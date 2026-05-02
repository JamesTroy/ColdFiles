-- ============================================================================
-- Migration 16 — cases_in_bbox excludes city-centroid stacks from map results
-- ============================================================================
--
-- Background:
--   When a case ingests with only city-level location data ("Los Angeles, CA"
--   with no street), the geocoder resolves to the city centroid. Multiple
--   cases land on the EXACT same lat/lng point. The map's clustering layer
--   then has 50+ markers stacked on one coordinate, and Leaflet's spiderfy
--   fans them out in a visually overwhelming spiral on tap.
--
--   It's also editorially misleading — the user reads "56 cases at LA City
--   Hall" when the truth is "56 cases somewhere in LA County."
--
--   These cases stay in the List tab (cases_within_radius / cases_recent
--   are separate RPCs that don't apply this filter; the list isn't lying
--   about a coordinate). The map filter is the only surface where stack
--   density misleads.
--
-- Threshold:
--   20 cases at a single location_point. Chosen from production data on
--   2026-05-02:
--     34.048, -118.254 (LA City Hall):     56 cases  ← filtered
--     33.749, -117.870 (Santa Ana):         8 cases  ← kept (borderline OK)
--     34.016, -118.495 (Santa Monica):      8 cases  ← kept
--     34.075, -117.750 (Pomona):            8 cases  ← kept
--   Real same-block clusters in dense urban areas (LA's downtown,
--   Manhattan, etc.) rarely exceed 20 cases at one EXACT coordinate
--   because real cases have street-level addresses that geocode to
--   distinct points. Stack-density as a proxy for imprecise-geocoding
--   is the cheapest signal we have without a schema change.
--
--   Self-tunes: if a future ingest brings street-level addresses for the
--   currently-stacked cases, the geocoder distributes them and they
--   re-appear on the map. No backfill required.
--
-- Performance:
--   The dense_points CTE scans the full cases table (one count per
--   location_point group). At ~5000 cases this is fast; at 100k+ we'd
--   want a materialized view with a nightly refresh. Marker for v1.1
--   capacity work — not a v1.0.x concern.
--
-- v1.0.1 follow-up: a `location_imprecise` boolean column on cases set
-- by the geocoder when only city/county granularity resolves. That makes
-- the filter explicit ("don't show imprecise points on the map") instead
-- of inferred from row count. Migration 16 is the row-count proxy for
-- the meantime.
-- ============================================================================

drop function if exists cases_in_bbox(
  double precision, double precision, double precision, double precision,
  case_kind[], case_status[], integer
);

create or replace function cases_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  filter_kinds case_kind[] default null,
  filter_status case_status[] default array['open']::case_status[],
  result_limit integer default 500
)
returns table (
  id uuid,
  slug text,
  kind case_kind,
  status case_status,
  lat double precision,
  lng double precision,
  victim_name text,
  has_photo boolean,
  recency_alpha numeric
)
language sql
stable
as $$
  with dense_points as (
    select location_point
    from cases
    where deleted_at is null
      and location_point is not null
    group by location_point
    having count(*) > 20
  )
  select
    c.id,
    c.slug,
    c.kind,
    c.status,
    st_y(c.location_point::geometry) as lat,
    st_x(c.location_point::geometry) as lng,
    c.victim_name,
    c.has_photo,
    case
      when c.last_changed_at is null then 0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 3 then 1.0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 10 then 0.5
      else 0
    end::numeric as recency_alpha
  from cases c
  where
    c.deleted_at is null
    and c.location_point is not null
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
    and c.location_point && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    and not exists (
      select 1 from dense_points dp
      where dp.location_point = c.location_point
    )
  limit result_limit;
$$;
