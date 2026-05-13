-- Migration 50 — cases_in_bbox reads location_point_displayed.
--
-- The bug:
--   At mid-zoom the home map renders individual pins via cases_in_bbox.
--   The RPC selected st_y/st_x(c.location_point) — the RAW point. For
--   city-precision rows the raw point is the city geographic centroid
--   (single coord per city). Every city-precision case in a metro
--   collapsed onto that one coord; the pin layer drew them stacked
--   pixel-on-pixel. LA was the loudest worked example — 200+ city-
--   precision cases all sitting on (34.05, -118.24) waiting to be
--   tapped, but indistinguishable on the canvas.
--
-- Why now:
--   location_point_displayed is a generated column (cases.* schema +
--   mig 43) that wraps cases_displayed_point(location_point,
--   location_precision, slug). It applies deterministic FNV-1a jitter
--   on the slug → angle (full 2π) + radius (0.02–0.045°, ~2.2–5.0km
--   mid-lat) for coarse precision tiers. For 'address' and 'street'
--   precision the displayed point IS the raw point (no jitter on real
--   addresses). So switching the read RPC to read the displayed
--   column gives the fanned-out coords the grid RPC (mig 44) already
--   uses — without surprising callers who pin to real street
--   addresses.
--
--   The cluster RPC (cases_grid_in_bbox, mig 44) already projects from
--   location_point_displayed; only the per-pin RPC was lagging. This
--   migration brings the two read paths to the same column.
--
-- The change:
--   • SELECT  st_y/st_x(c.location_point::geometry)
--          →  st_y/st_x(c.location_point_displayed::geometry)
--   • WHERE  c.location_point is not null
--          →  c.location_point_displayed is not null
--   • ST_Intersects on the displayed point.
--
-- Why filter on the same column we project from:
--   Mixing location_point in the WHERE and location_point_displayed
--   in the SELECT would cull cases whose jitter pushes them out of
--   the bbox while keeping cases whose jitter pulls them in — one
--   zoom level later, the same case can disappear/reappear depending
--   on where the viewport edge lands. Consistency on the column,
--   inside-or-out, is the only stable shape.
--
-- Preserved from mig 42:
--   • ORDER BY c.id (UUIDv4-uniform; defends against the state-skew
--     amplifier under bursty single-source rescrapes — see mig 42
--     header for the worked example).
--   • c.location_precision is distinct from 'state' filter (the
--     state-centroid exclusion from mig 33+).
--   • Same RETURNS TABLE shape — CREATE OR REPLACE is safe (no
--     42P13).
--
-- Verification (run in the SQL editor after apply):
--   Expect 10 distinct lat/lng pairs, all within ~5km of LA city
--   centroid (34.05, -118.24):
--
--     select slug, lat, lng
--     from public.cases_in_bbox(-118.30, 33.95, -118.15, 34.15)
--     where location_city = 'Los Angeles'
--     limit 10;
--
--   Before mig 50, every row returned (34.048, -118.254). After,
--   all 10 should be different — except rows whose precision is
--   'address' or 'street' (those intentionally don't jitter).

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
  location_precision text,
  recency_alpha numeric
)
language sql
stable
as $$
  select
    c.id,
    c.slug,
    c.kind,
    c.status,
    -- mig 50: was st_y/st_x(c.location_point) — raw point, stacked
    -- every city-precision case on the city centroid. The displayed
    -- column applies deterministic jitter for coarse precision tiers
    -- (and passes address/street through unchanged).
    st_y(c.location_point_displayed::geometry) as lat,
    st_x(c.location_point_displayed::geometry) as lng,
    c.victim_name,
    c.has_photo,
    c.incident_date,
    c.location_city,
    c.location_state,
    c.location_precision,
    case
      when c.last_changed_at is null then 0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 3 then 1.0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 10 then 0.5
      else 0
    end::numeric as recency_alpha
  from cases c
  where
    c.deleted_at is null
    -- mig 50: filter on the same column we project from. Mixing
    -- location_point in WHERE and location_point_displayed in SELECT
    -- would make bbox-edge cases blink in and out across zoom levels
    -- depending on jitter direction.
    and c.location_point_displayed is not null
    and c.location_precision is distinct from 'state'
    and ST_Intersects(
      c.location_point_displayed,
      ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    )
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
  order by c.id
  limit result_limit;
$$;
