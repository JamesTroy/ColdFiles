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
 * Result row from cases_in_bbox() — the only map-tier RPC after Tier 4
 * cleanup retires cases_within_radius and use-cases-near.ts. Schema source:
 * migrations/22_cases_in_bbox_order_by_last_changed.sql + migration 29
 * (expansion to include incident_date/location_city/location_state for the
 * bottom-sheet subtitle).
 *
 * Strict subset of CaseRowMapNear so SAMPLE_CASES_MAP entries flow into
 * either consumer via structural typing during the transition.
 */
export interface CaseRowMapBbox {
  id: string;
  slug: string;
  kind: CaseKind;
  status: CaseStatus;
  victim_name: string | null;
  has_photo: boolean;
  /** Incident date (ISO yyyy-mm-dd). Drives kindLine's year segment. */
  incident_date: string | null;
  /**
   * Quality of `incident_date`. Migration 36 added this to the
   * cases_in_bbox + cases_near_case RPCs so the case-detail adjacency
   * section can bucket by date precision (year_only dates land at
   * YYYY-01-01 by parseDate convention; treating them as point-dates
   * produces asymmetric matching against subjects elsewhere in the
   * year). Optional on the type because rows from older RPCs that
   * don't return it still typecheck — PostgREST omits unset fields.
   */
  incident_date_quality?: DateQuality | null;
  /** City name. Drives kindLine's place segment. */
  location_city: string | null;
  /** 2-letter US state code. Drives kindLine's place segment. */
  location_state: string | null;
  /** WGS84 latitude. */
  lat: number | null;
  /** WGS84 longitude. */
  lng: number | null;
  /**
   * Server-computed alpha for the recently-updated ring.
   *   0–3 days  → 1.0
   *   4–10 days → 0.5
   *   11+ days  → 0
   */
  recency_alpha: number | null;
  /**
   * Distance from a query origin point in miles. Set by cases_near_case
   * (migration 34) only; null/undefined on rows from cases_in_bbox /
   * cases_in_polygon (no query origin to measure from). Drives the
   * "Same period: / Other nearby:" bucket-render on the case-detail
   * "Within N Miles" section. PostgREST omits the field on the wire
   * for 29/33 calls; JS reads undefined for those.
   */
  distance_miles?: number | null;
}

/**
 * Result row from cases_centroids_in_bbox() — aggregated centroid markers
 * for coordinate pile-ups (>20 cases sharing the same lat/lng), the
 * complement to cases_in_bbox. Schema source: migrations/33_cases_
 * centroids_in_bbox.sql.
 *
 * The renderer pairs both RPCs: cases_in_bbox draws individual pins for
 * unique-or-low-density coordinates, cases_centroids_in_bbox draws a
 * centroid badge (translucent disc, count, tinted by kind mix) at every
 * coordinate where ≥21 cases share a point. Together they cover the
 * entire renderable corpus without lying about precision — individual
 * pins are real points, badges acknowledge "many cases logged here at
 * city-level only."
 *
 * Per-kind counts drive the badge tint: homicide-heavy → warm brown,
 * doe-heavy → cream, mixed → neutral amber. Total = case_count =
 * kinds_homicide + kinds_missing + kinds_doe (modulo any kinds outside
 * those three buckets, which are counted in case_count but not broken
 * out — currently no such kinds exist, future-proofing only).
 */
export interface CaseCentroidRow {
  /** WGS84 latitude of the shared centroid. */
  lat: number;
  /** WGS84 longitude of the shared centroid. */
  lng: number;
  /** Total cases at this coordinate (above threshold). */
  case_count: number;
  /** Subset of case_count where kind in ('homicide','suspicious_death'). */
  kinds_homicide: number;
  /** Subset of case_count where kind = 'missing'. */
  kinds_missing: number;
  /** Subset of case_count where kind in ('unidentified','unclaimed'). */
  kinds_doe: number;
}

/**
 * Result row from cases_within_radius() — the legacy radius-based query
 * surface. Tier 4 cleanup will retire this along with use-cases-near.ts;
 * after that, CaseRowMapBbox is the only map-tier row type.
 *
 * Currently still consumed by the list/saved/zone/search direct-table-read
 * paths, which fill in null for the lat/lng/distance_miles fields. Those
 * call sites should migrate to a narrower direct-read type as part of the
 * same Tier 4 sweep.
 *
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
  /** Known aliases / nicknames, free-form. Null or empty when none. */
  victim_aliases: string[] | null;
  victim_age: number | null;
  victim_age_min: number | null;
  victim_age_max: number | null;
  victim_sex: 'male' | 'female' | 'unknown' | 'other' | null;
  victim_race: string | null;
  victim_ethnicity: string | null;
  victim_height_cm: number | null;
  victim_weight_kg: number | null;
  victim_eye_color: string | null;
  victim_hair_color: string | null;
  /** Scars, tattoos, surgical marks, piercings, etc. Free-form. */
  distinguishing_marks: string | null;
  incident_date: string | null;
  incident_date_quality: DateQuality;
  incident_date_text: string | null;
  location_text: string | null;
  location_city: string | null;
  location_state: string | null;
  /** Generated columns from migration 08. Null when no geocode succeeded. */
  location_lat: number | null;
  location_lng: number | null;
  /** Missing-person specifics. All null for non-missing kinds. */
  last_seen_text: string | null;
  last_seen_date: string | null;
  last_seen_clothing: string | null;
  last_seen_circumstances: string | null;
  narrative: string | null;
  narrative_short: string | null;
  case_number_primary: string | null;
  reward_text: string | null;
  reward_amount_usd: number | null;
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
  /**
   * Photo URL the client renders. By construction, this is always the
   * Supabase Storage public URL — the ingest pipeline downloads bytes
   * BEFORE inserting the row (supabase/functions/_shared/media.ts), so
   * the no-hot-link guarantee for Charley/Doe is structurally enforced
   * upstream. There is no separate `mirror_url` column — `url` IS the
   * mirror.
   */
  url: string;
  /** Original source CDN URL — kept for re-fetch and provenance. Never rendered. */
  source_url: string | null;
  caption: string | null;
  is_primary: boolean;
  display_warning: 'graphic' | 'sensitive' | null;
  source_id: string | null;
}

/**
 * True when the imagery is artist-rendered (forensic reconstruction, sketch,
 * age progression). Used by PhotoFrame to render the FORENSIC RECONSTRUCTION
 * pill so users tapping a Doe pin don't mistake the rendering for a real
 * photo. Derived from kind rather than stored as a column — the kind taxonomy
 * already encodes this distinction.
 */
/**
 * Row shape for case_events (migration 35) — the per-case Timeline
 * Reconstruction. Closed taxonomy of public-record event kinds; every
 * row carries a verified source URL + verbatim quote (NOT NULL,
 * schema-enforced anti-inference).
 *
 * Joins on `source` so the section can render the source name in
 * the per-event meta line without a follow-up fetch.
 */
export type CaseEventKind =
  | 'incident'
  | 'last_seen'
  | 'remains_found'
  | 'case_spotlight_published'
  | 'status_resolved_arrest'
  | 'status_resolved_other'
  | 'status_identified';

export interface CaseEventRow {
  id: string;
  case_id: string;
  event_kind: CaseEventKind;
  headline: string;
  body: string | null;
  event_at: string | null;
  event_date: string | null;
  event_date_end: string | null;
  event_date_quality: DateQuality;
  event_date_text: string | null;
  source_url: string;
  source_quote: string;
  source_id: string | null;
  /** Joined source row when present. */
  source: SourceRow | null;
}

export function isMediaReconstruction(media: Pick<CaseMediaRow, 'kind'> | null | undefined): boolean {
  if (!media) return false;
  return (
    media.kind === 'reconstruction' ||
    media.kind === 'sketch_victim' ||
    media.kind === 'sketch_poi' ||
    media.kind === 'age_progression'
  );
}

export type TipRouteKind =
  | 'crime_stoppers_p3'
  | 'agency_form'
  | 'agency_phone'
  | 'fbi_tip'
  | 'namus_form'
  | 'email';
