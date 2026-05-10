-- Migration 44 — cases_grid_in_bbox: server-side tile-grid aggregation
-- for low-zoom map views.
--
-- Background:
--   Mig 42 fixed the state-skew at the cases_in_bbox 500-row LIMIT cap
--   (ORDER BY id-stable instead of last_changed_at). It did not fix
--   the underlying cardinality: 6,547 visible cases at nationwide zoom,
--   with the active mobile shipping limit=6000 to side-step the cap
--   entirely. Every nationwide-zoom render parses thousands of rows
--   that collapse to ~25 cluster discs in leaflet.markercluster.
--
--   This migration aggregates at the server below a client-chosen zoom
--   threshold. The client passes a cell size (degrees); the server
--   snaps each case's *displayed* point (post-jitter, from mig 43's
--   location_point_displayed generated column) to a regular grid via
--   ST_SnapToGrid, GROUPs by the snapped point, returns one row per
--   cell with case_count + kind composition + precision floor +
--   max-recency + modal locale label. The renderer (separate PR) draws
--   one cell badge at the cell centroid.
--
-- Why post-jitter aggregation (snap location_point_displayed, not
-- location_point):
--   The 5,661 city-precision rows all share their city's centroid
--   coordinate as imported. Snapping the raw point would collapse all
--   of (e.g.) LA's ~94 city-precision cases into one cell — the same
--   "city centroid pile-up" mig 39 retired the centroid-badge layer
--   for, just one zoom layer up. Mig 43's generated column applies
--   the renderer's deterministic 2-5km jitter server-side; snapping
--   the jittered point distributes a city's cases across ~2-3
--   adjacent cells, mirroring the visual spread the user sees at
--   high zoom.
--
-- Why this isn't a revival of the centroid-badge layer that mig 39
-- retired:
--   Mig 39's failure mode was specifically per-centroid badges
--   visually overlapping when multiple city centroids fell within
--   rendering distance — the LA / Hollywood / Long Beach pile-up.
--   The badges were placed at point-coincident coordinates, and
--   points-in-the-same-screen-area produced overlapping discs.
--
--   Tile-grid aggregation via ST_SnapToGrid produces DISJOINT cells
--   by construction: a case maps to exactly one cell, and cells
--   partition the plane on a regular grid. Two cell badges cannot
--   overlap visually — they cannot occupy the same screen region.
--   The specific failure mode mig 39 hit is structurally impossible
--   in this design, not just unlikely.
--
-- Why client-passed cell_size_deg, not server-derived:
--   The cell-size schedule is editorial (zoom 4→4°, 5→2°, 6→1°,
--   7→0.5°, threshold zoom 8 flips to point mode via cases_in_bbox).
--   Tying the server function to a fixed schedule means tweaking
--   the schedule requires a SQL migration. Keeping the parameter
--   explicit means schedule-tuning is a client-only OTA. Defensive
--   clamp [0.05, 20.0] catches stale clients drifting out of
--   schedule by raising rather than silently coercing.
--
-- dominant_kind threshold = 60%:
--   A cell tints in a kind family's color when ≥60% of its cases
--   are that family; otherwise renders 'mixed' (neutral amber).
--
--   50% (any plurality wins) was rejected: a 30-missing/28-homicide
--   cell rendered as a confident missing-color badge is the kind of
--   false precision that erodes trust for the users we most want to
--   trust the map (journalists, families, tip-submitters reading
--   literally). A 51% plurality painted as a unanimous-looking color
--   is the visual equivalent of a confident summary of an evenly-
--   split dataset. Wrong tone for the product.
--
--   75% (strong-majority wins) was rejected: pushes too many cells
--   into mixed. In dense metros where the data story is meaningful
--   (a South-LA cell that's 70% homicide vs an Orange-County cell
--   that's 85% missing tells a real journalistic story), 75%
--   flattens both into the same neutral. Loses signal the data
--   legitimately contains.
--
--   60% is the clear-majority threshold that matches "this place is
--   meaningfully more X than Y" and is stable against single-case
--   ingestion shifts. At 50%, a cell at 51%/49% can flip color on a
--   single ingest. At 60%, the underlying data has to shift more
--   substantively before the visual changes — good for visual
--   stability across rescrape cycles. Tuning this requires a SQL
--   migration; the framing above survives the next time someone
--   proposes adjusting it.
--
--   Small-n: the rule applies regardless of cell case_count. A 3-case
--   cell at 2-homicide/1-missing is 66.7% homicide and tints
--   homicide. The "small samples shouldn't speak with the same
--   confidence" concern is real but solved client-side: low-n cells
--   render at reduced opacity (≤5 cases → 60% opacity vs ≤90% for
--   cells with more cases). Keeps the SQL rule simple ("60% always")
--   and the visual signal honest. Tracked as a v1.1 renderer
--   enhancement, not a SQL change.
--
-- Cell coordinate semantics — cell centroid, not COG-of-cases:
--   ST_SnapToGrid returns the cell's lower-left corner (snapped to
--   integer multiples of cell_size_deg from origin (0,0)). We add
--   cell_size_deg/2 on each axis to get the cell centroid. Pan-
--   stable: the badge sits at the cell's geometric center regardless
--   of how cases are distributed within the cell. A cluster of cases
--   in one corner of a cell vs. spread across the cell produces the
--   same badge position. Editorial honesty: a grid-aggregation
--   badge is a regional-density signal, not a position claim.
--
-- What this migration does NOT do:
--   - Modify cases_in_bbox. (Unchanged from mig 42.) Renderer keeps
--     client-side applyImpreciseSpread for the zoom ≥ 8 point path
--     until a separate renderer-PR retires it.
--   - Drop the dormant cases_centroids_in_bbox + cases_at_coordinate
--     functions retired in mig 39, or the diagnostic
--     _diag_displayed_point_sample from mig 43. Defer to mig 45 once
--     the renderer-PR is live and parity has been re-validated.
--   - Add a new index. Bbox predicate uses
--     cases_location_point_displayed_idx (GiST, mig 43:165). At
--     the current corpus (~6.5k visible) ST_SnapToGrid + GROUP BY
--     is trivial. A functional index on
--     ST_SnapToGrid(location_point_displayed, K) would have to be
--     one-per-K in the schedule, encoding editorial cell-size into
--     schema — wrong shape. Revisit if EXPLAIN ANALYZE shows the
--     GROUP BY hot at corpus ~50k.
--   - Touch the renderer. The mobile renderer PR is a follow-up.
--     This migration ships the data shape; the hook PR ships
--     routing; the renderer PR ships the visual.
--
-- Idempotent: new function name, no prior signature to replace.
-- DROP IF EXISTS guards dev re-runs; no-op in production.

drop function if exists public.cases_grid_in_bbox(
  double precision, double precision, double precision, double precision,
  double precision, case_kind[], case_status[], integer
);

create function cases_grid_in_bbox(
  min_lng       double precision,
  min_lat       double precision,
  max_lng       double precision,
  max_lat       double precision,
  cell_size_deg double precision,
  filter_kinds  case_kind[]   default null,
  filter_status case_status[] default array['open']::case_status[],
  result_limit  integer       default 2000
)
returns table (
  cell_lat        double precision,
  cell_lng        double precision,
  case_count      integer,
  kinds_homicide  integer,
  kinds_missing   integer,
  kinds_doe       integer,
  precision_floor text,
  dominant_kind   text,
  recency_max     numeric,
  mode_city       text,
  mode_state      text
)
language plpgsql
stable
as $$
begin
  -- Defensive bound. Out-of-range cell_size_deg means a stale client
  -- is calling with a dropped or pre-deployed cell-size. Raise rather
  -- than coerce — surfaces drift loudly. Lower bound 0.05° (~5km) is
  -- below the imprecise-spread radius (0.02-0.045°) so smaller cells
  -- defeat the aggregation purpose. Upper bound 20° spans roughly
  -- half a continent per cell.
  if cell_size_deg is null or cell_size_deg < 0.05 or cell_size_deg > 20.0 then
    raise exception 'cases_grid_in_bbox: cell_size_deg % out of range [0.05, 20.0]', cell_size_deg;
  end if;

  return query
  with filtered as (
    select
      ST_SnapToGrid(c.location_point_displayed::geometry, cell_size_deg) as cell_origin,
      c.kind,
      c.location_precision,
      c.location_city,
      c.location_state,
      c.last_changed_at
    from cases c
    where c.deleted_at is null
      and c.location_point_displayed is not null
      -- 'state' precision rows have location_point at a state centroid;
      -- excluding them matches the cases_in_bbox editorial decision
      -- (mig 33 onward). They appear in list views, not on the map.
      and c.location_precision is distinct from 'state'
      and ST_Intersects(
        c.location_point_displayed,
        ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
      )
      and (filter_kinds is null or c.kind = any(filter_kinds))
      and (filter_status is null or c.status = any(filter_status))
  ),
  grouped as (
    select
      f.cell_origin,
      count(*)::integer as case_count_raw,
      count(*) filter (where f.kind in ('homicide','suspicious_death'))::integer as kh,
      count(*) filter (where f.kind = 'missing')::integer as km,
      count(*) filter (where f.kind in ('unidentified','unclaimed'))::integer as kd,
      -- Precision floor: coarsest precision in the cell. address=5,
      -- ..., unknown=1; MIN of ranks then mapped back to text. NULL
      -- precision rows safely map to rank 1 ('unknown') so the
      -- aggregate can't be poisoned by a missing-precision row. Lift
      -- from mig 34's cases_centroids_in_bbox.
      min(case f.location_precision
            when 'address' then 5
            when 'street'  then 4
            when 'city'    then 3
            when 'county'  then 2
            else 1
          end) as precision_rank,
      -- Recency: MAX over the cell. A cell pulses if ANY case in it
      -- is recent, which matches the editorial intent of "is anything
      -- new here." Mean would be wrong (one fresh + 50 stale → reads
      -- as stale, but the user's signal is the fresh case). Same
      -- stepwise CASE as mig 33 / 39's recency_alpha.
      max(case
            when f.last_changed_at is null then 0
            when extract(epoch from (now() - f.last_changed_at)) / 86400.0 <= 3 then 1.0
            when extract(epoch from (now() - f.last_changed_at)) / 86400.0 <= 10 then 0.5
            else 0
          end)::numeric as recency_max_raw,
      -- Modal locale labels. mode() returns NULL when every input is
      -- NULL, which is the correct behavior — a cell with no city
      -- info gets a NULL label rather than a fake one. Lift verbatim
      -- from mig 36.
      mode() within group (order by f.location_city)
        filter (where f.location_city is not null) as mode_city_raw,
      mode() within group (order by f.location_state)
        filter (where f.location_state is not null) as mode_state_raw
    from filtered f
    group by f.cell_origin
  )
  select
    -- Cell centroid: snapped lower-left + half-cell on each axis.
    -- Pan-stable badge position; same lat/lng for every render of
    -- the same cell regardless of within-cell case distribution.
    ST_Y(g.cell_origin) + cell_size_deg / 2.0 as cell_lat,
    ST_X(g.cell_origin) + cell_size_deg / 2.0 as cell_lng,
    g.case_count_raw as case_count,
    g.kh as kinds_homicide,
    g.km as kinds_missing,
    g.kd as kinds_doe,
    case g.precision_rank
      when 5 then 'address'
      when 4 then 'street'
      when 3 then 'city'
      when 2 then 'county'
      else 'unknown'
    end as precision_floor,
    -- Dominant-kind family @ 60% threshold. See migration header
    -- for the full 50/60/75 trade-off rationale. The ordered chain
    -- (homicide first, then missing, then doe) is purely tie-
    -- breaking; the >0.6 ratio gates exclude tied-near-50% cells
    -- regardless of order.
    case
      when g.kh > 0 and g.kh >= g.km and g.kh >= g.kd
       and g.kh::numeric / nullif(g.case_count_raw, 0) > 0.6
        then 'homicide'
      when g.km > 0 and g.km >= g.kd
       and g.km::numeric / nullif(g.case_count_raw, 0) > 0.6
        then 'missing'
      when g.kd > 0
       and g.kd::numeric / nullif(g.case_count_raw, 0) > 0.6
        then 'doe'
      else 'mixed'
    end as dominant_kind,
    g.recency_max_raw as recency_max,
    g.mode_city_raw as mode_city,
    -- cases.location_state is char(2); cast to text to match the
    -- RETURNS TABLE declaration. mode_city is already text and
    -- needs no cast.
    g.mode_state_raw::text as mode_state
  from grouped g
  order by g.case_count_raw desc, ST_X(g.cell_origin), ST_Y(g.cell_origin)
  limit result_limit;
end;
$$;

comment on function cases_grid_in_bbox(
  double precision, double precision, double precision, double precision,
  double precision, case_kind[], case_status[], integer
) is
  'Server-side tile-grid aggregation for the low-zoom map view. Snaps cases.location_point_displayed to a cell_size_deg grid via ST_SnapToGrid, returns one row per cell with count + kind composition + precision floor + max-recency + modal locale label. Client routes to this RPC when zoom < threshold (default 8 in the mobile schedule); routes to cases_in_bbox at zoom >= threshold. dominant_kind threshold is 60% (see migration header for 50/60/75 rationale).';
