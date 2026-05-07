# Performance Audit — ColdFiles Mobile (2026-05-07)

## Summary

The biggest perf liabilities in this build are not in the map (the map is a
WebView+Leaflet renderer, so its hot path runs in WebKit, not RN), they are
in the two highest-traffic list surfaces and the photo pipeline. The
Map/List/Saved tabs all render long item lists through `<ScrollView>` +
`.map()` instead of `<FlatList>`, which means up to ~6,000 case rows can
materialize as React subtrees with no virtualization once the user pans to
a continental view. Photos use plain `<Image>` from `react-native` despite
`expo-image` being installed — meaning no memory cache, no disk cache, no
progressive rendering. Hermes + Fabric + React Compiler are correctly
configured; cold-start chrome is reasonable. Top three wins: (1) virtualize
the List + Saved scroll containers, (2) swap photo-frame/photo-gallery to
`expo-image`, (3) drop the unused `@maplibre/maplibre-react-native`
dependency to shrink the AAB.

## Hot paths (biggest wins)

- [`mobile/app/(tabs)/list.tsx:288-312`](../../../mobile/app/(tabs)/list.tsx) —
  `ScrollView` renders all cases inline via nested `BUCKET_ORDER.map(...)` →
  `items.map(...)` → `<CaseRow>`. With `limit: 100` from `useCaseList`
  ([`use-case-list.ts:120`](../../../mobile/lib/hooks/use-case-list.ts)) the
  current cap is "only" 100 rows, but they all mount up-front with no
  recycling. Cause: ScrollView, not FlatList. Fix: SectionList (one section
  per bucket) with `keyExtractor`, `removeClippedSubviews={true}` (Android
  default OK on Fabric but explicit is safer), `windowSize={5}`,
  `initialNumToRender={12}`. Expected impact: ~40-60% reduction in
  JS-thread mount time on List tab cold-tab-switch, eliminates the brief
  white-flash when the user taps List from Map on a Pixel 6a.

- [`mobile/app/(tabs)/saved.tsx:225-229`](../../../mobile/app/(tabs)/saved.tsx)
  + [`mobile/app/(tabs)/saved.tsx:294-300`](../../../mobile/app/(tabs)/saved.tsx)
  — Same pattern: `ScrollView` + `rows.map(...)`/`zones.map(...)`. Saved
  cases have no upper bound (the user can save indefinitely; the dataset is
  device-local so no server cap applies). Symptom on a power user with
  500+ saved cases: every navigation back to the Saved tab re-mounts all
  500 `<SavedRow>` instances + all `<PinGlyph>` SVGs synchronously. Fix:
  `<FlatList>` for both panes; the `SavedRow` is uniform-height-friendly
  so `getItemLayout` is feasible.

- [`mobile/app/(tabs)/index.tsx:257`](../../../mobile/app/(tabs)/index.tsx) —
  `useCasesInBbox({ ..., limit: 6000 })`. At low zoom this returns the full
  corpus (~3,800 active cases per memory `project_doe_network_uid_2026_05_04_rescrape`,
  trending toward 6,000). The result feeds two derived `useMemo` chains
  (`counts`, `cases`) plus the Leaflet `markers` build at
  [`(tabs)/index.tsx:593`](../../../mobile/app/(tabs)/index.tsx). The
  marker build does a `Map<string, typeof filtered>` jitter-grouping pass
  + per-row trig math on every cases or selectedSlug change. Cause: server-
  side aggregation deferred ("Long-term: this is a stopgap" in the inline
  comment). Effect: when the user taps a pin, `selectedSlug` changes →
  the entire 6000-element jitter pass recomputes → JSON-stringifies →
  injects into WebView. Per-tap cost on the JS thread is meaningful at
  3,800 rows. Fix sketch: split selection out of the markers memo
  (`leaflet-map.tsx` already does this; the React-side memo can mirror
  it — pre-compute jittered positions in one memo keyed only on `cases`,
  apply selection in a separate cheap pass keyed on `selectedSlug`).
  Expected impact: pin-tap latency on continental zoom drops from ~200ms
  JS work to ~5ms; the `JSON.stringify(markers)` injection still dominates,
  but at least the React-side prep is constant time.

- [`mobile/components/cf/photo-frame.tsx:122-128`](../../../mobile/components/cf/photo-frame.tsx)
  + [`mobile/components/cf/photo-gallery.tsx:119-125`](../../../mobile/components/cf/photo-gallery.tsx)
  + [`mobile/components/cf/photo-lightbox.tsx`](../../../mobile/components/cf/photo-lightbox.tsx)
  — All three use RN core `<Image>` despite `expo-image ~3.0.11` being in
  deps. Per memory `feedback_photo_sourcing_policy`, NamUs/FBI/LASD photos
  are hot-linked, which means cold-fetch latency on every navigation back
  to a case the user has already viewed (RN `<Image>` only caches via
  HTTP cache headers, which most public agency-photo CDNs don't set
  generously). Fix: `import { Image } from 'expo-image'`, add
  `cachePolicy="memory-disk"`, add `placeholder` (the existing em-dash
  rendering can be the placeholder via `placeholderContentFit`). Expected
  impact: second-visit case detail renders the hero photo instantly
  instead of re-fetching; gallery thumbs (12-20 per case for Doe records)
  go from "flash of empty box per scroll" to instant.

## Map render

- The actual map is **not** native MapLibre — it's a WebView wrapping
  Leaflet 1.9 + leaflet.markercluster
  ([`mobile/components/cf/leaflet-map.tsx:1`](../../../mobile/components/cf/leaflet-map.tsx)).
  The `@maplibre/maplibre-react-native` package is in deps and registered
  as a plugin in [`app.config.ts:88`](../../../mobile/app.config.ts) but
  the import is gated to a dead path — `MapsView` always throws and
  `isNativeMapAvailable()` always returns false
  ([`maps-view.tsx:74`](../../../mobile/components/cf/maps-view.tsx)).
  This means: (a) the question "are pins symbol-layer-virtualized vs
  React-component-per-pin" doesn't apply — pins are inline-SVG `divIcon`s
  rendered by Leaflet, virtualized by Leaflet's marker-cluster plugin
  via `chunkedLoading: true`; (b) the AAB ships a native module that
  is never loaded at runtime (bundle-size waste, see Bundle section).

- [`leaflet-map.tsx:142-149`](../../../mobile/components/cf/leaflet-map.tsx)
  — `markersKey` is a stable join of `id|lat|lng|kind|recentDays`,
  intentionally excluding `selected`. Selection mutates in place via
  `setIcon` rather than remove-and-re-add. This is correct and
  performance-aware; the comment explains why. Don't touch.

- [`leaflet-map.tsx:122-126`](../../../mobile/components/cf/leaflet-map.tsx)
  — `html` is built with empty deps array (`useMemo(... , [])`). The
  HTML payload is ~50KB after token + initial-marker injection. This is
  fine — it ships once per WebView mount. Subsequent updates ride
  `injectJavaScript` on three independent channels (markers, here, zones)
  with their own memoized JSON keys. Good engineering.

- [`(tabs)/index.tsx:544-557`](../../../mobile/app/(tabs)/index.tsx) — the
  `NativeRenderer` markers memo also keys on `[cases, selectedSlug]`,
  which means selection changes trigger a full re-marshal. Same fix as
  the LeafletRenderer above — split memos. (Lower priority since
  `isNativeMapAvailable()` is false; this is the dead path until native
  MapLibre is re-enabled.)

- [`(tabs)/index.tsx:268-276`](../../../mobile/app/(tabs)/index.tsx) — the
  `counts` useMemo iterates the entire `casesAll` array on every change.
  At limit:6000 this is up to 6000 iterations per pan. Cheap (one for
  loop + 4 counters), but if combined with the marker-build memo on the
  same input array, the work is doubled. Acceptable for now; revisit if
  CPU profiling on a Pixel 6a shows JS-thread saturation during pan.

- [`leaflet-map.tsx:761-768`](../../../mobile/components/cf/leaflet-map.tsx)
  — `keepBuffer: 8` (default 2) is a deliberate trade: more memory, less
  white-tile flash. Correct call for a cold-case browsing app where pan
  cadence is leisurely. Don't churn.

## List rendering

- [`(tabs)/list.tsx:271-313`](../../../mobile/app/(tabs)/list.tsx) — see
  hot-path entry above. ScrollView + nested `.map()`. The bucketing
  semantic (TODAY / THIS WEEK / THIS MONTH / OLDER) maps cleanly to
  `SectionList` sections; this is a near-mechanical refactor that
  preserves the empty-bucket strip behavior via `renderSectionHeader` +
  conditional `renderItem`.

- [`(tabs)/saved.tsx:224-230`](../../../mobile/app/(tabs)/saved.tsx) and
  [`saved.tsx:293-300`](../../../mobile/app/(tabs)/saved.tsx) — both
  panes are `ScrollView` + `.map()`. The sentinel "this is a v1.0.x
  device-local store" makes Saved Cases the most likely list to grow
  unboundedly in production. Treat this as urgent.

- [`(tabs)/index.tsx:516-526`](../../../mobile/app/(tabs)/index.tsx) +
  [`map-bottom-sheet.tsx:201-209`](../../../mobile/components/cf/map-bottom-sheet.tsx) —
  the bottom-sheet uses `BottomSheetFlatList` with memoized
  `renderItem`, `keyExtractor`, and `ListHeaderComponent`. `SNAP_POINTS`
  is a module-level constant. `MapBottomSheet` itself is `forwardRef`
  with a ref-based imperative handle. **This file is correctly
  optimized — don't churn it.** It's the single counterexample in the
  list-surface set.

- `keyExtractor`/`getItemLayout`/`removeClippedSubviews`/`maxToRenderPerBatch` —
  none configured anywhere except the bottom sheet. The list and saved
  refactors should set all four explicitly. CaseRow is variable-height
  (one or two MonoLabel lines depending on `trailingLine`), so
  `getItemLayout` requires picking a fixed estimate; 76px is a safe
  approximation matching the current padding (14 top + ~48 content + 14
  bottom).

- `.map()` over 500-item arrays in render: yes, on the Saved tab once a
  user has 500+ saves. Currently no upper bound enforced.

## Re-render churn

- [`(tabs)/index.tsx:157`](../../../mobile/app/(tabs)/index.tsx) and
  [`index.tsx:161`](../../../mobile/app/(tabs)/index.tsx) and
  [`index.tsx:164`](../../../mobile/app/(tabs)/index.tsx) and
  [`index.tsx:199`](../../../mobile/app/(tabs)/index.tsx) — handlers
  are wrapped in `useCallback` with stable deps. Good.

- [`(tabs)/index.tsx:480`](../../../mobile/app/(tabs)/index.tsx) —
  `<LocationFAB onPress={() => void requestAndAcquire()}>` creates a
  new function each render. Low-impact (LocationFAB is a leaf
  component, not memoized), but if FAB is ever wrapped in `React.memo`
  the prop will defeat it. Fix: hoist via `useCallback`.

- [`(tabs)/index.tsx:431`](../../../mobile/app/(tabs)/index.tsx) —
  `onMarkerOpen={(slug) => router.push(...)}` — same pattern, new
  function per render, propagates into LeafletRenderer → LeafletMap.
  LeafletMap is not memoized, so the prop change is moot today, but
  it's worth hoisting once we wrap LeafletMap in React.memo (which is
  the right call at some point — its only mutable inputs flow through
  injectJavaScript channels, not React props).

- [`(tabs)/index.tsx:439-441`](../../../mobile/app/(tabs)/index.tsx) —
  `<LayerToggleButton visible={zonesVisible} onPress={toggleZonesVisible}>` —
  toggleZonesVisible is `useCallback`'d. Good.

- [`use-cases-in-bbox.ts:118-127`](../../../mobile/lib/hooks/use-cases-in-bbox.ts)
  — useEffect deps array contains `JSON.stringify(kinds)` and
  `JSON.stringify(status)`. **Both run on every render** of every
  consumer of this hook. With `kinds: null, status: null` from the home
  screen the cost is small (`JSON.stringify(null)` = `"null"`) but it's
  unnecessary work and a minor lint-rule violation
  (`react-hooks/exhaustive-deps` is satisfied accidentally). Fix:
  memoize the kinds/status arrays in the parent if they're meant to be
  identity-stable, or hash them outside the deps array. Same pattern
  almost certainly exists in `use-case-list.ts`; check before refactoring.

- [`map-bottom-sheet.tsx:142-160`](../../../mobile/components/cf/map-bottom-sheet.tsx)
  — `renderItem` is `useCallback` with `[daysFor, selectedSlug]`. Since
  `daysFor` is `useCallback`'d in the parent
  ([`(tabs)/index.tsx:164`](../../../mobile/app/(tabs)/index.tsx)) with
  `[]` deps, the identity is stable. Good. The `selectedSlug` dep means
  every selection change re-builds renderItem — that's expected and
  correct (the row needs the new highlighted state).

- React Compiler is **enabled** at
  [`app.config.ts:106`](../../../mobile/app.config.ts) (`reactCompiler:
  true`). This should auto-memoize many of the inline-style/closure
  patterns flagged here as "low impact." However, the compiler doesn't
  rescue the architectural issues (ScrollView vs FlatList, RN Image vs
  expo-image). It does mean: don't waste time hand-memoizing every
  component; focus on the structural fixes.

- Leaf components (CaseRow, Pin, FilterChip) have **zero** explicit
  `React.memo` wrappers. With React Compiler on this is mostly fine,
  but any prop that's a fresh literal (inline `{...}` style) defeats
  the compiler's identity inference. Spot-checked CaseRow callsites:
  [`list.tsx:298-309`](../../../mobile/app/(tabs)/list.tsx) inside
  `items.map()` passes a fresh `() =>` closure for `onPress` — that
  alone forces re-render of every row when the parent re-renders. The
  FlatList refactor will fix this incidentally (FlatList only renders
  visible rows; the closure is per-visible-row, not per-list-row).

## Bundle / cold start

- [`app.config.ts:88-91`](../../../mobile/app.config.ts) and
  [`package.json:14`](../../../mobile/package.json) —
  `@maplibre/maplibre-react-native` is in dependencies and registered
  as an Expo plugin, but
  [`maps-view.tsx:74`](../../../mobile/components/cf/maps-view.tsx)
  hard-returns false from `isNativeMapAvailable()` and the import is
  intentionally gated. The plugin still injects native code into the
  AAB. Estimated savings: 5-8MB AAB size + Hermes bytecode parse cost
  on cold start. Fix: remove from package.json, remove the plugin
  entry, leave the stub component as a typed placeholder. The comment
  in maps-view.tsx says to "flip back when the upstream Fabric fix
  lands" — when that day comes, re-adding the dep is one commit.

- `expo-symbols` (in deps, [`package.json:33`](../../../mobile/package.json))
  — searched usage: not imported anywhere in `app/`, `components/`, or
  `lib/`. iOS-only SF Symbols package, harmless on Android but
  unnecessary tree weight if unused. Confirm before removing.

- `react-native-svg 15.12.1` — used heavily (Pin, CaseRow Thumbnail,
  PhotoFrame brackets, all SilhouetteFallback SVGs). Justified.

- `react-native-webview 13.15.0` — used for LeafletMap. Justified.

- `expo-image` — in deps but not imported anywhere. Three call sites
  use core RN `<Image>`. The dep is correct; the call sites need
  migration. See hot-path entry above.

- date-fns / lodash / moment: **none present**. Good — codebase uses
  hand-rolled formatters (`lib/format.ts`) and tiny inline date math.
  This is the right pattern for an Android-Hermes target where every
  unused dep is parsed-and-cached on every cold launch.

- Cold-start chrome: [`app/_layout.tsx:38-46`](../../../mobile/app/_layout.tsx) —
  `SplashScreen.preventAutoHideAsync()` at module load,
  `SplashScreen.hideAsync()` in mount-effect immediately, JS-rendered
  BrandSplash takes over for 400ms after font-load. This is correct
  and well-engineered. The 400ms beat is intentional brand presence,
  not perf debt.

- Cold-start `AsyncStorage` reads: only one fires before first paint —
  the `useOnboarding()` hook in
  [`app/_layout.tsx:222`](../../../mobile/app/_layout.tsx) via
  `<OnboardingGate>`, which gates the redirect to `/onboarding`. The
  Map screen fires two more (`ZONES_VISIBLE_KEY` at
  [`(tabs)/index.tsx:80`](../../../mobile/app/(tabs)/index.tsx); the
  Saved tab fires `SEGMENT_PREF_KEY` at
  [`saved.tsx:59`](../../../mobile/app/(tabs)/saved.tsx)). All three
  are async and don't block the splash. Good.

- Auth session: not blocking the splash. supabase-js is configured
  `detectSessionInUrl: false` per the comment in
  [`_layout.tsx:101`](../../../mobile/app/_layout.tsx). Auth
  callback fires from `useAuthCallback()` which runs in mount-effect.
  Cold start does not wait on a network round-trip.

- Network waterfalls — home screen fires three independent queries on
  mount: `useCaseCount` (small, cached, 5-min TTL), `useCasesInBbox`
  (the big one, gated on `bounds` so it only fires after the WebView
  posts its initial region), and `useWatchZones` (small). They run in
  parallel via independent `useEffect`s, no sequential await chain.
  Good.

- Case detail —
  [`use-case-detail.ts:65-112`](../../../mobile/lib/hooks/use-case-detail.ts)
  is sequential (case row first, THEN sources+media in parallel). One
  RTT serialized before the parallel fan-out. Fix: fire all three from
  the start; if the case row 404s, abort/discard the sources+media
  results client-side. Saves ~200-400ms on the first paint of every
  case-detail screen for users on a 4G connection. Lower priority than
  the list/photo fixes but a clean win.

## Already-good (don't churn)

- Map bottom sheet
  ([`map-bottom-sheet.tsx`](../../../mobile/components/cf/map-bottom-sheet.tsx)) —
  textbook FlatList pattern: memoized renderItem/keyExtractor/header,
  module-level snap-point constant, forwardRef + useImperativeHandle
  for parent-driven scrolling. The lone correctly-virtualized list in
  the codebase. Use as the template for the List + Saved refactors.

- Leaflet WebView channels
  ([`leaflet-map.tsx:160-211`](../../../mobile/components/cf/leaflet-map.tsx))
  — three independent injectJavaScript channels (markers, here,
  zones), each with its own memoized JSON key, prevent GPS-cadence
  re-renders from disturbing zone overlays or open spiderfies. The
  inline comments document the spiderfy-collapse bug history; the
  current architecture is correct.

- Pin renderer
  ([`pin.tsx`](../../../mobile/components/cf/pin.tsx)) — pure function
  of props, no hooks, no state. SVG-based. React Compiler will
  auto-memoize cleanly. Don't touch.

- React Compiler enabled
  ([`app.config.ts:106`](../../../mobile/app.config.ts)) — best-in-class
  default for RN 0.81 / React 19. Means many "should we memo this?"
  questions answer themselves; focus on architectural fixes instead.

- Hermes confirmed at
  [`android/gradle.properties:42`](../../../mobile/android/gradle.properties)
  + Fabric (newArchEnabled) at line 38. Correct configuration for the
  React Compiler + Reanimated 4 stack.

- Cold-start chrome (BrandSplash, SplashScreen.preventAutoHideAsync,
  font preload) — see Bundle section. The 400ms brand beat is
  intentional, not debt.

- Reanimated worklets — spot-checked `(tabs)/index.tsx`'s
  useAnimatedStyle blocks (lines 120-146). Pure interpolations of one
  shared value, no JS-thread access. Clean.

- Horizontal ScrollView pin — `flexGrow:0/flexShrink:0` is correctly
  applied at [`(tabs)/index.tsx:382`](../../../mobile/app/(tabs)/index.tsx)
  and [`(tabs)/list.tsx:223`](../../../mobile/app/(tabs)/list.tsx) per
  memory `feedback_horizontal_scrollview_steals_height`. Both files
  carry the explanatory comment. Don't touch — this is the canonical
  example.

- Hooks-before-early-returns rule — spot-checked
  [`case/[slug].tsx:57-80`](../../../mobile/app/case/[slug].tsx) which
  carries an inline comment about a previous violation that surfaced
  as a blank grey screen on Android Fabric (matches memory
  `feedback_hooks_before_early_returns`). All hooks now declared
  before any conditional return. Don't churn.
