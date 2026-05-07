// Per-case Timeline event persistence — landing target for migration 35.
//
// Two responsibilities:
//   1. computeEventSignature — TypeScript-side stable hash of the
//      (source_url, event_kind, date) triple used as case_events.ingest_signature.
//      Mirrors the case_sources.payload_hash pattern (TypeScript-computed at
//      extract time, schema-uniqued via the unique(case_id, ingest_signature)
//      constraint, no GENERATED column or trigger). Headline is deliberately
//      excluded — source titles drift between scrapes.
//
//   2. persistCaseEvents — upsert a batch of CaseEventInput rows for a
//      given case_id. Idempotent: on conflict do nothing keeps re-scrapes
//      from churning rows. Empty arrays are no-ops.
//
// Editorial discipline lives at the row level: every input must carry a
// non-empty source_url + source_quote. The schema enforces NOT NULL but
// we also defensive-skip rows missing either at this layer so a buggy
// extractor surfaces a structured warning instead of a confusing PG error.
// See migration 35 body comment for the source_quote anti-inference rule.
//
// Note: this module is import-from-Deno-and-Node safe (sha256Hex from
// http.ts uses Web Crypto). No top-level side effects.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DateQuality } from './types.ts';
import { sha256Hex } from './http.ts';

export type CaseEventKind =
  | 'incident'
  | 'last_seen'
  | 'remains_found'
  | 'case_spotlight_published'
  | 'status_resolved_arrest'
  | 'status_resolved_other'
  | 'status_identified';

export interface CaseEventInput {
  event_kind: CaseEventKind;
  headline: string;
  body?: string;

  /** Exact instant if known (rare for cold cases). */
  event_at?: string;
  /** Date-precision floor — the canonical timeline anchor. */
  event_date?: string;
  /** Range end (null for single-date events). */
  event_date_end?: string;
  /** Defaults to 'unknown' when omitted. */
  event_date_quality?: DateQuality;
  /** Free-form ('summer 1985', 'c. 1987-1988') preserved verbatim. */
  event_date_text?: string;

  /** Optional FK to the case_sources row that produced this event. */
  case_source_id?: string;
  /** FK to sources for the originating source row. Denormalized. */
  source_id?: string;
  /** REQUIRED. Canonical URL backing this event. */
  source_url: string;
  /** REQUIRED. Verbatim source text justifying this event. */
  source_quote: string;
}

/**
 * SHA-256 of `source_url|event_kind|date_floor`. The date_floor is the first
 * non-empty of (event_date_text, event_date, ''). Mirrors the migration 35
 * column comment exactly — change here MUST come with a migration that
 * resets case_events.ingest_signature, since pre-existing rows can't be
 * re-hashed without re-scraping.
 */
export async function computeEventSignature(
  input: Pick<CaseEventInput, 'source_url' | 'event_kind' | 'event_date' | 'event_date_text'>,
): Promise<string> {
  const dateFloor = input.event_date_text ?? input.event_date ?? '';
  return sha256Hex(`${input.source_url}|${input.event_kind}|${dateFloor}`);
}

interface PersistEventsContext {
  supabase: SupabaseClient;
  /** sources.id for the source that produced these events (denormalized into case_events.source_id). */
  sourceId: string;
}

/**
 * Persist a batch of timeline events for a case. Empty input is a no-op.
 * On unique-violation (case_id, ingest_signature), the row is silently
 * skipped — re-scrapes idempotently land the same event without churning.
 */
export async function persistCaseEvents(
  ctx: PersistEventsContext,
  caseId: string,
  events: CaseEventInput[] | undefined,
): Promise<void> {
  if (!events?.length) return;

  const rows: Record<string, unknown>[] = [];
  for (const ev of events) {
    if (!ev.source_url || !ev.source_quote) {
      // Schema would reject; surfacing here as a structured warning so a
      // buggy extractor doesn't fail the whole batch with a Postgres error.
      console.warn(
        JSON.stringify({
          msg: 'persistCaseEvents: skipping event missing source_url or source_quote',
          case_id: caseId,
          event_kind: ev.event_kind,
          has_source_url: Boolean(ev.source_url),
          has_source_quote: Boolean(ev.source_quote),
        }),
      );
      continue;
    }
    const signature = await computeEventSignature(ev);
    rows.push({
      case_id: caseId,
      event_kind: ev.event_kind,
      headline: ev.headline,
      body: ev.body ?? null,
      event_at: ev.event_at ?? null,
      event_date: ev.event_date ?? null,
      event_date_end: ev.event_date_end ?? null,
      event_date_quality: ev.event_date_quality ?? 'unknown',
      event_date_text: ev.event_date_text ?? null,
      case_source_id: ev.case_source_id ?? null,
      source_id: ev.source_id ?? ctx.sourceId,
      source_url: ev.source_url,
      source_quote: ev.source_quote,
      ingest_signature: signature,
    });
  }
  if (!rows.length) return;

  // upsert with ignoreDuplicates so the unique(case_id, ingest_signature)
  // constraint silently dedupes re-scrapes. We don't want onConflict-update
  // here — re-scrapes shouldn't overwrite an existing row's headline/body
  // (the migration explicitly excludes headline from the signature because
  // source titles drift; updating-on-conflict would re-introduce that
  // churn).
  const { error } = await ctx.supabase
    .from('case_events')
    .upsert(rows, {
      onConflict: 'case_id,ingest_signature',
      ignoreDuplicates: true,
    });
  if (error) {
    // Non-fatal — surface a structured warning so the case row write isn't
    // rolled back over a timeline write failure. Timeline is additive UI
    // material; persist.ts shouldn't fail a scrape over it.
    console.warn(
      JSON.stringify({
        msg: 'persistCaseEvents: upsert failed',
        case_id: caseId,
        row_count: rows.length,
        error: error.message,
      }),
    );
  }
}
