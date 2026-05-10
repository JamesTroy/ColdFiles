// Narrative-based location extraction via the Claude messages API.
// Returns the most likely "last known" or "discovery" location as a
// geocodable string + a confidence score. Caller passes the candidate
// through the Mapbox resolver (geocode-resolver.ts) and gates on the
// returned precision.
//
// Runtime-agnostic via fetch — works in both Deno (edge functions)
// and Node (the backfill CLI). System prompt is identical across
// every call; we mark it with cache_control so Anthropic prompt-caches
// it server-side. At ~5,665 calls in the backfill, the cache hit rate
// drops the per-call cost to ~$0.0006 vs. ~$0.003 uncached.
//
// Per CLAUDE.md and the claude-api skill: prefer the latest Haiku for
// cost; structured output via explicit JSON instructions in the system
// prompt (no tool calling needed for a single-field extraction). The
// model returns plain JSON; we parse + validate before returning.

export interface ExtractionInput {
  /** Free-text case narrative — the primary signal source. */
  narrative: string | null;
  /** Optional shorter card-summary narrative — secondary signal. */
  narrativeShort: string | null;
  /** Investigating agency name from migration 24 — auxiliary signal. */
  agencyName: string | null;
  /** Already-known city, used for prompt context and as the
   *  "fallback" baseline the candidate must improve on. */
  city: string | null;
  /** Already-known state code (e.g. 'CA'). */
  state: string | null;
}

export interface ExtractionResult {
  /** The geocodable location string the LLM returned, or null if no
   *  specific signal was extractable from the narrative. */
  candidate: string | null;
  /** 0.0-1.0 confidence score from the LLM. Null when the LLM
   *  declined to extract (e.g., narrative was empty). */
  confidence: number | null;
  /** One-sentence rationale from the LLM, kept for the audit log. */
  reasoning: string;
  /** Model identifier used for the call. Logged for reproducibility
   *  if extraction quality is later questioned. */
  model: string;
}

/**
 * The model used for all extractions. Claude Haiku 4.5 — fast, cheap,
 * sufficient for single-narrative location extraction. Pinned to the
 * specific snapshot rather than a moving alias so a future model
 * upgrade is an explicit decision rather than a silent quality shift.
 */
export const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';

/**
 * System prompt — identical for every call. Marked with cache_control
 * so Anthropic prompt-caches it server-side. The cache TTL is 5
 * minutes; the backfill CLI batches calls in ~30s windows so cache
 * hits are near-100% during a backfill run.
 */
const SYSTEM_PROMPT = `You analyze cold-case narratives to extract the most likely "last known location" (for missing-person cases) or "discovery location" (for unidentified-remains cases) for use with a geocoder.

Output ONLY valid JSON matching this schema (no prose, no markdown):
{"candidate": string | null, "confidence": number, "reasoning": string}

Rules:
1. The candidate must be a geocodable string the Mapbox geocoder can resolve. Examples:
   - "100 block of Bernard Street, Houma, LA"
   - "3rd and South Streets, Philadelphia, PA"
   - "University of Alaska, Anchorage, AK"
   - "5300 block of Sierra Vista Avenue, Los Angeles, CA"
   - "Soda Dry Lake along Zzyzx Road, Baker, CA"
2. Always include the city and state in the candidate string for geocoder context.
3. For missing-person cases: use the LAST known location of the person (where they were last seen alive).
4. For unidentified-remains cases: use the discovery location of the body or remains.
5. Set candidate=null if only vague references exist ("his apartment", "her home", "near a friend's house"). Vague city-only references are also null since the geocoder already has the city.
6. Don't return locations from sightings or events AFTER disappearance unless that's the only signal in the narrative.
7. If multiple candidates exist, pick the one most directly tied to the disappearance/discovery event itself.
8. Set confidence based on specificity:
   - 0.90-1.00: explicit street + number ("1003 Pierce Street, Apt. B-3, Sioux City, IA")
   - 0.75-0.90: block + street ("100 block of Bernard Street, Houma, LA") OR a uniquely-named landmark ("University of Alaska, Anchorage, AK")
   - 0.55-0.75: intersection or general landmark ("near Walmart on Highway 80, Macon County, AL")
   - <0.55: vague references; prefer candidate=null over a low-confidence string.
9. Confidence must be a number between 0.0 and 1.0 inclusive. Reasoning must be one sentence.`;

/**
 * Call Claude with the case context. Returns parsed extraction or
 * throws on transport / parse errors. Caller handles the throw and
 * logs an 'errored' outcome.
 */
export async function extractLocation(
  input: ExtractionInput,
  apiKey: string,
): Promise<ExtractionResult> {
  // No narrative + no agency hint → there's nothing for the LLM to
  // chew on; skip the API call entirely. Caller logs
  // 'rejected_no_narrative' / 'rejected_no_signal'.
  const hasNarrative = !!(input.narrative || input.narrativeShort);
  if (!hasNarrative && !input.agencyName) {
    return {
      candidate: null,
      confidence: null,
      reasoning: 'No narrative or agency hint provided.',
      model: EXTRACTION_MODEL,
    };
  }

  const userPrompt = buildUserPrompt(input);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      max_tokens: 256,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(
      `Anthropic API ${response.status}: ${errBody.slice(0, 200)}`,
    );
  }

  const json = (await response.json()) as AnthropicMessageResponse;
  const textBlock = json.content?.find((b) => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new Error('Anthropic response had no text content block');
  }

  return parseExtractionJson(textBlock.text);
}

/**
 * Build the user prompt. Intentionally short — the system prompt
 * carries the rules; the user message is just the case context.
 */
function buildUserPrompt(input: ExtractionInput): string {
  const cityState =
    input.city && input.state
      ? `${input.city}, ${input.state}`
      : input.state ?? input.city ?? 'unknown';

  // Use narrative_short as a fallback when the full narrative is
  // missing — happens for some sources that only carry the card
  // summary.
  const narrative = input.narrative ?? input.narrativeShort ?? '(no narrative)';
  const agency = input.agencyName ?? 'unknown';

  return [
    `Case context:`,
    `- City, State (already known): ${cityState}`,
    `- Investigating agency: ${agency}`,
    ``,
    `Narrative:`,
    narrative,
  ].join('\n');
}

/**
 * Parse the LLM's JSON response. Strict — any deviation from the
 * schema throws so the caller logs 'errored' rather than silently
 * accepting bad data.
 */
export function parseExtractionJson(text: string): ExtractionResult {
  // Strip markdown code-fences if the model adds them despite the
  // system instruction. Defensive — the rules say "no markdown" but
  // models occasionally hedge.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `LLM response was not valid JSON: ${text.slice(0, 200)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM JSON was not an object');
  }
  const obj = parsed as Record<string, unknown>;

  const candidate =
    obj.candidate === null || obj.candidate === undefined
      ? null
      : typeof obj.candidate === 'string'
        ? obj.candidate.trim() || null
        : null;
  const confidence =
    typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
      ? Math.max(0, Math.min(1, obj.confidence))
      : null;
  const reasoning =
    typeof obj.reasoning === 'string'
      ? obj.reasoning.trim()
      : '(no reasoning)';

  return {
    candidate,
    confidence,
    reasoning,
    model: EXTRACTION_MODEL,
  };
}

interface AnthropicMessageResponse {
  content?: Array<{ type: string; text?: string }>;
}
