# Centroid badge layer revival — implementation plan

**Date:** 2026-05-14
**Trigger:** Post-mig-53, 782 city-precision LA cases collapsed onto
the LA centroid + client jitter produced a tight donut of pins in
downtown LA. Operator decision: precision is a property of the data,
not of the viewport — render city/state precision as badges, render
address/street as individual pins, both coexist on the same map.

## Why we're reviving (and why the prior retirement isn't load-bearing)

Commit `4dbd9a5` (2026-05-09) retired the centroid badge layer with
the explicit feedback "they look horrible and clutter up the map way
too much." Two specific failure modes:

1. Every small-town city centroid carried a "2"/"3"/"7" disc.
2. Dense metros stacked 8+ overlapping badges
   (LA + Hollywood + Long Beach + Pasadena visible together at
   moderate zoom).

The new architecture dodges both:

1. **Zoom-gate the badge layer's *visibility*, not its data.** Below
   roughly zoom 11 the grid RPC (`cases_grid_in_bbox`) aggregates
   ALL cases — precision-blind — into cells. Badges turn on at
   zoom 11+ where individual cities are distinguishable on the map.
   "Every small-town with a disc" never reaches the user; the grid
   layer carries the load at continental view.
2. **One badge per (city, state) keyed coalescing is still distinct
   per-city.** A dense metro WILL still show separate badges for
   LA / Hollywood / Long Beach. That's editorially correct — those
   are separate cities in the source data. If they should coalesce
   into a single "Greater LA" pile, that's an upstream data-
   normalization decision, not a renderer fix.

## The architectural rule

| Precision | Rendering |
|---|---|
| `address`, `street` | Individual pin at the real coordinate, all zooms |
| `city`, `county` | Badge at city centroid, zoom ≥ 11 |
| `state` | Badge at state centroid, zoom ≥ 11 |
| (any) | Grid cell at zoom < 11 (cases_grid_in_bbox handles this) |

Precision is the routing key. Zoom decides which **layers** are
visible, not what a case's identity is.

## Server changes (this PR — mig 54)

`cases_centroids_in_bbox` is the only server change in this PR.
Migration 54:

- Drops the `c.location_precision is distinct from 'state'` filter
  so state-precision rows flow through as their own aggregate rows
  (group by `c.location_point` already coalesces them at the state
  centroid, same way city-precision coalesces at city centroids).
- Extends the `precision_floor` CASE expression to surface `'state'`
  as its own value (was previously collapsed into `'unknown'`).
- Return-table shape unchanged → `CREATE OR REPLACE` works in place.

Untouched on the server in this PR:
- `cases_at_coordinate` (mig 38) — still keyed on raw `location_point`,
  still correct for tap-drill round-trip.
- `cases_in_bbox` — still returns all precisions. The pin layer will
  filter client-side in PR 2 (acceptable: address/street precision is
  a small fraction of LIMIT 500 in any metro bbox; we can revisit a
  server-side `precision_floor` param if pin-layer sampling becomes a
  visible problem).

## Mobile changes (PR 2 — separate)

Re-vivification of ~800 lines retired in `4dbd9a5`, plus net-new UX:

1. **Type re-add**: `CaseCentroidRow` (extended to include
   `precision_floor: 'state' | 'city' | ...`).
2. **Hook re-add**: `useCentroidsInBbox`, `useCasesAtCoordinate`
   (revived from git history, retyped against current schema).
3. **`LeafletCentroid` re-add** in `leaflet-map.tsx` with new
   divIcon HTML/CSS for the badge visual.
4. **`CentroidCasesSheet` component** — new sheet design:
   - 70% snap point (same as the retired version + the current
     `coincident-cases-sheet.tsx`).
   - Header: serif locale label ("Los Angeles, CA" / "Texas" / count
     fallback), mono count subtitle, close button.
   - **Category filter** — homicide / missing / Doe row, preserving
     the brown / amber / cream tri-color in the row icons.
   - **Sort** — recency / name / kind (sortable column header style
     or a small mono dropdown).
   - Tap on a row → `router.push('/case/[slug]')` (closes the sheet).
5. **MapScreen rewire**:
   - Call `cases_centroids_in_bbox` alongside `cases_in_bbox`.
   - Render the centroid layer ONLY when `zoom >= BADGE_MIN_ZOOM`
     (probably 11; tune in PR).
   - Filter `cases_in_bbox` rows by precision (address/street only)
     before passing to the pin layer.
   - On badge tap: open `CentroidCasesSheet` — do NOT re-center or
     re-zoom the map (operator decision: scan multiple cities in
     sequence without losing context).

## Badge visual specification

Per the operator brief (2026-05-14):

> "Cream outlined ring with the PhotoFrame corner-bracket motif would
> stay on-brand and read as distinct from the pin tri-color. Numeral
> in Newsreader since it's data-as-evidence, not UI chrome."

Concrete:

- **Shape**: Square frame with cream-colored outline (~1px stroke,
  `tokens.color.evidence.chrome`). Matches the `CornerBrackets`
  component in `mobile/components/cf/photo-frame.tsx` (lines ~261–
  295) — same `BRACKET_ARM` length, same `evidence.chrome` stroke.
- **Background**: `tokens.color.bg.elev1` at ~85% opacity. Dimmed
  enough to read as transparent overlay; opaque enough to keep the
  numeral legible against the OSM tile layer.
- **Numeral**: Newsreader, weight 500, size ~16-20 (scales with
  count via log2 — small for "2", larger for "1,340"). `tokens.color.
  text.primary`. The number is the entity, not a UI label.
- **Optional locale label**: Below the bracket frame, mono 9px in
  `tokens.color.text.secondary`. Same "Belen, NM" pill-style the
  retired badge used, but with the cream background instead of
  amber.
- **Hover/tap state**: Slight scale (0.96) on press, same haptic as
  marker tap.
- **Size**: `Math.max(32, Math.min(72, 28 + Math.log2(case_count) * 6))`.
  A count of 2 → ~34px; count of 200 → ~74px; clamped 32-72.

Size + numeral typeface together distinguish the new badge from:
- The amber pin tri-color (homicide brown / missing amber / Doe
  cream) — solid fills vs the bracket-outline.
- The pulse-ring on fresh cases — bracket is square, pulse is
  circular.
- The future grid-cell renderer — different geometric primitive.

## Open question (operator)

> "default to coalescing by city, but it's a real editorial call"

The current `cases_centroids_in_bbox` groups by `location_point`. For
LA case-data the LA centroid is one coord and Hollywood is a different
coord, so they render as separate badges. The user noted this in the
prior retirement feedback ("LA / Hollywood / Long Beach / Pasadena
stacked"). Coalescing by `(city, state)` would still produce separate
badges for those cities (they have different `location_city` text).

Coalescing them into "Greater LA" requires upstream data normalization
(e.g., a `location_metro` column or a city → metro mapping table).
Out of scope for this PR. Land the badge layer as-is and decide later
whether the editorial benefit of coalescing is worth the data work.

## Risk + rollback

Mig 54 is `CREATE OR REPLACE` with same shape. Revert path: re-apply
`migrations/35_pin_system_rebuild_threshold_one.sql` to restore the
mig 35 definition (the latest pre-mig-54 version). State-precision
aggregates stop being returned, callers that don't expect them
continue to work.

PR 2 (client) ships behind no feature flag — once the OTA reaches
devices, the badge layer is live. Rollback path: re-OTA the prior
bundle (commit `318c50d` was the last live mobile build per session
history).
