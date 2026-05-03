-- Migration 33 — expand cases_in_polygon return to include subtitle fields.
--
-- Mirrors migration 29's fix for cases_in_bbox. The same lying-cast
-- drift that migration 29 diagnosed for the Map bottom-sheet was alive
-- on the Watch Zone detail screen — mobile/app/zone/[id].tsx casts
-- cases_in_polygon's 9-column return to CaseRowMapNear (16 columns).
-- kindLine() in CaseRow reads incident_date and location_city — both
-- undefined at runtime — so every "cases inside this zone" row
-- rendered with an empty subtitle. Same UX failure shape, different
-- screen, both anchored on engagement-spine surfaces (the bottom-sheet
-- list, and the Watch Zone detail that v1.0.2 push delivery routes
-- users into).
--
-- Expanding the RPC + retyping the call site to CaseRowMapBbox (the
-- subset type introduced in migration 29) closes the parity gap.
--
-- Bandwidth: substantially smaller blast radius than the bbox cap
-- bump. Polygon results are scoped to a user-drawn watch zone — at
-- the v1.0.2 ZONE_SOFT_CAP=25 zones × small polygons, expected
-- per-fetch payload is single-digit-to-low-tens of cases (each zone's
-- "cases inside" count). The three added text columns add ~25-40
-- bytes per row × ~10 rows ≈ <1 KB per fetch. PostgREST gzips on
-- the wire; effectively a no-op for bandwidth.
--
-- Idempotent: drop+create the function (necessary because PostgreSQL
-- rejects CREATE OR REPLACE when the RETURNS TABLE column list
-- changes — same 42P13 caveat that bit migration 29 on first apply).

drop function if exists public.cases_in_polygon(
  text, case_kind[], case_status[], integer
);

create function cases_in_polygon(
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
  -- ↓ new columns added by migration 33 to power the bottom-sheet
  -- subtitle on the Watch Zone detail screen. Mirrors migration 29's
  -- additions to cases_in_bbox.
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
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
    and st_within(
      c.location_point::geometry,
      st_setsrid(st_geomfromtext(polygon_wkt), 4326)
    )
  limit result_limit;
$$;
