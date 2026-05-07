-- Migration 36 — extend cases_in_bbox + cases_near_case to return
-- incident_date_quality.
--
-- Why: the case-detail "WITHIN N MILES" section's Same-Period bucket
-- needs date precision to bucket correctly. Year-only-quality dates
-- land at YYYY-01-01 by parseDate convention; a section that does
-- point-vs-point month math against that anchor produces asymmetric
-- matching (a year_only "1985" matches Feb-1985 subjects but misses
-- Oct-1985 subjects, even though both are by definition within 1985).
--
-- The fix lives client-side: the section computes each case's
-- effective date as a RANGE based on its quality (year_only → full
-- year, exact → point), then checks range-overlap against a ±6-month
-- window around the subject's range. To do that, the section needs
-- incident_date_quality on every row it gets back from the RPC.
--
-- Today both RPCs return the parsed `incident_date` column but not
-- the matching quality enum. This migration adds it. PostgREST omits
-- new fields gracefully on old clients (existing screens that don't
-- consume the field stay green); the section's bucket logic is the
-- only call site that reads it.
--
-- Bandwidth: incident_date_quality is a 5-value enum, ~12 bytes per
-- row on the wire. Negligible at the 100-200 row caps these RPCs
-- carry.
--
-- Idempotent: DROP IF EXISTS + CREATE per the established pattern
-- from migrations 29 + 33 + 34. CREATE OR REPLACE doesn't work for
-- RETURNS TABLE column-set changes (42P13).

-- ─── cases_in_bbox ──────────────────────────────────────────────────

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
  -- Migration 36 — drives quality-aware bucketing on case-detail's
  -- adjacency section. See file header for context.
  incident_date_quality date_quality,
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
    c.incident_date_quality,
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

-- ─── cases_near_case ────────────────────────────────────────────────

drop function if exists public.cases_near_case(
  uuid, integer, case_kind[], case_status[], integer
);

create function cases_near_case(
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
  -- Migration 36 — see cases_in_bbox above.
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
    select location_point
    from cases
    where id = subject_case_id
      and deleted_at is null
      and location_point is not null
    limit 1
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
    c.incident_date_quality,
    c.location_city,
    c.location_state,
    case
      when c.last_changed_at is null then 0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 3 then 1.0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 10 then 0.5
      else 0
    end::numeric as recency_alpha,
    (ST_Distance(c.location_point, (select location_point from subject)) / 1609.344)::double precision as distance_miles
  from cases c, subject
  where c.id <> subject_case_id
    and c.deleted_at is null
    and c.location_point is not null
    and ST_DWithin(
      c.location_point,
      subject.location_point,
      radius_miles * 1609.344
    )
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
  order by distance_miles asc
  limit result_limit;
$$;
