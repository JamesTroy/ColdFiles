-- Migration 34 — geographic adjacency view for the case-detail screen.
--
-- Editorial frame: family members of unidentified Does and missing
-- persons can spot geographic adjacency that NamUs's UI buries (same
-- decade, same region). NOT "true-crime browsing" or "related cases"
-- — that would imply investigatory linkage we're not asserting. The
-- case-detail section that consumes this RPC heads with "WITHIN N
-- MILES" — neutral, geographic, operational tone matching the
-- amber-palette posture from the design memory.
--
-- The subject case is excluded from results (don't surface "the case
-- you're looking at" as nearby itself). Soft-deleted +
-- takedown_requested cases are filtered automatically through
-- cases_public_read + migration 25's takedown predicate — security
-- invoker (default; mirrors migrations 29 + 33), RLS evaluates per
-- call, no new policy mode introduced.
--
-- Returns the same column set as migrations 29 + 33 plus
-- distance_miles, so the same <CaseRow> renders all three within the
-- existing CaseRowMapBbox type contract (extended with an optional
-- distance_miles? field — null on bbox/polygon results, populated
-- here). PostgREST omits the field on the wire for 29/33 calls; JS
-- reads undefined → optional type accepts. No retrofit on existing
-- call sites.
--
-- Idempotent: drop+create (RETURNS TABLE column set is new, so
-- CREATE OR REPLACE would 42P13 — same caveat 29 + 33 hit and PR #4
-- already encoded the fix-shape for).

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
    c.location_city,
    c.location_state,
    case
      when c.last_changed_at is null then 0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 3 then 1.0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 10 then 0.5
      else 0
    end::numeric as recency_alpha,
    -- ST_Distance with two geography args returns meters; convert to mi
    -- (1 mi = 1609.344 m). Cast to double precision so PostgREST sends
    -- it as a JSON number rather than a string.
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
