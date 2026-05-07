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
  parseAge,
  parseDate,
  parseSex,
  parseState,
  splitName,
  stripHtml,
  truncateNarrative,
  weightToKg,
} from '../supabase/functions/_shared/normalize.ts';

/**
 * The Doe Network — international volunteer org. Server-rendered HTML is a JS shell;
 * actual case data is served from a JSON endpoint at
 *   https://www.doenetwork.org/cases/software/php/mpdatabase.php?id={ID}&fields=true
 * with sibling endpoints `&agencies=true` and `&images=true`.
 *
 * Index endpoints (10 for missing, 10 for unidentified) return all IDs scoped by
 * (country × sex). A typical missing-person ID looks like `1002DMNY` — the trailing
 * 2 letters are the US state code; non-US cases use a different suffix layout that we
 * don't decode (state is left null and the location_text field is the source of truth).
 *
 * Trust weight: 70. Below NamUs (90) and agency-direct (95), above Project: Cold Case
 * (50). Doe Network is researched but volunteer-maintained and occasionally outdated.
 */

const DOE_DB = 'https://www.doenetwork.org/cases/software/php/mpdatabase.php';

const MP_INDEX_ENDPOINTS = [
  `${DOE_DB}?get_mp_males_index_us=true`,
  `${DOE_DB}?get_mp_females_index_us=true`,
  `${DOE_DB}?get_mp_males_index_canada=true`,
  `${DOE_DB}?get_mp_females_index_canada=true`,
  `${DOE_DB}?get_mp_males_index_mexico=true`,
  `${DOE_DB}?get_mp_females_index_mexico=true`,
  `${DOE_DB}?get_mp_males_index_euro=true`,
  `${DOE_DB}?get_mp_females_index_euro=true`,
  `${DOE_DB}?get_mp_males_index_aus=true`,
  `${DOE_DB}?get_mp_females_index_aus=true`,
];

interface DoeFields {
  id?: string;
  pname?: string;
  nickname_alias?: string;
  case_classification?: string;
  missing_since?: string;
  location_last_seen?: string;
  date_of_birth?: string;
  age?: string;
  race?: string;
  gender?: string;
  height?: string;
  weight?: string;
  hair_color?: string;
  eye_color?: string;
  distinguishing_marks_and_features?: string;
  clothing?: string;
  jewelry?: string;
  circumstances_of_disappearance?: string;
  information_sources?: string;
  is_closed?: string; // 'X' when closed/removed
}

interface DoeAgency {
  id?: string;
  agency_name?: string;
  agency_contact_person?: string;
  agency_phone_number?: string;
  agency_email?: string;
  agency_case_number?: string;
}

interface DoeImage {
  id?: string;
  img_reference?: string; // an HTML <img ...> tag — extract src
  is_selected?: string;
}

/** Pull `<img src="...">` value out of img_reference HTML strings. */
function imgSrc(htmlImg: string): string | undefined {
  const m = htmlImg.match(/src="([^"]+)"/i);
  return m?.[1];
}

/** US Doe Network IDs end with 2-letter state code: `1002DMNY` → `NY`. */
function stateFromId(id?: string): string | undefined {
  if (!id) return undefined;
  const m = id.match(/[A-Z]{2}$/);
  if (!m) return undefined;
  // Only accept a real US state code; non-US ID schemes use other suffixes.
  return parseState(m[0]);
}

/** Try to extract a NamUs case number from the information_sources HTML. */
function namusFromInformationSources(html?: string): string | undefined {
  if (!html) return undefined;
  const m = html.match(/MissingPersons\/Case#?\/(\d+)/i);
  return m ? `MP${m[1]}` : undefined;
}

/** Parse "Buffalo, Erie County, New York" into city / county / state. */
function splitLocation(text?: string): {
  city?: string;
  county?: string;
  state?: string;
} {
  if (!text) return {};
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  // Walk from the right: last is state, prior with "County" is county, leading is city.
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

export const doeNetwork: SourceConfig = {
  slug: 'doe_network',
  name: 'The Doe Network',
  kind: 'nonprofit',
  baseUrl: 'https://www.doenetwork.org',
  rateLimitMs: 3000,
  scheduleCron: '0 4 1 */3 *', // first of every 3rd month, 04:00 UTC — quarterly
  trustWeight: 70,
  attribution: {
    html:
      'Source: <a href="https://www.doenetwork.org" rel="external">The Doe Network</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'json_api',
    endpoints: MP_INDEX_ENDPOINTS,
    itemsPath: '', // top-level array
    detailUrl: (item) =>
      `${DOE_DB}?id=${encodeURIComponent(String(item.id ?? ''))}&fields=true`,
  },
  detail: {
    kind: 'json',
    fetchUrls: (detailUrl) => {
      const u = new URL(detailUrl);
      const id = u.searchParams.get('id') ?? '';
      return {
        fields: detailUrl,
        agencies: `${DOE_DB}?id=${encodeURIComponent(id)}&agencies=true`,
        images: `${DOE_DB}?id=${encodeURIComponent(id)}&images=true`,
      };
    },
    mapJson: (data, detailUrl): Partial<CaseRecord> => {
      const fields = (data.fields ?? null) as DoeFields | null;
      if (!fields) {
        // Genuine no-data — null fields object, page 404 / removed entirely.
        // Skip; nothing to ingest or update.
        return { raw: { closed: true } };
      }
      // Closed-or-resolved branch: the case still has data but Doe has
      // marked it closed. PRIOR behavior was `return { raw: { closed: true } }`,
      // which threw the resolution signal away — cases ingested while
      // open stayed at status=open in our DB even after Doe flipped them.
      // Fix: ingest with `status: 'cleared_other'` so the merge path
      // propagates the flip on existing case rows, and a brand-new
      // closed-case-discovery still lands as a real record (not skipped).
      // Doe's MP feed doesn't distinguish "found alive" / "located
      // remains" / other resolution kinds — `cleared_other` is the
      // honest mapping. The UID feed (separate is_identified field) gets
      // a more specific mapping in doe_network_uid.ts.
      const isClosed = fields.is_closed === 'X';

      const agencies = (Array.isArray(data.agencies) ? data.agencies : []) as DoeAgency[];
      const images = (Array.isArray(data.images) ? data.images : []) as DoeImage[];
      const id = fields.id ?? new URL(detailUrl).searchParams.get('id') ?? '';

      const nameParts = splitName(fields.pname ?? '');
      const dateParse = parseDate(fields.missing_since ?? '');
      const loc = splitLocation(fields.location_last_seen);
      const stateFromIdValue = stateFromId(id);

      const agencyHint: AgencyHint | undefined = agencies[0]
        ? {
            name: agencies[0].agency_name,
            phone: agencies[0].agency_phone_number
              ? extractPhone(agencies[0].agency_phone_number)
              : undefined,
          }
        : undefined;

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
          kind: 'photo_victim' as const,
        }))
        .filter((p) => p.url && !p.url.includes('No_Image_Available'));

      const narrative = stripHtml(fields.circumstances_of_disappearance ?? '');
      const narrative_short =
        narrative.split(/\n{2,}/)[0]?.slice(0, 240) || undefined;

      // Timeline event — last_seen. Only emit when missing_since parsed
      // (no inference from absence). source_quote is the raw upstream
      // value verbatim per the editorial-noise rule (migration 35).
      // Dates that didn't parse to ISO would still produce a hash but
      // we keep the event suppressed when no date signal is present —
      // headlines without dates aren't useful in the timeline.
      const events: CaseEventInput[] = [];
      if (fields.missing_since && (dateParse.iso || dateParse.quality !== 'unknown')) {
        const locationLabel = fields.location_last_seen?.trim();
        events.push({
          event_kind: 'last_seen',
          headline: locationLabel ? `Last seen — ${locationLabel}` : 'Last seen',
          event_date: dateParse.iso ?? undefined,
          event_date_quality: dateParse.quality,
          event_date_text:
            fields.missing_since && dateParse.quality !== 'exact'
              ? fields.missing_since
              : undefined,
          source_url: detailUrl,
          source_quote: `Missing Since: ${fields.missing_since}`,
        });
      }

      // Status flip event. Doe doesn't surface a publish-date for the
      // close — only the is_closed boolean. Per migration 35 body
      // comment: use 'approximate' quality with today's date as the
      // scrape-observed flip anchor. UI copy carries the cron-cadence
      // caveat ("first observed within ~quarter of cron last fire").
      // source_quote is the verbatim JSON-field signal that justified
      // the event. Idempotent on re-scrape via the
      // unique(case_id, ingest_signature) constraint — re-running
      // tomorrow with a different "today" date would generate a new
      // signature, BUT computeEventSignature drops the date when no
      // event_date_text is set... wait, it includes event_date in the
      // hash. Workaround: pin event_date_text to a stable string so
      // the signature stabilizes across cron firings. Trade-off:
      // event_date_text becomes a synthetic anchor, not a verbatim
      // quote — which is the right call here since Doe has no
      // verbatim flip-date to quote.
      if (isClosed) {
        events.push({
          event_kind: 'status_resolved_other',
          headline: 'Marked closed by Doe Network',
          event_date_quality: 'approximate',
          // Stable signature input: date_text is the anchor across
          // cron firings so re-scrapes don't churn.
          event_date_text: 'observed by Doe Network (date approximate)',
          source_url: detailUrl,
          source_quote: 'is_closed: X',
        });
      }

      return {
        kind: 'missing',
        status: isClosed ? 'cleared_other' : 'open',
        victim_name: fields.pname || undefined,
        victim_first_name: nameParts.first,
        victim_last_name: nameParts.last,
        victim_aliases: fields.nickname_alias && fields.nickname_alias !== 'Unknown'
          ? [fields.nickname_alias]
          : undefined,
        victim_age: parseAge(fields.age ?? ''),
        victim_sex: parseSex(fields.gender ?? ''),
        victim_race: orUndef(fields.race),
        victim_height_cm: fields.height ? heightToCm(fields.height) : undefined,
        victim_weight_kg: fields.weight ? weightToKg(fields.weight) : undefined,
        victim_eye_color: orUndef(fields.eye_color),
        victim_hair_color: orUndef(fields.hair_color),
        distinguishing_marks: orUndef(fields.distinguishing_marks_and_features),

        incident_date: dateParse.iso,
        incident_date_quality: dateParse.quality,
        incident_date_text:
          fields.missing_since && dateParse.quality !== 'exact' ? fields.missing_since : undefined,

        location_text: orUndef(fields.location_last_seen),
        location_city: loc.city,
        location_county: loc.county,
        location_state: stateFromIdValue ?? loc.state,

        last_seen_clothing: orUndef(fields.clothing),

        narrative: narrative ? truncateNarrative(narrative) : undefined,
        narrative_short,

        case_number_primary: agencies[0]?.agency_case_number || undefined,
        namus_number: namusFromInformationSources(fields.information_sources),

        agency_hint: agencyHint,
        photos,
        events,

        raw: {
          fields,
          agencies,
          images: images.map((i) => i.img_reference),
        },
      };
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

function orUndef(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const trimmed = v.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown' || trimmed.toLowerCase() === 'n/a') {
    return undefined;
  }
  return trimmed;
}
