/**
 * Project: Cold Case — family-attributed unsolved homicides via WordPress
 * REST API.
 *
 * The earlier dormancy block (sources/namus.ts-style "wake-up paths" comment
 * and the memory note `project_cold_case_deferred.md`) was based on a
 * misread of the site structure. We thought the case detail was a SPA stub
 * fed by AJAX. It isn't. Each "Cold Case Spotlight" post is a regular
 * WordPress post under date-based permalinks (/YYYY/MM/DD/slug/), and the
 * site exposes the standard WP REST API at /wp-json/wp/v2/posts.
 *
 * Discovery: paginate /wp-json/wp/v2/posts?categories=4 (Cold Case
 * Spotlight, ~376 posts as of 2026-05-02) and emit one API URL per post.
 *
 * Detail: fetch /wp-json/wp/v2/posts/{id}. The response carries a
 * `yoast_head_json` object with a SEO-grade `description` field — a
 * single-sentence summary that names the victim, action, location, and
 * date in a consistent enough shape to parse for incident_date and
 * location_state. Examples:
 *
 *   "Edward McClain went missing from the 1600 block of Colgate Road in
 *    Jacksonville, FL on November 20, 2000 and has not been heard from
 *    since."
 *   "On April 5, 2018, deputies responded to reports of gunfire on SW
 *    Williston Rd. in Gainesville, FL and found Devonte Jenkins shot to
 *    death."
 *
 * The full body content is in `content.rendered` (HTML); we strip it for
 * narrative.
 *
 * Trust weight: 75 — same tier as Charley (volunteer-aggregator with
 * documented family-submission intake; not an authoritative federal
 * source like NamUs).
 *
 * Be polite: PCC is a small nonprofit. 5s rate limit + the 02:00–05:00 UTC
 * window from Charley's playbook.
 */

import type {
  AgencyHint,
  CaseRecord,
  DateQuality,
  ExtractedPhoto,
  SourceConfig,
} from '../supabase/functions/_shared/types.ts';
import {
  parseDate,
  parseState,
  splitName,
  stripHtml,
  truncateNarrative,
} from '../supabase/functions/_shared/normalize.ts';

const API_BASE = 'https://projectcoldcase.org/wp-json/wp/v2';
const COLD_CASE_SPOTLIGHT_CATEGORY = 4;
const PER_PAGE = 100;
const MAX_PAGES = 10; // safety cap; ~376 posts as of 2026-05-02 → 4 pages

// ────────────────────────────────────────────────────────────────────────────
// URL classifier — sorts PCC posts into three branches at the discovery
// layer. Replaces the prior "ingest everything, hope the title heuristic
// catches the noise" approach that audit (2026-05-04) found leaving
// ~10-15 garbage records in `cases` and producing 183 dedupe-failure
// errors per scrape pass.
//
// Three classes:
//
//   victim         — original case file ("Aaron Bustamante", date-based
//                    permalink, victim_name = post title). Normal
//                    extraction.
//
//   status-update  — post about an existing case's resolution ("Arrest
//                    Made in Isaac Hodges Case", "Solved Cold Case
//                    Spotlight – Jamal Fleming"). Routed to a status-
//                    update path that finds the existing case by name
//                    and propagates the status flip; never inserts.
//
//   editorial      — generic content unrelated to a specific case
//                    (Grief Diaries interview series, 2nd Annual Year
//                    of Hope fundraiser, "Arrests Don't Always Equal
//                    Justice" commentary). Skipped entirely at
//                    discovery — never hits the extractor, never
//                    produces a record, never logs an error.
//
// See feedback_extractor_editorial_noise.md memory note for the
// pattern this is solving (second instance after FBI Wanted's
// editorial-misfit retirement).
// ────────────────────────────────────────────────────────────────────────────

export type PccUrlClass = 'victim' | 'status-update' | 'editorial';

export interface PccStatusUpdateHint {
  /** Mapped resolution status from the post title. */
  status: 'cleared_arrest' | 'cleared_other';
  /**
   * Victim name extracted from the title. Used by the status-update
   * handler to find the existing case in `cases`. May be null when
   * the title parse fails — caller skips in that case.
   */
  victimNameHint: string | null;
}

export interface PccClassification {
  class: PccUrlClass;
  /** Set only when class === 'status-update'. */
  statusUpdate?: PccStatusUpdateHint;
}

// Editorial-noise URL slugs (matched against the slug portion after the
// /YYYY/MM/DD/ date prefix). Patterns are anchored at slug start with
// a word boundary at end so partial-prefix collisions are avoided.
const EDITORIAL_NOISE_SLUG_PATTERNS: readonly RegExp[] = [
  /^grief-diaries(-|$)/i,
  /^year-of-hope(-|$)/i,
  /^\d+(st|nd|rd|th)?-annual(-|$)/i,
  /^annual-year-of-hope(-|$)/i,
  /^arrests?-don.?t-always-equal-justice(-|$)/i,
  /(^|-)fundraiser(-|$)/i,
  // "Cold Case Spotlight – <Name>" summary roundup posts (editorial,
  // not individual victim files). The prior discoverFn skipped these
  // with /\/cold-case-spotlight-/i; the classifier carries that forward.
  // NOTE: this pattern is anchored at slug start, so it does NOT match
  // /solved-cold-case-spotlight-/ or /update-solved-cold-case-spotlight-/
  // — those classify as status-update below. Order is preserved.
  /^cold-case-spotlight(-|$)/i,
];

// Status-update slug patterns. Order matters — more-specific patterns
// first so they classify correctly. "arrest-made-solved-cold-case-
// spotlight-…" is an arrest update (cleared_arrest); plain "solved-
// cold-case-spotlight-…" is generic resolution (cleared_other).
const STATUS_UPDATE_SLUG_PATTERNS: ReadonlyArray<{
  re: RegExp;
  status: PccStatusUpdateHint['status'];
}> = [
  { re: /^arrest-made-solved-cold-case-spotlight-/i, status: 'cleared_arrest' },
  { re: /^arrests?-made(-in)?-/i, status: 'cleared_arrest' },
  { re: /^update-solved-cold-case-spotlight-/i, status: 'cleared_other' },
  { re: /^solved-cold-case-spotlight-/i, status: 'cleared_other' },
];

// Title-based victim-name extraction for status-update posts. Each
// pattern's first capture group is the victim name. Order matches the
// status-update slug patterns so a post matched by URL gets a parallel
// title regex applied.
const TITLE_NAME_PATTERNS: readonly RegExp[] = [
  /^Arrests?\s+Made\s+(?:in\s+)?(.+?)\s+(?:Case|case|Investigation)\s*$/i,
  /^Arrest\s+Made:?\s*Solved\s+Cold\s+Case\s+Spotlight\s*[–\-:]\s*(.+?)\s*$/i,
  /^(?:Update:?\s*)?Solved\s+Cold\s+Case\s+Spotlight\s*[–\-:]\s*(.+?)\s*$/i,
];

/** Pull the slug portion after the /YYYY/MM/DD/ date prefix. */
function slugFromUrl(url: string): string | null {
  // PCC permalinks: https://projectcoldcase.org/2018/04/24/<slug>/?pcc_id=...
  // OR /<slug>/ (no date) for some legacy paths.
  const m = url.match(/projectcoldcase\.org\/(?:\d{4}\/\d{2}\/\d{2}\/)?([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Try each title pattern in order; return the first non-empty capture. */
function extractVictimNameFromTitle(title: string): string | null {
  for (const re of TITLE_NAME_PATTERNS) {
    const m = title.match(re);
    if (m && m[1]) {
      const name = m[1].trim();
      if (name) return name;
    }
  }
  return null;
}

/**
 * Classify a PCC URL + title into one of three branches. The title is
 * optional at discovery (we may only have the URL); when classified as
 * status-update without a title, the victim-name hint stays null and
 * the consumer skips. When the title is available, the hint is filled.
 */
export function classifyPccUrl(url: string, title?: string): PccClassification {
  const slug = slugFromUrl(url);
  if (!slug) return { class: 'victim' }; // can't classify; treat as victim

  for (const re of EDITORIAL_NOISE_SLUG_PATTERNS) {
    if (re.test(slug)) return { class: 'editorial' };
  }

  for (const { re, status } of STATUS_UPDATE_SLUG_PATTERNS) {
    if (re.test(slug)) {
      const victimNameHint = title ? extractVictimNameFromTitle(title) : null;
      return {
        class: 'status-update',
        statusUpdate: { status, victimNameHint },
      };
    }
  }

  return { class: 'victim' };
}

interface YoastImage {
  url?: string;
  width?: number;
  height?: number;
  type?: string;
}

interface YoastHeadJson {
  title?: string;
  description?: string;
  og_image?: YoastImage[];
  article_published_time?: string;
  author?: string;
}

interface PccPost {
  id: number;
  slug: string;
  link: string;
  date: string;
  title: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  yoast_head_json?: YoastHeadJson;
}

/**
 * Decode the HTML entities WP serializes into JSON post titles and Yoast
 * descriptions: numeric (&#NNNN; / &#xHHHH;) and a small set of named
 * entities common in WP-generated content. Without decoding, names with
 * apostrophes serialize as "De&#8217;Shaun" which we'd then key into the
 * dedupe table with the entity baked in. WP serves the entity-encoded form
 * in the JSON API even though the rendered HTML page decodes it; we have
 * to do the decode ourselves.
 */
function decodeHtmlEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Pull date + city + state out of a Yoast description sentence.
 *
 * Two main shapes the descriptions take:
 *   1. "<Name> went missing from <where> in <City>, <State> on <Date> ..."
 *   2. "On <Date>, ... in <City>, <State> ... <Name> ..."
 *
 * The order matters less than the markers. We look for:
 *   - date:  "<Month> <day>, <year>" or "<year>" patterns anywhere
 *   - state: "<City>, <2-letter-state>" or "<City>, <FullStateName>"
 */
function parseYoastDescription(desc: string): {
  iso?: string;
  quality: DateQuality;
  rawDate?: string;
  city?: string;
  state?: string;
  locationText?: string;
} {
  const out: ReturnType<typeof parseYoastDescription> = { quality: 'unknown' };
  if (!desc) return out;

  // Date — try month-day-year first, then month-year, then year-only.
  // Anchor on word boundaries so "May 15" inside a name doesn't match.
  const monthDayYear = desc.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/,
  );
  if (monthDayYear) {
    const parsed = parseDate(monthDayYear[0]);
    if (parsed.iso) {
      out.iso = parsed.iso;
      out.quality = parsed.quality;
      out.rawDate = monthDayYear[0];
    }
  } else {
    const monthYear = desc.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/,
    );
    if (monthYear) {
      const parsed = parseDate(monthYear[0]);
      if (parsed.iso) {
        out.iso = parsed.iso;
        out.quality = parsed.quality;
        out.rawDate = monthYear[0];
      }
    } else {
      const yearOnly = desc.match(/\b(19\d{2}|20\d{2})\b/);
      if (yearOnly) {
        out.iso = `${yearOnly[1]}-01-01`;
        out.quality = 'year_only';
        out.rawDate = yearOnly[1];
      }
    }
  }

  // Location — "<City>, <ST>" with a 2-letter state. We anchor before the
  // comma so we don't match arbitrary commas in the sentence.
  const cityState = desc.match(
    /\bin\s+([A-Z][A-Za-z .'-]{1,40}?),\s+([A-Z]{2})\b/,
  );
  if (cityState) {
    out.city = cityState[1].trim();
    out.state = cityState[2];
    out.locationText = `${out.city}, ${out.state}`;
  } else {
    // Fallback: try full-state-name pattern.
    const cityStateFullName = desc.match(
      /\bin\s+([A-Z][A-Za-z .'-]{1,40}?),\s+([A-Z][A-Za-z ]+?)(?=[\s,.])/,
    );
    if (cityStateFullName) {
      const stateCode = parseState(cityStateFullName[2]);
      if (stateCode) {
        out.city = cityStateFullName[1].trim();
        out.state = stateCode;
        out.locationText = `${out.city}, ${stateCode}`;
      }
    }
  }

  return out;
}

export const projectColdCase: SourceConfig = {
  slug: 'project_cold_case',
  name: 'Project: Cold Case',
  kind: 'nonprofit',
  baseUrl: 'https://projectcoldcase.org',
  rateLimitMs: 5000,
  scheduleCron: '0 9 5 * *',
  trustWeight: 75,
  windowUtc: { startHour: 2, endHour: 5 },
  attribution: {
    html:
      'Source: <a href="https://projectcoldcase.org" rel="external">Project: Cold Case</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'custom',
    // Discovery emits the human-facing canonical URLs (date-permalink form
    // like /2026/04/27/edward-mcclain/) so case_sources.source_url stores
    // the URL we'd actually want a user to land on if they tap the source
    // chip on the case detail. The post ID rides along as a `?pcc_id=`
    // query param so detail.fetchUrls below can derive the WP REST API
    // endpoint without an extra slug-lookup round-trip per case.
    //
    // deriveExternalId in pipeline.ts checks `?id=` first; we use
    // `?pcc_id=` specifically so that check falls through and external_id
    // resolves to the URL's last path segment (the WP slug, e.g.
    // 'edward-mcclain'). Stable across re-scrapes.
    discoverFn: async (fetcher, detailLimit) => {
      const target = detailLimit ?? Infinity;
      const urls: string[] = [];
      for (let page = 1; page <= MAX_PAGES && urls.length < target; page += 1) {
        const items = await fetcher.getJson<
          Array<{ id: number; link: string }>
        >(
          `${API_BASE}/posts?categories=${COLD_CASE_SPOTLIGHT_CATEGORY}&per_page=${PER_PAGE}&_fields=id,link&page=${page}`,
        );
        if (!Array.isArray(items) || items.length === 0) break;
        for (const item of items) {
          if (typeof item?.id !== 'number' || typeof item?.link !== 'string') continue;
          // Three-way classification at discovery (classifyPccUrl above):
          //   editorial      → skip entirely (Grief Diaries, Year of Hope,
          //                    fundraisers, "Cold Case Spotlight – <Name>"
          //                    roundup summaries).
          //   status-update  → keep — extractor will produce a
          //                    status_update_only-flagged record so
          //                    persistRecord merges into an existing case
          //                    or skips, never inserts.
          //   victim         → keep — normal extraction path.
          const klass = classifyPccUrl(item.link).class;
          if (klass === 'editorial') continue;
          const sep = item.link.includes('?') ? '&' : '?';
          urls.push(`${item.link}${sep}pcc_id=${item.id}`);
          if (urls.length >= target) break;
        }
        if (items.length < PER_PAGE) break; // last page
      }
      return urls;
    },
  },
  detail: {
    kind: 'json',
    // Translate the discovery-emitted human URL into the WP REST API
    // endpoint by extracting the embedded pcc_id query param.
    fetchUrls: (detailUrl) => {
      let id = '';
      try {
        id = new URL(detailUrl).searchParams.get('pcc_id') ?? '';
      } catch {
        /* fall through */
      }
      if (!id) {
        // Defensive: if pcc_id wasn't encoded (e.g. a manually-supplied
        // detail URL), the fetcher will return an empty post object and
        // mapJson handles it as a skip.
        return { post: detailUrl };
      }
      return { post: `${API_BASE}/posts/${id}` };
    },
    mapJson: (data, detailUrl): Partial<CaseRecord> => {
      const post = data.post as PccPost | null;
      if (!post) return { raw: { empty: true } };

      const yoast = post.yoast_head_json ?? {};
      const description = decodeHtmlEntities(yoast.description ?? '').trim();
      const parsed = parseYoastDescription(description);

      const titleRendered = decodeHtmlEntities(
        stripHtml(post.title?.rendered ?? ''),
      ).trim();

      // Defensive belt-and-suspenders against the discoverFn URL filter:
      // if a Cold Case Spotlight post slips through (e.g. PCC adds a new
      // category-tag pattern we don't catch), the title heuristic still
      // skips the record. The title format is consistent: "Cold Case
      // Spotlight – <Name>" with an em-dash. Fall through to empty so
      // the persist path treats it as a no-op.
      if (/^cold case spotlight\b/i.test(titleRendered)) {
        return { raw: { skipped: 'cold-case-spotlight-summary' } };
      }

      // Status-update routing. URLs that classify as status-update at
      // discovery (e.g. /arrests-made-in-X-case/, /solved-cold-case-
      // spotlight-X/) document a resolution event for an EXISTING case
      // — not a new case file. Produce a minimal record carrying just
      // the resolution status + the victim-name hint extracted from
      // the title; persistRecord (with status_update_only=true) merges
      // into the matching existing case, or logs + skips when no match.
      //
      // We re-classify here (rather than threading state from discovery)
      // because classifyPccUrl is pure + cheap, and re-running with the
      // title in hand fills the victimNameHint that URL-only
      // classification couldn't.
      const classification = classifyPccUrl(detailUrl, titleRendered);
      if (classification.class === 'status-update' && classification.statusUpdate) {
        const hint = classification.statusUpdate;
        const hintParts = hint.victimNameHint
          ? splitName(hint.victimNameHint)
          : { first: undefined, last: undefined };
        return {
          kind: 'homicide',
          status: hint.status,
          status_update_only: true,
          victim_name: hint.victimNameHint ?? undefined,
          victim_first_name: hintParts.first,
          victim_last_name: hintParts.last,
          // Nothing else populated — this record is a status flip, not
          // a new case file. The merge path will only touch the status
          // field on the matched existing case.
          raw: {
            post_id: post.id,
            slug: post.slug,
            link: post.link,
            classification: 'status-update',
            proposed_status: hint.status,
            title: titleRendered,
          },
        };
      }

      const nameParts = titleRendered ? splitName(titleRendered) : { first: undefined, last: undefined };

      const photos: ExtractedPhoto[] = (yoast.og_image ?? [])
        .map((img) => img.url)
        .filter((u): u is string => !!u && u.startsWith('http'))
        .map((url) => ({ url, kind: 'photo_victim' as const }));

      const bodyHtml = post.content?.rendered ?? '';
      const narrativeRaw = stripHtml(bodyHtml).trim();
      const narrative = narrativeRaw ? truncateNarrative(narrativeRaw) : undefined;
      // Yoast description is the SEO-tuned single-sentence summary —
      // perfect as the narrative_short; falls back to the body's first
      // paragraph when description is missing.
      const narrativeShort =
        description ||
        narrativeRaw.split(/\n{2,}/)[0]?.slice(0, 240) ||
        undefined;

      const agencyHint: AgencyHint = {
        // PCC doesn't consistently name the investigating agency in their
        // descriptions; route tips to PCC's own info-seeking line, which
        // forwards to the family + agency on their side.
        name: 'Project: Cold Case',
        tip_url: 'https://projectcoldcase.org/contact-us/',
      };

      return {
        kind: 'homicide',
        status: 'open',
        victim_name: titleRendered || undefined,
        victim_first_name: nameParts.first,
        victim_last_name: nameParts.last,

        incident_date: parsed.iso,
        incident_date_quality: parsed.quality,
        incident_date_text:
          parsed.rawDate && parsed.quality !== 'exact' ? parsed.rawDate : undefined,

        location_text: parsed.locationText,
        location_city: parsed.city,
        location_state: parsed.state,

        narrative,
        narrative_short: narrativeShort,

        agency_hint: agencyHint,
        photos,

        raw: {
          post_id: post.id,
          slug: post.slug,
          link: post.link,
          published_at: yoast.article_published_time,
          author: yoast.author,
        },
      };
    },
    inferKind: () => 'homicide',
  },
  defaults: {
    status: 'open',
    kind: 'homicide',
    incident_date_quality: 'unknown',
    photos: [],
    raw: {},
  },
};
