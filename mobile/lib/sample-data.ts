/**
 * Sample fallback data for when EXPO_PUBLIC_SUPABASE_URL is unset.
 *
 * Lets designers iterate on UI without needing a backend wired up. Every hook
 * checks isSupabaseConfigured() and returns this data shape immediately when
 * the env vars are missing. When the env vars ARE set, the hooks run real
 * queries against the cases_within_radius / cases_in_bbox RPCs and slug-keyed
 * selects from the `cases` table.
 */

import type {
  AgencyRow,
  CaseRowFull,
  CaseRowMapNear,
  CaseSourceRow,
} from './types/database';

const SAMPLE_AGENCY_LASD: AgencyRow = {
  id: 'sample-agency-lasd',
  slug: 'lasd',
  name: 'Los Angeles County Sheriff\'s Department',
  short_name: 'LASD',
  agency_type: 'county_sheriff',
  state: 'CA',
  county: 'Los Angeles',
  city: null,
  phone_tip: null,
  tip_url: null,
  tip_route_kind: null,
  cold_case_url: null,
};

export const SAMPLE_CASES_MAP: CaseRowMapNear[] = [
  {
    id: 'evans-1985',
    slug: 'evans-1985',
    kind: 'homicide',
    status: 'open',
    victim_name: 'David R. Evans',
    victim_age: 57,
    incident_date: '1985-10-13',
    location_text: 'Claremont, CA',
    location_city: 'Claremont',
    location_state: 'CA',
    narrative_short:
      'Mr. Evans was found beaten to death inside his Claremont residence.',
    has_photo: false,
    primary_agency_name: 'LASD Homicide Bureau',
    primary_photo_url: null,
    distance_miles: 1.4,
  },
  {
    id: 'aarlie-2011',
    slug: 'aarlie-2011',
    kind: 'missing',
    status: 'open',
    victim_name: 'John Andrew Aarlie',
    victim_age: 52,
    incident_date: '2011-07-16',
    location_text: 'Yakima, WA',
    location_city: 'Yakima',
    location_state: 'WA',
    narrative_short: 'Last heard from on July 16, 2011 by his sister.',
    has_photo: true,
    primary_agency_name: 'Quincy Police Department',
    primary_photo_url: null,
    distance_miles: 1042.7,
  },
  {
    id: 'doe-1985',
    slug: 'doe-1985',
    kind: 'unidentified',
    status: 'open',
    victim_name: null,
    victim_age: null,
    incident_date: '1985-04-04',
    location_text: 'Los Angeles, CA',
    location_city: 'Los Angeles',
    location_state: 'CA',
    narrative_short: null,
    has_photo: false,
    primary_agency_name: 'LASD Homicide Bureau',
    primary_photo_url: null,
    distance_miles: 18.2,
  },
  {
    id: 'talmon-1974',
    slug: 'talmon-1974',
    kind: 'missing',
    status: 'open',
    victim_name: 'Duane Robert Talmon',
    victim_age: 16,
    incident_date: '1974-10-30',
    location_text: 'Buffalo, NY',
    location_city: 'Buffalo',
    location_state: 'NY',
    narrative_short:
      'Last seen leaving Williamsville North High School on October 30, 1974.',
    has_photo: true,
    primary_agency_name: 'Quincy Police Department',
    primary_photo_url: null,
    distance_miles: 2451.0,
  },
];

export const SAMPLE_CASE_FULL_BY_SLUG: Record<string, CaseRowFull> = {
  'evans-1985': {
    id: 'evans-1985',
    slug: 'evans-1985',
    kind: 'homicide',
    status: 'open',
    victim_name: 'David R. Evans',
    victim_age: 57,
    victim_age_min: null,
    victim_age_max: null,
    victim_sex: 'male',
    victim_race: 'White',
    incident_date: '1985-10-13',
    incident_date_quality: 'exact',
    incident_date_text: null,
    location_text: 'Claremont, CA',
    location_city: 'Claremont',
    location_state: 'CA',
    narrative:
      'Mr. Evans was found beaten to death inside his Claremont residence on a Sunday evening. His body was discovered by Claremont Police Officers responding to a possible burglary call from neighbors. At the time, the investigation had…',
    narrative_short:
      'Mr. Evans was found beaten to death inside his Claremont residence.',
    case_number_primary: 'CASE-LASD-1985-0413',
    reward_text: null,
    has_photo: false,
    has_sketch: false,
    is_featured: false,
    last_changed_at: new Date().toISOString(),
    primary_agency_id: SAMPLE_AGENCY_LASD.id,
    primary_agency: SAMPLE_AGENCY_LASD,
  },
};

export const SAMPLE_CASE_SOURCES_BY_CASE_ID: Record<string, CaseSourceRow[]> = {
  'evans-1985': [
    {
      id: 'src-1',
      case_id: 'evans-1985',
      source_id: 'src-lasd',
      source_external_id: 'evans-1985',
      source_url: 'https://lasd.org/cold-cases/evans-1985',
      trust_weight: 95,
      last_ingested_at: new Date().toISOString(),
      source: {
        id: 'src-lasd',
        slug: 'lasd_homicide',
        name: 'LASD Homicide Bureau',
        kind: 'agency',
        base_url: 'https://lasd.org',
        attribution_html: 'Source: <a href="https://lasd.org">LASD</a>',
      },
    },
    {
      id: 'src-2',
      case_id: 'evans-1985',
      source_id: 'src-pcc',
      source_external_id: 'evans-1985',
      source_url: 'https://projectcoldcase.org/cases/evans-1985',
      trust_weight: 50,
      last_ingested_at: new Date().toISOString(),
      source: {
        id: 'src-pcc',
        slug: 'project_cold_case',
        name: 'Project: Cold Case',
        kind: 'nonprofit',
        base_url: 'https://projectcoldcase.org',
        attribution_html:
          'Source: <a href="https://projectcoldcase.org">Project: Cold Case</a>',
      },
    },
  ],
};
