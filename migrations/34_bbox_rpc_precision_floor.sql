-- Migration 34 — expose precision on the bbox read path.
--
-- Background:
--   Migration 31 formalized cases.location_precision; migration 33 added
--   cases_centroids_in_bbox + state-precision exclusion. Both used
--   precision as a WHERE-clause filter only — never returned it. The
--   centroid-badge renderer branches on per-case precision (route a
--   shared-coord cluster to ring-jitter when ALL members are address
--   precision, otherwise route to the centroid badge), so it needs the
--   field on the row. This migration adds it.
--
--   Two changes:
--
--   1. cases_in_bbox: add location_precision text to RETURNS TABLE and
--      to the SELECT list. Lets the renderer's worst-precision-wins
--      logic operate on per-case precision when grouping coincident
--      pins.
--
--   2. cases_centroids_in_bbox: add precision_floor text to RETURNS
--      TABLE — the COARSEST precision among the cases at a centroid.
--      "Floor" not "max" because the editorial intent is honest-
--      labeling: a cluster of 11 address + 1 city pins reads as
--      "city-level" (the floor), not "address-level" (the majority).
--      Mislabeling would be the same lie ring-jitter was making, just
--      at a different layer.
--
-- Why not also a precision_breakdown jsonb column (count per precision):
--   The badge's primary job is to stop lying about spatial precision.
--   precision_floor alone accomplishes that — once the floor routes
--   the group to a badge, per-case precision detail belongs in the
--   tap-drill side-list panel (PR 3), not in the centroid row payload.
--   JSONB aggregation adds migration friction with no immediate UX
--   payoff. Revisit if real usage surfaces a gap.
--
-- Nullability:
--   precision_floor is declared nullable in RETURNS TABLE — defensive,
--   even though the inner CASE expression below always emits one of
--   the 5 values (NULL precision in the input maps to rank 1 = the
--   'unknown' bucket). Renderer normalizes NULL → 'unknown' so the
--   lie-direction is consistent: when in doubt, treat as imprecise
--   and badge rather than jitter.
--
--   location_precision on cases_in_bbox is also nullable — matches the
--   underlying column's nullability. In the live corpus per the
--   migration-31 audit (point_without_precision = 0), every row with
--   a non-null point has a non-null precision, so the renderer should
--   rarely if ever see NULL. The nullable type is forward-compat for
--   future code paths that might insert a point without precision.
--
-- Both functions ship via DROP-then-CREATE, not CREATE OR REPLACE:
--   PostgreSQL rejects in-place replacement when RETURNS TABLE changes
--   (error 42P13). Same pattern migration 29 used. The DROPs are
--   qualified by full argument signature so they only target the
--   exact overload, safe to re-run.

-- 1. cases_in_bbox — add location_precision to the RETURNS TABLE shape.
drop function if exists public.cases_in_bbox(
  double precision, double precision, double precision, double precision,
  case_kind[], case_status[], integer
);

create function cases_in_bbox(
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
  -- ↓ new column added by migration 34 to power the centroid-badge
  --   renderer's worst-precision-wins clustering branch.
  location_precision text,
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

-- 2. cases_centroids_in_bbox — add precision_floor to the RETURNS TABLE
--    shape. precision_floor = the COARSEST precision in the group, so
--    the badge label can read truthfully even when the cluster mixes
--    precisions (one city + eleven address = "city-level").
drop function if exists public.cases_centroids_in_bbox(
  double precision, double precision, double precision, double precision,
  case_kind[], case_status[], integer, integer
);

create function cases_centroids_in_bbox(
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
  kinds_doe integer,
  -- ↓ new column added by migration 34 — coarsest precision in the
  --   group. address > street > city > county > unknown ordering;
  --   NULL precision inputs collapse to 'unknown' in the rank lookup
  --   so a row missing precision can't poison the aggregate.
  --   ('state' is excluded by the WHERE clause and never reaches the
  --   aggregation, so it's intentionally absent from the rank map.)
  precision_floor text
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
    count(*) filter (where c.kind in ('unidentified', 'unclaimed'))::integer as kinds_doe,
    -- COARSEST = MIN over rank values (address=5, ..., unknown=1).
    -- NULL inputs hit the ELSE arm and map to rank 1 (unknown), so
    -- MIN never sees NULL and the outer CASE always returns a non-
    -- null text. The column is still nullable in the RETURNS TABLE
    -- as defensive forward-compat for future SQL changes.
    case
      min(
        case c.location_precision
          when 'address' then 5
          when 'street'  then 4
          when 'city'    then 3
          when 'county'  then 2
          else 1
        end
      )
      when 5 then 'address'
      when 4 then 'street'
      when 3 then 'city'
      when 2 then 'county'
      else 'unknown'
    end as precision_floor
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
