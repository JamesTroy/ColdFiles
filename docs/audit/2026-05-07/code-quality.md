# Code Quality Audit — ColdFiles Mobile (2026-05-07)

Scope: `/Users/jtroy/Desktop/ColdFiles/mobile/` only (Android Play app). Excludes `app/` (Next.js web), `supabase/`, `scripts/`, `sources/`.

## Summary

Overall health is **strong** — the codebase has been disciplined about its load-bearing rules. `npx tsc --noEmit` passes clean across all 105 ts/tsx files (with `strict: true`); `npx expo lint` returns 1 error and 4 warnings, none of which are hooks-related; the project's flagship "hooks before early returns" rule is **not violated anywhere**, and several files (case detail, watch-zone, notifications) carry explicit comments self-documenting the rule. The mechanical safety net (`react-hooks/rules-of-hooks` + `exhaustive-deps`) is enabled transitively via `eslint-config-expo` → `plugin:react-hooks/recommended` (verified at `node_modules/eslint-config-expo/utils/react.js:4`), so future drift is gated.

Top three risks, ranked:
1. Three orphan map components (`map-canvas.tsx`, `watch-zone-map.tsx`, `peek-sheet.tsx`, ~306 LOC combined) with zero importers — actual dead code, not deliberate stubs.
2. `displayName(row)` is reimplemented locally in three list/zone surfaces with weaker Doe-case fallbacks than the canonical `lib/format.ts:displayName` — inconsistent victim-name rendering between the case-detail screen and the saved/zone/case-row surfaces.
3. `alphaToDays()` is duplicated verbatim in `app/(tabs)/index.tsx` and `app/(tabs)/list.tsx`. Low-stakes today, but the pattern repeats: kind-bucketing, unit conversions (cm↔in, kg↔lb, mi↔m), and haversine logic are scattered.

## Critical (must-fix before next AAB)

ZERO issues in this category. The code that ships as the next AAB has no hooks-rule violations, no `tsc` errors, no production `console.log` calls, no `@ts-ignore`/`@ts-expect-error`, no production `any`, and no compile-blocking lint errors.

The single `expo lint` error is cosmetic (an unescaped apostrophe) and does not block a release build.

## Important (next sprint)

- **[delete-account.tsx:139](mobile/app/delete-account.tsx)** — `react/no-unescaped-entities` error. A literal `'` inside JSX should be `&apos;` or `&#39;`. This is the only true lint error; trivial fix but currently failing CI-style lint.

- **Three orphan components, never imported anywhere:**
  - **[components/cf/map-canvas.tsx](mobile/components/cf/map-canvas.tsx)** (122 LOC) — referenced only in doc comments and `00_DECISIONS.md` lore. The SVG MapCanvas was the closed-testing fallback; LeafletMap shipped instead and Canvas was never wired. Delete or document why it's load-bearing.
  - **[components/cf/watch-zone-map.tsx](mobile/components/cf/watch-zone-map.tsx)** (43 LOC) — pure stub for "future MapLibre native" that throws on render. `MapsView` (its sibling stub at `components/cf/maps-view.tsx`) is at least branched-into via `isNativeMapAvailable()`, so the type contract still binds; `WatchZoneMap` has no consumer at all. Either delete or have `app/zone/[id].tsx`/`app/watch-zone.tsx` import the type-only contract from it the way they do for `maps-view`.
  - **[components/cf/peek-sheet.tsx](mobile/components/cf/peek-sheet.tsx)** (141 LOC) — the inline peek behavior on the map screen replaced this component (see `app/(tabs)/index.tsx:151` comment "PeekSheet (when a pin was selected) is now replaced by the persistent sheet"). The file was never deleted post-refactor. Code is reachable if anyone imports `{ PeekSheet }` but currently dead.

- **[app/case/[slug].tsx:40](mobile/app/case/[slug].tsx)** — `formatDateMonthDay` is imported but unused (lint warning). Dead import after a render refactor.

- **[app/sign-in.tsx:17](mobile/app/sign-in.tsx)** — `ActivityIndicator` is imported but unused (lint warning).

- **[app/(tabs)/index.tsx:161](mobile/app/(tabs)/index.tsx)** — `handleClearSelection` callback is created via `useCallback` but never wired to anything. Either dead code from a previous draft or a hookup was lost in a merge. Confirm the X-to-dismiss path on the peek sheet still works without it.

- **`displayName` semantic drift across four files** — canonical implementation at **[lib/format.ts:99](mobile/lib/format.ts)** generates "Unidentified Female, est. 25–35" for Doe cases (uses sex + age range). Local re-implementations strip the demographic detail:
  - **[app/(tabs)/saved.tsx:570](mobile/app/(tabs)/saved.tsx)** — returns "Unidentified" only.
  - **[app/zone/[id].tsx:546](mobile/app/zone/[id].tsx)** — returns "Unidentified" only.
  - **[components/cf/case-row.tsx:187](mobile/components/cf/case-row.tsx)** — returns "Unidentified person" only.
  
  Result: a Doe case shows as "Unidentified Female, est. 25–35" on case-detail but "Unidentified" on saved/zone-detail/list-row. Lift the canonical `displayName` to accept the narrower row types (`CaseRowMapBbox`/`CaseRowMapNear` already carry `kind`, `victim_name`, `victim_sex`, `victim_age_min`, `victim_age_max`) so the demographic fallback is consistent. The CaseRow primitive in particular drives both bottom-sheet and list-tab — fixing it once flows everywhere.

- **`alphaToDays` duplication** — defined at **[app/(tabs)/index.tsx:64](mobile/app/(tabs)/index.tsx)** and **[app/(tabs)/list.tsx:93](mobile/app/(tabs)/list.tsx)**. The map version returns `null` for low alphas, the list version handles `alpha == null` upfront. Same thresholds (0.99, 0.49) and the index.tsx version is also embedded inline inside `daysFor` at line 164–168. Extract to `lib/format.ts` (or a new `lib/recency.ts` if you want recency-only utilities) since the comment "Mirrors the map's stepwise recency_alpha → day-count translation" is exactly the smell.

- **Unit-conversion magic numbers scattered** — `cm/2.54` and `kg*2.20462` in **[app/case/[slug].tsx:734-748](mobile/app/case/[slug].tsx)**, `1609.344` (mi→m) in **[app/watch-zone.tsx:56](mobile/app/watch-zone.tsx)**, `R = 3958.7613` (earth radius mi) in **[app/(tabs)/saved.tsx:584](mobile/app/(tabs)/saved.tsx)**. Each duplicates a standard unit constant; they're correct values but should live in `lib/format.ts` or a dedicated `lib/units.ts` so a future calculation in another screen doesn't re-derive (and risk re-typoing) the constant.

- **Haversine + toRad re-derived twice** — `haversineKm` at **[components/cf/leaflet-map.tsx:1197](mobile/components/cf/leaflet-map.tsx)** and an inline shoelace `toRad` at **[app/(tabs)/saved.tsx:597](mobile/app/(tabs)/saved.tsx)**. Different math (haversine vs spherical-shoelace), but `toRad` is identical. Lift `toRad` and `haversineKm` to `lib/geo.ts`.

- **Polygon helpers inline in screens** — `circleToPolygon` at **[app/watch-zone.tsx:712](mobile/app/watch-zone.tsx)**, `geojsonToVertices` and `verticesToWkt` at **[app/zone/[id].tsx:558-571](mobile/app/zone/[id].tsx)**. These will be reused once polygon-mode (v1.0.2) lands in the editor; pre-extracting now to `lib/zone-geometry.ts` keeps polygon mode's diff to actual UI work, not "where do these helpers live."

## Minor / nice-to-have

- **[components/cf/leaflet-map.tsx](mobile/components/cf/leaflet-map.tsx)** — at 1,211 lines, this file is bigger than every other in the app. Most of the bulk (lines ~370–1196) is the embedded HTML/JS template string for the Leaflet WebView, which is genuinely one logical unit (DOM, CSS, JS, marker generation, message protocol all need to stay co-located for the WebView contract to be readable). Splitting wouldn't improve it. Worth adding a `// MARK: HTML generation` and `// MARK: native side` divider to make the structure scannable; otherwise leave it.

- **[lib/sample-data.ts](mobile/lib/sample-data.ts)** — 1,412 lines of seed objects. Big, but it's the largest file by deliberate design (closed-testing fallback when `EXPO_PUBLIC_SUPABASE_URL` is unset). No action needed — splitting by source/kind would just spread the same data across more files.

- **[app/case/[slug].tsx](mobile/app/case/[slug].tsx)** at 1,122 lines — the per-section sub-components (`ReceiptBlock`, `LastSeenBlock`, `PhysicalDescriptionBlock`, `CaseLocationPreview`, `ColdTimeGravity`, `AnniversaryNote`, `AliasesRow`, `FactLine`) are colocated with the screen. Each is small and case-detail-specific. Splitting into `components/cf/case-detail/*.tsx` would marginally improve scannability; the trade is more imports + indirection. Defer until one of these sub-blocks is needed elsewhere — none currently is.

- **[components/cf/cases-near-case-section.tsx:291](mobile/components/cf/cases-near-case-section.tsx)** — single `Array<T>` form instead of `T[]` (lint warning, auto-fixable with `--fix`).

- **`as unknown as` casts in Supabase result handlers** — appears at:
  - **[lib/hooks/use-case-detail.ts:116-128](mobile/lib/hooks/use-case-detail.ts)** (3 sites)
  - **[lib/hooks/use-case-events.ts:68](mobile/lib/hooks/use-case-events.ts)**
  - **[app/(tabs)/index.tsx:101](mobile/app/(tabs)/index.tsx)**
  - **[components/cf/map-bottom-sheet.tsx:184](mobile/components/cf/map-bottom-sheet.tsx)**
  - **[lib/diagnostics.ts:55](mobile/lib/diagnostics.ts)**
  
  These are mostly `Supabase row → CaseRowFull/CaseSourceRow/CaseMediaRow` shape assertions where the `select(...)` projection encodes more structure than the generic `PostgrestResponse` type knows. The proper fix is generated DB types via `supabase gen types typescript`, then the join projections become proper return types. Until then the cast pattern is the working idiom — flag rather than fix.

- **`useEffect` exhaustive-deps disables, all annotated** — 9 sites total (5 in `leaflet-map.tsx`, 1 each in `watch-zone.tsx` ×2, `zone/[id].tsx`, `draw-zone-map.tsx`, `case-location-map.tsx`, `leaflet-watch-zone.tsx`). Each has a one-line comment explaining the WebView one-shot HTML pattern. Pattern is consistent and intentional. No action.

- **Test coverage in `lib/__tests__/`** — only `format.test.ts` and `period-bucket.test.ts`. The recency / haversine / polygon helpers don't have tests. If those move to shared modules, add coverage at the same time.

- **`comment hygiene`** — unusually good. Most comments explain WHY (e.g. the 30+ line block at **[app/(tabs)/index.tsx:148-156](mobile/app/(tabs)/index.tsx)** explaining why peek + persistent sheets aren't both rendered, the **[app/case/[slug].tsx:69-74](mobile/app/case/[slug].tsx)** comment self-documenting the hooks-before-return rule). No "increment counter" / "set state" WHAT-restating comments found in the spot-checked surfaces.

- **`console.warn`** — single instance at **[lib/hooks/use-submit-tip.ts:111](mobile/lib/hooks/use-submit-tip.ts)** for a non-critical receipt-write failure. Acceptable for a side-effect path; consider routing through a single `lib/log.ts` so future Sentry/EventGrid wire-in is one swap, not a grep.

- **No import cycles detected** between `app/`, `components/cf/`, and `lib/`. Imports flow `app/ → components/cf/, lib/`; `components/cf/ → lib/`; `lib/hooks/ → lib/types/, lib/`. Clean layering.

## Tooling gaps

The hooks rule has the mechanical safety net the project asks for. No additional config changes are required for the hooks-before-early-returns enforcement, but a few opportunistic gaps:

- **`react-hooks/rules-of-hooks` + `exhaustive-deps`**: ALREADY ON via `expoConfig` → `eslint-config-expo/flat` → `eslint-config-expo/utils/react.js:4` (`extends: ['plugin:react-hooks/recommended']`). No action needed.

- **`@typescript-eslint/no-explicit-any`** — not currently on. Would have flagged `lib/__tests__/period-bucket.test.ts:121` (which is a test fixture, not production code, so probably fine to keep). To enable strictly:
  ```js
  // eslint.config.js
  module.exports = defineConfig([
    expoConfig,
    {
      ignores: ['dist/*'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
      },
    },
  ]);
  ```
  Low-stakes — production code already has zero `any`, so this is just a tripwire for future drift.

- **`no-console`** — not on. Single existing call site is intentional. If a `lib/log.ts` lands, enable `'no-console': ['error', { allow: [] }]` to force everything through the wrapper.

- **`no-unused-vars`** — currently catching `formatDateMonthDay`, `ActivityIndicator`, `handleClearSelection`. Already configured (these surfaced as warnings in `expo lint`); just resolve the four warnings rather than tooling work.

- **`import/order`** — not enforced. The codebase is mostly consistent (external imports → `@/components/cf` → `@/lib`) but some screens drift. Low priority, very mechanical with `--fix`.

- **No CI enforcement**: `package.json` does not appear to wire `lint` or `tsc --noEmit` to a `prepublish`/`pretest` hook or a GitHub Action. The discipline is entirely human today; given the v1.0.1 → v1.0.2 → v1.0.3 cadence, a `eas build` pre-flight check that runs `npx tsc --noEmit && npx expo lint --max-warnings 0` would catch lint regressions before they ride into the AAB. This is the actual mechanical gate; ESLint config is sound, but nothing forces it to run on the path that produces the AAB.
