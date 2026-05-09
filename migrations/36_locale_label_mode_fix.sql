-- Migration 36 — fix locale_label aggregation to use MODE() instead of
-- strict unanimity.
--
-- Background:
--   Migration 35 added a server-built "City, ST" locale_label to
--   cases_centroids_in_bbox. The first-pass logic required the cases
--   at a centroid to UNANIMOUSLY agree on city + state:
--
--     count(distinct location_city) = 1 AND count(distinct location_state) = 1
--
--   In practice, cases at the same geocoded centroid often have
--   heterogeneous location_city values — sources report different
--   neighborhood / submunicipality names that all snap to the same
--   city centroid. The LA centroid (34.048, -118.254) for example
--   carries 211 cases with location_city in {'Los Angeles',
--   'Hollywood', 'Studio City', 'Burbank', ...}. Unanimity fails →
--   the city+state branch falls through → state-only branch then
--   NULL → every badge ships without a label.
--
--   Migration 36's fix: replace strict-unanimity with MODE() —
--   pick the most-common (city, state) pair at each centroid. Most
--   coincident-coord groups are city-centroid pile-ups where the
--   modal city is the actual centroid label; outlier names get
--   outvoted. NULL inputs are excluded via FILTER so a few NULL-city
--   cases don't poison the mode.
--
--   Also drops the state-only fallback that migration 35 had. A bare
--   "CA" or "TX" without city context is more noise than signal —
--   the badge already shows count + (kind tint), state-without-city
--   adds no editorial value. NULL is the more honest alternative.
--
-- Why CTE instead of inline aggregation:
--   MODE() WITHIN GROUP needs to be computed over the GROUP BY
--   bucket; using it twice inline (once for city, once for state)
--   would duplicate the aggregation. A `with grouped as (...)` CTE
--   computes each mode once and re-uses both in the SELECT. Cleaner
--   to read, and the planner inlines it anyway for a single-use CTE.
--
-- Idempotent via CREATE OR REPLACE (signature unchanged from
-- migration 35; only the function body changes).

create or replace function cases_centroids_in_bbox(
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
  locale_label text
)
language sql
stable
as $$
  with grouped as (
    select
      c.location_point,
      count(*) as case_count,
      count(*) filter (where c.kind in ('homicide', 'suspicious_death')) as kinds_homicide,
      count(*) filter (where c.kind = 'missing') as kinds_missing,
      count(*) filter (where c.kind in ('unidentified', 'unclaimed')) as kinds_doe,
      -- Coarsest precision in the group. NULL precision maps to rank
      -- 1 ('unknown') in the inner CASE so a row missing precision
      -- can't poison the aggregate.
      min(
        case c.location_precision
          when 'address' then 5
          when 'street'  then 4
          when 'city'    then 3
          when 'county'  then 2
          else 1
        end
      ) as precision_rank,
      -- MODE() picks the most-common value across the group; FILTER
      -- excludes NULLs so a few cases with NULL city don't pollute
      -- the result for groups where most cases have a real city.
      mode() within group (order by c.location_city)
        filter (where c.location_city is not null) as mode_city,
      mode() within group (order by c.location_state)
        filter (where c.location_state is not null) as mode_state
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
  )
  select
    st_y(g.location_point::geometry) as lat,
    st_x(g.location_point::geometry) as lng,
    g.case_count::integer,
    g.kinds_homicide::integer,
    g.kinds_missing::integer,
    g.kinds_doe::integer,
    case g.precision_rank
      when 5 then 'address'
      when 4 then 'street'
      when 3 then 'city'
      when 2 then 'county'
      else 'unknown'
    end as precision_floor,
    -- Render only when both city AND state resolve to a modal value.
    -- A bare state code without city is more noise than signal —
    -- prefer NULL (badge shows count only) over half-information.
    case
      when g.mode_city is not null and g.mode_state is not null
        then g.mode_city || ', ' || g.mode_state
      else null
    end as locale_label
  from grouped g
  order by g.case_count desc
  limit result_limit;
$$;
