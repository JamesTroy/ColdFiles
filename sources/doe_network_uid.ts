/**
 * The Doe Network — Unidentified Persons (Doe cases).
 *
 * Sibling source to `doe_network.ts` (which covers Doe Network's MISSING
 * persons set). Two distinct sources rather than one branched source so:
 *   - Independent cron schedules
 *   - Independent rate-limit envelopes
 *   - Independent `is_closed` / `is_identified` skip logic
 *   - mapJson stays single-purpose and readable
 *
 * Endpoint layout — discovered via the public site's case-browser JS:
 *   - List: `database.php?get_uid_<sex>_index_<country>=true`
 *     where sex ∈ {males, females}, country ∈ {us, canada, mexico, euro, aus}
 *     → 10 endpoints, each returning a JSON array of {id, ...} for that
 *     country/sex bucket.
 *   - Detail: `database.php?id=<ID>&fields=true` (and parallel `&agencies=true`,
 *     `&images=true`).
 *
 * Note that UID uses `database.php` while MP uses `mpdatabase.php` — the
 * paths diverged historically. JS-side both work via the same Fetcher.
 *
 * IDs follow the pattern `<n>U<sex><state>` — e.g. `1003UMMD` is the 1003rd
 * Unidentified Male in Maryland. State suffix is parsed from the trailing
 * 2 letters (US states only — non-US schemes don't decode cleanly here).
 */

import type {
  AgencyHint,
  CaseRecord,
  ExtractedPhoto,
  SourceConfig,
} from '../supabase/functions/_shared/types.ts';
import {
  extractPhone,
  heightToCm,
  parseDate,
  parseSex,
  parseState,
  stripHtml,
  truncateNarrative,
  weightToKg,
} from '../supabase/functions/_shared/normalize.ts';

const DOE_UID_DB = 'https://www.doenetwork.org/cases/software/php/database.php';

const UID_INDEX_ENDPOINTS = [
  `${DOE_UID_DB}?get_uid_males_index_us=true`,
  `${DOE_UID_DB}?get_uid_females_index_us=true`,
  `${DOE_UID_DB}?get_uid_males_index_canada=true`,
  `${DOE_UID_DB}?get_uid_females_index_canada=true`,
  `${DOE_UID_DB}?get_uid_males_index_mexico=true`,
  `${DOE_UID_DB}?get_uid_females_index_mexico=true`,
  `${DOE_UID_DB}?get_uid_males_index_euro=true`,
  `${DOE_UID_DB}?get_uid_females_index_euro=true`,
  `${DOE_UID_DB}?get_uid_males_index_aus=true`,
  `${DOE_UID_DB}?get_uid_females_index_aus=true`,
];

interface DoeUidFields {
  id?: string;
  date_of_discovery?: string;
  location_of_discovery?: string;
  estimated_age?: string;
  estimated_date_of_death?: string;
  race?: string;
  sex?: string;
  height?: string;
  weight?: string;
  hair_color?: string;
  eye_color?: string;
  distinguishing_marks_and_features?: string;
  clothing?: string;
  jewelry?: string;
  dentals?: string;
  fingerprints?: string;
  dna?: string;
  cause_of_death?: string;
  state_of_remains?: string;
  circumstances_of_discovery?: string;
  information_sources?: string;
  namus_case_number?: string;
  ncic_case_number?: string;
  ncmec_case_number?: string;
  is_closed?: string; // 'X' when closed/removed
  is_identified?: string; // 'X' when the Doe has been identified
  reconstruction_text?: string;
}

interface DoeAgency {
  id?: string;
  agency_name?: string;
  agency_phone_number?: string;
  agency_email?: string;
  agency_case_number?: string;
}

interface DoeImage {
  id?: string;
  img_reference?: string;
  is_selected?: string;
}

/** Pull `<img src="...">` value out of img_reference HTML strings. */
function imgSrc(htmlImg: string): string | undefined {
  const m = htmlImg.match(/src="([^"]+)"/i);
  return m?.[1];
}

/** US Doe Network IDs end with 2-letter state code: `1003UMMD` → `MD`. */
function stateFromId(id?: string): string | undefined {
  if (!id) return undefined;
  const m = id.match(/[A-Z]{2}$/);
  if (!m) return undefined;
  return parseState(m[0]);
}

/** Parse "Buffalo, Erie County, New York" into city / county / state. */
function splitLocation(text?: string): {
  city?: string;
  county?: string;
  state?: string;
} {
  if (!text) return {};
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  let state: string | undefined;
  let county: string | undefined;
  let city: string | undefined;
  if (parts.length >= 1) state = parseState(parts[parts.length - 1]);
  for (let i = parts.length - 2; i >= 0; i--) {
    if (/county/i.test(parts[i])) {
      county = parts[i];
      break;
    }
  }
  if (parts.length >= 1) city = parts[0];
  return { city, county, state };
}

/**
 * Parse "20-25 years old" or "Approximately 30" into a min/max range.
 * Returns the bounds we can extract; missing bound stays undefined.
 */
function parseAgeRange(text?: string): { min?: number; max?: number } {
  if (!text) return {};
  const range = text.match(/(\d{1,3})\s*(?:-|to|–)\s*(\d{1,3})/);
  if (range) {
    return { min: parseInt(range[1], 10), max: parseInt(range[2], 10) };
  }
  const single = text.match(/(\d{1,3})/);
  if (single) {
    const n = parseInt(single[1], 10);
    return { min: n, max: n };
  }
  return {};
}

/** Try to extract a NamUs case number from the information_sources HTML. */
function namusFromInformationSources(html?: string): string | undefined {
  if (!html) return undefined;
  const m = html.match(/Case#?\/(\d+)/i);
  return m ? `UP${m[1]}` : undefined;
}

export const doeNetworkUid: SourceConfig = {
  slug: 'doe_network_uid',
  name: 'The Doe Network — Unidentified',
  kind: 'nonprofit',
  baseUrl: 'https://www.doenetwork.org',
  rateLimitMs: 3000,
  scheduleCron: '0 4 15 */3 *', // 15th of every 3rd month, 04:00 UTC — quarterly,
                                 // offset 14 days from the MP scrape so the two
                                 // sources don't collide on Doe's bandwidth
  trustWeight: 70,
  attribution: {
    html:
      'Source: <a href="https://www.doenetwork.org" rel="external">The Doe Network</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'json_api',
    endpoints: UID_INDEX_ENDPOINTS,
    itemsPath: '', // top-level array
    detailUrl: (item) =>
      `${DOE_UID_DB}?id=${encodeURIComponent(String(item.id ?? ''))}&fields=true`,
  },
  detail: {
    kind: 'json',
    fetchUrls: (detailUrl) => {
      const u = new URL(detailUrl);
      const id = u.searchParams.get('id') ?? '';
      return {
        fields: detailUrl,
        agencies: `${DOE_UID_DB}?id=${encodeURIComponent(id)}&agencies=true`,
        images: `${DOE_UID_DB}?id=${encodeURIComponent(id)}&images=true`,
      };
    },
    mapJson: (data, detailUrl): Partial<CaseRecord> => {
      const fields = (data.fields ?? null) as DoeUidFields | null;
      if (!fields) return { raw: { closed: true } };
      // Closed/identified branch: prior behavior was to skip entirely
      // (return { raw: { closed: true, ... } }), which threw away the
      // resolution signal — cases ingested while open stayed at
      // status=open in our DB even after Doe flipped them. The audit
      // (2026-05-04) found 6,314 of 6,314 cases at status=open, none
      // resolved, because every extractor discarded these signals.
      //
      // Fix: ingest closed/identified cases with the appropriate status
      // so the merge path propagates the flip on existing case rows.
      // Two distinct signals on the UID feed:
      //
      //   is_identified='X' → status='identified'
      //     The Doe has been identified; the remains have a name. The
      //     case stops being a "Doe" but stays in the dataset with the
      //     identified status surfacing the resolution.
      //
      //   is_closed='X' (and not identified) → status='cleared_other'
      //     Closed for a non-identification reason (returned remains,
      //     case withdrawn, etc.). Map to cleared_other since the UID
      //     feed doesn't carry the specific resolution kind.
      const isIdentified = fields.is_identified === 'X';
      const isClosed = fields.is_closed === 'X';
      const resolvedStatus: 'identified' | 'cleared_other' | null = isIdentified
        ? 'identified'
        : isClosed
          ? 'cleared_other'
          : null;

      const agencies = (Array.isArray(data.agencies) ? data.agencies : []) as DoeAgency[];
      const images = (Array.isArray(data.images) ? data.images : []) as DoeImage[];
      const id = fields.id ?? new URL(detailUrl).searchParams.get('id') ?? '';

      const dateParse = parseDate(fields.date_of_discovery ?? '');
      const loc = splitLocation(fields.location_of_discovery);
      const stateFromIdValue = stateFromId(id);
      const ageRange = parseAgeRange(fields.estimated_age);

      const agencyHint: AgencyHint | undefined = agencies[0]
        ? {
            name: agencies[0].agency_name,
            phone: agencies[0].agency_phone_number
              ? extractPhone(agencies[0].agency_phone_number)
              : undefined,
          }
        : undefined;

      // Doe Network sometimes carries a forensic reconstruction in addition
      // to (or instead of) a real photo. The image URL alone doesn't tell
      // us which — the `reconstruction_text` field signals when an image is
      // a reconstruction. Default to photo_victim; flip to reconstruction
      // when reconstruction_text is populated.
      const isReconstruction = !!stripHtml(fields.reconstruction_text ?? '').trim();
      // Doe Network returns a "No Image Available" placeholder JPG in the
      // images array for cases without a real photo. Three known variants
      // (No_Image_Available_male.jpg / _female.jpg / _infant.jpg) — filter
      // by URL so the placeholder bytes don't get mirrored into Storage and
      // served as a victim photo. Audit found 1,154 cases (~30% of has_photo)
      // were displaying the placeholder before this fix.
      const photos: ExtractedPhoto[] = images
        .filter((img) => img.img_reference)
        .map((img) => ({
          url: imgSrc(img.img_reference ?? '') ?? '',
          kind: isReconstruction ? ('reconstruction' as const) : ('photo_victim' as const),
        }))
        .filter((p) => p.url && !p.url.includes('No_Image_Available'));

      const narrative = stripHtml(fields.circumstances_of_discovery ?? '');
      const narrativeShort =
        narrative.split(/\n{2,}/)[0]?.slice(0, 240) || undefined;

      // distinguishing_marks gets a soft merge with cause_of_death + dentals
      // when meaningful — UID cases lean heavily on physical-feature
      // identification, so packing dental/genetic/COD info into one field
      // surfaces it in the existing description block rather than burying
      // it in raw.
      const distinguishingParts: string[] = [];
      if (fields.distinguishing_marks_and_features &&
          fields.distinguishing_marks_and_features.toLowerCase() !== 'unknown') {
        distinguishingParts.push(fields.distinguishing_marks_and_features);
      }
      if (fields.dentals && !/^unknown$/i.test(fields.dentals)) {
        distinguishingParts.push(`Dentals: ${fields.dentals}`);
      }
      const distinguishingMarks = distinguishingParts.join(' · ') || undefined;

      return {
        kind: 'unidentified',
        status: resolvedStatus ?? 'open',
        // Doe cases have no name. Leave undefined.
        victim_name: undefined,
        victim_first_name: undefined,
        victim_last_name: undefined,
        victim_age_min: ageRange.min,
        victim_age_max: ageRange.max,
        victim_sex: parseSex(fields.sex ?? ''),
        victim_race: fields.race && fields.race.toLowerCase() !== 'unknown'
          ? fields.race
          : undefined,
        victim_height_cm: fields.height ? heightToCm(fields.height) : undefined,
        victim_weight_kg: fields.weight ? weightToKg(fields.weight) : undefined,
        victim_eye_color: fields.eye_color && fields.eye_color.toLowerCase() !== 'unknown'
          ? fields.eye_color
          : undefined,
        victim_hair_color: fields.hair_color && fields.hair_color.toLowerCase() !== 'unknown'
          ? fields.hair_color
          : undefined,
        distinguishing_marks: distinguishingMarks,

        incident_date: dateParse.iso ?? undefined,
        incident_date_quality: dateParse.quality,
        incident_date_text:
          fields.date_of_discovery && dateParse.quality !== 'exact'
            ? fields.date_of_discovery
            : undefined,

        location_text: fields.location_of_discovery && fields.location_of_discovery.toLowerCase() !== 'unknown'
          ? fields.location_of_discovery
          : undefined,
        location_city: loc.city,
        location_county: loc.county,
        location_state: stateFromIdValue ?? loc.state,

        narrative: narrative ? truncateNarrative(narrative) : undefined,
        narrative_short: narrativeShort,

        case_number_primary:
          agencies[0]?.agency_case_number ||
          (fields.ncic_case_number && fields.ncic_case_number.toLowerCase() !== 'unknown'
            ? fields.ncic_case_number
            : undefined),
        namus_number: namusFromInformationSources(fields.information_sources)
          ?? (fields.namus_case_number ? `UP${fields.namus_case_number}` : undefined),

        agency_hint: agencyHint,
        photos,

        raw: {
          fields,
          agencies,
          images: images.map((i) => i.img_reference),
        },
      };
    },
    inferKind: () => 'unidentified',
  },
  defaults: {
    status: 'open',
    kind: 'unidentified',
    incident_date_quality: 'unknown',
    photos: [],
    raw: {},
  },
};
