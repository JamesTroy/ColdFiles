-- Migration 35 — pin-system rebuild: collapse coincidence threshold to 1
-- and surface a locale label on aggregate rows.
--
-- Reframes the bbox RPC contract:
--
--   - cases_in_bbox returns ONLY solo points (one case at the coord).
--   - cases_centroids_in_bbox returns EVERY coincident coord (>= 2 cases),
--     with case count, kind breakdown, precision_floor, and a server-
--     built "City, ST" locale label so the badge can show context.
--
-- Throws out the >20 dense_threshold inherited from migration 16. The
-- threshold-20 era assumed the renderer would handle 2-20 share clusters
-- via client-side jitter; that path layered fix-on-fix and produced
-- "rings of pins floating in suburbs" at every editorial review. The
-- rebuild's editorial rule is simpler: any coincident coord is an
-- aggregation, period. No client-side spatial logic.
--
-- Why coincidence-only (not precision-aware on the server):
--   We considered "individual pins for all-address-precision shared
--   coords, aggregate for coarser." Two address-precision cases at
--   the same address still produce coincident coord — to render as
--   distinct pins requires client-side spiderfy or jitter, which is
--   exactly the layered hack the rebuild is replacing. Cost of the
--   simpler "shared coord = aggregate" rule is ~rare address-shared
--   pairs becoming a "2" badge instead of a stack; the badge tap-drill
--   side-list (follow-up PR) surfaces the per-case detail honestly.
--
-- Two changes:
--
--   1. cases_in_bbox: dense_points threshold 20 -> 1. Body otherwise
--      unchanged from migration 34. Signature unchanged.
--
--   2. cases_centroids_in_bbox: default threshold 20 -> 1. Adds
--      locale_label text to RETURNS TABLE — a "City, ST" label
--      derived from the cases at the centroid:
--        - All cases share city + state -> "City, ST"
--        - All cases share state but city varies -> "ST"
--        - Else -> NULL (renderer falls back to count-only label)
--      RETURNS TABLE change forces DROP+CREATE per migration 29's
--      pattern.
--
-- Both functions ship via DROP-then-CREATE.

-- 1. cases_in_bbox — dense_points threshold to 1.
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
  location_precision text,
  recency_alpha numeric
)
language sql
stable
as $$
  with dense_points as (
    -- Threshold 1: any coincident coord is moved to the centroid
    -- aggregate path. Result: cases_in_bbox only returns solo cases.
    select location_point
    from cases
    where deleted_at is null
      and location_point is not null
    group by location_point
    having count(*) > 1
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

-- 2. cases_centroids_in_bbox — default threshold to 1, add locale_label.
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
  threshold integer default 1,
  result_limit integer default 500
)
returns table (
  lat double precision,
  lng double precision,
  case_count integer,
  kinds_homicide integer,
  kinds_missing integer,
  kinds_doe integer,
  precision_floor text,
  -- ↓ new column added by migration 35. Server-built "City, ST" label
  --   for the badge. NULL when the cases at the centroid don't share
  --   a single city/state — renderer falls back to count-only label.
  locale_label text
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
    -- Coarsest precision in the group. NULL inputs map to rank 1
    -- ('unknown') in the inner CASE so a row missing precision can't
    -- poison the aggregate. Outer CASE always returns non-null text.
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
    end as precision_floor,
    -- "City, ST" label, NULL if the group's cases don't share a
    -- single city or state. Most coincident-coord groups are city-
    -- centroid pile-ups so this resolves to the centroid's label
    -- (e.g., "Belen, NM"). Mixed-locale groups (rare — could happen
    -- at a county centroid that geographic-spans multiple cities)
    -- fall back to NULL.
    case
      when count(distinct c.location_city) = 1
       and count(distinct c.location_state) = 1
       and max(c.location_city) is not null
       and max(c.location_state) is not null
        then max(c.location_city) || ', ' || max(c.location_state)
      when count(distinct c.location_state) = 1
       and max(c.location_state) is not null
        then max(c.location_state)
      else null
    end as locale_label
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
