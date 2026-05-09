import type {
  AgencyHint,
  CaseRecord,
  ExtractedPhoto,
  SourceConfig,
} from '../supabase/functions/_shared/types.ts';
import type { CaseEventInput } from '../supabase/functions/_shared/case-events.ts';
import {
  heightToCm,
  parseDate,
  parseSex,
  parseState,
  truncateNarrative,
  weightToKg,
} from '../supabase/functions/_shared/normalize.ts';

/**
 * New Mexico DPS Missing Persons Clearinghouse.
 * https://missingpersons.dps.nm.gov/mpweb/
 *
 * Statutorily-mandated state clearinghouse (NMSA §29-15-3). Tribal
 * agencies are required to feed it, so it carries Indigenous cases
 * that volunteer-curated sources (Doe Network, Charley) consistently
 * miss. NM has 23 sovereign tribal nations and a documented MMIW
 * data gap — this source is the targeted fix.
 *
 * ~933 cases as of 2026-05-09. Spans 1988 (Tara Calico, M3) to
 * present. Single-page listing at /mpweb/mpstate_serv with all M-IDs
 * inline as <a href=mpdetailreport_serv?id=M{n}> (unquoted attributes,
 * legacy mod_jk Java backend).
 *
 * Trust weight: 80. Same as NY DCJS / CA MUPS — state-level
 * government source. Above Doe (70) and Charley (75) because tribal
 * agencies are statutorily required to feed it.
 *
 * Detail-page DOM (legacy Java + non-conforming SGML — unclosed
 * </body>, mismatched <center>, table cells closing </a> inside <td>):
 *   - Field labels live in <strong>Label:</strong> inside a left-cell
 *     <td>, with the value in the immediately-following sibling <td>'s
 *     <strong>...</strong>. Standard byLabel helpers don't fit; we
 *     use a tdLabelValue helper that walks <td>+<td> pairs.
 *   - Title (victim name): inside a colored-bg <td bgcolor="#7D0000">
 *     wrapping <font color="white">. Distinctive enough to grab via
 *     font[color="white"] within the page.
 *   - Classification (kind): top-of-page text in a <center> font
 *     ("Missing Person - Involuntary" or similar). Drives status mapping.
 *   - Photo: <img id="MPpic" src="image_serv?id=N"> — RELATIVE URL.
 *     Resolve against the listing host. Numeric image_id is
 *     independent of the M-id; one case can have multiple photos with
 *     unrelated numeric IDs.
 *   - Narrative: bottom of the field table, inside a single <td
 *     colspan="5"> after the demographics block.
 *   - NO agency case number, NO NCIC/NamUs cross-IDs in the public
 *     view. Tier-1 dedupe will rely on name_state_year only.
 *   - NO reporting-agency name field on the detail page either.
 *     Agency hint stays undefined — the persist layer will leave
 *     primary_agency_name_raw null for these.
 *
 * Robots.txt: dps.nm.gov is fully open (no Disallow). No declared
 * Crawl-delay. We default to 2s/req (modest politeness), full crawl
 * ≈ 31 minutes for 933 cases. Fits a cron window comfortably.
 *
 * Photo policy: state government work, hot-link OK with
 * source_attribution = 'NM DPS Clearinghouse' per memory
 * `feedback_photo_legal_posture.md`.
 *
 * Out-of-state: by statute the clearinghouse is NM-only. Tested
 * sample shows all `Missing From: <city>, NM`. Default location_state
 * to 'NM' when the value isn't parseable.
 */

const BASE = 'https://missingpersons.dps.nm.gov';
const LISTING_URL = `${BASE}/mpweb/mpstate_serv`;

interface ParsedField {
  raw?: string;
}

/**
 * NM detail pages mix two layouts in the same demographic table:
 *   (a) Split cells: <td>Date Missing:</td><td>09/20/1988</td>
 *   (b) Combined:    <td>Sex: Female</td>
 *   (c) Floating value cell with adjacent label cell:
 *                    <td>Date of Birth:</td><td>02/28/1969</td>
 *
 * tdLabelValue handles all three by scanning every <td>:
 *   - Pattern (b): cell text starts with "${label}:" — split on colon.
 *   - Pattern (a)/(c): cell text equals "${label}:" — take next td's text.
 *
 * Case-insensitive label match. Returns the first non-empty value.
 */
function tdLabelValue(
  $: import('cheerio').CheerioAPI,
  label: string,
): string | undefined {
  const wantedLower = label.toLowerCase();
  let result: string | undefined;
  $('td').each((_, el) => {
    if (result !== undefined) return;
    const cellText = $(el).text().replace(/\s+/g, ' ').trim();
    const lower = cellText.toLowerCase();

    // Pattern (b): "Sex: Female" — colon present, value follows.
    if (lower.startsWith(`${wantedLower}:`)) {
      const tail = cellText.slice(label.length + 1).trim();
      if (tail) {
        result = tail;
        return;
      }
      // Colon present but no value in this cell → fall through to
      // sibling-cell pattern below.
    }

    // Pattern (a)/(c): cell IS the label. Next sibling has the value.
    const stripped = cellText.replace(/:$/, '').trim().toLowerCase();
    if (stripped === wantedLower) {
      const next = $(el).next('td');
      if (next && next.length > 0) {
        const v = next.text().replace(/\s+/g, ' ').trim();
        if (v) result = v;
      }
    }
  });
  return result;
}

/**
 * Pull the victim name from the colored heading cell. Sample DOM:
 *   <td bgcolor=#7D0000 ...><strong><font color="white" size="5">Tara Leigh Calico</strong>...
 */
function pickVictimName($: import('cheerio').CheerioAPI): string | undefined {
  const el = $('font[color="white"]').first();
  if (!el || el.length === 0) return undefined;
  const t = el.text().replace(/\s+/g, ' ').trim();
  return t || undefined;
}

/**
 * Pull the classification line from the page header — drives the
 * kind/status mapping. Examples seen in fixtures:
 *   "Missing Person - Involuntary"   → kind=missing, status=open
 *   "Missing Person - Voluntary"     → kind=missing, status=open
 *   "Missing Person - Located"       → kind=missing, status=located
 *   "Missing Person - Lost"          → kind=missing, status=open
 */
function pickClassification($: import('cheerio').CheerioAPI): string | undefined {
  // The header line lives in a <font size="5"><strong> inside a
  // <center>. Look for any size=5 font that ISN'T the white name
  // (which lives in the colored cell font[color="white"] selector
  // we use elsewhere). Fall through to any size=5 font as a
  // last resort.
  let result: string | undefined;
  $('font[size="5"]').each((_, el) => {
    if (result !== undefined) return;
    const f = $(el);
    if (f.attr('color') === 'white') return;
    const t = f.text().replace(/\s+/g, ' ').trim();
    if (t.toLowerCase().includes('missing person')) result = t;
  });
  return result;
}

/**
 * "Belen, NM" → { city: 'Belen', state: 'NM' }
 * "Mescalero Apache Indian Reservation, NM" → { city: full, state: 'NM' }
 * "Belen" → { city: 'Belen' }
 */
function splitMissingFrom(text?: string): { city?: string; state?: string } {
  if (!text) return {};
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) {
    return { city: parts[0] };
  }
  const tail = parts[parts.length - 1];
  const head = parts.slice(0, -1).join(', ');
  const state = parseState(tail);
  return {
    city: head || undefined,
    state: state ?? undefined,
  };
}

function statusFromClassification(c?: string): CaseRecord['status'] {
  if (!c) return 'open';
  const lower = c.toLowerCase();
  if (lower.includes('located')) return 'located';
  if (lower.includes('identified')) return 'identified';
  return 'open';
}

/**
 * Compute age at incident from DOB + Date Missing. Falls back to the
 * "Age Then" field if either date isn't parseable. CaseRecord stores
 * age, not DOB.
 */
function ageAtIncident(
  dobIso: string | undefined,
  incidentIso: string | undefined,
  ageThen: string | undefined,
): number | undefined {
  if (dobIso && incidentIso) {
    const dob = new Date(dobIso);
    const inc = new Date(incidentIso);
    if (!Number.isNaN(dob.getTime()) && !Number.isNaN(inc.getTime())) {
      let age = inc.getFullYear() - dob.getFullYear();
      const m = inc.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && inc.getDate() < dob.getDate())) age -= 1;
      if (age >= 0 && age <= 130) return age;
    }
  }
  // Fallback: parse the displayed "Age Then" field.
  if (ageThen) {
    const n = parseInt(ageThen, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 130) return n;
  }
  return undefined;
}

export const nmDps: SourceConfig = {
  slug: 'nm_dps',
  name: 'New Mexico DPS Missing Persons Clearinghouse',
  kind: 'state',
  baseUrl: BASE,
  // Modest politeness — robots.txt declares no Crawl-delay but the
  // backend is legacy mod_jk Java, easy to overload. 2s/req → ~31min
  // full crawl across 933 cases.
  rateLimitMs: 2000,
  scheduleCron: '0 6 * * 1', // Monday 06:00 UTC — weekly
  trustWeight: 80,
  attribution: {
    html:
      'Source: <a href="https://missingpersons.dps.nm.gov/mpweb/" rel="external">New Mexico DPS Missing Persons Clearinghouse</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'custom',
    discoverFn: async (fetcher, detailLimit) => {
      const { load } = await import('cheerio');
      const html = await fetcher.getText(LISTING_URL);
      const $ = load(html);
      const seen = new Set<string>();
      const urls: string[] = [];
      $('a[href*="mpdetailreport_serv"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const m = href.match(/id=(M\d+)/);
        if (!m) return;
        const id = m[1] ?? '';
        const detailUrl = `${BASE}/mpweb/mpdetailreport_serv?id=${encodeURIComponent(id)}`;
        if (seen.has(detailUrl)) return;
        seen.add(detailUrl);
        urls.push(detailUrl);
        if (detailLimit && urls.length >= detailLimit) return false;
      });
      return urls;
    },
  },
  detail: {
    kind: 'cheerio',
    selectors: {
      // The runner's selector path picks up name + auto-splits into
      // victim_first_name/victim_last_name (required for the
      // name_state_year + lastname_age_sex dedupe keys). The colored
      // heading cell wraps the name in font[color="white"].
      name: 'font[color="white"]',
      // Photo URL is RELATIVE on this source (e.g., src="image_serv?id=131301").
      // The photos transform below resolves to absolute.
      photoUrls: 'img#MPpic',
    },
    transforms: {
      // victim_name override — clean up the doubled-space/SGML noise the
      // runner's textOf may leave behind. The selector path also handles
      // first/last splitting automatically; this transform just normalizes
      // whitespace if the runner's already-set value carries chrome.
      victim_name: (_raw, $) => pickVictimName($),
      victim_age: (_raw, $) => {
        const dob = parseDate(tdLabelValue($, 'Date of Birth') ?? '').iso;
        const incident = parseDate(tdLabelValue($, 'Date Missing') ?? '').iso;
        return ageAtIncident(dob, incident, tdLabelValue($, 'Age Then'));
      },
      victim_sex: (_raw, $) => parseSex(tdLabelValue($, 'Sex') ?? ''),
      victim_race: (_raw, $) => tdLabelValue($, 'Race'),
      victim_hair_color: (_raw, $) => tdLabelValue($, 'Hair'),
      victim_eye_color: (_raw, $) => tdLabelValue($, 'Eye'),
      victim_height_cm: (_raw, $) => heightToCm(tdLabelValue($, 'Height') ?? ''),
      victim_weight_kg: (_raw, $) => weightToKg(tdLabelValue($, 'Weight') ?? ''),
      distinguishing_marks: (_raw, $) => tdLabelValue($, 'Marks'),

      incident_date: (_raw, $) => parseDate(tdLabelValue($, 'Date Missing') ?? '').iso,
      incident_date_quality: (_raw, $) =>
        parseDate(tdLabelValue($, 'Date Missing') ?? '').quality,
      incident_date_text: (_raw, $) => {
        const raw = tdLabelValue($, 'Date Missing');
        if (!raw) return undefined;
        const parsed = parseDate(raw);
        return parsed.quality !== 'exact' ? raw : undefined;
      },
      last_seen_date: (_raw, $) => parseDate(tdLabelValue($, 'Date Missing') ?? '').iso,
      last_seen_text: (_raw, $) => tdLabelValue($, 'Missing from'),

      location_text: (_raw, $) => tdLabelValue($, 'Missing from'),
      location_city: (_raw, $) =>
        splitMissingFrom(tdLabelValue($, 'Missing from')).city,
      // NM clearinghouse is statutorily NM-only. Default to NM when
      // the comma-tail isn't a state code (often the location is just
      // a city or a tribal-reservation name without a state suffix).
      location_state: (_raw, $) =>
        splitMissingFrom(tdLabelValue($, 'Missing from')).state ?? 'NM',

      // No agency-name or agency-phone fields in the public view of
      // this clearinghouse — agency_hint stays undefined. Persist's
      // primary_agency_name_raw will be null. Tip-routing will route
      // through the state DPS as a default fallback when no per-case
      // agency is known. Acceptable for v1.
      agency_hint: (): AgencyHint | undefined => undefined,

      // Status flips when the classification line says "Located" /
      // "Identified" — picks up DPS resolution events as the corpus
      // is re-scraped weekly.
      status: (_raw, $) => statusFromClassification(pickClassification($)),

      // Narrative — the field table's wide cell after the demographics
      // block. Sample DOM has it as <td colspan="5">{text}</td>. Match
      // any td with colspan ≥ 4 that contains a substantive paragraph
      // (filter out chrome cells like spacers).
      narrative: (_raw, $) => {
        let result: string | undefined;
        $('td[colspan]').each((_, el) => {
          if (result !== undefined) return;
          const cs = parseInt($(el).attr('colspan') ?? '0', 10);
          if (cs < 4) return;
          const txt = $(el).text().replace(/\s+/g, ' ').trim();
          // Spacer cells are short. Real narrative is typically 60+ chars.
          if (txt.length < 60) return;
          // Skip the legend / disclaimer lines that also sit in colspan
          // cells. Heuristic: real narratives mention the victim's name
          // or a date in the body. The fixture sample has lines starting
          // with "TARA LEIGH CALICO was forcibly abducted by ..."
          if (txt.toLowerCase().includes('clearinghouse') && !/\d{4}/.test(txt)) return;
          result = txt;
        });
        return result ? truncateNarrative(result) : undefined;
      },
      narrative_short: (_raw, $) => {
        // Re-derive from the same logic — first sentence or 240 chars.
        let result: string | undefined;
        $('td[colspan]').each((_, el) => {
          if (result !== undefined) return;
          const cs = parseInt($(el).attr('colspan') ?? '0', 10);
          if (cs < 4) return;
          const txt = $(el).text().replace(/\s+/g, ' ').trim();
          if (txt.length < 60) return;
          if (txt.toLowerCase().includes('clearinghouse') && !/\d{4}/.test(txt)) return;
          result = txt;
        });
        if (!result) return undefined;
        return result.split(/[.!?]\s+/)[0]?.slice(0, 240) || undefined;
      },

      // Photos — resolve relative `image_serv?id=N` URLs to absolute.
      // The runner's photoUrls path passes the raw <img src>; we
      // override here to fix up the URL.
      photos: (_raw, $): ExtractedPhoto[] => {
        const photos: ExtractedPhoto[] = [];
        $('img#MPpic, img[src*="image_serv"]').each((_, el) => {
          const src = $(el).attr('src');
          if (!src) return;
          const url = src.startsWith('http')
            ? src
            : `${BASE}/mpweb/${src.replace(/^\/+/, '')}`;
          photos.push({ url, kind: 'photo_victim' as const });
        });
        return photos;
      },

      events: (_raw, $, pageUrl): CaseEventInput[] | undefined => {
        const rawDate = tdLabelValue($, 'Date Missing');
        if (!rawDate || !pageUrl) return undefined;
        const parsed = parseDate(rawDate);
        if (!parsed.iso && parsed.quality === 'unknown') return undefined;
        const locationLabel = tdLabelValue($, 'Missing from');
        return [
          {
            event_kind: 'last_seen',
            headline: locationLabel ? `Last seen — ${locationLabel}` : 'Last seen',
            event_date: parsed.iso ?? undefined,
            event_date_quality: parsed.quality,
            event_date_text: parsed.quality !== 'exact' ? rawDate : undefined,
            source_url: pageUrl,
            source_quote: `Date Missing: ${rawDate}`,
          },
        ];
      },

      raw: (_raw, $) => ({
        classification: pickClassification($),
        ageThen: tdLabelValue($, 'Age Then'),
        ageNow: tdLabelValue($, 'Age Now'),
        dobText: tdLabelValue($, 'Date of Birth'),
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
