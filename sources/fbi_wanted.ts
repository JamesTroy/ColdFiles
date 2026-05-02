/**
 * FBI Wanted — federal cold-case + missing-person feed.
 *
 * Public open API at api.fbi.gov; no auth, no robots blocks. The dataset
 * carries:
 *   - ViCAP Homicides (unsolved homicide victims, identified by name)
 *   - Kidnappings and Missing Persons (active missing-person posters)
 *   - Seeking Information (unsolved investigations, mostly homicide)
 *   - Plus categories we deliberately skip: Most Wanted Fugitives, ECAP,
 *     domestic terrorism — those are perpetrators, not cold-case victims.
 *
 * Endpoint shape:
 *   - List:   GET https://api.fbi.gov/wanted/v1/list?pageSize=50&page=N
 *             returns { total, items: [...] } where each item carries the
 *             full case record (no separate detail fetch needed in
 *             principle, but we go through the per-case pathId endpoint
 *             anyway to match the pipeline's discover→detail flow).
 *   - Detail: GET <item.pathId>  (e.g. api.fbi.gov/@wanted-person/<uid>)
 *
 * Trust weight: 85 — federal source, agency-owned posters, but the FBI
 * sometimes posts third-party-investigator referrals where the actual
 * primary agency is local LE. NamUs (90) edges this out for unidentified-
 * person rigor; agency-direct (95) still tops both.
 */

import type {
  AgencyHint,
  CaseKind,
  CaseRecord,
  ExtractedPhoto,
  SourceConfig,
} from '../supabase/functions/_shared/types.ts';
import {
  parseDate,
  parseSex,
  parseState,
  splitName,
  stripHtml,
  truncateNarrative,
} from '../supabase/functions/_shared/normalize.ts';

const API_BASE = 'https://api.fbi.gov/wanted/v1';
const DETAIL_BASE = 'https://api.fbi.gov/@wanted-person';

interface FbiImage {
  large?: string;
  thumb?: string;
  original?: string;
  caption?: string | null;
}

interface FbiItem {
  uid: string;
  title?: string;
  description?: string;
  details?: string;
  caution?: string;
  subjects?: string[];
  images?: FbiImage[];
  files?: Array<{ url?: string; name?: string }>;
  field_offices?: string[] | null;
  publication?: string;
  modified?: string;
  status?: string;
  url?: string;
  path?: string;
  pathId?: string;
  poster_classification?: string;
  reward_text?: string | null;
  reward_min?: number;
  reward_max?: number;
  sex?: string | null;
  age_min?: number | null;
  age_max?: number | null;
  hair?: string | null;
  eyes?: string | null;
  height_min?: number | null;
  height_max?: number | null;
  weight_min?: number | null;
  weight_max?: number | null;
  race?: string | null;
  scars_and_marks?: string | null;
  place_of_birth?: string | null;
  ncic?: string | null;
  dates_of_birth_used?: string[] | null;
  coordinates?: Array<{ lat?: number; lon?: number }> | null;
}

interface FbiSearchResponse {
  total: number;
  items: FbiItem[];
}

/**
 * Map an item's `subjects` + `poster_classification` to one of our case
 * kinds, OR null when the item is a perpetrator-focused poster (Most
 * Wanted Fugitives, ECAP, etc.) that we shouldn't ingest.
 */
function bucketKind(item: FbiItem): CaseKind | null {
  const subjects = (item.subjects ?? []).map((s) => s.toLowerCase());
  const cls = item.poster_classification ?? '';

  // Perpetrator-focused buckets — skip outright.
  const perp = [
    'ten most wanted fugitives',
    'most wanted',
    'wanted fugitives',
    'eci',
    'crimes against children',
    'cyber',
    'human trafficking',
    'criminal enterprise',
    'counterintelligence',
    'domestic terrorism',
    'international terrorism',
    'violent crimes',
    'white collar',
  ];
  if (subjects.some((s) => perp.includes(s))) return null;
  if (cls === 'ten') return null;

  if (subjects.includes('vicap unidentified persons')) return 'unidentified';
  if (subjects.includes('vicap homicides and sexual assaults')) return 'homicide';
  if (subjects.includes('vicap missing persons')) return 'missing';
  if (subjects.includes('kidnappings and missing persons')) return 'missing';
  if (cls === 'missing') return 'missing';

  // Seeking Information is the long tail — most are unsolved homicides
  // (the FBI uses this when victim ID is known but suspect isn't), some
  // are wanted-suspect-info (we skip those by inspecting title language).
  if (subjects.includes('seeking information')) {
    const text = `${item.title ?? ''} ${item.description ?? ''}`.toLowerCase();
    if (/wanted|suspect|fugitive|fled|escaped/.test(text)) return null;
    return 'homicide';
  }

  // Default: skip unknown bucket.
  return null;
}

/**
 * Cold-enough filter for FBI Wanted ingest.
 *
 * The FBI Wanted feed is a *current alerts* board, not a cold-case
 * archive. It carries notices ranging from decades-old ViCAP cases to
 * bulletins issued days ago. Ingesting recent bulletins as if they were
 * cold cases would:
 *   1. Pollute the corpus's editorial premise (The Cold File is for
 *      cold cases — families of victims and survivors expect that
 *      framing). A 2-week-old active investigation read as a "cold
 *      case" is jarring.
 *   2. Ship records with weak dedupe keys — Wanted bulletins are
 *      sometimes posted before NamUs / state clearinghouse records
 *      land for the same case, so we'd duplicate.
 *
 * Threshold: incident_date must be >= 5 years old. The 5-year bar is
 * Project: Cold Case's published cold-case definition, the same one
 * used in the v1.0.x cold-pill rendering. Cases without a parseable
 * date in the FBI description are skipped — without a date we can't
 * make the cold-case claim.
 *
 * Required-field gate: cases need a parseable location_state AND
 * (for kind != 'unidentified') a victim name, so dedupe keys actually
 * generate. Without state + name, every re-scrape would create a fresh
 * row instead of UPDATE-ing the existing one.
 */
function isColdEnoughForIngest(
  item: FbiItem,
  kind: CaseKind | null,
): boolean {
  if (!kind) return false;
  const desc = parseDescription(item.description);

  // Required: parseable date.
  if (!desc.date) return false;
  const incidentMs = Date.parse(desc.date);
  if (Number.isNaN(incidentMs)) return false;

  // Required: at least 5 years cold.
  const FIVE_YEARS_MS = 5 * 365.25 * 24 * 60 * 60 * 1000;
  if (Date.now() - incidentMs < FIVE_YEARS_MS) return false;

  // Required: parseable state for dedupe (location_state participates
  // in the name_state_year dedupe key).
  const cityState = splitCityState(desc.locationText);
  if (!cityState.state) return false;

  // For named kinds, require a parseable victim name in the title.
  // Unidentified cases use the anonymous "Unidentified Female / Male"
  // titles by design — no name expected.
  if (kind === 'homicide' || kind === 'missing') {
    const titleClean = (item.title ?? '')
      .split(/\s*[-–—]\s*/)[0]
      ?.trim();
    if (!titleClean || titleClean.length < 3) return false;
  }

  return true;
}

/**
 * Parse the description blob — typically "City, State\\nMonth Day, Year" —
 * into a location + date pair.
 */
function parseDescription(desc: string | undefined): {
  locationText?: string;
  date?: string;
} {
  if (!desc) return {};
  const lines = desc
    .split(/[\r\n]+/)
    .map((l) => stripHtml(l).trim())
    .filter(Boolean);
  if (lines.length === 0) return {};
  // Heuristic: the LAST line that looks like a date is the incident date;
  // earlier lines are location.
  let dateIdx = -1;
  let date: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseDate(lines[i]);
    if (parsed.iso) {
      date = parsed.iso;
      dateIdx = i;
      break;
    }
  }
  const locationLines = lines.filter((_, i) => i !== dateIdx);
  return {
    locationText: locationLines.join(', ') || undefined,
    date,
  };
}

/**
 * "City, State" → { city, state } where state is normalized to a
 * 2-letter US code. The FBI feed uses full state names ("California",
 * "Virginia") in description blobs, not the 2-letter codes the
 * downstream schema expects. Run the trailing token through
 * `parseState` (handles "California", "CA", "calif.", etc.) so the
 * dedupe key (name_state_year) generates correctly.
 *
 * Returns state undefined when the trailing token isn't a recognizable
 * US state — typically international locations like "Mannheim, Germany"
 * which the cold-case-cold-enough filter then drops.
 */
function splitCityState(loc: string | undefined): {
  city?: string;
  state?: string;
} {
  if (!loc) return {};
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  const last = parts[parts.length - 1];
  const state = parseState(last);
  const city = state ? parts.slice(0, -1).join(', ') : parts.join(', ');
  return { city: city || undefined, state };
}

export const fbiWanted: SourceConfig = {
  slug: 'fbi_wanted',
  name: 'FBI Wanted',
  kind: 'federal',
  baseUrl: 'https://www.fbi.gov',
  rateLimitMs: 1500,
  scheduleCron: '0 5 7 */1 *', // 7th of every month, 05:00 UTC
  trustWeight: 85,
  attribution: {
    html: 'Source: <a href="https://www.fbi.gov/wanted" rel="external">FBI Wanted</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'custom',
    discoverFn: async (fetcher, detailLimit) => {
      const target = detailLimit ?? 2000;
      const PAGE = 50;
      const urls: string[] = [];
      let page = 1;
      while (urls.length < target) {
        const res = await fetcher.getJson<FbiSearchResponse>(
          `${API_BASE}/list?pageSize=${PAGE}&page=${page}`,
        );
        const items = res.items ?? [];
        if (items.length === 0) break;
        for (const item of items) {
          if (!item.uid) continue;
          // Skip captured / resolved cases — the case is no longer cold.
          if (item.status === 'captured') continue;
          // Bucket-filter at discovery to avoid the per-case detail fetch
          // for items we'd skip anyway. Plus the cold-enough filter so
          // we don't pollute a cold-case corpus with current alerts.
          const itemKind = bucketKind(item);
          if (itemKind === null) continue;
          if (!isColdEnoughForIngest(item, itemKind)) continue;
          urls.push(`${DETAIL_BASE}/${item.uid}`);
          if (urls.length >= target) break;
        }
        page += 1;
        if (page > 100) break; // safety — would be 5000 cases
      }
      return urls;
    },
  },
  detail: {
    kind: 'json',
    fetchUrls: (detailUrl) => ({ fields: detailUrl }),
    mapJson: (data, detailUrl): Partial<CaseRecord> => {
      const item = data.fields as FbiItem | null;
      if (!item) return { raw: { empty: true } };
      const kind = bucketKind(item);
      if (!kind) return { raw: { skipped: 'wrong bucket' } };
      // Defense in depth: discovery already filters by isColdEnoughForIngest,
      // but if a stale URL slips through (e.g. cached, or a future trigger
      // path bypasses discovery), bail before constructing the case record.
      if (!isColdEnoughForIngest(item, kind)) {
        return { raw: { skipped: 'not cold enough' } };
      }

      const desc = parseDescription(item.description);
      const cityState = splitCityState(desc.locationText);

      // Title parsing — most FBI titles are uppercase "FIRST LAST - LOCATION"
      // for victims (homicide) or just "FIRST LAST" for missing persons.
      // For ViCAP homicides, the title is the victim name; we strip the
      // "- LOCATION" suffix when present.
      const title = (item.title ?? '').trim();
      const titleClean = title.split(/\s*[-–—]\s*/)[0]?.trim() || undefined;
      const titleCased = titleClean
        ? titleClean
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase())
        : undefined;
      const nameParts = titleCased ? splitName(titleCased) : { first: undefined, last: undefined };

      // For missing-person cases, the name is the SUBJECT (the missing
      // person). For homicide victims, same — title = victim name.
      // Unidentified cases: title is descriptive ("Unidentified Female"),
      // not an actual name; skip name fields.
      const isNamed = kind === 'homicide' || kind === 'missing';
      const victimName = isNamed && titleCased ? titleCased : undefined;

      const photos: ExtractedPhoto[] = (item.images ?? [])
        .map((img) => img.original ?? img.large ?? img.thumb)
        .filter((u): u is string => !!u && u.startsWith('http'))
        .map((url) => ({
          url,
          // FBI poster images of homicide victims are real photos. For
          // unidentified-person posters, FBI sometimes runs forensic
          // reconstructions; treat the first image as a photo and let the
          // case-detail UI's kind-based reconstruction inference handle
          // labeling.
          kind: kind === 'unidentified' ? ('reconstruction' as const) : ('photo_victim' as const),
        }));

      // FBI sometimes embeds GPS in coordinates[]. When present, pre-supply
      // them — saves a Mapbox call.
      const coord = item.coordinates?.[0];
      const lat = typeof coord?.lat === 'number' ? coord.lat : undefined;
      const lng = typeof coord?.lon === 'number' ? coord.lon : undefined;

      const agencyName = item.field_offices?.[0]
        ? `FBI ${item.field_offices[0].replace(/\b\w/g, (c) => c.toUpperCase())} Field Office`
        : undefined;
      const agencyHint: AgencyHint | undefined = agencyName
        ? { name: agencyName, tip_url: 'https://tips.fbi.gov' }
        : { name: 'Federal Bureau of Investigation', tip_url: 'https://tips.fbi.gov' };

      const narrativeRaw = stripHtml(item.details ?? '').trim();
      const cautionRaw = stripHtml(item.caution ?? '').trim();
      const narrative =
        [narrativeRaw, cautionRaw].filter(Boolean).join('\n\n') || undefined;
      const narrativeShort = narrative
        ? narrative.split(/\n{2,}/)[0]?.slice(0, 240)
        : undefined;

      const dateParse = desc.date ? parseDate(desc.date) : { iso: null, quality: 'unknown' as const };

      return {
        kind,
        status: 'open',
        victim_name: victimName,
        victim_first_name: isNamed ? nameParts.first : undefined,
        victim_last_name: isNamed ? nameParts.last : undefined,
        // FBI age fields are about the SUBJECT — for missing-person posters
        // that's the missing person; for homicide-victim posters that's
        // the victim. For unidentified, age_min/max describe the body's
        // estimated age range.
        victim_age_min: item.age_min ?? undefined,
        victim_age_max: item.age_max ?? undefined,
        victim_sex: item.sex ? parseSex(item.sex) : undefined,
        victim_race: item.race ?? undefined,
        victim_height_cm:
          // FBI height is in inches; convert when both bounds are set.
          typeof item.height_min === 'number'
            ? Math.round(item.height_min * 2.54)
            : undefined,
        victim_weight_kg:
          typeof item.weight_min === 'number'
            ? Math.round(item.weight_min * 0.453592)
            : undefined,
        victim_eye_color: item.eyes ?? undefined,
        victim_hair_color: item.hair ?? undefined,
        distinguishing_marks: item.scars_and_marks ?? undefined,

        incident_date: dateParse.iso ?? undefined,
        incident_date_quality: dateParse.quality,

        location_text: desc.locationText,
        location_city: cityState.city,
        location_state: cityState.state,
        location_lat: lat,
        location_lng: lng,

        narrative: narrative ? truncateNarrative(narrative) : undefined,
        narrative_short: narrativeShort,

        case_number_primary: item.ncic ?? undefined,
        reward_text: item.reward_text ?? undefined,

        agency_hint: agencyHint,
        photos,

        raw: {
          uid: item.uid,
          subjects: item.subjects,
          poster_classification: item.poster_classification,
          publication: item.publication,
          modified: item.modified,
          public_url: item.url, // human-readable FBI page
          path: item.path,
          field_offices: item.field_offices,
          detailUrl,
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
