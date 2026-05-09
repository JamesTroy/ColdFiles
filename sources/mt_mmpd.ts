import type {
  AgencyHint,
  CaseRecord,
  ExtractedPhoto,
  SourceConfig,
} from '../supabase/functions/_shared/types.ts';
import type { CaseEventInput } from '../supabase/functions/_shared/case-events.ts';
import {
  extractPhone,
  heightToCm,
  parseDate,
  parseSex,
  weightToKg,
} from '../supabase/functions/_shared/normalize.ts';

/**
 * Montana DOJ Missing Persons Database (MMPD).
 * https://app.dojmt.gov/apps/missingPersonDatabase/
 *
 * Statutorily-backed state clearinghouse run by the MT DOJ. Spans
 * 1975 to present (~165 active cases as of 2026-05-09). The standout
 * editorial property: a dedicated `?filter=indigenous` filter that
 * already segregates 43 Native cases — ~26% of the corpus, vs MT's
 * ~6.7% AI/AN population share. The state explicitly tracks MMIW as
 * a first-class category, and the database is referenced by the
 * Montana Missing & Murdered Indigenous Persons Advisory Council
 * (mtmissing.org).
 *
 * This is the kind of "weak Doe Network coverage" target the
 * thesis is about: small absolute count but high editorial value
 * because the cases overrepresent demographics that volunteer-curated
 * sources systematically miss.
 *
 * IMPORTANT — robots.txt: dojmt.gov + app.dojmt.gov BOTH disallow
 * ClaudeBot in their AI-bot block. Our scraper UA is the project's
 * default ColdFileBot/1.0 (Mozilla-compatible per http.ts), which is
 * not blocked. Do NOT change the UA to anything resembling ClaudeBot.
 *
 * Listing surface — `/apps/missingPersonDatabase/results.php`
 *   Single page, no pagination, all 165 cases inline as <li class=
 *   "personCard"> items with an OpenDetailsWindow(...) JS handler
 *   on click. The handler args carry essentially the full record:
 *     [photoSha[]], [photoDate[]], "Lastname, Firstname", "MALE",
 *     "15", "AMERICAN INDIAN OR ALASKAN NATIVE", "BLACK", "BROWN",
 *     "601", "150", "04/14/2026", "Blaine County Sheriff", "", "45874"
 *   The 14th arg is the case ID. We regex-extract IDs and build
 *   detail URLs from them.
 *
 * Detail page — MissingPersonDetails.php?id=<n>
 *   Structured HTML: h1.nameHeader for name, fullDetailsPhotosContainer
 *   for photos, then <p><b>Label:</b> value<br><b>Label:</b> value</p>
 *   blocks for demographics + agency. Has agency PHONE (which the
 *   listing doesn't). Aliases present. No narrative paragraph.
 *
 *   Fields exposed:
 *     Name, Age Now, Gender, Race, Hair Color, Eye Color, Height,
 *     Weight, Date of Last Contact, Investigating Agency,
 *     Investigating Agency Phone, Aliases.
 *
 *   No agency case number, no NCIC/NamUs cross-IDs, no narrative.
 *   Tier-1 dedupe relies on name_state_year (lastname_age_sex is
 *   candidate-tier).
 *
 * Photo policy: state government work, agency-released. Hot-link OK
 * with source_attribution = 'Montana DOJ MMPD'. Photos use
 * SHA256-named JPEGs under /apps/missingPersonDatabase/images/mmps_img/
 *
 * Trust weight: 80. Same as NY DCJS / CA MUPS / NM DPS.
 *
 * Schedule: weekly Sunday 06:00 UTC. Full crawl ~28 minutes at
 * 10s/req across 165 cases — robots.txt declares no global Crawl-
 * delay but we honor 10s as the agent-research-derived politeness
 * floor for this host.
 */

const BASE = 'https://app.dojmt.gov';
const LISTING_URL = `${BASE}/apps/missingPersonDatabase/results.php`;
const DETAIL_PATH = '/apps/missingPersonDatabase/MissingPersonDetails.php';

/**
 * "Lastname, Firstname Middle Jr" → "Firstname Middle Jr Lastname"
 *
 * MT MMPD displays names in reversed comma form on both listing and
 * detail. Normalize to natural order so dedupe key generation
 * (name_state_year, lastname_age_sex) and display surfaces work
 * consistently with the rest of the corpus.
 */
function normalizeName(reversed: string): string {
  const trimmed = reversed.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(',');
  if (parts.length < 2) return trimmed;
  const last = parts[0]?.trim() ?? '';
  const rest = parts.slice(1).join(',').trim();
  return rest ? `${rest} ${last}` : last;
}

/**
 * Walk the page's <p><b>Label:</b> value<br><b>Label:</b> value</p>
 * structure. Each <p> may carry multiple labeled values separated
 * by <br>. Returns the text after the matching <b>Label:</b> up to
 * the next <b> or end-of-paragraph.
 *
 * Match is case-insensitive on the label. Returns the first non-
 * empty value across all <p> elements.
 */
function pLabelValue(
  $: import('cheerio').CheerioAPI,
  label: string,
): string | undefined {
  const wantedLower = label.toLowerCase();
  let result: string | undefined;
  $('p').each((_, el) => {
    if (result !== undefined) return;
    // Extract HTML so we can split on <br>. The cheerio html() gives
    // us the inner HTML; we then split on br tags (handling br/br /
    // br /-self-closing variants) and look for <b>Label:</b> pattern.
    const html = $(el).html() ?? '';
    const segments = html.split(/<br\s*\/?>/i);
    for (const seg of segments) {
      // Match <b>Label:</b> followed by everything up to the next
      // tag boundary or end of segment.
      const re = new RegExp(
        `<b>\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*:?\\s*</b>([^<]*)`,
        'i',
      );
      const m = seg.match(re);
      if (!m) continue;
      const v = (m[1] ?? '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#?[a-z0-9]+;/gi, '') // strip remaining entity refs
        .replace(/\s+/g, ' ')
        .trim();
      if (v) {
        result = v;
        return;
      }
    }
    // Cheerio's text() pass — handles odd cases where the label is
    // present but the inline-block <span> wrapping interferes with
    // the regex. Less reliable; fallback only.
    if (result === undefined) {
      const textBlocks = $(el).text().split(/\n+/);
      for (const block of textBlocks) {
        const idx = block.toLowerCase().indexOf(`${wantedLower}:`);
        if (idx >= 0) {
          const v = block.slice(idx + label.length + 1).trim();
          if (v) {
            result = v;
            return;
          }
        }
      }
    }
  });
  return result;
}

/**
 * Photo extractor — pull <img> elements out of the
 * .fullDetailsPhotosContainer wrapper and resolve relative
 * "./images/mmps_img/<sha>.jpg" URLs to absolute. Pair with the
 * sibling <figcaption>'s "Photo Date: MM/DD/YYYY" when present.
 */
function pickPhotos($: import('cheerio').CheerioAPI): ExtractedPhoto[] {
  const photos: ExtractedPhoto[] = [];
  $('.fullDetailsPhotosContainer img').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const url = src.startsWith('http')
      ? src
      : `${BASE}/apps/missingPersonDatabase/${src.replace(/^\.\//, '').replace(/^\/+/, '')}`;
    photos.push({ url, kind: 'photo_victim' as const });
  });
  return photos;
}

export const mtMmpd: SourceConfig = {
  slug: 'mt_mmpd',
  name: 'Montana DOJ Missing Persons Database',
  kind: 'state',
  baseUrl: BASE,
  rateLimitMs: 10_000, // 10s — agent-research-derived politeness for the MMPD host
  scheduleCron: '0 6 * * 0', // Sunday 06:00 UTC — weekly
  trustWeight: 80,
  attribution: {
    html:
      'Source: <a href="https://app.dojmt.gov/apps/missingPersonDatabase/" rel="external">Montana DOJ Missing Persons Database</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'custom',
    discoverFn: async (fetcher, detailLimit) => {
      const html = await fetcher.getText(LISTING_URL);
      // Listing items use OpenDetailsWindow(..., "<id>") on click —
      // no <a href> we can scrape. The case ID is the LAST quoted
      // argument in the call. Regex-extract every match, then dedupe.
      // Each call's argument list looks like:
      //   OpenDetailsWindow([{}],["mm/dd/yyyy"],"Lastname, First","MALE",
      //     "15","RACE","HAIR","EYE","601","150","mm/dd/yyyy",
      //     "Investigating Agency","aliases","45874")
      const seen = new Set<string>();
      const urls: string[] = [];
      const callRe = /OpenDetailsWindow\(([^)]*)\)/g;
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(html)) !== null) {
        const argString = m[1] ?? '';
        // Last quoted token is the ID — the trailing ","45874")
        // pattern. Trim trailing whitespace + paren-close.
        const idMatch = argString.match(/"([^"]+)"\s*$/);
        if (!idMatch) continue;
        const id = idMatch[1] ?? '';
        if (!/^\d+$/.test(id)) continue;
        const detailUrl = `${BASE}${DETAIL_PATH}?id=${id}`;
        if (seen.has(detailUrl)) continue;
        seen.add(detailUrl);
        urls.push(detailUrl);
        if (detailLimit && urls.length >= detailLimit) break;
      }
      return urls;
    },
  },
  detail: {
    kind: 'cheerio',
    selectors: {
      // h1.nameHeader carries "Lastname, Firstname Middle". The
      // runner's selector path will set victim_name + auto-split into
      // first/last via splitName. The reversal isn't ideal — a
      // reversed-form "Stewart, Robert" becomes first='Stewart',
      // last='Robert'. We override victim_first_name + victim_last_name
      // in transforms below to fix the order.
      name: 'h1.nameHeader',
    },
    transforms: {
      // Re-derive name fields from the comma-reversed form.
      victim_name: (_raw, $) => {
        const raw = $('h1.nameHeader').first().text().trim();
        return raw ? normalizeName(raw) : undefined;
      },
      victim_first_name: (_raw, $) => {
        const raw = $('h1.nameHeader').first().text().trim();
        if (!raw) return undefined;
        const parts = raw.split(',');
        if (parts.length < 2) return undefined;
        // "Robert Garrett Jr" → "Robert" (first token)
        return parts[1]?.trim().split(/\s+/)[0] || undefined;
      },
      victim_last_name: (_raw, $) => {
        const raw = $('h1.nameHeader').first().text().trim();
        if (!raw) return undefined;
        return raw.split(',')[0]?.trim() || undefined;
      },

      victim_age: (_raw, $) => {
        const ageRaw = pLabelValue($, 'Age Now');
        if (!ageRaw) return undefined;
        const n = parseInt(ageRaw, 10);
        return Number.isFinite(n) && n >= 0 && n <= 130 ? n : undefined;
      },
      victim_sex: (_raw, $) => parseSex(pLabelValue($, 'Gender') ?? ''),
      victim_race: (_raw, $) => pLabelValue($, 'Race'),
      victim_hair_color: (_raw, $) => pLabelValue($, 'Hair Color'),
      victim_eye_color: (_raw, $) => pLabelValue($, 'Eye Color'),
      victim_height_cm: (_raw, $) => {
        // MT exposes "5 ft 11 in" form. heightToCm parses both this
        // and the apostrophe-quote form.
        const raw = pLabelValue($, 'Height');
        if (!raw) return undefined;
        // Convert "5 ft 11 in" → "5'11""
        const m = raw.match(/(\d+)\s*ft\s*(\d+)?\s*in?/i);
        if (m) {
          const ft = m[1] ?? '0';
          const inches = m[2] ?? '0';
          return heightToCm(`${ft}'${inches}"`);
        }
        return heightToCm(raw);
      },
      victim_weight_kg: (_raw, $) => {
        const raw = pLabelValue($, 'Weight');
        return raw ? weightToKg(raw) : undefined;
      },
      victim_aliases: (_raw, $) => {
        const raw = pLabelValue($, 'Aliases');
        if (!raw) return undefined;
        return raw
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.toLowerCase() !== 'xx');
      },

      incident_date: (_raw, $) =>
        parseDate(pLabelValue($, 'Date of Last Contact') ?? '').iso,
      incident_date_quality: (_raw, $) =>
        parseDate(pLabelValue($, 'Date of Last Contact') ?? '').quality,
      incident_date_text: (_raw, $) => {
        const raw = pLabelValue($, 'Date of Last Contact');
        if (!raw) return undefined;
        const parsed = parseDate(raw);
        return parsed.quality !== 'exact' ? raw : undefined;
      },
      last_seen_date: (_raw, $) =>
        parseDate(pLabelValue($, 'Date of Last Contact') ?? '').iso,

      // Location — MT MMPD doesn't expose city/state on the detail
      // page (the listing card carries county). Default state to MT
      // since the corpus is statutorily MT-only.
      location_state: () => 'MT',

      agency_hint: (_raw, $): AgencyHint | undefined => {
        const name = pLabelValue($, 'Investigating Agency');
        if (!name) return undefined;
        const phoneRaw = pLabelValue($, 'Investigating Agency Phone');
        return {
          name,
          phone: phoneRaw ? extractPhone(phoneRaw) : undefined,
        };
      },

      photos: (_raw, $) => pickPhotos($),

      events: (_raw, $, pageUrl): CaseEventInput[] | undefined => {
        const rawDate = pLabelValue($, 'Date of Last Contact');
        if (!rawDate || !pageUrl) return undefined;
        const parsed = parseDate(rawDate);
        if (!parsed.iso && parsed.quality === 'unknown') return undefined;
        return [
          {
            event_kind: 'last_seen',
            headline: 'Last seen',
            event_date: parsed.iso ?? undefined,
            event_date_quality: parsed.quality,
            event_date_text: parsed.quality !== 'exact' ? rawDate : undefined,
            source_url: pageUrl,
            source_quote: `Date of Last Contact: ${rawDate}`,
          },
        ];
      },

      raw: (_raw, $) => ({
        rawName: $('h1.nameHeader').first().text().trim() || undefined,
        ageNowRaw: pLabelValue($, 'Age Now'),
        heightRaw: pLabelValue($, 'Height'),
        // Race-flag captured for analytics — MMIW dashboards count
        // cases tagged AI/AN against the broader Doe Network corpus.
        isIndigenous: ((): boolean | undefined => {
          const r = pLabelValue($, 'Race');
          if (!r) return undefined;
          return /american indian|alaskan native|native american/i.test(r);
        })(),
      }),
    },
    inferKind: () => 'missing',
  },
  defaults: {
    status: 'open',
    kind: 'missing',
    incident_date_quality: 'unknown',
    photos: [],
    raw: {},
  },
};
