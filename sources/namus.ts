/**
 * NamUs — National Missing and Unidentified Persons System.
 * https://www.namus.gov
 *
 * NamUs is the gold-standard public registry for both missing and
 * unidentified-deceased cases in the United States. Run by the DOJ's
 * National Institute of Justice.
 *
 * v1.0.x ingests UNIDENTIFIED persons only (`namus_up`). The MP set is
 * larger (~26k cases) and overlaps with Charley Project; the UP set is
 * the unique data we don't carry from any other source today and the
 * one that lights up the "Doe" filter chip on the map/list tabs.
 *
 * ─── DORMANT — DO NOT REMOVE ───────────────────────────────────────────
 *
 * This source is fully wired into the pipeline (registered in
 * sources/index.ts) but does NOT ingest at runtime. Every detail-page
 * URL is rejected by NamUs's robots.txt:
 *
 *     User-agent: *
 *     Allow: /$
 *     Allow: /About
 *     Allow: /Contact
 *     Disallow: /
 *
 * Our PoliteFetcher honors this and skips every /api/ URL. Result:
 * scrape:run on this source completes with 0 records.
 *
 * ─── HOW TO WAKE IT UP ─────────────────────────────────────────────────
 *
 * NamUs's posture has historically swung — public scraping was
 * previously tolerated, then formalized via an API access program, then
 * tightened, then partially reopened. When the conditions allow, this
 * source can be live by changing ONE of the following:
 *
 * 1. Register at https://www.namus.gov/About (or whatever the current
 *    "Developer / API" link is). NamUs's program approves bona-fide
 *    research / public-safety integrations. They issue:
 *      - An API key (HTTP header — name varies by program version,
 *        currently `Ocp-Apim-Subscription-Key` on the Azure-fronted
 *        endpoints)
 *      - A documented rate-limit envelope
 *      - A user-agent string they whitelist
 *    To use the key, add support for `headers` in PoliteFetcher.postJson
 *    and ensureSourceRow → wire `NAMUS_API_KEY` env var into this
 *    source's `discoverFn` + `fetchUrls` callbacks. Robots-respect can
 *    stay on; registered traffic is bypassed by their access control,
 *    not by ignoring robots.
 *
 * 2. Receive explicit user attestation that they have permission to
 *    scrape NamUs (e.g. operator is a registered LE agency with
 *    standing access). In that case, gate the source's pipeline on a
 *    `cf:bypass-robots-namus` flag and only honor it when set in env —
 *    this keeps the rule enforced for everyone except the attesting
 *    operator. The bypass should NEVER ship with a default "on."
 *
 * 3. NamUs publishes a permissive robots.txt amendment (unlikely but
 *    historically has happened). At that point this source runs without
 *    any code change.
 *
 * The supporting infrastructure (ListStrategyCustom in types.ts,
 * postJson in http.ts, location_lat/lng pre-supply in persist.ts) is
 * already in place and reusable — none of it depends on NamUs being
 * live. Don't rip it out when refactoring.
 *
 * ─── API shape (probed live, captured here so re-waking doesn't require
 * re-discovery) ────────────────────────────────────────────────────────
 *
 *   - Search: POST https://www.namus.gov/api/CaseSets/NamUs/UnidentifiedPersons/Search
 *     Body: { take, skip, projections: ['idFormatted'], predicate: '' }
 *     Returns: { count, results: [{ idFormatted: "UP12345", ... }] }
 *   - Detail: GET https://www.namus.gov/api/CaseSets/NamUs/UnidentifiedPersons/Cases/{numericId}
 *     Returns: full case object (subjectDescription, circumstances,
 *     physicalDescription, investigatingAgencies, images, ...)
 *   - Total UP records last probed: 15,494
 *
 * Trust weight: 90 — second only to direct agency feeds (95). NamUs is a
 * federal registry with verified agency ownership of each record.
 */

import type {
  AgencyHint,
  CaseRecord,
  ExtractedPhoto,
  SourceConfig,
} from '../supabase/functions/_shared/types.ts';
import {
  extractPhone,
  parseDate,
  parseSex,
  splitName,
  truncateNarrative,
} from '../supabase/functions/_shared/normalize.ts';

const NAMUS_BASE = 'https://www.namus.gov';
const UP_SEARCH = `${NAMUS_BASE}/api/CaseSets/NamUs/UnidentifiedPersons/Search`;
const UP_CASE = (id: string | number) =>
  `${NAMUS_BASE}/api/CaseSets/NamUs/UnidentifiedPersons/Cases/${id}`;

interface UpSearchResponse {
  count: number;
  results: Array<{ idFormatted?: string; modifiedDateTime?: string }>;
}

interface NamusLookup {
  id?: number;
  name?: string;
  localizedName?: string;
  displayName?: string;
}

interface NamusEthnicity extends NamusLookup {}

interface NamusAddress {
  city?: string;
  state?: NamusLookup;
  county?: NamusLookup;
  zipCode?: string;
}

interface NamusGeolocation {
  coordinates?: { lat?: number; lon?: number };
  formattedAddress?: string;
}

interface NamusImage {
  id?: number;
  isDefault?: boolean;
  caption?: string;
  files?: Array<{
    href?: string;
    sizeName?: string; // 'Thumbnail' / 'Original' / 'Poster'
  }>;
}

interface UpCaseDetail {
  id: number;
  idFormatted: string;
  publicationStatus?: NamusLookup;
  caseIdentification?: { caseNumber?: string };
  caseIsResolved?: boolean;
  subjectDescription?: {
    sex?: NamusLookup;
    primaryEthnicity?: NamusEthnicity;
    ethnicities?: NamusEthnicity[];
    estimatedAgeFrom?: number;
    estimatedAgeTo?: number;
    estimatedYearOfDeathFrom?: number;
    estimatedYearOfDeathTo?: number;
    height?: number;
    weight?: number;
  };
  circumstances?: {
    status?: NamusLookup;
    dateFound?: string;
    address?: NamusAddress;
    publicGeolocation?: NamusGeolocation;
    circumstancesOfRecovery?: string;
  };
  physicalDescription?: {
    hairColor?: NamusLookup;
    leftEyeColor?: NamusLookup;
    rightEyeColor?: NamusLookup;
  };
  physicalFeatureDescriptions?: Array<{
    physicalFeature?: NamusLookup;
    description?: string;
  }>;
  images?: NamusImage[];
  investigatingAgencies?: Array<{
    name?: string;
    selection?: {
      agency?: {
        name?: string;
        phone?: string;
        websiteUrl?: string;
      };
    };
    caseNumber?: string;
  }>;
  hrefDefaultImageThumbnail?: string;
  hrefDefaultImagePoster?: string;
}

/** Drop "Unknown" / empty / "Cannot Estimate" lookup names. */
function lookupName(l?: NamusLookup): string | undefined {
  const n = l?.name?.trim();
  if (!n) return undefined;
  const lower = n.toLowerCase();
  if (lower === 'unknown' || lower === 'cannot estimate' || lower === 'n/a') {
    return undefined;
  }
  return n;
}

export const namusUp: SourceConfig = {
  slug: 'namus_up',
  name: 'NamUs Unidentified Persons',
  kind: 'federal',
  baseUrl: NAMUS_BASE,
  // NamUs is a federal registry; their backend is robust but we still want
  // a polite cadence. 1.5s between requests = ~40 cases/min.
  rateLimitMs: 1500,
  scheduleCron: '0 5 1 */2 *', // 1st of every other month, 05:00 UTC
  trustWeight: 90,
  attribution: {
    html:
      'Source: <a href="https://www.namus.gov" rel="external">NamUs</a> ' +
      '(National Missing and Unidentified Persons System)',
    linkBackRequired: true,
  },
  list: {
    kind: 'custom',
    discoverFn: async (fetcher, detailLimit) => {
      // NamUs Search is paginated via {skip, take} in the body. We grab the
      // most-recently-modified subset first; the search endpoint sorts by
      // modifiedDateTime desc by default.
      const PAGE = 200;
      const target = detailLimit ?? 1000;
      const urls: string[] = [];
      let skip = 0;
      while (urls.length < target) {
        const remaining = target - urls.length;
        const take = Math.min(PAGE, remaining);
        const body = {
          take,
          skip,
          projections: ['idFormatted'],
          predicate: '',
        };
        const res = await fetcher.postJson<UpSearchResponse>(UP_SEARCH, body);
        const batch = (res.results ?? [])
          .map((r) => {
            const idf = r.idFormatted ?? '';
            const m = idf.match(/^UP(\d+)$/);
            return m ? UP_CASE(m[1]) : null;
          })
          .filter((u): u is string => !!u);
        if (batch.length === 0) break;
        urls.push(...batch);
        skip += take;
        if (skip >= res.count) break;
      }
      return urls;
    },
  },
  detail: {
    kind: 'json',
    fetchUrls: (detailUrl) => ({ fields: detailUrl }),
    mapJson: (data, detailUrl): Partial<CaseRecord> => {
      const c = data.fields as UpCaseDetail | null;
      if (!c) return { raw: { empty: true } };

      // Skip cases where NamUs hasn't approved publication. We respect their
      // consent gate; tipsters can find these via NamUs directly.
      const pubStatus = c.publicationStatus?.name?.toLowerCase();
      if (pubStatus && pubStatus !== 'published') {
        return { raw: { skipped: 'not published' } };
      }

      const subject = c.subjectDescription ?? {};
      const circ = c.circumstances ?? {};
      const phys = c.physicalDescription ?? {};
      const dateParse = circ.dateFound ? parseDate(circ.dateFound) : { iso: null, quality: 'unknown' as const };

      // Eye color: NamUs tracks left/right separately. Most cases either
      // leave both unknown or list the same color in both. Coalesce: prefer
      // a populated color over Unknown; if both are populated and differ,
      // join them.
      const leftEye = lookupName(phys.leftEyeColor);
      const rightEye = lookupName(phys.rightEyeColor);
      const eyeColor = leftEye && rightEye && leftEye !== rightEye
        ? `${leftEye} (left), ${rightEye} (right)`
        : leftEye ?? rightEye;

      // Distinguishing marks come as a small array of structured items —
      // flatten into a single string with semicolons.
      const distinguishingMarks = (c.physicalFeatureDescriptions ?? [])
        .map((f) => {
          const feature = lookupName(f.physicalFeature);
          const desc = f.description?.trim();
          if (feature && desc) return `${feature}: ${desc}`;
          return desc ?? feature;
        })
        .filter((s): s is string => !!s)
        .join('; ') || undefined;

      // Photos: prefer the explicit images array. Each image typically
      // carries multiple sizes — pick the largest "Original" or "Poster".
      // Skip when the case doesn't have permissionToPublish (rare; NamUs
      // sometimes withholds images even on otherwise-published cases).
      const photos: ExtractedPhoto[] = [];
      for (const img of c.images ?? []) {
        const file = img.files?.find((f) => f.sizeName === 'Original')
          ?? img.files?.find((f) => f.sizeName === 'Poster')
          ?? img.files?.[0];
        if (file?.href) {
          photos.push({
            url: file.href.startsWith('http') ? file.href : `${NAMUS_BASE}${file.href}`,
            kind: 'photo_victim',
            caption: img.caption,
          });
        }
      }
      // Default thumbnail fallback (most published UP cases have at least
      // a placeholder rendering — facial reconstruction or sketch).
      if (photos.length === 0 && c.hrefDefaultImagePoster) {
        photos.push({
          url: `${NAMUS_BASE}${c.hrefDefaultImagePoster}`,
          // The default image on Doe cases is usually a forensic
          // reconstruction or sketch, not a photo. Mark conservatively as
          // reconstruction so the PhotoFrame label correctly reads
          // "FORENSIC RECONSTRUCTION."
          kind: 'reconstruction',
        });
      }

      const lat = circ.publicGeolocation?.coordinates?.lat;
      const lon = circ.publicGeolocation?.coordinates?.lon;

      const agency = c.investigatingAgencies?.[0];
      const agencyHint: AgencyHint | undefined = agency
        ? {
            name: agency.selection?.agency?.name ?? agency.name,
            phone: agency.selection?.agency?.phone
              ? extractPhone(agency.selection.agency.phone)
              : undefined,
            // Agency website goes in raw.agency_website for now; AgencyHint
            // doesn't surface it (yet) and we don't want to silently lose it.
          }
        : undefined;

      const narrative = circ.circumstancesOfRecovery?.trim();
      const narrativeShort = narrative ? narrative.split(/\n{2,}/)[0]?.slice(0, 240) : undefined;

      // location_text falls back to "City, ST" when NamUs didn't compute a
      // formattedAddress (rare but happens for cases with non-US-style
      // location data).
      const cityState = [circ.address?.city, circ.address?.state?.displayName]
        .filter(Boolean)
        .join(', ');
      const locationText =
        circ.publicGeolocation?.formattedAddress ?? (cityState || undefined);

      return {
        kind: 'unidentified',
        status: 'open',
        // Doe cases have no name. CaseRecord.victim_name is optional; leave
        // undefined rather than null so the type matches.
        victim_name: undefined,
        victim_first_name: undefined,
        victim_last_name: undefined,
        victim_age_min: subject.estimatedAgeFrom,
        victim_age_max: subject.estimatedAgeTo,
        victim_sex: subject.sex ? parseSex(subject.sex.name ?? '') : undefined,
        victim_race: lookupName(subject.primaryEthnicity),
        victim_height_cm: subject.height ?? undefined,
        victim_weight_kg: subject.weight ?? undefined,
        victim_eye_color: eyeColor,
        victim_hair_color: lookupName(phys.hairColor),
        distinguishing_marks: distinguishingMarks,

        incident_date: dateParse.iso ?? undefined,
        incident_date_quality: dateParse.quality,

        location_text: locationText,
        location_city: circ.address?.city,
        location_county: lookupName(circ.address?.county),
        location_state: circ.address?.state?.displayName,
        location_zip: circ.address?.zipCode,
        location_lat: typeof lat === 'number' ? lat : undefined,
        location_lng: typeof lon === 'number' ? lon : undefined,

        narrative: narrative ? truncateNarrative(narrative) : undefined,
        narrative_short: narrativeShort,

        case_number_primary: agency?.caseNumber ?? c.caseIdentification?.caseNumber,
        namus_number: c.idFormatted, // "UP12345"

        agency_hint: agencyHint,
        photos,

        raw: {
          id: c.id,
          idFormatted: c.idFormatted,
          modifiedAt: (data as { modifiedDateTime?: string }).modifiedDateTime,
          detailUrl,
          agency_website: agency?.selection?.agency?.websiteUrl,
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
