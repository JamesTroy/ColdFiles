import type {
  AgencyHint,
  SourceConfig,
} from '../supabase/functions/_shared/types.ts';
import type { CaseEventInput } from '../supabase/functions/_shared/case-events.ts';
import {
  extractPhone,
  heightToCm,
  parseState,
} from '../supabase/functions/_shared/normalize.ts';

/**
 * California DOJ Missing & Unidentified Persons System (MUPS).
 * https://oag.ca.gov/missing
 *
 * Drupal 7 site, server-rendered HTML. ~3,104 missing-person records as
 * of 2026-05-08. Single global listing at /missing/search?page=N
 * (0-indexed, 20 cases/page, 155 pages).
 *
 * Robots.txt allows crawling with a 10-second Crawl-delay. Full
 * single-pass crawl ≈ 8.6 hours at 10s/req. Weekly cron (Saturday
 * 02:00 UTC) keeps the cadence modest while still picking up new
 * cases reasonably fast — DOJ adds ~5-15 cases/week historically.
 *
 * Trust weight: 80. Same as NY DCJS (state-level government source).
 * Above Doe Network (70) / Charley (75) — state DOJ owns these case
 * rows directly. Below NamUs (90) / agency-direct (95) because
 * coverage is CA-only and CA agencies sometimes report cases that
 * occurred elsewhere (~6% out-of-state per the 2026-05-08 sample;
 * a few are even Canadian — British Columbia surfaced in the sample).
 *
 * Detail page DOM (Drupal 7 server-rendered, all in static HTML):
 *   .field-name-field-missing-person-{sex,race,hair,eye-color,weight}
 *     .field-items > .field-item.even contains the labeled value.
 *     The runner's built-in cheerio extractor handles these directly
 *     via the `selectors` map below.
 *   .field-name-field-missing-person-{height-ft,height-in}
 *     Split across two fields — combined to "5'4"" in the
 *     victim_height_cm transform.
 *   .field-name-field-missing-person-{dob,last-seen}
 *     <span property="dc:date" content="ISO-DATE"> — extract via
 *     RDFa `content` attribute (not text), in dedicated transforms.
 *   .field-name-field-missing-person-last-loc
 *     "City, CA" or similar; sparse (~60% empty per 2026-05-08 sample).
 *   .field-name-field-missing-person-picture
 *     <img typeof="foaf:Image"> at oag.ca.gov/sites/default/files/...
 *   .field-name-field-missing-person-note
 *     Narrative (circumstances). Sometimes empty.
 *   .field-name-field-mp-contact-{agency,phone-number,case-number}
 *     Inside a fieldset.group-contact. Always populated.
 *   h1.page-header
 *     Victim name. Two trailing spaces are common (Drupal merging
 *     first+middle+last with a missing middle) — textOf collapses.
 *
 * Out-of-state cases:
 *   ~6% of the corpus is non-CA (CA agencies report cases that
 *   occurred elsewhere). The agency block carries no state suffix
 *   for in-CA agencies; out-of-state ones include "(XX)" or "(BC)"
 *   for Canadian. Locate-state fallback chain:
 *     1. last-loc trailing token if it parses as a US state  → use it
 *     2. agency name "(XX)" suffix if XX parses as a US state → use it
 *     3. neither → DEFAULT to CA. The agency block carries (XX) ONLY
 *        for out-of-state agencies — its absence is a strong positive
 *        signal of in-CA. Without this default the ~94% in-CA majority
 *        would lose name_state_year and agency_case_number dedupe keys
 *        (both require location_state) and ingest as un-mergeable
 *        singletons.
 *
 *   Edge case to flag: Canadian (BC) cases come back tagged "BC" by
 *   parseState's strict 2-letter US-only path → returns undefined →
 *   falls through to the CA default above. That's mildly wrong (the
 *   case is Canadian, not CA) but only affects a handful of records
 *   in the 6% out-of-state slice. Acceptable for v1; revisit if the
 *   misattribution surfaces user-side.
 *
 * Slug stability:
 *   Slugs like "christopher-enoch-abeyta" are stable across re-fetches.
 *   Drupal collision-resolution adds "-0", "-1" suffixes ("rosa-alejandra-
 *   ramos-0") which are also stable and resolve to real records (not
 *   archives). Use the slug as the source_external_id (deriveExternalId
 *   in persist.ts handles slug → ID extraction).
 *
 * Change-detection:
 *   Last-Modified / ETag drift on every render (Drupal form_build_id
 *   in HTML body), so conditional GETs are useless. We rely on full
 *   re-scrape + Tier-1/2 dedupe to update existing rows.
 */

const BASE = 'https://oag.ca.gov';
const LISTING_PATH = '/missing/search';
const TOTAL_PAGES_HINT = 155;

/**
 * Extract the ISO date string out of Drupal's RDFa `content` attribute.
 *   <span property="dc:date" datatype="xsd:dateTime" content="2000-03-30T00:00:00-08:00">
 *   → "2000-03-30"
 *
 * Returns undefined when the field isn't present or the content attr
 * is malformed (defensive — Drupal occasionally exports missing
 * timezone offsets which break a naive Date(...).toISOString roundtrip).
 */
function rdfaIsoDate(
  $: import('cheerio').CheerioAPI,
  fieldClass: string,
): string | undefined {
  const span = $(`.field-name-field-${fieldClass} span[property="dc:date"]`).first();
  if (!span || span.length === 0) return undefined;
  const content = span.attr('content');
  if (!content) return undefined;
  const head = content.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : undefined;
}

function fieldText(
  $: import('cheerio').CheerioAPI,
  fieldClass: string,
): string | undefined {
  const el = $(`.field-name-field-${fieldClass} .field-item`).first();
  if (!el || el.length === 0) return undefined;
  const t = el.text().trim();
  return t || undefined;
}

/**
 * "Sepulveda, CA" → { city: 'Sepulveda', state: 'CA' }.
 * Tolerates state-only and city-only forms.
 */
function splitLastLoc(text?: string): { city?: string; state?: string } {
  if (!text) return {};
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    const asState = parseState(parts[0]);
    if (asState) return { state: asState };
    return { city: parts[0] };
  }
  const tail = parts[parts.length - 1];
  const state = parseState(tail);
  return {
    city: parts[0] || undefined,
    state: state ?? undefined,
  };
}

/**
 * "Colorado Springs (CO) Police Department" → { name: 'Colorado Springs Police Department', state: 'CO' }.
 * "Tukwila Police Department (WA)"          → { name: 'Tukwila Police Department', state: 'WA' }.
 *
 * The (XX) state code can appear ANYWHERE in the string (frequently
 * mid-string, between locality and agency type — Drupal stores the
 * locality + dept type in one field and dept curators have positioned
 * the (XX) inconsistently across the corpus). Match anywhere; strip
 * for display name; parse the state code via parseState.
 *
 * In-CA agencies don't carry a suffix → state stays undefined.
 */
function splitAgencyState(rawAgency?: string): { name?: string; state?: string } {
  if (!rawAgency) return {};
  const trimmed = rawAgency.trim();
  const m = trimmed.match(/\(([A-Z]{2,3})\)/);
  if (!m) return { name: trimmed };
  const state = parseState(m[1] ?? '');
  if (!state) return { name: trimmed };
  // Strip the (XX) from the name and collapse the resulting double-space.
  const name = trimmed.replace(/\s*\([A-Z]{2,3}\)\s*/, ' ').replace(/\s+/g, ' ').trim();
  return { name: name || trimmed, state };
}

/**
 * Compute age at incident from DOB + last-seen ISO dates. Returns
 * undefined when either date is missing or the result falls outside
 * the [0, 130] sanity range.
 */
function ageAt(dobIso?: string, atIso?: string): number | undefined {
  if (!dobIso || !atIso) return undefined;
  const dob = new Date(dobIso);
  const at = new Date(atIso);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(at.getTime())) return undefined;
  let age = at.getFullYear() - dob.getFullYear();
  const m = at.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) age -= 1;
  return age >= 0 && age <= 130 ? age : undefined;
}

export const caMups: SourceConfig = {
  slug: 'ca_mups',
  name: 'California DOJ Missing & Unidentified Persons System',
  kind: 'state',
  baseUrl: BASE,
  rateLimitMs: 10_000, // robots.txt Crawl-delay: 10
  scheduleCron: '0 2 * * 6', // Saturday 02:00 UTC
  trustWeight: 80,
  attribution: {
    html:
      'Source: <a href="https://oag.ca.gov/missing" rel="external">California Attorney General — Missing &amp; Unidentified Persons</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'custom',
    discoverFn: async (fetcher, detailLimit) => {
      const seen = new Set<string>();
      const urls: string[] = [];
      // Lazy-import cheerio inside the discoverFn so node_modules is
      // touched only when ingesting (keeps deno-edge bundle lean).
      const { load } = await import('cheerio');
      let pageIdx = 0;
      const HARD_CAP = TOTAL_PAGES_HINT + 50;
      while (pageIdx < HARD_CAP) {
        const url = `${BASE}${LISTING_PATH}?page=${pageIdx}`;
        let html: string;
        try {
          html = await fetcher.getText(url);
        } catch {
          break; // 404 / network error → end-of-pagination
        }
        const $ = load(html);
        let addedThisPage = 0;
        $('a[href^="/missing/person/"]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          const path = href.split('?')[0]?.split('#')[0] ?? href;
          const detailUrl = `${BASE}${path}`;
          if (seen.has(detailUrl)) return;
          seen.add(detailUrl);
          urls.push(detailUrl);
          addedThisPage += 1;
          if (detailLimit && urls.length >= detailLimit) return false;
        });
        if (detailLimit && urls.length >= detailLimit) break;
        if (addedThisPage === 0) break; // empty page → past end of corpus
        pageIdx += 1;
      }
      return urls;
    },
  },
  detail: {
    kind: 'cheerio',
    selectors: {
      // The runner's built-in cheerio extractor handles these directly.
      // textOf collapses whitespace (h1.page-header has doubled spaces
      // when middle name is blank — Drupal merges first+middle+last).
      name: 'h1.page-header',
      sex: '.field-name-field-missing-person-sex .field-item',
      race: '.field-name-field-missing-person-race .field-item',
      weight: '.field-name-field-missing-person-weight .field-item',
      photoUrls: '.field-name-field-missing-person-picture img',
      narrative: '.field-name-field-missing-person-note .field-item',
    },
    transforms: {
      // Height: combine ft + in into "5'4"" string then convert to cm.
      // Drupal stores these as separate list-text fields. heightToCm
      // accepts the apostrophe-quote form natively.
      victim_height_cm: (_raw, $) => {
        const ft = fieldText($, 'missing-person-height-ft') ?? '0';
        const inches = fieldText($, 'missing-person-height-in') ?? '0';
        return heightToCm(`${ft}'${inches}"`);
      },

      // Hair / eye colors come straight from .field-item text.
      victim_hair_color: (_raw, $) => fieldText($, 'missing-person-hair'),
      victim_eye_color: (_raw, $) => fieldText($, 'missing-person-eye-color'),

      // Aliases — Drupal field carries multiple .field-item children.
      victim_aliases: (_raw, $) => {
        const aliases: string[] = [];
        $('.field-name-field-missing-person-aka .field-item').each((_, el) => {
          const t = $(el).text().trim();
          if (t) aliases.push(t);
        });
        return aliases.length ? aliases : undefined;
      },

      distinguishing_marks: (_raw, $) => fieldText($, 'missing-person-marks'),
      last_seen_clothing: (_raw, $) => fieldText($, 'missing-person-clothing'),

      // Date last seen — RDFa span content carries the canonical ISO
      // date. The text node form ("12/17/2001") is also available but
      // requires US-locale parsing; the RDFa value is unambiguous.
      incident_date: (_raw, $) => rdfaIsoDate($, 'missing-person-last-seen'),
      incident_date_quality: (_raw, $) =>
        rdfaIsoDate($, 'missing-person-last-seen') ? 'exact' : 'unknown',
      incident_date_text: (_raw, $) => {
        const iso = rdfaIsoDate($, 'missing-person-last-seen');
        return iso ? undefined : fieldText($, 'missing-person-last-seen');
      },
      last_seen_date: (_raw, $) => rdfaIsoDate($, 'missing-person-last-seen'),

      // Age at incident — computed from DOB + last-seen. CaseRecord
      // stores age, not DOB; most upstream sources expose age directly.
      victim_age: (_raw, $) =>
        ageAt(
          rdfaIsoDate($, 'missing-person-dob'),
          rdfaIsoDate($, 'missing-person-last-seen'),
        ),

      // Last-known location — text form preserved verbatim, then
      // city/state derived. State resolves via the docstring's
      // fallback chain (last-loc tail → agency suffix → undefined).
      location_text: (_raw, $) => fieldText($, 'missing-person-last-loc'),
      last_seen_text: (_raw, $) => fieldText($, 'missing-person-last-loc'),
      location_city: (_raw, $) =>
        splitLastLoc(fieldText($, 'missing-person-last-loc')).city,
      location_state: (_raw, $) => {
        // Fallback chain (re-evaluated 2026-05-08, see docstring):
        //   1. last-loc trailing token if it parses as a US state
        //   2. agency name "(XX)" suffix if XX parses as a US state
        //   3. neither → DEFAULT to CA. The agency block carries (XX)
        //      ONLY for out-of-state agencies — its absence is a
        //      strong positive signal of in-CA. Without this default,
        //      the ~94% in-CA majority would lose name_state_year
        //      and agency_case_number dedupe keys (both require
        //      location_state) and ingest as un-mergeable singletons.
        const fromLoc = splitLastLoc(fieldText($, 'missing-person-last-loc')).state;
        if (fromLoc) return fromLoc;
        const fromAgency = splitAgencyState(fieldText($, 'mp-contact-agency')).state;
        if (fromAgency) return fromAgency;
        return 'CA';
      },

      // Agency name + phone. Strip the "(XX)" suffix from out-of-state
      // agencies so the display name reads cleanly; the suffix's state
      // value already feeds location_state above.
      agency_hint: (_raw, $): AgencyHint | undefined => {
        const split = splitAgencyState(fieldText($, 'mp-contact-agency'));
        if (!split.name) return undefined;
        const phoneRaw = fieldText($, 'mp-contact-phone-number');
        return {
          name: split.name,
          phone: phoneRaw ? extractPhone(phoneRaw) : undefined,
        };
      },

      // Agency-issued case number — feeds the agency_case_number Tier-1
      // dedupe key. Always populated for this source.
      case_number_primary: (_raw, $) => fieldText($, 'mp-contact-case-number'),

      // Timeline event — last_seen, only when the date parsed.
      events: (_raw, $, pageUrl): CaseEventInput[] | undefined => {
        const iso = rdfaIsoDate($, 'missing-person-last-seen');
        if (!iso || !pageUrl) return undefined;
        const lastLoc = fieldText($, 'missing-person-last-loc');
        const dateText = fieldText($, 'missing-person-last-seen') ?? iso;
        return [
          {
            event_kind: 'last_seen',
            headline: lastLoc ? `Last seen — ${lastLoc}` : 'Last seen',
            event_date: iso,
            event_date_quality: 'exact',
            source_url: pageUrl,
            source_quote: `Date Last Seen: ${dateText}`,
          },
        ];
      },

      // Stash a few raw-feed fields for ad-hoc analytics / future audit
      // without polluting the structured columns.
      raw: (_raw, $) => {
        const dobIso = rdfaIsoDate($, 'missing-person-dob');
        const dobText = fieldText($, 'missing-person-dob');
        const agencyRaw = fieldText($, 'mp-contact-agency');
        const agencySplit = splitAgencyState(agencyRaw);
        return {
          dobIso,
          dobText,
          jewelry: fieldText($, 'missing-person-jewelry'),
          otherId: fieldText($, 'missing-person-other-id'),
          heightFt: fieldText($, 'missing-person-height-ft'),
          heightIn: fieldText($, 'missing-person-height-in'),
          ageProgressed: fieldText($, 'missing-person-age-prog'),
          dentalXrays: fieldText($, 'missing-person-dent-xrays'),
          reportType: fieldText($, 'missing-person-report-type'),
          agencyRaw,
          outOfState: agencySplit.state && agencySplit.state !== 'CA' ? true : undefined,
        };
      },
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

