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
 * New York State DCJS Missing Persons Clearinghouse.
 *
 * State-level government source. The clearinghouse is run by NY's Division
 * of Criminal Justice Services and covers actively-missing only — children,
 * college students, and vulnerable adults. Unidentified decedents are NOT
 * here (NY routes those through NamUs).
 *
 * The site at /missing/ is an AngularJS SPA that calls a public REST
 * endpoint at /MPAPubNotificationWeb/MPAPubNotification/. The endpoint
 * supports JSONP (callback=cb wraps the body) but ALSO returns plain JSON
 * when no callback param is sent — confirmed empirically 2026-05-08.
 * We hit the plain-JSON path so the standard JSON detail strategy works
 * unchanged.
 *
 * Index feeds (one per case-type bucket):
 *   requestType=4 → Missing Children (~120 cases)
 *   requestType=5 → Missing College Students (~8)
 *   requestType=6 → Missing Vulnerable Adults (~49)
 *   requestType=A → Active Alerts (AMBER / Silver / etc. — DELIBERATELY
 *                   SKIPPED. The A feed mixes ephemeral alerts with the
 *                   real corpus; per the editorial-noise rule we keep
 *                   alerts out of the cold-case dataset.)
 *
 * Total corpus is small (~177 cases). Daily refresh is fine.
 *
 * Listing payload shape (note: `missingPerson` is an object keyed by
 * stringified indices, NOT a true array — Object.values to iterate):
 *   { missingPerson: { "0": {caseId, fullName, ...}, "1": {...} } }
 *
 * Detail payload shape (single-record, same wrapper):
 *   { missingPerson: { "0": { caseDate, caseNumber, missingPerson1FirstName,
 *                              missingPerson1Image, ... } } }
 *
 * The runner's built-in 'json_api' list strategy expects items to be a
 * proper Array, so this source uses 'custom' to do the Object.values()
 * conversion in the discoverFn.
 *
 * Trust weight: 80. Above Doe Network (70) and Charley Project (75)
 * because state LE owns the case rows directly; below NamUs federal (90)
 * and agency-direct (95) because state-level coverage scope is narrower.
 *
 * Photos: state-government works, attribution = "NYS DCJS". URLs come
 * back as http:// (not https) — the photo-cache pipeline mirrors HTTP
 * photo URLs into Supabase Storage per the photo-sourcing-policy memory.
 */

const API_BASE =
  'https://www.criminaljustice.ny.gov/MPAPubNotificationWeb/MPAPubNotification';

const REQUEST_TYPES_INGESTED = ['4', '5', '6'] as const;
type RequestType = (typeof REQUEST_TYPES_INGESTED)[number];

/**
 * Detail-page URL synthesized from a caseId. The caseId is the only
 * stable identifier DCJS exposes — caseNumber (like "26-52965 JD") is
 * the agency-issued reference but a few records have it blank. Use
 * caseId as the source_external_id, caseNumber as a Tier-1 dedupe key
 * via agency_case_number when present.
 */
function detailUrlFor(caseId: string): string {
  return `${API_BASE}/getCaseDetails?caseId=${encodeURIComponent(caseId)}`;
}

interface DcjsSummaryItem {
  caseId?: string;
}

interface DcjsDetailFields {
  caseDate?: string;
  caseNumber?: string;
  caseType?: string;
  caseCircumstances?: string;
  dateOfMissing?: string;
  investigatingAgency?: string;
  missingFrom?: string;
  otherInformation?: string;
  fullName?: string;
  missingPerson1FirstName?: string;
  missingPerson1MiddleName?: string;
  missingPerson1LastName?: string;
  missingPerson1Image?: string;
  missingPerson1DateOfBirth?: string;
  missingPerson1Sex?: string;
  missingPerson1Height?: string;
  missingPerson1Weight?: string;
  missingPerson1HairColor?: string;
  missingPerson1EyeColor?: string;
  missingPerson1Race?: string;
}

/**
 * Pull the first record out of DCJS's `missingPerson: { "0": {...} }`
 * envelope. Returns undefined when the wrapper is empty (case not found).
 */
function unwrapFirst<T>(payload: unknown): T | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const wrapper = (payload as Record<string, unknown>).missingPerson;
  if (!wrapper || typeof wrapper !== 'object') return undefined;
  const values = Object.values(wrapper as Record<string, unknown>);
  return values[0] as T | undefined;
}

function unwrapAll<T>(payload: unknown): T[] {
  if (!payload || typeof payload !== 'object') return [];
  const wrapper = (payload as Record<string, unknown>).missingPerson;
  if (!wrapper || typeof wrapper !== 'object') return [];
  return Object.values(wrapper as Record<string, unknown>) as T[];
}

/**
 * "CENTEREACH , New York" → { city: 'CENTEREACH', state: 'NY' }
 *
 * DCJS pads with " , " and uses ALL CAPS for cities. Tolerate both
 * "CITY, State" and "CITY , State" (trailing-space-before-comma is
 * the common pattern in the live data).
 */
function splitMissingFrom(text?: string): { city?: string; state?: string } {
  if (!text) return {};
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  const head = parts[0];
  const tail = parts[parts.length - 1];
  const state = tail !== head ? parseState(tail) : undefined;
  return {
    city: head || undefined,
    state,
  };
}

export const nysDcjs: SourceConfig = {
  slug: 'nys_dcjs',
  name: 'New York State Missing Persons Clearinghouse',
  kind: 'state',
  baseUrl: 'https://www.criminaljustice.ny.gov',
  rateLimitMs: 1000,
  // Daily — full corpus refresh is ~3 minutes at 1 req/sec across ~180 cases.
  scheduleCron: '0 5 * * *',
  trustWeight: 80,
  attribution: {
    html:
      'Source: <a href="https://www.criminaljustice.ny.gov/missing" rel="external">NYS Missing Persons Clearinghouse</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'custom',
    discoverFn: async (fetcher, detailLimit) => {
      const seen = new Set<string>();
      const urls: string[] = [];
      for (const requestType of REQUEST_TYPES_INGESTED) {
        const summaryUrl = `${API_BASE}/getSummary?requestType=${requestType}`;
        const payload = await fetcher.getJson<unknown>(summaryUrl);
        const items = unwrapAll<DcjsSummaryItem>(payload);
        for (const item of items) {
          const caseId = item.caseId;
          if (!caseId) continue;
          const url = detailUrlFor(caseId);
          if (seen.has(url)) continue;
          seen.add(url);
          urls.push(url);
          if (detailLimit && urls.length >= detailLimit) return urls;
        }
      }
      return urls;
    },
  },
  detail: {
    kind: 'json',
    fetchUrls: (detailUrl) => ({ detail: detailUrl }),
    mapJson: (data, detailUrl): Partial<CaseRecord> => {
      const fields = unwrapFirst<DcjsDetailFields>(data.detail);
      if (!fields) {
        // Wrapper was empty — case removed / never published. Treat as
        // a no-op skip; the runner will record extract_skipped and
        // move on without inserting a row.
        return { raw: { closed: true } };
      }

      const caseId = new URL(detailUrl).searchParams.get('caseId') ?? '';
      const dateParse = parseDate(fields.dateOfMissing ?? '');
      const loc = splitMissingFrom(fields.missingFrom);

      // Compute age at incident from DOB + dateOfMissing when both parse.
      // CaseRecord stores age, not DOB; victim_dob isn't in the schema
      // because most upstream sources expose age directly. We compute it
      // here so the demographics block on the case-detail screen can
      // surface "Age 16 at the time" without lossy guesswork.
      const dobParse = parseDate(fields.missingPerson1DateOfBirth ?? '');
      let victimAge: number | undefined;
      if (dobParse.iso && dateParse.iso) {
        const dob = new Date(dobParse.iso);
        const inc = new Date(dateParse.iso);
        if (!Number.isNaN(dob.getTime()) && !Number.isNaN(inc.getTime())) {
          let age = inc.getFullYear() - dob.getFullYear();
          const m = inc.getMonth() - dob.getMonth();
          if (m < 0 || (m === 0 && inc.getDate() < dob.getDate())) age -= 1;
          if (age >= 0 && age <= 130) victimAge = age;
        }
      }

      // DCJS uppercases names ("TERSHAWN SMITH"). Don't titlecase here —
      // the persist/normalize layer owns display formatting; we hand it
      // the upstream value verbatim so future-us can audit raw → cleaned.
      const victim_name = fields.fullName?.trim() || undefined;

      const agencyHint: AgencyHint | undefined = fields.investigatingAgency
        ? {
            name: fields.investigatingAgency.trim(),
            // No phone field exposed; leave undefined. The agency name
            // alone suffices for the tip-routing resolver to look up a
            // phone via the agencies table when one's been seeded.
          }
        : undefined;

      const photos: ExtractedPhoto[] = fields.missingPerson1Image
        ? [
            {
              url: fields.missingPerson1Image,
              kind: 'photo_victim' as const,
            },
          ]
        : [];

      const narrative = (fields.otherInformation ?? '').trim();
      const narrativeShort =
        narrative.split(/\n{2,}/)[0]?.slice(0, 240) || undefined;

      // Timeline event — last_seen. Only emit when dateOfMissing parsed.
      // source_quote captures the raw upstream value verbatim per
      // editorial-noise rule (migration 35).
      const events: CaseEventInput[] = [];
      if (
        fields.dateOfMissing &&
        (dateParse.iso || dateParse.quality !== 'unknown')
      ) {
        const locationLabel = fields.missingFrom?.trim();
        events.push({
          event_kind: 'last_seen',
          headline: locationLabel ? `Last seen — ${locationLabel}` : 'Last seen',
          event_date: dateParse.iso ?? undefined,
          event_date_quality: dateParse.quality,
          event_date_text:
            fields.dateOfMissing && dateParse.quality !== 'exact'
              ? fields.dateOfMissing
              : undefined,
          source_url: detailUrl,
          source_quote: `Date of missing: ${fields.dateOfMissing}`,
        });
      }

      const partial: Partial<CaseRecord> = {
        source_external_id: caseId,
        source_url: detailUrl,
        kind: 'missing',
        status: 'open',
        victim_name,
        victim_first_name: fields.missingPerson1FirstName?.trim() || undefined,
        victim_last_name: fields.missingPerson1LastName?.trim() || undefined,
        victim_age: victimAge,
        victim_sex: parseSex(fields.missingPerson1Sex ?? ''),
        victim_race: fields.missingPerson1Race?.trim() || undefined,
        victim_height_cm: heightToCm(fields.missingPerson1Height ?? ''),
        victim_weight_kg: weightToKg(fields.missingPerson1Weight ?? ''),
        victim_hair_color: fields.missingPerson1HairColor?.trim() || undefined,
        victim_eye_color: fields.missingPerson1EyeColor?.trim() || undefined,
        incident_date: dateParse.iso ?? undefined,
        incident_date_quality: dateParse.quality,
        incident_date_text:
          fields.dateOfMissing && dateParse.quality !== 'exact'
            ? fields.dateOfMissing
            : undefined,
        last_seen_date: dateParse.iso ?? undefined,
        last_seen_text: fields.missingFrom?.trim() || undefined,
        last_seen_circumstances: fields.caseCircumstances?.trim() || undefined,
        location_text: fields.missingFrom?.trim() || undefined,
        location_city: loc.city,
        location_state: loc.state,
        agency_hint: agencyHint,
        // case_number_primary feeds the agency_case_number Tier-1 dedupe
        // key (DedupeKeyType 'agency_case_number') in dedupe.ts. NY DCJS
        // emits e.g. "26-52965 JD" — agency-issued, mostly populated.
        case_number_primary: fields.caseNumber?.trim() || undefined,
        narrative: narrative ? truncateNarrative(narrative) : undefined,
        narrative_short: narrativeShort,
        photos,
        events: events.length ? events : undefined,
        raw: {
          caseType: fields.caseType,
          caseDate: fields.caseDate,
          dateOfBirth: fields.missingPerson1DateOfBirth,
          middleName: fields.missingPerson1MiddleName,
        },
      };

      return partial;
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
