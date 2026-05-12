-- Migration 48 — MAP aggregate RPCs.
--
-- Three count-shaped RPCs against migration 47's homicide_aggregates
-- table, per docs/integrations/map-ingestion-plan.md §3 ("New RPCs"):
--
--   homicide_counts_in_polygon — totals + solved/unsolved split for
--     an arbitrary polygon and year window. The denominator widget.
--   homicide_density_for_bbox — bbox-shaped count, suitable for the
--     Phase 5 county-shaded choropleth. Aggregated by county, not by
--     individual point — plan §4a is explicit that MAP rows never
--     render as map pins.
--   homicide_context_for_case — given a ColdFiles case_id, returns
--     the SHR baseline for that case's county + ±5-year window.
--     The most product-differentiated of the three (plan §3).
--
-- Shared design rules:
--
--   * All three read homicide_aggregates_current (the view from
--     migration 47), not the base table. A new ingest with a higher
--     source_release atomically becomes "the active corpus" without
--     any RPC code change.
--
--   * Map-rendered queries filter out location_precision = 'state',
--     same as cases_in_bbox §42:124. State-centroid points are a
--     long-tail ORI-lookup-failed sentinel, not honest geographic
--     data — they belong in count totals but not in any map
--     visualization.
--
--   * `language sql stable` (no PL/pgSQL). Plain SQL is enough for
--     all three RPCs, and stable lets Postgres function-inline them
--     into the calling query plan.
--
--   * The signatures are deliberately additive — every filter
--     parameter has a NULL-or-default value that means "don't apply
--     this filter," so a caller can pass only the dimensions they
--     care about. Matches the cases_in_bbox / cases_grid_in_bbox
--     pattern.
--
-- These RPCs compile and run against an empty homicide_aggregates
-- table. Plan §5 (Phase 1) requires they're real enough to verify
-- with a hand query after the first state's data is ingested; they
-- are not stubs that return [].

-- ─────────────────────────────────────────────────────────────────────────────
-- homicide_counts_in_polygon
-- ─────────────────────────────────────────────────────────────────────────────
-- Given a polygon (as a WKT/GeoJSON string the client builds, or a
-- pre-existing geometry), return the count of SHR rows whose agency
-- centroid falls inside the polygon, split by solved status. Optional
-- year window + weapon/circumstance/state filters.
--
-- Polygon comes in as text so the client can pass GeoJSON or WKT
-- without an extra round-trip to turn it into a geometry. ST_GeomFromText
-- handles WKT; ST_GeomFromGeoJSON handles GeoJSON. We try WKT first and
-- fall back to GeoJSON — both throw the same "invalid input" error on
-- failure so the caller gets a useful 400.
--
-- Returns one row. Callers wanting per-year breakdowns can call this
-- in a loop or use homicide_density_for_bbox for a denser shape.

create or replace function homicide_counts_in_polygon(
  polygon_wkt        text,
  year_min           integer default null,
  year_max           integer default null,
  filter_state       char(2) default null,
  filter_weapons     text[]  default null,
  filter_circumstances text[] default null
)
returns table (
  total_count        bigint,
  solved_count       bigint,
  unsolved_count     bigint,
  foia_obtained_count bigint
)
language sql
stable
as $$
  with poly as (
    select
      case
        -- ST_GeomFromText errors on JSON; ST_GeomFromGeoJSON errors on
        -- WKT. coalesce() over a try-each pattern is the conventional
        -- PostGIS workaround.
        when polygon_wkt like '{%' then ST_GeomFromGeoJSON(polygon_wkt)
        else ST_GeomFromText(polygon_wkt, 4326)
      end::geography as geom
  )
  select
    count(*) as total_count,
    count(*) filter (where h.solved is true)                       as solved_count,
    count(*) filter (where h.solved is false or h.solved is null)  as unsolved_count,
    count(*) filter (where h.source_flag = 'foia_obtained')        as foia_obtained_count
  from homicide_aggregates_current h, poly
  where
    h.location_point is not null
    and h.location_precision is distinct from 'state'
    and ST_Intersects(h.location_point, poly.geom)
    and (year_min is null or h.year >= year_min)
    and (year_max is null or h.year <= year_max)
    and (filter_state is null or h.state = filter_state)
    and (filter_weapons is null or h.weapon = any(filter_weapons))
    and (filter_circumstances is null or h.circumstance = any(filter_circumstances));
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- homicide_density_for_bbox
-- ─────────────────────────────────────────────────────────────────────────────
-- Backs the Phase 5 county-shaded choropleth (plan §4a, §5 — explicitly
-- aggregate-only, NEVER point pins). Returns one row per (state, county)
-- intersecting the bbox, with totals + the solved/unsolved/FOIA split.
--
-- The client computes per-capita normalization on its side from this
-- + population data; this RPC stays count-shaped.
--
-- Bbox comes in as four doubles to match the cases_in_bbox signature
-- the codebase already uses — same conventions for parameter order
-- (min_lng, min_lat, max_lng, max_lat).

create or replace function homicide_density_for_bbox(
  min_lng      double precision,
  min_lat      double precision,
  max_lng      double precision,
  max_lat      double precision,
  year_min     integer default null,
  year_max     integer default null
)
returns table (
  state              char(2),
  county             text,
  total_count        bigint,
  solved_count       bigint,
  unsolved_count     bigint,
  foia_obtained_count bigint
)
language sql
stable
as $$
  select
    h.state,
    h.county,
    count(*)                                                       as total_count,
    count(*) filter (where h.solved is true)                       as solved_count,
    count(*) filter (where h.solved is false or h.solved is null)  as unsolved_count,
    count(*) filter (where h.source_flag = 'foia_obtained')        as foia_obtained_count
  from homicide_aggregates_current h
  where
    h.location_point is not null
    and h.location_precision is distinct from 'state'
    and ST_Intersects(
      h.location_point,
      ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    )
    and (year_min is null or h.year >= year_min)
    and (year_max is null or h.year <= year_max)
  group by h.state, h.county;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- homicide_context_for_case
-- ─────────────────────────────────────────────────────────────────────────────
-- The Phase 3 Context band (plan §3, §5) calls this with a ColdFiles
-- case_id; the RPC pulls the SHR baseline for the same county + a
-- ±N-year window around the incident_date. Returns counts only —
-- the UI renders the prose ("47 unsolved homicides in this county
-- between 1980–2024.").
--
-- N defaults to 5 (a 10-year window around the case) per the plan,
-- but the parameter is explicit so the UI can widen it for an old
-- case where the case itself is the only one within ±5 years.
--
-- This RPC is the ONE place homicide_aggregates and `cases` touch
-- each other in this migration set. The join is by predicate (state,
-- county, year window), NOT by foreign key — see plan §3
-- ("No case_id foreign key to cases").

create or replace function homicide_context_for_case(
  target_case_id  uuid,
  year_window     integer default 5
)
returns table (
  total_count           bigint,
  solved_count          bigint,
  unsolved_count        bigint,
  foia_obtained_count   bigint,
  -- Echo the case's resolved county + year window back so the UI
  -- can render "47 in <county> between <ymin>–<ymax>" without a
  -- second round trip.
  resolved_state        char(2),
  resolved_county       text,
  year_min              integer,
  year_max              integer
)
language sql
stable
as $$
  with target as (
    select
      c.location_state::char(2)            as state,
      c.location_county                    as county,
      extract(year from c.incident_date)::integer as case_year
    from cases c
    where c.id = target_case_id
      and c.deleted_at is null
    limit 1
  ),
  windowed as (
    select
      t.state,
      t.county,
      coalesce(t.case_year - year_window, null) as ymin,
      coalesce(t.case_year + year_window, null) as ymax
    from target t
  )
  select
    count(*)                                                       as total_count,
    count(*) filter (where h.solved is true)                       as solved_count,
    count(*) filter (where h.solved is false or h.solved is null)  as unsolved_count,
    count(*) filter (where h.source_flag = 'foia_obtained')        as foia_obtained_count,
    w.state                                                        as resolved_state,
    w.county                                                       as resolved_county,
    w.ymin                                                         as year_min,
    w.ymax                                                         as year_max
  from windowed w
  left join homicide_aggregates_current h
    on h.state = w.state
   and h.county = w.county
   and (w.ymin is null or h.year >= w.ymin)
   and (w.ymax is null or h.year <= w.ymax)
  group by w.state, w.county, w.ymin, w.ymax;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Execution grants
-- ─────────────────────────────────────────────────────────────────────────────
-- Same pattern as the existing case RPCs (cases_in_bbox et al.):
-- anon + authenticated can call these. Service role doesn't need
-- explicit grants; it bypasses by default.

grant execute on function homicide_counts_in_polygon(text, integer, integer, char, text[], text[]) to anon, authenticated;
grant execute on function homicide_density_for_bbox(double precision, double precision, double precision, double precision, integer, integer) to anon, authenticated;
grant execute on function homicide_context_for_case(uuid, integer) to anon, authenticated;
