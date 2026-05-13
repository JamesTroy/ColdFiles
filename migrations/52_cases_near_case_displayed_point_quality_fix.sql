-- Migration 52 — fix-forward for mig 51's cases_near_case shape drift.
--
-- WHAT WENT WRONG IN MIG 51:
--   I audited the most recent cases_near_case definition by reading
--   mig 34_cases_near_case_rpc.sql, which has a 13-column return shape.
--   I missed that mig 36_cases_in_bbox_and_near_case_quality.sql
--   later extended the return type to 14 columns by inserting
--   `incident_date_quality date_quality` between `incident_date` and
--   `location_city` — to power the Same-Period bucketing on the
--   case-detail adjacency section.
--
--   Prod has the 14-column shape (mig 36). Mig 51's CREATE OR REPLACE
--   used the 13-column shape, so PostgreSQL refused the apply with
--   42P13 ("cannot change return type of existing function").
--
-- ASYMMETRY WITH cases_in_bbox:
--   Mig 36 also extended cases_in_bbox to include incident_date_quality,
--   but mig 39 + mig 42 + mig 50 all used the 13-column shape with
--   `location_precision` instead of `incident_date_quality`. Apparently
--   either mig 36's bbox half was never applied to prod, or mig 39
--   silently replaced it via some other path. Empirically: mig 50
--   applied cleanly, so prod's cases_in_bbox is at the
--   location_precision shape (no quality column). No fix needed there.
--
--   cases_near_case followed a different path — the mig 36 shape stuck.
--
-- THE FIX:
--   Re-define cases_near_case preserving the mig 36 return shape
--   (incident_date_quality intact at position 10) and ADD the two
--   intended changes from mig 51:
--     • Switch SELECT/WHERE/ST_Distance/ST_DWithin to
--       location_point_displayed.
--     • Add `location_precision is distinct from 'state'` filter.
--
--   With the return shape preserved, CREATE OR REPLACE works — no
--   DROP needed, no API gap.
--
-- ALSO INCLUDED — defensive re-apply of mig 51's other two:
--   cases_in_polygon and cases_within_radius were CREATE OR REPLACE
--   with same-shape return tables in mig 51. They probably applied
--   (cases_in_polygon ran first; cases_within_radius after the failed
--   cases_near_case may or may not have run depending on Supabase SQL
--   editor transaction behavior). Re-running them here as CREATE OR
--   REPLACE is idempotent on the no-op path and lands them
--   definitively if they didn't apply in mig 51.
--
-- VERIFICATION AFTER APPLY:
--   Should return the 14-column shape including incident_date_quality:
--     select column_name, data_type
--     from information_schema.parameters
--     where specific_schema = 'public'
--       and specific_name like 'cases_near_case%'
--       and parameter_mode = 'TABLE';

-- ─────────────────────────────────────────────────────────────────────
-- cases_near_case — 14-col shape, displayed-point, state-precision filter
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
  -- Preserved from mig 36 — drives quality-aware Same-Period bucketing
  -- on the case-detail adjacency section. Mig 51 erroneously dropped
  -- this; mig 52 puts it back.
  incident_date_quality date_quality,
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
    c.incident_date_quality,
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
-- cases_in_polygon — defensive re-apply (no-op if mig 51 already
-- landed; lands it now if mig 51 rolled back).
-- Same shape as mig 33; displayed-point + state-precision filter.
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
-- cases_within_radius — defensive re-apply (probably didn't run in
-- mig 51 because cases_near_case errored before reaching it).
-- Same shape as mig 02; displayed-point + state-precision filter.
-- Search center stays raw (user lat/lng); only case coords switch.
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
