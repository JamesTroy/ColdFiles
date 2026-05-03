-- Migration 22 — deterministic ordering for cases_in_bbox.
--
-- Migration 16's cases_in_bbox had no ORDER BY clause. When the result
-- exceeds result_limit, Postgres returns whatever the planner returned
-- first — typically physical heap order, which is roughly insertion
-- order. That's both unspecified and unstable: the same bbox query can
-- return a different 100 cases between calls, and the visible viewport
-- isn't guaranteed to be in the result at all.
--
-- User-visible symptom: cases that were just on the map disappear when
-- the user pans or zooms out, even though they're still inside the
-- queried bbox. Replaced by other rows from outside the visible
-- viewport.
--
-- Fix: ORDER BY c.last_changed_at DESC NULLS LAST. The most-recently-
-- updated cases sort first, which is also the most useful default
-- selection — what the user wants to see when there are too many cases
-- to fit. Stable across calls (last_changed_at is monotonic + tied to
-- ingest pipeline).
--
-- Idempotent: drops and recreates the function with the same signature.

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
  order by c.last_changed_at desc nulls last, c.id
  limit result_limit;
$$;
