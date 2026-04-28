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
  CaseMediaRow,
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
  lapd: {
    id: 'sample-agency-lapd',
    slug: 'lapd',
    name: 'Los Angeles Police Department',
    short_name: 'LAPD',
    agency_type: 'city_pd',
    state: 'CA',
    county: 'Los Angeles',
    city: 'Los Angeles',
    phone_tip: null,
    tip_url: null,
    tip_route_kind: null,
    cold_case_url: null,
  },
  fbi: {
    id: 'sample-agency-fbi',
    slug: 'fbi-la',
    name: 'FBI Los Angeles Field Office',
    short_name: 'FBI',
    agency_type: 'federal',
    state: 'CA',
    county: null,
    city: 'Los Angeles',
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
    lat: 34.0967,
    lng: -117.7196,
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
    lat: 34.1975,
    lng: -119.1771,
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
    has_photo: true,
    primary_agency_name: AGENCIES.vcso.name,
    primary_photo_url: null,
    distance_miles: 0.6,
    recency_alpha: recencyAlpha(18),
    lat: 34.2746,
    lng: -119.229,
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
    has_photo: true,
    primary_agency_name: AGENCIES.vcso.name,
    primary_photo_url: null,
    distance_miles: 7.2,
    recency_alpha: recencyAlpha(60),
    lat: 34.2164,
    lng: -119.0376,
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
    has_photo: true,
    primary_agency_name: AGENCIES.vcso.name,
    primary_photo_url: null,
    distance_miles: 9.1,
    recency_alpha: recencyAlpha(90),
    lat: 34.448,
    lng: -119.2429,
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
    has_photo: true,
    primary_agency_name: AGENCIES.topd.name,
    primary_photo_url: null,
    distance_miles: 12.8,
    recency_alpha: recencyAlpha(14),
    lat: 34.1706,
    lng: -118.8376,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Real LA County cases — manually seeded for designer mode validation.
  // Photo URLs are TODO — open source_url, copy image URL, paste into the
  // SAMPLE_CASE_MEDIA_BY_CASE_ID entry for the matching case_id below.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'aujay-1998',
    slug: 'jonathan-aujay-1998-devils-punchbowl-ca',
    kind: 'missing',
    status: 'open',
    victim_name: 'Jonathan Aujay',
    victim_age: 32,
    incident_date: '1998-03-07',
    location_text: "Devil's Punchbowl, Angeles National Forest",
    location_city: null,
    location_state: 'CA',
    narrative_short:
      'LASD deputy who disappeared while hiking in the Angeles National Forest. No trace recovered despite extensive search.',
    has_photo: true,
    primary_agency_name: AGENCIES.lasd.name,
    primary_photo_url: null,
    distance_miles: 32.4,
    recency_alpha: recencyAlpha(45),
    lat: 34.4192,
    lng: -117.8642,
  },
  {
    id: 'armstead-2024',
    slug: 'zaryn-armstead-2024-los-angeles-ca',
    kind: 'missing',
    status: 'open',
    victim_name: 'Zaryn Armstead',
    victim_age: null,
    incident_date: '2024-10-17',
    location_text: 'Los Angeles, CA',
    location_city: 'Los Angeles',
    location_state: 'CA',
    narrative_short: 'Missing from Los Angeles since October 17, 2024.',
    has_photo: true,
    primary_agency_name: AGENCIES.lapd.name,
    primary_photo_url: null,
    distance_miles: 8.2,
    recency_alpha: recencyAlpha(2),
    lat: 34.0522,
    lng: -118.2437,
  },
  {
    id: 'up125280-2024',
    slug: 'doe-up125280-2024-los-angeles-county-ca',
    kind: 'unidentified',
    status: 'open',
    victim_name: null,
    victim_age: null,
    incident_date: '2024-06-29',
    location_text: 'Los Angeles County, CA',
    location_city: null,
    location_state: 'CA',
    narrative_short:
      'Unidentified person found in Los Angeles County, June 29, 2024. NamUs case UP125280.',
    has_photo: true,
    primary_agency_name: AGENCIES.lasd.name,
    primary_photo_url: null,
    distance_miles: 11.0,
    recency_alpha: recencyAlpha(12),
    lat: 34.05,
    lng: -118.25,
  },
  {
    id: 'abdelkader-2024',
    slug: 'robert-abdelkader-iii-2024-compton-ca',
    kind: 'homicide',
    status: 'open',
    victim_name: 'Robert Abdelkader III',
    victim_age: 28,
    incident_date: '2024-06-07',
    location_text: 'Compton, CA',
    location_city: 'Compton',
    location_state: 'CA',
    narrative_short:
      'Shot at a Compton pool party June 7, 2024. Joint FBI / LASD investigation; $20,000 reward.',
    has_photo: true,
    primary_agency_name: AGENCIES.fbi.name,
    primary_photo_url: null,
    distance_miles: 14.3,
    recency_alpha: recencyAlpha(3),
    lat: 33.8958,
    lng: -118.2201,
  },
  {
    id: 'alvarez-diaz-2022',
    slug: 'carlos-alvarez-diaz-2022-hawaiian-gardens-ca',
    kind: 'homicide',
    status: 'open',
    victim_name: 'Carlos Alvarez-Diaz',
    victim_age: null,
    incident_date: '2022-10-08',
    location_text: 'Hawaiian Gardens, CA',
    location_city: 'Hawaiian Gardens',
    location_state: 'CA',
    narrative_short:
      'Innocent victim of a drive-by shooting in Hawaiian Gardens, October 8, 2022. $30,000 reward announced May 2023.',
    has_photo: true,
    primary_agency_name: AGENCIES.lasd.name,
    primary_photo_url: null,
    distance_miles: 18.6,
    recency_alpha: recencyAlpha(7),
    lat: 33.8311,
    lng: -118.0726,
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
    has_photo: true,
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
    has_photo: true,
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
    has_photo: true,
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
    has_photo: true,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.topd.id,
    primary_agency: AGENCIES.topd,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Real LA County full-detail entries — matches the SAMPLE_CASES_MAP rows
  // added above. Photo media lives in SAMPLE_CASE_MEDIA_BY_CASE_ID.
  // ──────────────────────────────────────────────────────────────────────────
  'jonathan-aujay-1998-devils-punchbowl-ca': {
    id: 'aujay-1998',
    slug: 'jonathan-aujay-1998-devils-punchbowl-ca',
    kind: 'missing',
    status: 'open',
    victim_name: 'Jonathan Aujay',
    victim_age: 32,
    victim_age_min: null,
    victim_age_max: null,
    victim_sex: 'male',
    victim_race: 'LASD deputy',
    incident_date: '1998-03-07',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: "Devil's Punchbowl, Angeles National Forest",
    location_city: null,
    location_state: 'CA',
    narrative:
      'Jonathan Aujay, an LASD deputy, disappeared while hiking in the Angeles National Forest near Devil\'s Punchbowl on March 7, 1998. Despite an extensive ground and air search by SAR teams, no trace was ever recovered.',
    narrative_short:
      'LASD deputy who disappeared while hiking in the Angeles National Forest. No trace recovered despite extensive search.',
    case_number_primary: null,
    reward_text: null,
    has_photo: true,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 45 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.lasd.id,
    primary_agency: AGENCIES.lasd,
  },
  'zaryn-armstead-2024-los-angeles-ca': {
    id: 'armstead-2024',
    slug: 'zaryn-armstead-2024-los-angeles-ca',
    kind: 'missing',
    status: 'open',
    victim_name: 'Zaryn Armstead',
    victim_age: null,
    victim_age_min: null,
    victim_age_max: null,
    victim_sex: null,
    victim_race: null,
    incident_date: '2024-10-17',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: 'Los Angeles, CA',
    location_city: 'Los Angeles',
    location_state: 'CA',
    narrative: 'Missing from Los Angeles since October 17, 2024. NamUs case MP131995.',
    narrative_short: 'Missing from Los Angeles since October 17, 2024.',
    case_number_primary: 'NAMUS-MP-131995',
    reward_text: null,
    has_photo: true,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.lapd.id,
    primary_agency: AGENCIES.lapd,
  },
  'doe-up125280-2024-los-angeles-county-ca': {
    id: 'up125280-2024',
    slug: 'doe-up125280-2024-los-angeles-county-ca',
    kind: 'unidentified',
    status: 'open',
    victim_name: null,
    victim_age: null,
    victim_age_min: null,
    victim_age_max: null,
    victim_sex: null,
    victim_race: null,
    incident_date: '2024-06-29',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: 'Los Angeles County, CA',
    location_city: null,
    location_state: 'CA',
    narrative:
      'Unidentified person found in Los Angeles County on June 29, 2024. NamUs case UP125280. May include forensic reconstruction or post-mortem imagery — render media gated behind display_warning.',
    narrative_short:
      'Unidentified person found in Los Angeles County, June 29, 2024.',
    case_number_primary: 'NAMUS-UP-125280',
    reward_text: null,
    has_photo: true,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 12 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.lasd.id,
    primary_agency: AGENCIES.lasd,
  },
  'robert-abdelkader-iii-2024-compton-ca': {
    id: 'abdelkader-2024',
    slug: 'robert-abdelkader-iii-2024-compton-ca',
    kind: 'homicide',
    status: 'open',
    victim_name: 'Robert Abdelkader III',
    victim_age: 28,
    victim_age_min: null,
    victim_age_max: null,
    victim_sex: 'male',
    victim_race: null,
    incident_date: '2024-06-07',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: 'Compton, CA',
    location_city: 'Compton',
    location_state: 'CA',
    narrative:
      'Robert Abdelkader III, 28, was shot at a Compton pool party on June 7, 2024. Joint FBI / LASD investigation. The FBI is offering a reward of up to $20,000 for information leading to the identification, arrest, and conviction of the persons responsible.',
    narrative_short:
      'Shot at a Compton pool party June 7, 2024. Joint FBI / LASD investigation.',
    case_number_primary: null,
    reward_text: 'Up to $20,000',
    has_photo: true,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.fbi.id,
    primary_agency: AGENCIES.fbi,
  },
  'carlos-alvarez-diaz-2022-hawaiian-gardens-ca': {
    id: 'alvarez-diaz-2022',
    slug: 'carlos-alvarez-diaz-2022-hawaiian-gardens-ca',
    kind: 'homicide',
    status: 'open',
    victim_name: 'Carlos Alvarez-Diaz',
    victim_age: null,
    victim_age_min: null,
    victim_age_max: null,
    victim_sex: 'male',
    victim_race: null,
    incident_date: '2022-10-08',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: 'Hawaiian Gardens, CA',
    location_city: 'Hawaiian Gardens',
    location_state: 'CA',
    narrative:
      'Carlos Alvarez-Diaz was an innocent victim of a drive-by shooting in Hawaiian Gardens on October 8, 2022. In May 2023 a $30,000 reward was announced by the family and LASD homicide bureau for information leading to an arrest.',
    narrative_short:
      'Innocent victim of a drive-by shooting in Hawaiian Gardens, October 8, 2022.',
    case_number_primary: null,
    reward_text: '$30,000',
    has_photo: true,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    primary_agency_id: AGENCIES.lasd.id,
    primary_agency: AGENCIES.lasd,
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
// Case media (per-case) — used by the case detail PhotoFrame in designer mode.
//
// Picsum returns deterministic CC-licensed photographs from a seed — same
// slug always returns the same image. These are clearly placeholder material
// (landscapes / objects from Unsplash, not faces or silhouettes), so they
// don't violate the design rule about never using a generic stand-in where a
// victim photo belongs. The corner-bracket frame and caption strip mark them
// as case-file material rather than illustration. When Supabase is wired,
// real media rows come from the case_media table and this map becomes
// irrelevant.
// ────────────────────────────────────────────────────────────────────────────

function makePicsumPhoto(caseId: string, slug: string): CaseMediaRow {
  // Designer-mode placeholder for the six fictional Ventura-area cases.
  // Picsum returns deterministic Unsplash photographs by seed — landscapes
  // and objects, never faces / silhouettes. The corner-bracket frame and
  // caption strip mark these as case-file material, not illustration.
  // source_attribution intentionally reads "Designer placeholder" so any
  // QA glance at a screenshot can tell real material from filler.
  return {
    id: `media-${caseId}-photo`,
    case_id: caseId,
    kind: 'photo_victim',
    url: `https://picsum.photos/seed/${slug}/600/400`,
    mirror_url: null,
    source_url: null,
    caption: null,
    is_primary: true,
    display_warning: null,
    source_attribution: 'Designer placeholder',
    is_reconstruction: false,
    source_id: null,
  };
}

export const SAMPLE_CASE_MEDIA_BY_CASE_ID: Record<string, CaseMediaRow[]> = {
  // ── Fictional Ventura-area cases (designer-mode placeholders) ──────────────
  evans: [makePicsumPhoto('evans', 'david-evans-1985-claremont-ca')],
  thompson: [makePicsumPhoto('thompson', 'maria-thompson-2018-oxnard-ca')],
  'doe-2003': [makePicsumPhoto('doe-2003', 'doe-2003-ventura-ca')],
  hernandez: [makePicsumPhoto('hernandez', 'hernandez-1992-camarillo-ca')],
  'doe-1994': [makePicsumPhoto('doe-1994', 'doe-1994-ojai-ca')],
  wallace: [makePicsumPhoto('wallace', 'wallace-2001-thousand-oaks-ca')],

  // ── Real LA County cases — manual seed scaffolding ─────────────────────────
  // For each entry: open `source_url` in a browser, right-click the photo →
  // "Copy image URL", paste into `url`. Cannot be programmatically resolved
  // (NamUs / FBI / LASD bot-block server-side fetches; NamUs is JS-rendered).
  //
  // Hot-link policy per source:
  //   FBI / LASD / NamUs   → hot-link OK (federal / agency CDNs are stable)
  //   Charley Project      → MIRROR to Supabase immediately (donation-funded)
  //   Doe Network          → MIRROR (volunteer-funded)
  //
  // See feedback_photo_sourcing_policy.md in project memory.

  // 1. Jonathan Aujay — LASD deputy missing since 1998. Mirror immediately:
  //    Charley Project bandwidth is donation-funded, hot-linking is the wrong
  //    move. Populate mirror_url from day one (upload the photo to Supabase
  //    Storage and put the public URL there); leave url as the Charley page's
  //    photo URL for provenance.
  'aujay-1998': [
    {
      id: 'media-aujay-photo',
      case_id: 'aujay-1998',
      kind: 'photo_victim',
      url: 'TODO_PHOTO_URL', // Charley Project photo URL (provenance only)
      mirror_url: null, // TODO: upload to Supabase Storage, paste public URL
      source_url: 'https://charleyproject.org/case/jonathan-aujay',
      caption: 'Jonathan Aujay, last seen March 7, 1998',
      is_primary: true,
      display_warning: null,
      source_attribution: 'Charley Project',
      is_reconstruction: false,
      source_id: null,
    },
  ],

  // 2. Zaryn Armstead — recent NamUs missing person, casual family snapshot.
  //    NamUs is JS-rendered; image URL only visible in DevTools Network panel.
  'armstead-2024': [
    {
      id: 'media-armstead-photo',
      case_id: 'armstead-2024',
      kind: 'photo_victim',
      url: 'TODO_PHOTO_URL', // grab CDN URL from NamUs DevTools
      mirror_url: null,
      source_url: 'https://namus.nij.ojp.gov/missing-person-namus-mp131995',
      caption: 'Zaryn Armstead, missing from Los Angeles since October 17, 2024',
      is_primary: true,
      display_warning: null,
      source_attribution: 'NamUs',
      is_reconstruction: false,
      source_id: null,
    },
  ],

  // 3. UP125280 — unidentified, LA County, June 2024.
  //    GATE BEHIND TAP. May include post-mortem photography or forensic
  //    reconstruction. display_warning: 'sensitive' is pre-set; if the page
  //    actually shows forensic art rather than a real photo, flip
  //    is_reconstruction to true.
  'up125280-2024': [
    {
      id: 'media-up125280-photo',
      case_id: 'up125280-2024',
      kind: 'reconstruction', // change to 'photo_victim' if the source isn't art
      url: 'TODO_PHOTO_URL',
      mirror_url: null,
      source_url: 'https://namus.nij.ojp.gov/unidentified-person-namus-up125280',
      caption: 'Unidentified person, found in Los Angeles County, June 29, 2024',
      is_primary: true,
      display_warning: 'sensitive',
      source_attribution: 'NamUs',
      is_reconstruction: true, // flip false if NamUs page shows a real photo
      source_id: null,
    },
  ],

  // 4. Robert Abdelkader III — FBI seeking-info poster.
  //    Federal works, lowest legal risk. FBI page has a "View Poster" link
  //    pointing to a PDF; the poster preview image on the page itself is the
  //    JPG you want. Hot-link OK.
  'abdelkader-2024': [
    {
      id: 'media-abdelkader-photo',
      case_id: 'abdelkader-2024',
      kind: 'photo_victim',
      url: 'TODO_PHOTO_URL', // FBI poster preview JPG (not the PDF)
      mirror_url: null,
      source_url: 'https://www.fbi.gov/wanted/seeking-info/robert-abdelkader-iii',
      caption: 'Robert Abdelkader III, homicide victim, Compton, June 7, 2024',
      is_primary: true,
      display_warning: null,
      source_attribution: 'FBI',
      is_reconstruction: false,
      source_id: null,
    },
  ],

  // 5. Carlos Alvarez-Diaz — LASD homicide bulletin, family snapshot.
  //    LASD images at lasd.org/wp-content/uploads/YYYY/MM/<file>.jpg are
  //    stable WordPress uploads — hot-link OK.
  //    NOTE: source_url points to the homicide-bureau category page; the
  //    specific May 17, 2023 bulletin slug couldn't be confirmed without a
  //    successful fetch. Easiest fix: open the category page, scroll to the
  //    May 17, 2023 entry, paste that bulletin's URL here.
  'alvarez-diaz-2022': [
    {
      id: 'media-alvarez-diaz-photo',
      case_id: 'alvarez-diaz-2022',
      kind: 'photo_victim',
      url: 'TODO_PHOTO_URL', // wp-content/uploads/2023/05/<file>.jpg
      mirror_url: null,
      source_url: 'https://lasd.org/category/homicide-bureau/',
      caption: 'Carlos Alvarez-Diaz, killed in Hawaiian Gardens, October 8, 2022',
      is_primary: true,
      display_warning: null,
      source_attribution: 'LASD',
      is_reconstruction: false,
      source_id: null,
    },
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
