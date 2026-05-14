-- Migration 53 — revert the column swap from mig 50 / 51 / 52.
-- Read RPCs project from c.location_point (raw) again.
-- Keep the state-precision filter and ORDER BY id additions.
--
-- THE STORY (date: 2026-05-14):
--
-- Mig 50 / 51 / 52 switched four read RPCs from c.location_point to
-- c.location_point_displayed to fix a "pins stacked at city centroid"
-- bug the handoff documented. Within hours of mig 52 landing, the
-- user reported pins floating in Santa Monica Bay off Rancho Palos
-- Verdes / Redondo Beach / Manhattan Beach. Diagnostic confirmed
-- every in-water pin was city-precision (jitter artifact, not a real
-- water case).
--
-- Root cause: TWO LAYERS OF JITTER STACKING.
--
--   1. The server's cases_displayed_point (mig 43) applies FNV-1a
--      slug-seeded jitter at radius 0.02-0.045° (2.2-5.0 km).
--   2. The client's applyImpreciseSpread in mobile/app/(tabs)/index
--      .tsx still applies its OWN FNV-1a slug-seeded jitter at radius
--      0.003-0.008° (0.33-0.88 km).
--
--   Both hashes are byte-identical on the same slug (FNV-1a 32-bit,
--   same offset basis, same prime). Both use sin(angle) for longitude
--   and cos(angle) for latitude. Same angle, same direction —
--   additive radius. After mig 50, every city-precision case displays
--   at city centroid + (server 2.2-5.0 km) + (client 0.33-0.88 km) in
--   the SAME direction. Total: 2.5-5.9 km in a fixed direction. For
--   coastal-city centroids (Redondo, Manhattan Beach, San Pedro,
--   Palos Verdes) that's enough to drop pins offshore.
--
--   The byte-identity parity contract mig 43 documented was already
--   silently broken when the client renderer rebuild (commit 5b298cd
--   in the recent OTA) changed the client radius from 2-5 km to
--   0.33-0.88 km. Mig 50 was written assuming the parity held and
--   the server jitter was the ONLY source of displacement — which
--   was correct in mig 43's design but no longer true in current
--   prod.
--
-- WHY REVERT, NOT TIGHTEN THE SERVER:
--
--   Two paths considered:
--
--   A. Reduce server radius to match client (0.003-0.008°). Restores
--      additive-but-small total of 0.66-1.76 km. Still leaks into
--      water for tight-coast cities (Manhattan Beach is essentially
--      on the coast — even 880 m of west-direction jitter lands in
--      surf zone).
--
--   B. Revert the read RPCs to c.location_point (raw). Server-side
--      jitter from displayed_point stops applying to per-case
--      renders. Client jitter (0.33-0.88 km) handles visual
--      separation alone. Coastal cities still see some pins drift
--      to the coast edge but rarely into water; large cities (LA,
--      Long Beach) still spread well at zoom 14+ where individual
--      pins matter.
--
--   B is correct. The displayed-point column was always intended as
--   the spatial seed for cases_grid_in_bbox cell-aggregation (mig
--   44 — wants wider spread so 200 LA cases distribute across
--   adjacent cells, not all into one). It was misapplied to the
--   read RPCs after a handoff that read the symptom one zoom level
--   off from where the client jitter actually fires.
--
-- WHAT MIG 53 PRESERVES:
--
--   ✓ Mig 42's `order by c.id` on cases_in_bbox (UUIDv4-uniform;
--     defends state-skew under bursty rescrapes).
--   ✓ Mig 36's 14-column return shape on cases_near_case
--     (includes incident_date_quality).
--   ✓ State-precision filter (`c.location_precision is distinct
--     from 'state'`) on all four — mig 50/51/52 added this; it's
--     a real bug fix unrelated to the displayed-point question.
--
-- WHAT MIG 53 CHANGES:
--
--   • cases_in_bbox       — SELECT/WHERE/ST_Intersects back to c.location_point.
--   • cases_in_polygon    — SELECT/WHERE/ST_Within back to c.location_point.
--   • cases_near_case     — SELECT/WHERE/ST_Distance/ST_DWithin back to c.location_point.
--   • cases_within_radius — SELECT/WHERE/ST_DWithin/distance back to c.location_point.
--
--   `cases_grid_in_bbox` (mig 44) is UNCHANGED — still uses displayed
--   for cell aggregation. The displayed-point generated column and
--   its function stay too; only the read RPCs revert.
--
-- VERIFICATION AFTER APPLY:
--
--   Re-run the LA bbox query that confirmed the bug earlier — should
--   now show all city-precision cases at the city centroid (3 decimal
--   places per the snapToBlock privacy floor), no in-water drift:
--
--     select slug, location_city, location_precision,
--            ST_Y(location_point_displayed::geometry) - ST_Y(location_point::geometry) as lat_delta,
--            ST_X(location_point_displayed::geometry) - ST_X(location_point::geometry) as lng_delta
--     from public.cases
--     where location_precision = 'city'
--       and ST_Intersects(location_point, ST_MakeEnvelope(-118.55, 33.65, -118.25, 33.90, 4326)::geography)
--     limit 5;
--
--   The displayed-vs-raw delta should be on the order of 0.02-0.045
--   degrees (the server jitter still computes; the read RPCs just
--   don't USE it).
--
--   Then on mobile: open the LA map at the same zoom as before.
--   Coastal-city pins should now sit on land in their respective
--   cities (with the client's 0.33-0.88 km jitter spreading them
--   visibly at zoom 14+ but staying within city footprints).
--
-- FOLLOW-UP WORK NOT IN THIS MIGRATION:
--
--   1. Retire the client's applyImpreciseSpread next time a mobile
--      OTA goes out. Single source of truth = server. After client
--      retires its jitter, optionally restore mig 50's column swap
--      AND constrain the server jitter to city polygons (the
--      mig 41 infrastructure). City polygons table is documented
--      as "populated from US Census TIGER data in a follow-up
--      session" — confirm it's populated before that work.
--
--   2. The mig 43 parity-test diagnostic (_diag_displayed_point_
--      sample + scripts/diagnose-jitter-parity.ts) is out of date
--      with prod — client radius diverged in commit 5b298cd. Either
--      delete the parity script (the contract is gone) or update
--      it to assert the angle matches but the radius scales are
--      independent. Tracked here, not landed in this mig.
--
-- IDEMPOTENT:
--   All four are CREATE OR REPLACE. Same RETURNS TABLE shapes as
--   their last-applied definitions. No DROP needed.

-- ─────────────────────────────────────────────────────────────────────
-- cases_in_bbox — mid-zoom map pin RPC. Back to raw c.location_point.
-- Same shape as mig 42 + mig 50 (13 cols, includes location_precision).
-- ─────────────────────────────────────────────────────────────────────

create or replace function cases_in_bbox(
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
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
  order by c.id
  limit result_limit;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- cases_in_polygon — Watch Zone "what's inside this drawn perimeter?".
-- Same shape as mig 33 + mig 51 (12 cols).
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
    and c.location_precision is distinct from 'state'
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
    and st_within(
      c.location_point::geometry,
      st_setsrid(st_geomfromtext(polygon_wkt), 4326)
    )
  limit result_limit;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- cases_near_case — case-detail "WITHIN N MILES" adjacency list.
-- Same shape as mig 36 + mig 52 (14 cols, includes incident_date_quality).
-- Distance is computed raw-to-raw — matches the physical-distance
-- semantics callers expect on this surface.
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
    and c.location_precision is distinct from 'state'
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

-- ─────────────────────────────────────────────────────────────────────
-- cases_within_radius — home-screen "cases near me" list.
-- Same shape as mig 02 + mig 51 (18 cols).
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
        c.location_point,
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
    st_y(c.location_point::geometry) as lat,
    st_x(c.location_point::geometry) as lng
  from cases c
  left join agencies a on a.id = c.primary_agency_id
  where
    c.deleted_at is null
    and c.location_point is not null
    and c.location_precision is distinct from 'state'
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
    and st_dwithin(
      c.location_point,
      st_setsrid(st_makepoint(search_lng, search_lat), 4326)::geography,
      radius_miles * 1609.34
    )
  order by c.location_point <-> st_setsrid(st_makepoint(search_lng, search_lat), 4326)::geography
  limit result_limit;
$$;
