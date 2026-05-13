-- Migration 51 — apply mig 50's displayed-point fix to the three
-- sibling read RPCs that share the same bug shape.
--
-- WHAT THIS DOES:
--   • cases_in_polygon       (mig 33 → updated)
--   • cases_near_case        (mig 34 → updated)
--   • cases_within_radius    (mig 02 → updated)
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   • cases_at_coordinate (mig 38) — intentionally keyed on raw
--     location_point to round-trip the cases_centroids_in_bbox
--     grouping. Its callers (centroid badge tap-drill) match raw
--     coords by design. Leave as-is. The badge layer is being
--     retired by the client anyway (see the "retire centroid badge
--     layer" commit in the recent OTA).
--   • The watch_zone_hit producer trigger (mig 19) — switching the
--     alert-side polygon-membership test from raw to displayed is a
--     real product decision (the moat-product surface per
--     feedback_alerts_are_the_moat). Out of scope here; separate
--     explicit operator conversation if/when we want that.
--
-- THE PATTERN (identical across the three):
--   • SELECT  st_y/st_x(c.location_point::geometry)
--          →  st_y/st_x(c.location_point_displayed::geometry)
--   • WHERE  c.location_point is not null
--          →  c.location_point_displayed is not null
--   • Spatial predicate (ST_Within / ST_DWithin / ST_Distance)
--     operates on c.location_point_displayed.
--   • Add c.location_precision is distinct from 'state' (was missing
--     from all three; same posture as cases_in_bbox + the centroid
--     RPCs per mig 33 rationale).
--
-- WHY:
--   Consistency with the map. Users see jittered display pins on the
--   home map (mig 50). The watch-zone "what's inside this drawn
--   perimeter?" list, the case-detail "within N miles" list, and
--   the home-screen nearby list should all match those same coords.
--   Otherwise:
--     • A user draws a zone over a city → sees pins fanned out on
--       the map, but the zone's "cases inside" list excludes pins
--       whose jitter pushes them outside the polygon (or includes
--       cases the map renders outside). Visible discrepancy.
--     • "Within 25 miles" lists a city-precision case as 0.0 miles
--       away (raw=raw centroid match) when the pin renders 3km off.
--
-- NUMERIC IMPLICATIONS:
--   Switching distance/radius math to displayed coords introduces up
--   to ~5km of jitter noise. Acceptable for the radii in play (25mi
--   default on cases_within_radius / cases_near_case; user-drawn
--   polygons typically span tens of miles). The cost is small noise
--   at the radius edge; the benefit is UI consistency. The home-
--   screen nearby user-input search center stays raw — only the case
--   coords switch.
--
-- IDEMPOTENT:
--   All three are CREATE OR REPLACE — RETURNS TABLE shape is
--   preserved across the swap. No DROP needed (would be a temporary
--   API gap for the live web property).
--
-- DEPENDENCY ORDER:
--   Apply 50 first (cases_in_bbox), confirm map renders cleanly,
--   THEN apply 51. Each function in 51 is independently revertable
--   by re-running the prior migration that defined it (32 / 34 / 02
--   respectively).

-- ─────────────────────────────────────────────────────────────────────
-- cases_in_polygon — Watch Zone "what's inside this drawn perimeter?"
-- ─────────────────────────────────────────────────────────────────────

create or replace function cases_in_polygon(
  polygon_wkt text,
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
  select
    c.id,
    c.slug,
    c.kind,
    c.status,
    st_y(c.location_point_displayed::geometry) as lat,
    st_x(c.location_point_displayed::geometry) as lng,
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
    and c.location_point_displayed is not null
    and c.location_precision is distinct from 'state'
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
    and st_within(
      c.location_point_displayed::geometry,
      st_setsrid(st_geomfromtext(polygon_wkt), 4326)
    )
  limit result_limit;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- cases_near_case — case-detail "WITHIN N MILES" adjacency list.
-- Distance is computed displayed-to-displayed so "0.8 mi" matches the
-- pixel distance between the two pins on the map.
-- ─────────────────────────────────────────────────────────────────────

create or replace function cases_near_case(
  subject_case_id uuid,
  radius_miles integer default 25,
  filter_kinds case_kind[] default null,
  filter_status case_status[] default null,
  result_limit integer default 200
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
  recency_alpha numeric,
  distance_miles double precision
)
language sql
stable
as $$
  with subject as (
    select location_point_displayed
    from cases
    where id = subject_case_id
      and deleted_at is null
      and location_point_displayed is not null
    limit 1
  )
  select
    c.id,
    c.slug,
    c.kind,
    c.status,
    st_y(c.location_point_displayed::geometry) as lat,
    st_x(c.location_point_displayed::geometry) as lng,
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
    end::numeric as recency_alpha,
    (ST_Distance(
       c.location_point_displayed,
       (select location_point_displayed from subject)
     ) / 1609.344)::double precision as distance_miles
  from cases c, subject
  where c.id <> subject_case_id
    and c.deleted_at is null
    and c.location_point_displayed is not null
    and c.location_precision is distinct from 'state'
    and ST_DWithin(
      c.location_point_displayed,
      subject.location_point_displayed,
      radius_miles * 1609.344
    )
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
  order by distance_miles asc
  limit result_limit;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- cases_within_radius — home-screen "cases near me" list.
-- The search center is the user's raw lat/lng (device GPS / address
-- geocode) — that stays raw. Only the case-side coords switch.
-- ─────────────────────────────────────────────────────────────────────

create or replace function cases_within_radius(
  search_lat double precision,
  search_lng double precision,
  radius_miles double precision default 25,
  filter_kinds case_kind[] default null,
  filter_status case_status[] default array['open']::case_status[],
  result_limit integer default 100
)
returns table (
  id uuid,
  slug text,
  kind case_kind,
  status case_status,
  victim_name text,
  victim_age integer,
  incident_date date,
  location_text text,
  location_city text,
  location_state char(2),
  narrative_short text,
  has_photo boolean,
  primary_agency_name text,
  primary_photo_url text,
  distance_miles numeric,
  recency_alpha numeric,
  lat double precision,
  lng double precision
)
language sql
stable
as $$
  select
    c.id,
    c.slug,
    c.kind,
    c.status,
    c.victim_name,
    c.victim_age,
    c.incident_date,
    c.location_text,
    c.location_city,
    c.location_state,
    c.narrative_short,
    c.has_photo,
    a.name as primary_agency_name,
    (
      select cm.url
      from case_media cm
      where cm.case_id = c.id and cm.is_primary = true
      limit 1
    ) as primary_photo_url,
    round(
      (st_distance(
        c.location_point_displayed,
        st_setsrid(st_makepoint(search_lng, search_lat), 4326)::geography
      ) / 1609.34)::numeric,
      2
    ) as distance_miles,
    case
      when c.last_changed_at is null then 0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 3 then 1.0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 10 then 0.5
      else 0
    end::numeric as recency_alpha,
    st_y(c.location_point_displayed::geometry) as lat,
    st_x(c.location_point_displayed::geometry) as lng
  from cases c
  left join agencies a on a.id = c.primary_agency_id
  where
    c.deleted_at is null
    and c.location_point_displayed is not null
    and c.location_precision is distinct from 'state'
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
    and st_dwithin(
      c.location_point_displayed,
      st_setsrid(st_makepoint(search_lng, search_lat), 4326)::geography,
      radius_miles * 1609.34
    )
  order by c.location_point_displayed <-> st_setsrid(st_makepoint(search_lng, search_lat), 4326)::geography
  limit result_limit;
$$;
