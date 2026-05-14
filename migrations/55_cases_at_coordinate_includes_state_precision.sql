-- Migration 55 — cases_at_coordinate includes state-precision rows.
--
-- Follow-up to mig 54. Mig 54 dropped the state-precision filter from
-- cases_centroids_in_bbox so the centroid badge layer can surface
-- per-state aggregates ("TX · 1,340"). The companion tap-drill RPC
-- (cases_at_coordinate, mig 38) still excludes state-precision rows
-- — so tapping a state badge fetches zero cases.
--
-- Mig 55 drops that same filter from cases_at_coordinate. State-
-- precision tap-drills now return the right pile. City-precision tap-
-- drills are unchanged (those rows always passed the filter).
--
-- CREATE OR REPLACE works in place — return shape (14 cols) unchanged.

create or replace function cases_at_coordinate(
  query_lat double precision,
  query_lng double precision,
  filter_kinds case_kind[] default null,
  filter_status case_status[] default array['open']::case_status[],
  result_limit integer default 100
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
  incident_date_quality date_quality,
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
    st_y(c.location_point::geometry) as lat,
    st_x(c.location_point::geometry) as lng,
    c.victim_name,
    c.has_photo,
    c.incident_date,
    c.incident_date_quality,
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
  where c.deleted_at is null
    and c.location_point is not null
    -- Mig 55: REMOVED `and c.location_precision is distinct from 'state'`.
    -- State-precision rows now flow through the tap-drill so the
    -- post-mig-54 state-precision centroid badges have a working
    -- "see the cases" path.
    and st_y(c.location_point::geometry) = query_lat
    and st_x(c.location_point::geometry) = query_lng
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
  order by c.last_changed_at desc nulls last, c.id
  limit result_limit;
$$;
