-- Migration 54 — cases_centroids_in_bbox includes state-precision aggregates.
--
-- Part of the centroid badge layer revival (see
-- docs/research/centroid-badge-revival-plan.md). Server side preps
-- the data; client work lands in a follow-up PR with its own OTA.
--
-- WHY:
--
--   The architectural rule (operator decision 2026-05-14): precision
--   is a property of the data, not of the viewport.
--     • city-precision case → contributes to a city-centroid badge
--     • state-precision case → contributes to a state-centroid badge
--     • address/street → renders as an individual pin
--
--   The current cases_centroids_in_bbox returns (city) aggregates
--   correctly — every city-precision case shares its city's centroid
--   as raw location_point, so the GROUP BY location_point coalesces
--   them naturally. But the function explicitly filters out state-
--   precision cases (mig 33+ rationale: "a state centroid is
--   meaningfully a non-point"). Under the new rule, state-precision
--   gets the SAME visual treatment as city-precision: aggregate badge
--   at the state centroid, no individual pins. Same machinery —
--   GROUP BY c.location_point coalesces state-precision rows by their
--   state centroid coord just like city-precision rows do by their
--   city centroid coord.
--
-- THE CHANGE:
--
--   1. Drop the `c.location_precision is distinct from 'state'`
--      WHERE clause filter. State-precision groups now flow through.
--
--   2. Extend the precision_floor CASE expression to include 'state'
--      as its own rank (1), with unknown demoted to 0. So a state-
--      precision aggregate row returns precision_floor='state'
--      instead of 'unknown' — the client uses that to render the
--      state-tier badge variant (different copy: "TX · 1,340" vs
--      "Los Angeles · 782").
--
--   3. RETURNS TABLE shape unchanged (8 cols). CREATE OR REPLACE
--      works in place; no DROP needed; no API gap.
--
-- VERIFICATION AFTER APPLY:
--
--   Should return one row per state with state-precision cases,
--   AND the existing rows per city centroid:
--
--     select precision_floor, locale_label, case_count
--     from public.cases_centroids_in_bbox(
--       -125.0, 24.0, -66.0, 49.5,     -- continental US bbox
--       null, array['open']::case_status[],
--       1, 5000
--     )
--     where precision_floor in ('state', 'city')
--     order by case_count desc
--     limit 20;
--
--   Expect to see "California" / "Texas" / etc. as state rows mixed
--   with the existing city rows. State rows count = the # of
--   state-only-precision cases in that state; city rows unchanged.
--
-- DEPENDENCIES:
--   None — mig 33+/35 establish the column shape this migration
--   preserves. The new precision_floor='state' enum value is purely
--   informational to the client; PostgreSQL doesn't enforce it
--   anywhere (it's `text`, not an enum type).

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
  select
    st_y(c.location_point::geometry) as lat,
    st_x(c.location_point::geometry) as lng,
    count(*)::integer as case_count,
    count(*) filter (where c.kind in ('homicide', 'suspicious_death'))::integer as kinds_homicide,
    count(*) filter (where c.kind = 'missing')::integer as kinds_missing,
    count(*) filter (where c.kind in ('unidentified', 'unclaimed'))::integer as kinds_doe,
    -- Mig 54: extend the rank table to include 'state' as rank 1
    -- (between 'county' and 'unknown'). State-precision aggregates
    -- now surface precision_floor='state' so the client can render
    -- the state-tier badge variant. Unknown demoted to rank 0.
    case
      min(
        case c.location_precision
          when 'address' then 5
          when 'street'  then 4
          when 'city'    then 3
          when 'county'  then 2
          when 'state'   then 1
          else 0
        end
      )
      when 5 then 'address'
      when 4 then 'street'
      when 3 then 'city'
      when 2 then 'county'
      when 1 then 'state'
      else 'unknown'
    end as precision_floor,
    -- Locale label: "City, ST" for city-precision groups, just the
    -- state name for state-precision groups (already handled by the
    -- existing single-state fallback below — falls through when no
    -- city is known for the group, which is exactly the case for
    -- state-precision aggregates).
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
    -- Mig 54: REMOVED `and c.location_precision is distinct from 'state'`.
    -- State-precision rows now contribute to aggregates the same way
    -- city-precision rows do. The badge layer (client) renders state
    -- aggregates with the same machinery, different copy.
    and ST_Intersects(
      c.location_point,
      ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    )
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
  group by c.location_point
  having count(*) > threshold
  order by case_count desc
  limit result_limit;
$$;
