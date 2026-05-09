-- Migration 33 — centroid-aware map rendering: split dense pile-ups into
-- a separate aggregated RPC, exclude state-precision from the map entirely.
--
-- Background:
--   The cases_in_bbox RPC (migrations 16, 22, 29) excludes any
--   location_point shared by >20 cases — a "dense_points" filter
--   originally added to drop default-centroid pile-ups (CDCR Sacramento,
--   "Los Angeles" defaults) from showing as visually-misleading single
--   pins. As the corpus grew (~7,500 cases by 2026-05-09), city-precision
--   rows (5,665 of them, geocoded to city centroids per the migration 31
--   audit) now overwhelmingly land in dense_points groups and get dropped.
--   The map shows ~1,000 pins nationwide while the corpus has ~6,500
--   cases with location_point. Editorially correct (no fake-precision
--   pins), but UX-unhelpful: most of the corpus is invisible on the
--   primary surface.
--
--   Migration 31 formalized location_precision specifically so the
--   renderer could branch on precision tier. This migration completes
--   the data layer:
--
--   1. New RPC cases_centroids_in_bbox returns the aggregated centroids
--      that cases_in_bbox excludes — same threshold (>20), with case
--      count and kind breakdown for tinting. The mobile renderer pairs
--      this with cases_in_bbox to draw individual pins for low-density
--      coordinates and centroid badges for pile-ups.
--
--   2. cases_in_bbox now excludes location_precision = 'state'. The 35
--      state-precision rows (per scripts/sql/diagnostic_geocoding_
--      provenance.sql audit) carry no meaningful point — they're
--      visible only via list views going forward. cases_centroids_in_
--      bbox applies the same exclusion so a state-centroid pile-up
--      doesn't render either.
--
-- Why IS DISTINCT FROM 'state' (not <> 'state'):
--   For the post-migration-31 corpus, every row with non-null
--   location_point has a non-null location_precision (point_without_
--   precision = 0 in the audit). But IS DISTINCT FROM is NULL-safe in
--   case a future code path inserts a point without setting precision —
--   `<> 'state'` would silently drop those rows, IS DISTINCT FROM keeps
--   them. Cheap defensive choice.
--
-- Idempotent via CREATE OR REPLACE (signatures unchanged for both).

-- 1. cases_centroids_in_bbox — new aggregated centroid RPC.
--    Mirror-shape of cases_in_bbox for inputs (bbox + filter_kinds +
--    filter_status), with a `threshold` parameter so the renderer can
--    request a different cutoff if needed (e.g., for a debug overlay).
--    Default 20 matches the dense_points threshold in cases_in_bbox.
create or replace function cases_centroids_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  filter_kinds case_kind[] default null,
  filter_status case_status[] default array['open']::case_status[],
  threshold integer default 20,
  result_limit integer default 500
)
returns table (
  lat double precision,
  lng double precision,
  case_count integer,
  kinds_homicide integer,
  kinds_missing integer,
  kinds_doe integer
)
language sql
stable
as $$
  select
    st_y(c.location_point::geometry) as lat,
    st_x(c.location_point::geometry) as lng,
    count(*)::integer as case_count,
    count(*) filter (where c.kind in ('homicide', 'suspicious_death'))::integer as kinds_homicide,
    count(*) filter (where c.kind = 'missing')::integer as kinds_missing,
    count(*) filter (where c.kind in ('unidentified', 'unclaimed'))::integer as kinds_doe
  from cases c
  where c.deleted_at is null
    and c.location_point is not null
    and c.location_precision is distinct from 'state'
    and ST_Intersects(
      c.location_point,
      ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    )
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
  group by c.location_point
  having count(*) > threshold
  order by count(*) desc
  limit result_limit;
$$;

-- 2. cases_in_bbox — add state-precision exclusion.
--    Signature unchanged from migration 29 (same args, same RETURNS
--    TABLE), so CREATE OR REPLACE works in-place. Body is migration 29's
--    body with one additional WHERE clause: c.location_precision IS
--    DISTINCT FROM 'state'. The dense_points CTE itself is unchanged —
--    state-precision rows that pile up at a state centroid would land
--    in dense_points anyway, but the explicit clause documents the
--    "state stays off-map" rule directly in the visible part of the
--    query rather than as an emergent property of the >20 threshold.
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
  incident_date date,
  location_city text,
  location_state text,
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
    c.incident_date,
    c.location_city,
    c.location_state,
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
    and c.location_precision is distinct from 'state'
    and ST_Intersects(
      c.location_point,
      ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    )
    and c.location_point not in (select location_point from dense_points)
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
  order by c.last_changed_at desc nulls last, c.id
  limit result_limit;
$$;
