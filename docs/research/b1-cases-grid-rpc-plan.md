# B1 — `cases_grid_in_bbox` server-side tile-grid aggregation

**Status:** plan, drafting in progress.
**Migration slots:** 43 (generated column), 44 (RPC). Hook PR sits on top.
**Source thread:** post-mig-42 design discussion, 2026-05-10.

This is the design doc for the B1 follow-up to mig 42. It exists to
record the architectural decisions, the alternatives considered, and
the editorial constraints — so the implementer (current or future)
isn't re-deriving the same trade-offs from `git log` later.

## Problem

Mig 42 fixed the state-skew at the `cases_in_bbox` 500-row LIMIT cap
(ORDER BY id-stable instead of last_changed_at). It did not fix the
underlying cardinality: 6,547 visible cases at nationwide zoom, with
a current client `limit: 6000` ([mobile/app/(tabs)/index.tsx:333](../../mobile/app/(tabs)/index.tsx))
that side-steps the cap by parsing all rows client-side and letting
leaflet.markercluster aggregate. At growth pace (corpus heading
toward 50k) that fan-in doesn't scale — every nationwide-zoom render
parses thousands of rows that collapse to ~25 cluster discs.

B1's job: aggregate at the **server** below a zoom threshold.

## Solution shape

A new RPC `cases_grid_in_bbox(bbox, cell_size_deg, ...)` that:
1. Filters to `deleted_at IS NULL AND location_point IS NOT NULL AND location_precision IS DISTINCT FROM 'state'` and the bbox.
2. Snaps each case's *displayed* point (post-jitter) to a regular grid via `ST_SnapToGrid`.
3. Aggregates cases per cell: count, kind family counts, precision floor, recency max, dominant-kind tag, modal city/state.
4. Returns one row per cell.

The mobile client routes between `cases_grid_in_bbox` (zoom < 8) and
`cases_in_bbox` (zoom ≥ 8) via a `Math.floor(map.getZoom()) < 8`
check on `zoomend`. Below threshold: server returns ~tens of cells.
Above threshold: server returns individual rows, markercluster
aggregates client-side as today.

## Why this isn't a revival of the centroid-badge layer (mig 39)

Mig 39's failure mode was specifically per-centroid badges
**visually overlapping** when multiple city centroids fell within
rendering distance — the LA / Hollywood / Long Beach pile-up. The
badges were placed at point-coincident coordinates, and points-in-
the-same-screen-area produced overlapping discs.

Tile-grid aggregation via `ST_SnapToGrid` produces **disjoint cells
by construction**: a case maps to exactly one cell, and cells
partition the plane on a regular grid. Two cell badges cannot
overlap visually — they cannot occupy the same screen region. The
specific failure mode mig 39 hit is structurally impossible in B1,
not just unlikely.

This framing belongs in the migration header verbatim — the durable
version of "different problem class."

---

## Mig 43 — generated column `location_point_displayed`

### Decision: aggregate post-jitter

The renderer's [applyImpreciseSpread](../../mobile/app/(tabs)/index.tsx)
deterministically jitters city/county/null/unknown precision rows by
2–5km around the city centroid so they spread visibly instead of
stacking invisibly. If we snap **raw** `location_point` to the grid,
a city's 28 imprecise cases all land in one cell (the cell containing
the city centroid) — reintroducing the LA-style pile-up at cell
level, just one zoom layer up.

If we snap the **post-jitter** displayed point, the 28 cases
distribute across ~2-3 adjacent cells (jitter pushes some across
cell boundaries). The cell-badge spread roughly matches the pin
spread you'd see at high zoom.

Implementation: a STORED generated column `location_point_displayed`
on `cases`, computed from the existing `applyImpreciseSpread` shape:

- For `location_precision IN ('address', 'street')`: return
  `location_point` unchanged.
- Otherwise: deterministic ~2–5km jitter via FNV-1a hash on `slug`.

### The polynomial — constrained-mirror, not free-design

[mobile/app/(tabs)/index.tsx:86-135](../../mobile/app/(tabs)/index.tsx)
defines the existing client-side jitter:

```ts
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

function applyImpreciseSpread(slug, lat, lng, precision) {
  if (precision === 'address' || precision === 'street') return { lat, lng };
  const h = fnv1a(slug);
  const angle = ((h & 0xffff) / 0xffff) * Math.PI * 2;
  const radius = 0.02 + ((h >>> 16) / 0xffff) * 0.025;
  return {
    lat: lat + Math.cos(angle) * radius,
    lng: lng + Math.sin(angle) * radius,
  };
}
```

The hash multiplier-as-shift-sum expands to `h * 16777619` (the
standard FNV-1a 32-bit prime, `0x01000193`), then masked to uint32.

**Byte-identity is required** — if the polynomial diverges, cases
will appear to jump 1–3km when the user crosses zoom 8 (server-
jittered cell centers below 8, client-jittered points above 8 — same
case, different displayed coord, visible jump). The kind of bug
that's hard to attribute and erodes trust.

The Postgres implementation:

```sql
create or replace function fnv1a_32(s text)
returns bigint
language sql
immutable
as $$
  with bytes as (
    select generate_subscripts(string_to_array(s, null), 1) as i,
           ascii(unnest(string_to_array(s, null))) as b
  )
  -- iterative XOR + multiply via recursive CTE; fold to bigint with
  -- a 32-bit mask each step.
  ...
$$;
```

The SQL implementation needs to be exact. See the parity script
([scripts/diagnose-jitter-parity.ts](../../scripts/diagnose-jitter-parity.ts))
for the byte-identity test harness.

**ASCII assumption:** `charCodeAt` returns UTF-16 code units; for
ASCII slugs (the entire current corpus), this equals UTF-8 byte
values. The parity script flags any non-ASCII slug as a divergence
risk so the assumption is checked, not assumed.

### Generated-column shape (sketch — exact body in mig 43)

```sql
alter table cases
  add column location_point_displayed geography(Point, 4326)
  generated always as (
    case
      when location_point is null then null
      when location_precision in ('address', 'street') then location_point
      else
        ST_SetSRID(
          ST_MakePoint(
            ST_X(location_point::geometry) + sin(<angle>) * <radius>,
            ST_Y(location_point::geometry) + cos(<angle>) * <radius>
          ),
          4326
        )::geography
    end
  ) stored;

create index cases_location_point_displayed_idx
  on cases using gist(location_point_displayed);
```

Where `<angle>` and `<radius>` are computed from
`fnv1a_32(slug)` mirroring the TS polynomial.

(Note on cos/sin convention: the TS uses
`lat + cos*r, lng + sin*r`. The PG version must match — cos goes on
lat, sin on lng. Easy to swap by accident; parity script catches it.)

### Why STORED, not VIRTUAL

The column needs a GiST index for the `cases_grid_in_bbox` bbox
query. Postgres only allows indexes on STORED generated columns.
VIRTUAL would force the snap-to-grid expression to recompute the
displayed point on every read — same cost as inline-jitter-in-CTE,
defeating the DRY argument.

### Operational notes

- ALTER on a 7,892-row table with a STORED generated column
  triggers a full rewrite. Fast in absolute terms, but it IS a lock
  event. Schedule for a quiet ingest window.
- Active scrapers (scrape-cli) should be paused during the apply.
  CLAUDE.md notes scrape-cli writes are auto-mode actions; pause
  manually before applying mig 43.
- Backfill happens automatically on ALTER. Post-apply verification
  is the parity script (see below).
- Cases written after mig 43 lands inherit the column automatically
  on INSERT (generated column auto-populates).

### What mig 43 does NOT do

- Modify `cases_in_bbox`. Renderer keeps client-side
  `applyImpreciseSpread` until the renderer-PR retires it. Server
  returning the un-jittered point + client jittering on top remains
  the high-zoom path; no double-jitter risk.
- Drop the dormant `cases_centroids_in_bbox` /
  `cases_at_coordinate` RPCs — separate cleanup mig.
- Add the new RPC. Mig 44.

---

## Mig 44 — `cases_grid_in_bbox` RPC

### Signature

```sql
cases_grid_in_bbox(
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
```

### Body

Structurally identical to `cases_centroids_in_bbox` (mig 33-36) with
two changes:
1. Group by `ST_SnapToGrid(c.location_point_displayed::geometry, cell_size_deg)` instead of `c.location_point`.
2. Add `dominant_kind` derivation from kind counters.

Lifted verbatim from the dormant RPCs:
- precision_floor MIN-of-rank (mig 34)
- kind family counters (mig 33)
- MODE() locale labels (mig 36)
- ST_Intersects bbox predicate
- recency CASE expression (returned as `recency_max` via MAX over the cell)

### Cell coordinate semantics

Cell **centroid** (snapped lower-left + half-cell on each axis), not
SW corner, not COG-of-cases. Pan-stable: the badge sits at the
cell's geometric center regardless of how cases are distributed
within the cell. Editorial honesty: a grid-aggregation badge is a
regional-density signal, not a position claim.

### `dominant_kind` semantics

≥60% threshold:

```sql
case
  when kh > 0 and kh >= km and kh >= kd
   and kh::numeric / nullif(case_count_raw, 0) > 0.6 then 'homicide'
  when km > 0 and km >= kd
   and km::numeric / nullif(case_count_raw, 0) > 0.6 then 'missing'
  when kd > 0
   and kd::numeric / nullif(case_count_raw, 0) > 0.6 then 'doe'
  else 'mixed'
end
```

60% is a strawman — flag for editorial review before mig 44 lands.
50% (any plurality) reads "mostly X" too aggressively; 75% leaves
most mixed-region cells reading neutral. 60% is the strawman that
matches the editorial sense of "the cell is mostly one thing."

### Defensive bounds

`cell_size_deg` is clamped to `[0.05, 20.0]` server-side. Out-of-
range raises (`raise exception`). Surfaces stale clients calling
with a dropped or pre-deployed cell-size loudly, rather than
silently coercing to a wrong rendering.

### `recency_max` is wire-shape only in v1

Returned but unused. Renderer-PR or v1.1 may surface it as cell
saturation (recent-active cells slightly more saturated). Not
worth pulling into the v1 badge.

### What mig 44 does NOT do

- No new index. Bbox predicate uses
  `cases_location_point_displayed_idx` (GiST, mig 43). `ST_SnapToGrid`
  + `GROUP BY` over ≤6,547 rows is trivial. A functional index on
  `ST_SnapToGrid(location_point_displayed, K)` would need one-per-K
  in the schedule, encoding editorial cell-size schedule into
  schema — wrong shape. Revisit if EXPLAIN ANALYZE shows hot path
  at corpus ~50k.

---

## Hook + client-integration PR

### Schedule

| Leaflet zoom (floor) | Mode | Cell size (deg) | Rationale |
| --- | --- | --- | --- |
| ≤ 4 | grid | 4.0 | CONUS in ~6×8 cells |
| 5 | grid | 2.0 | Multi-state |
| 6 | grid | 1.0 | State cluster |
| 7 | grid | 0.5 | Single state |
| ≥ 8 | bbox | — | Metro and below; markercluster takes over |

Strawman — editorial review before commit.

### Hook layer

[mobile/lib/hooks/use-cases-in-bbox.ts](../../mobile/lib/hooks/use-cases-in-bbox.ts)
gains a sibling `useCellsGridInBbox` plus an `aggregationForZoom`
helper. The home screen picks which hook fires via `enabled` gating;
both run as React Query–style hooks so the inactive one keeps last-
known data while the active one fetches.

### LeafletMap — the actually-Leaflet integration shape

The map is **Leaflet 1.9 in a WebView**, not Mapbox GL. Leaflet has
no built-in per-layer zoom visibility; the toggle is manual on
`zoomend`:

```ts
// WebView side, pseudocode for the consumer wiring
const POINT_ZOOM_THRESHOLD = 8;

map.on('zoomend', async () => {
  const zoom = Math.floor(map.getZoom());
  const useGrid = zoom < POINT_ZOOM_THRESHOLD;

  if (useGrid) {
    markerClusterGroup.clearLayers();
    aggregationLayer.setData(/* cells from useCellsGridInBbox */);
  } else {
    aggregationLayer.clearLayers();
    markerClusterGroup.addLayers(/* markers from useCasesInBbox */);
  }
});
```

leaflet.markercluster stays in play **only at zoom ≥ 8** — exactly
the regime where bbox-result-size rarely exceeds 500. So:

- Below zoom 8: server aggregates via `cases_grid_in_bbox`. Client
  draws cell badges. Markercluster off.
- At zoom ≥ 8: server returns individual rows via `cases_in_bbox`.
  Markercluster does within-screen aggregation. Cell badges off.

`onRegionChange` payload gains `zoom` (currently captured into a
module-level `lastViewedCenter` but not forwarded — small additive
change).

### Render-PR deferral

The actual visual (cell badge styling, tap-to-zoom, sheet-list
behavior in grid mode) is a follow-up PR. The hook PR ships the
data plumbing, with `cells` computed-but-rendered-as-nothing on the
home screen until the renderer-PR ships. Cleanest interface
boundary: SQL + hook landed and verified live, renderer change
follows in its own beat.

---

## Sequencing

The user-confirmed order:

1. **Read `applyImpreciseSpread`** — done; constrained-mirror
   confirmed.
2. **Write [scripts/diagnose-jitter-parity.ts](../../scripts/diagnose-jitter-parity.ts)** —
   parity harness that pulls a sample of imprecise cases, computes
   client-side `applyImpreciseSpread` output, compares to
   server-side `location_point_displayed`. Asserts byte-identity to
   ~6 decimal places. Flags non-ASCII slugs.
3. **Draft mig 43** — generated column with PL/pgSQL FNV-1a
   matching the TS impl byte-for-byte.
4. **Apply mig 43** (user-confirmed action). Pause scrapers first.
5. **Run parity script.** Pass = polynomial is correct, proceed.
   Fail = revert mig 43 cleanly, fix polynomial, re-apply.
6. **Draft mig 44** — RPC consuming `location_point_displayed`.
7. **Apply mig 44** (user-confirmed).
8. **Hook + LeafletMap PR.**
9. **Renderer PR** (separate beat) — cell-badge visual,
   cell-tap-zoom, grid-mode sheet behavior.
10. **Mig 45 cleanup** (separate beat) — drop
    `cases_centroids_in_bbox` and `cases_at_coordinate` once the
    renderer-PR is live and no client references them.

Steps 1-3 + 6-8 are local code work. Steps 4, 5, 7 are
production-database actions per CLAUDE.md auto-mode rules — explicit
user confirmation required for each.

---

## Architectural decisions flagged for review

These are explicit decisions with sane defaults but real editorial
weight. Worth a 30-second pass before each lands.

1. **60% threshold for `dominant_kind`.** Could be 50% / 75%.
2. **Cell-size schedule.** Strawman 4.0 / 2.0 / 1.0 / 0.5 deg per
   zoom step.
3. **Threshold zoom 8 for grid → point switch.** Could be 7 or 9.
4. **Cell coordinate = centroid, not COG-of-cases.** Pan-stability
   vs. data-following. Recommend centroid; flag for confirmation.
5. **`recency_max` returned but unused in v1.** Defer the badge
   styling to v1.1 / renderer PR.
6. **Mig 45 cleanup ordering.** Defer to after renderer PR ships
   (mig 39 cited OTA-timing; same logic applies to the dormant
   RPCs).
7. **Branch / PR shape.** `feat/cases-grid-rpc` covering migs 43+44
   + hook + LeafletMap regionChange shape change. Renderer PR is a
   separate `feat/map-grid-renderer` branch.

---

## Reference — discarded alternatives

### Pre-jitter aggregation
Snap raw `location_point` to grid. Cleanest data semantics ("this
cell holds the cases at these source-supplied coords"), but
reintroduces the LA-style centroid pile-up at cell level. Mig 39
was reacting against exactly this anti-pattern at point-coincident
scale; B1 would reproduce it at cell scale. Rejected.

### Hybrid (jitter address-precision into cells, snap city/county to actual locality)
Overengineered. The point is to stop lying about position; running
the editorial-honesty rule per-row at the SQL layer multiplies
complexity for no user-visible win. Rejected.

### Free-design FNV polynomial
Considered before reading the existing code. Rejected the moment
`applyImpreciseSpread` was confirmed deterministic — the constraint
is "be byte-identical to the existing client jitter," not "be
clean." Future renderer-PR cleanup (when client-side
`applyImpreciseSpread` retires and the server is the only jitterer)
can revisit if needed.

### Server-derived cell-size schedule
The function reads `zoom` from a request param and looks up
`cell_size` from a hardcoded server schedule. Rejected: couples
server function to client UX choices, makes schedule-tuning a SQL
migration each time. Client-passed `cell_size_deg` is the right
shape; defensive clamp catches the stale-client case.

### Single-discriminated-union return shape (Option A from earlier)
One hook returning either points or cells based on the active mode.
Rejected: bottom-sheet list, chip counters, coincident-tap-drill,
and the `coincidentCases` lat/lng filter at
[index.tsx:362-374](../../mobile/app/(tabs)/index.tsx) all break
because cells aren't points. Cleaner separation: two hooks, one
orchestrator switches between them on zoom. Each downstream
consumer stays strict-typed.

### Mapbox GL `cluster: true` on the source
Considered before the explore agent confirmed the actual stack is
Leaflet + leaflet.markercluster. N/A for this codebase.
