/**
 * Sample fallback data for when EXPO_PUBLIC_SUPABASE_URL is unset.
 *
 * Six cases pulled from the prototype, with rich metadata so every screen has
 * something to render — list, map, case detail, sources, routes. Designers
 * iterate on UI without needing a backend wired up. When env vars are set,
 * every hook switches to live queries automatically.
 */

import type {
  AgencyRow,
  CaseRowFull,
  CaseRowMapNear,
  CaseSourceRow,
} from './types/database';

// ────────────────────────────────────────────────────────────────────────────
// Agencies (one per case in the launch metro)
// ────────────────────────────────────────────────────────────────────────────

const AGENCIES: Record<string, AgencyRow> = {
  lasd: {
    id: 'sample-agency-lasd',
    slug: 'lasd',
    name: "Los Angeles County Sheriff's Department · Homicide Bureau",
    short_name: 'LASD',
    agency_type: 'county_sheriff',
    state: 'CA',
    county: 'Los Angeles',
    city: null,
    phone_tip: null,
    tip_url: null,
    tip_route_kind: null,
    cold_case_url: null,
  },
  oxnard_pd: {
    id: 'sample-agency-oxnard',
    slug: 'oxnard-pd',
    name: 'Oxnard Police Department',
    short_name: 'Oxnard PD',
    agency_type: 'city_pd',
    state: 'CA',
    county: 'Ventura',
    city: 'Oxnard',
    phone_tip: null,
    tip_url: null,
    tip_route_kind: null,
    cold_case_url: null,
  },
  vcso: {
    id: 'sample-agency-vcso',
    slug: 'vcso',
    name: "Ventura County Sheriff's Office",
    short_name: 'VCSO',
    agency_type: 'county_sheriff',
    state: 'CA',
    county: 'Ventura',
    city: null,
    phone_tip: null,
    tip_url: null,
    tip_route_kind: null,
    cold_case_url: null,
  },
  topd: {
    id: 'sample-agency-topd',
    slug: 'topd',
    name: 'Thousand Oaks Police',
    short_name: 'TOPD',
    agency_type: 'city_pd',
    state: 'CA',
    county: 'Ventura',
    city: 'Thousand Oaks',
    phone_tip: null,
    tip_url: null,
    tip_route_kind: null,
    cold_case_url: null,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// CaseRowMapNear — used by useCasesNear / useCaseList
// ────────────────────────────────────────────────────────────────────────────

/**
 * recency_alpha mirrors what cases_within_radius / cases_in_bbox compute
 * server-side post-migration-02. Stepwise: 0–3 days → 1.0, 4–10 → 0.5, 11+ → 0.
 */
function recencyAlpha(daysSinceUpdate: number): number {
  if (daysSinceUpdate <= 3) return 1;
  if (daysSinceUpdate <= 10) return 0.5;
  return 0;
}

export const SAMPLE_CASES_MAP: CaseRowMapNear[] = [
  {
    id: 'evans',
    slug: 'david-evans-1985-claremont-ca',
    kind: 'homicide',
    status: 'open',
    victim_name: 'David R. Evans',
    victim_age: 57,
    incident_date: '1985-10-13',
    location_text: 'Claremont, CA',
    location_city: 'Claremont',
    location_state: 'CA',
    narrative_short: 'Mr. Evans was found beaten to death inside his Claremont residence.',
    has_photo: true,
    primary_agency_name: AGENCIES.lasd.name,
    primary_photo_url: null,
    distance_miles: 1.4,
    recency_alpha: recencyAlpha(5),
  },
  {
    id: 'thompson',
    slug: 'maria-thompson-2018-oxnard-ca',
    kind: 'missing',
    status: 'open',
    victim_name: 'Maria Thompson',
    victim_age: 23,
    incident_date: '2018-06-04',
    location_text: 'Oxnard, CA',
    location_city: 'Oxnard',
    location_state: 'CA',
    narrative_short: 'Last seen leaving the Oxnard Walmart parking lot.',
    has_photo: true,
    primary_agency_name: AGENCIES.oxnard_pd.name,
    primary_photo_url: null,
    distance_miles: 4.7,
    recency_alpha: recencyAlpha(1),
  },
  {
    id: 'doe-2003',
    slug: 'doe-2003-ventura-ca',
    kind: 'unidentified',
    status: 'open',
    victim_name: null,
    victim_age: null,
    incident_date: '2003-08-22',
    location_text: 'Ventura, CA',
    location_city: 'Ventura',
    location_state: 'CA',
    narrative_short:
      'Remains recovered along a hiking trail. Forensic facial reconstruction completed.',
    has_photo: false,
    primary_agency_name: AGENCIES.vcso.name,
    primary_photo_url: null,
    distance_miles: 0.6,
    recency_alpha: recencyAlpha(18),
  },
  {
    id: 'hernandez',
    slug: 'hernandez-1992-camarillo-ca',
    kind: 'homicide',
    status: 'open',
    victim_name: 'Roberto Hernandez',
    victim_age: 34,
    incident_date: '1992-03-17',
    location_text: 'Camarillo, CA',
    location_city: 'Camarillo',
    location_state: 'CA',
    narrative_short: null,
    has_photo: false,
    primary_agency_name: AGENCIES.vcso.name,
    primary_photo_url: null,
    distance_miles: 7.2,
    recency_alpha: recencyAlpha(60),
  },
  {
    id: 'doe-1994',
    slug: 'doe-1994-ojai-ca',
    kind: 'unidentified',
    status: 'open',
    victim_name: null,
    victim_age: null,
    incident_date: '1994-11-08',
    location_text: 'Ojai, CA',
    location_city: 'Ojai',
    location_state: 'CA',
    narrative_short: null,
    has_photo: false,
    primary_agency_name: AGENCIES.vcso.name,
    primary_photo_url: null,
    distance_miles: 9.1,
    recency_alpha: recencyAlpha(90),
  },
  {
    id: 'wallace',
    slug: 'wallace-2001-thousand-oaks-ca',
    kind: 'missing',
    status: 'open',
    victim_name: 'James Wallace',
    victim_age: 41,
    incident_date: '2001-07-22',
    location_text: 'Thousand Oaks, CA',
    location_city: 'Thousand Oaks',
    location_state: 'CA',
    narrative_short: null,
    has_photo: false,
    primary_agency_name: AGENCIES.topd.name,
    primary_photo_url: null,
    distance_miles: 12.8,
    recency_alpha: recencyAlpha(14),
  },
];

/**
 * Days since each case last changed — used by the list-row recency dot, the
 * map-pin recency ring, and the "RECENTLY UPDATED" section header. Same shape
 * cases_in_bbox will eventually surface as `recency_alpha` (server-side per
 * the design doc), but for designer mode the raw days-since count is fine.
 */
export const SAMPLE_LAST_CHANGED_DAYS: Record<string, number> = {
  'david-evans-1985-claremont-ca': 5,
  'maria-thompson-2018-oxnard-ca': 1,
  'doe-2003-ventura-ca': 18,
  'hernandez-1992-camarillo-ca': 60,
  'doe-1994-ojai-ca': 90,
  'wallace-2001-thousand-oaks-ca': 14,
};

/**
 * Map-canvas placeholder coordinates (normalized 0..1). Same six cases as
 * SAMPLE_CASES_MAP. When Mapbox lands these go away — real markers render
 * from real lat/lng.
 */
export const SAMPLE_MAP_COORDS: Record<string, { x: number; y: number }> = {
  'david-evans-1985-claremont-ca': { x: 0.35, y: 0.31 },
  'maria-thompson-2018-oxnard-ca': { x: 0.66, y: 0.19 },
  'doe-2003-ventura-ca': { x: 0.49, y: 0.5 },
  'hernandez-1992-camarillo-ca': { x: 0.74, y: 0.28 },
  'doe-1994-ojai-ca': { x: 0.27, y: 0.43 },
  'wallace-2001-thousand-oaks-ca': { x: 0.83, y: 0.41 },
};

// ────────────────────────────────────────────────────────────────────────────
// CaseRowFull — used by useCaseDetail
// ────────────────────────────────────────────────────────────────────────────

export const SAMPLE_CASE_FULL_BY_SLUG: Record<string, CaseRowFull> = {
  'david-evans-1985-claremont-ca': {
    id: 'evans',
    slug: 'david-evans-1985-claremont-ca',
    kind: 'homicide',
    status: 'open',
    victim_name: 'David R. Evans',
    victim_age: 57,
    victim_age_min: null,
    victim_age_max: null,
    victim_sex: 'male',
    victim_race: 'VP, Pomona First Federal',
    incident_date: '1985-10-13',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: 'Claremont, CA',
    location_city: 'Claremont',
    location_state: 'CA',
    narrative:
      'Mr. Evans was found beaten to death inside his Claremont residence on a Sunday evening. His body was discovered by Claremont Police Officers responding to a possible burglary call from neighbors. At the time, the investigation had several persons of interest associated with banking irregularities at PFF Bank, where Mr. Evans served as Vice President.',
    narrative_short: 'Mr. Evans was found beaten to death inside his Claremont residence.',
    case_number_primary: 'CASE-LASD-1985-0413',
    reward_text: null,
    has_photo: true,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.lasd.id,
    primary_agency: AGENCIES.lasd,
  },
  'maria-thompson-2018-oxnard-ca': {
    id: 'thompson',
    slug: 'maria-thompson-2018-oxnard-ca',
    kind: 'missing',
    status: 'open',
    victim_name: 'Maria Thompson',
    victim_age: 23,
    victim_age_min: null,
    victim_age_max: null,
    victim_sex: 'female',
    victim_race: 'Last seen leaving work',
    incident_date: '2018-06-04',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: 'Oxnard, CA',
    location_city: 'Oxnard',
    location_state: 'CA',
    narrative:
      'Maria was last seen leaving the Oxnard Walmart parking lot on the evening of June 4, 2018. Her vehicle, a 2012 silver Honda Civic, was found abandoned the following morning at a Ventura beach access road approximately 14 miles from her workplace. Her phone went offline at 9:47 PM that same evening.',
    narrative_short: 'Last seen leaving the Oxnard Walmart parking lot.',
    case_number_primary: 'NAMUS-MP-87412',
    reward_text: null,
    has_photo: true,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.oxnard_pd.id,
    primary_agency: AGENCIES.oxnard_pd,
  },
  'doe-2003-ventura-ca': {
    id: 'doe-2003',
    slug: 'doe-2003-ventura-ca',
    kind: 'unidentified',
    status: 'open',
    victim_name: null,
    victim_age: null,
    victim_age_min: 30,
    victim_age_max: 45,
    victim_sex: 'female',
    victim_race: 'Estimated age 30–45 · female',
    incident_date: '2003-08-22',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: 'Ventura, CA',
    location_city: 'Ventura',
    location_state: 'CA',
    narrative:
      'Remains were recovered along a hiking trail in the foothills above Ventura on August 22, 2003. Forensic analysis estimated the decedent to be a female aged 30–45 of mixed heritage. A forensic facial reconstruction was completed in 2008 and updated using current methods in 2019. DNA is on file with NamUs.',
    narrative_short:
      'Remains recovered along a hiking trail. Forensic facial reconstruction completed.',
    case_number_primary: 'NAMUS-UP-19288',
    reward_text: null,
    has_photo: false,
    has_sketch: true,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 18 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.vcso.id,
    primary_agency: AGENCIES.vcso,
  },
  'hernandez-1992-camarillo-ca': {
    id: 'hernandez',
    slug: 'hernandez-1992-camarillo-ca',
    kind: 'homicide',
    status: 'open',
    victim_name: 'Roberto Hernandez',
    victim_age: 34,
    victim_age_min: null,
    victim_age_max: null,
    victim_sex: 'male',
    victim_race: 'Construction foreman',
    incident_date: '1992-03-17',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: 'Camarillo, CA',
    location_city: 'Camarillo',
    location_state: 'CA',
    narrative: null,
    narrative_short: null,
    case_number_primary: null,
    reward_text: null,
    has_photo: false,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 60 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.vcso.id,
    primary_agency: AGENCIES.vcso,
  },
  'doe-1994-ojai-ca': {
    id: 'doe-1994',
    slug: 'doe-1994-ojai-ca',
    kind: 'unidentified',
    status: 'open',
    victim_name: null,
    victim_age: null,
    victim_age_min: 16,
    victim_age_max: 22,
    victim_sex: 'male',
    victim_race: 'Estimated age 16–22 · male',
    incident_date: '1994-11-08',
    incident_date_quality: 'year_only',
    incident_date_text: '1994',
    location_text: 'Ojai, CA',
    location_city: 'Ojai',
    location_state: 'CA',
    narrative: null,
    narrative_short: null,
    case_number_primary: null,
    reward_text: null,
    has_photo: false,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.vcso.id,
    primary_agency: AGENCIES.vcso,
  },
  'wallace-2001-thousand-oaks-ca': {
    id: 'wallace',
    slug: 'wallace-2001-thousand-oaks-ca',
    kind: 'missing',
    status: 'open',
    victim_name: 'James Wallace',
    victim_age: 41,
    victim_age_min: null,
    victim_age_max: null,
    victim_sex: 'male',
    victim_race: 'Last seen at home',
    incident_date: '2001-07-22',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: 'Thousand Oaks, CA',
    location_city: 'Thousand Oaks',
    location_state: 'CA',
    narrative: null,
    narrative_short: null,
    case_number_primary: null,
    reward_text: null,
    has_photo: false,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.topd.id,
    primary_agency: AGENCIES.topd,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Sources (per-case, with trust + last_ingested_at for the chip ordering)
// ────────────────────────────────────────────────────────────────────────────

function makeSource(
  caseId: string,
  source_id: string,
  slug: string,
  name: string,
  trust: number,
  daysAgo: number,
): CaseSourceRow {
  return {
    id: `${caseId}-${slug}`,
    case_id: caseId,
    source_id,
    source_external_id: caseId,
    source_url: `https://${slug.replace('_', '')}.example/case/${caseId}`,
    trust_weight: trust,
    last_ingested_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    source: {
      id: source_id,
      slug,
      name,
      kind: trust >= 90 ? 'agency' : trust >= 70 ? 'aggregator' : 'nonprofit',
      base_url: `https://${slug.replace('_', '')}.example`,
      attribution_html: `Source: <a href="https://${slug.replace('_', '')}.example">${name}</a>`,
    },
  };
}

export const SAMPLE_CASE_SOURCES_BY_CASE_ID: Record<string, CaseSourceRow[]> = {
  evans: [
    makeSource('evans', 'src-lasd', 'lasd_homicide', 'LASD Homicide Bureau', 95, 5),
    makeSource('evans', 'src-pcc', 'project_cold_case', 'Project: Cold Case', 50, 48),
  ],
  thompson: [
    makeSource('thompson', 'src-namus', 'namus', 'NamUs', 90, 2),
    makeSource('thompson', 'src-charley', 'charley_project', 'The Charley Project', 75, 26),
    makeSource('thompson', 'src-doe', 'doe_network', 'The Doe Network', 70, 46),
  ],
  'doe-2003': [
    makeSource('doe-2003', 'src-namus', 'namus', 'NamUs', 90, 12),
    makeSource('doe-2003', 'src-doe', 'doe_network', 'The Doe Network', 70, 64),
  ],
  hernandez: [
    makeSource('hernandez', 'src-pcc', 'project_cold_case', 'Project: Cold Case', 50, 26),
  ],
  'doe-1994': [
    makeSource('doe-1994', 'src-doe', 'doe_network', 'The Doe Network', 70, 105),
  ],
  wallace: [
    makeSource('wallace', 'src-charley', 'charley_project', 'The Charley Project', 75, 15),
    makeSource('wallace', 'src-namus', 'namus', 'NamUs', 90, 7),
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Tip routes (per-case) — used by the submit-tip modal in designer mode.
// Three cards each, with one carrying the RECOMMENDED badge.
// ────────────────────────────────────────────────────────────────────────────

export interface SampleTipRoute {
  id: string;
  agency: { name: string; short_name?: string };
  meta: string;
  recommended: boolean;
}

export const SAMPLE_TIP_ROUTES_BY_SLUG: Record<string, SampleTipRoute[]> = {
  'david-evans-1985-claremont-ca': [
    {
      id: 'la-crime-stoppers',
      agency: { name: 'LA Crime Stoppers', short_name: 'LA Crime Stoppers' },
      meta: 'Anonymous · routes to LASD detective on this case · reward eligible',
      recommended: true,
    },
    {
      id: 'lasd-direct',
      agency: { name: 'LASD Homicide Bureau', short_name: 'LASD Homicide' },
      meta: '323-890-5500 · direct line',
      recommended: false,
    },
    {
      id: 'fbi-tip',
      agency: { name: 'FBI Tip Line', short_name: 'FBI' },
      meta: 'Federal jurisdiction or interstate',
      recommended: false,
    },
  ],
  'maria-thompson-2018-oxnard-ca': [
    {
      id: 'ventura-cs',
      agency: { name: 'Ventura County Crime Stoppers', short_name: 'Ventura CS' },
      meta: 'Anonymous · routes to Oxnard PD detective · reward eligible',
      recommended: true,
    },
    {
      id: 'oxnard-pd',
      agency: { name: 'Oxnard Police Department', short_name: 'Oxnard PD' },
      meta: '805-385-7600 · main',
      recommended: false,
    },
    {
      id: 'fbi-tip',
      agency: { name: 'FBI Tip Line', short_name: 'FBI' },
      meta: 'Federal jurisdiction or interstate',
      recommended: false,
    },
  ],
  'doe-2003-ventura-ca': [
    {
      id: 'ventura-cs',
      agency: { name: 'Ventura County Crime Stoppers', short_name: 'Ventura CS' },
      meta: 'Anonymous · routes to VCSO detective · reward eligible',
      recommended: true,
    },
    {
      id: 'namus-form',
      agency: { name: 'NamUs Tipline', short_name: 'NamUs' },
      meta: 'Specialized for unidentified persons',
      recommended: false,
    },
  ],
  'hernandez-1992-camarillo-ca': [
    {
      id: 'ventura-cs',
      agency: { name: 'Ventura County Crime Stoppers', short_name: 'Ventura CS' },
      meta: 'Anonymous · routes to VCSO · reward eligible',
      recommended: true,
    },
  ],
  'doe-1994-ojai-ca': [
    {
      id: 'namus-form',
      agency: { name: 'NamUs Tipline', short_name: 'NamUs' },
      meta: 'Specialized for unidentified persons',
      recommended: true,
    },
  ],
  'wallace-2001-thousand-oaks-ca': [
    {
      id: 'ventura-cs',
      agency: { name: 'Ventura County Crime Stoppers', short_name: 'Ventura CS' },
      meta: 'Anonymous · routes to TOPD · reward eligible',
      recommended: true,
    },
  ],
};
