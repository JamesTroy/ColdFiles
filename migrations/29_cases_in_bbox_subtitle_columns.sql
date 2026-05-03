-- Migration 29 — expand cases_in_bbox return to include subtitle fields.
--
-- Audit finding (2026-05-03): mobile/components/cf/case-row.tsx renders
-- kindLine(row), which reads `incident_date` and `location_city` from
-- the row to produce the "Unidentified · 1985 · CLAREMONT, CA" subtitle.
-- The cases_in_bbox() RPC (last touched in migrations 16 + 22) returned
-- only id/slug/kind/status/lat/lng/victim_name/has_photo/recency_alpha —
-- 9 columns, none of which are incident_date or location_city.
--
-- The mobile cast lied to the type system (cast result to CaseRowMapNear,
-- a 16-column type), so the type checker stayed quiet and the bottom-sheet
-- silently rendered each row with just the kind word and nothing else. A
-- map of "Unidentified", "Unidentified", "Unidentified" rows had no year
-- or place context — the live map UX has had this gap since migration 16.
--
-- Fix: expand the RPC to return the three missing subtitle fields. Mobile
-- gets a tighter row type (CaseRowMapBbox in mobile/lib/types/database.ts)
-- and the kindLine subtitle works on map-derived rows for the first time.
--
-- Bandwidth note: at the current 6,000-row map cap, the three added text
-- columns add roughly:
--   incident_date  ~10 bytes (ISO date)
--   location_city  ~12 bytes (avg "Los Angeles" etc.)
--   location_state  ~3 bytes (2-letter code + null overhead)
-- ≈ 25-40 bytes per row × 6,000 rows ≈ 150-240 KB per wide-zoom fetch.
-- Comfortable on cellular, worth being aware of for the next limit-bump
-- conversation. PostgREST gzips on the wire; real over-the-wire size is
-- substantially lower.
--
-- DROP-then-CREATE is required here, not CREATE OR REPLACE: PostgreSQL
-- rejects in-place replacement when the RETURNS TABLE signature changes
-- (error 42P13). The DROP is qualified by full argument signature so it
-- only targets this overload — safe to re-run.
--
-- Idempotent via DROP IF EXISTS + CREATE.

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
  -- ↓ new columns added by migration 29 to power the bottom-sheet subtitle.
  incident_date date,
  location_city text,
  location_state text,
  recency_alpha numeric
)
language sql
stable
as $$
  with dense_points as (
    -- Inherited from migration 16 — drops centroid stacks (CDCR location,
    -- arbitrary "Los Angeles" defaults) where >20 cases share the same
    -- exact lat/lng. Marked for replacement with a `location_imprecise`
    -- boolean per the architecture review (see Tier 4 cleanups).
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
  -- Inherited from migration 22 — deterministic ordering so the trimmed
  -- limit prefix doesn't shuffle on each pan.
  order by c.last_changed_at desc nulls last, c.id
  limit result_limit;
$$;
