/**
 * Database row shapes the mobile app reads.
 *
 * Hand-written subset of the schema in migrations/01_schema.sql — only the
 * fields the mobile screens actually consume. As new fields surface in the UI,
 * extend the relevant interface here.
 *
 * If this file drifts from the schema, re-generate via `supabase gen types
 * typescript --project-id <id>` and copy the relevant slices over. For now the
 * surface is small enough that hand-writing is cheaper than the codegen
 * dependency.
 */

export type CaseKind =
  | 'homicide'
  | 'missing'
  | 'unidentified'
  | 'unclaimed'
  | 'suspicious_death';

export type CaseStatus =
  | 'open'
  | 'cleared_arrest'
  | 'cleared_other'
  | 'identified'
  | 'located'
  | 'withdrawn';

export type DateQuality =
  | 'exact'
  | 'approximate'
  | 'year_only'
  | 'suspect'
  | 'unknown';

/**
 * Result row from cases_within_radius() and cases_in_bbox() RPCs.
 * Schema source: migrations/01_schema.sql + migrations/02_cases_in_bbox_recency_alpha.sql.
 */
export interface CaseRowMapNear {
  id: string;
  slug: string;
  kind: CaseKind;
  status: CaseStatus;
  victim_name: string | null;
  victim_age: number | null;
  incident_date: string | null;
  location_text: string | null;
  location_city: string | null;
  location_state: string | null;
  narrative_short: string | null;
  has_photo: boolean;
  primary_agency_name: string | null;
  primary_photo_url: string | null;
  distance_miles: number | null;
  /**
   * Server-computed alpha for the recently-updated ring.
   *   0–3 days since last_changed_at  → 1.0
   *   4–10 days                       → 0.5
   *   11+ days                        → 0   (client renders no ring)
   * Always non-null on rows from the RPCs; null is reserved for sources that
   * don't carry it (table reads on the List tab, etc.).
   */
  recency_alpha: number | null;
  /** WGS84 latitude. Returned by cases_within_radius + cases_in_bbox; null on table reads. */
  lat: number | null;
  /** WGS84 longitude. Returned by cases_within_radius + cases_in_bbox; null on table reads. */
  lng: number | null;
}

/** Fuller case row used by the case-detail screen. */
export interface CaseRowFull {
  id: string;
  slug: string;
  kind: CaseKind;
  status: CaseStatus;
  victim_name: string | null;
  victim_age: number | null;
  victim_age_min: number | null;
  victim_age_max: number | null;
  victim_sex: 'male' | 'female' | 'unknown' | 'other' | null;
  victim_race: string | null;
  incident_date: string | null;
  incident_date_quality: DateQuality;
  incident_date_text: string | null;
  location_text: string | null;
  location_city: string | null;
  location_state: string | null;
  narrative: string | null;
  narrative_short: string | null;
  case_number_primary: string | null;
  reward_text: string | null;
  has_photo: boolean;
  has_sketch: boolean;
  is_featured: boolean;
  last_changed_at: string;
  primary_agency_id: string | null;
  /** Joined agency fields when present. */
  primary_agency: AgencyRow | null;
}

export interface AgencyRow {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  agency_type: string;
  state: string | null;
  county: string | null;
  city: string | null;
  phone_tip: string | null;
  tip_url: string | null;
  tip_route_kind: TipRouteKind | null;
  cold_case_url: string | null;
}

export interface CaseSourceRow {
  id: string;
  case_id: string;
  source_id: string;
  source_external_id: string;
  source_url: string;
  trust_weight: number;
  last_ingested_at: string;
  /** Joined source fields when present. */
  source: SourceRow | null;
}

export interface SourceRow {
  id: string;
  slug: string;
  name: string;
  kind: 'federal' | 'state' | 'agency' | 'aggregator' | 'nonprofit' | 'media';
  base_url: string;
  attribution_html: string;
}

export interface CaseMediaRow {
  id: string;
  case_id: string;
  kind:
    | 'photo_victim'
    | 'sketch_victim'
    | 'reconstruction'
    | 'age_progression'
    | 'photo_clothing'
    | 'photo_jewelry'
    | 'photo_evidence'
    | 'photo_location'
    | 'sketch_poi'
    | 'document';
  url: string;
  source_url: string | null;
  caption: string | null;
  is_primary: boolean;
  display_warning: 'graphic' | 'sensitive' | null;
  source_id: string | null;
}

export type TipRouteKind =
  | 'crime_stoppers_p3'
  | 'agency_form'
  | 'agency_phone'
  | 'fbi_tip'
  | 'namus_form'
  | 'email';
