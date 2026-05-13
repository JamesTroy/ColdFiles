# Map-RPC displayed-point audit (mig 50 + 51)

**Date:** 2026-05-12
**Scope:** Audit of every map-adjacent RPC for the
`location_point` vs `location_point_displayed` correctness boundary,
following the cases_in_bbox stacking bug handoff.

## The pattern

`location_point` is the raw geocoder output. For city-precision cases
this is the city geographic centroid (e.g. 200+ LA city-precision cases
all sitting on `34.05, -118.24`).

`location_point_displayed` is a **generated column** wrapping
`cases_displayed_point(location_point, location_precision, slug)`. It
applies deterministic FNV-1a jitter on the slug → angle + radius
(~2.2-5.0km at mid-lat) for coarse precision tiers, passes
`address`/`street` precision through unchanged.

Read RPCs that power user-visible map pins must project from the
**displayed** column to fan out city-precision rows. RPCs that
round-trip a centroid grouping (the badge-tap-drill family) must
stay on the **raw** column.

## RPC inventory + verdict

| RPC | Defined in | Status | Fix |
|---|---|---|---|
| `cases_in_bbox` | mig 42 | **Bug — fixed** | Migration 50 |
| `cases_in_polygon` | mig 33 | Bug + missing state-precision filter | Migration 51 |
| `cases_near_case` | mig 34 | Bug + missing state-precision filter | Migration 51 |
| `cases_within_radius` | mig 02 | Bug + missing state-precision filter | Migration 51 |
| `cases_at_coordinate` | mig 38 | **Correct as-is** — intentional raw key | — |
| `cases_centroids_in_bbox` | mig 33 | Correct (raw, by design) | — |
| `cases_grid_in_bbox` | mig 44 | Already on displayed | — |

### Why `cases_at_coordinate` stays raw

`cases_at_coordinate` is the tap-drill handler for centroid badges:
when a user taps a "211" badge at the LA centroid, this RPC returns
the 211 cases at that exact coord. The grouping that produced the
badge (`cases_centroids_in_bbox` `group by location_point`) is keyed
on raw coords, so the tap-drill must match raw coords too — otherwise
some cases at the centroid would be missing from the side-list when
opened from the badge tap.

The badge layer is being retired from the client (per the recent OTA
`retire centroid badge layer` commit), so this RPC may end up with no
callers. Harmless to leave as-is; touching it would risk breaking any
remaining caller without upside.

### State-precision filter posture

mig 33+ established that state-precision rows (where only the state is
known, raw point = state geographic centroid) should NOT appear on
the map. The filter `location_precision is distinct from 'state'` was
present on `cases_in_bbox` and the centroid RPCs but **missing** from
`cases_in_polygon`, `cases_near_case`, and `cases_within_radius`.
Migration 51 adds it to all three for consistency.

## Non-bug: 3-decimal coord truncation

The handoff doc listed "3-decimal coordinate truncation in scraper"
as a backlog data-quality issue. Investigation found this is a
**deliberate privacy decision**, not a bug:

- `supabase/functions/_shared/normalize.ts:snapToBlock` (line 218)
  snaps all incoming lat/lng to ~111m granularity (3 decimals).
  Docstring: *"Snap lat/lng to ~100m granularity (3 decimals ≈ 111m
  at equator) so we never pinpoint a private residence. Apply before
  storing location_point."*
- `supabase/functions/reverse-geocode/index.ts:99-100` uses 3-decimal
  rounding only as a cache-key collapse for nearby zones — doesn't
  affect stored coords.

The "every precision tier returns max_decimals=3" diagnostic from the
handoff is the privacy posture working as designed, applied uniformly
before storage. Removing the truncation would expose street-level
precision on real addresses (~10cm at 6 decimals), violating the
documented posture.

**Do not act on this without an explicit privacy-policy conversation.**

## Out of scope (separate decision)

The `notify_watch_zone_hit` trigger (mig 19) tests whether a newly-
inserted/updated case's `location_point` falls inside any active user
watch zone. Switching this trigger to use `location_point_displayed`
would change which cases trigger alerts — a real product decision on
the alerts moat (`feedback_alerts_are_the_moat`). Not in mig 50 or 51.

Worth raising explicitly: should the alert-side polygon-membership
test match the visible-map polygon-membership test? UI consistency
says yes; alert-stability says think before flipping. Operator call.
