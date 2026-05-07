# Error Handling Audit — ColdFiles Mobile (2026-05-07)

Scope: `/Users/jtroy/Desktop/ColdFiles/mobile/`. Read-only audit. Read across
[`app/`](../../../mobile/app), [`lib/`](../../../mobile/lib), and
[`components/cf/`](../../../mobile/components/cf), with sampling on the screens that
field network calls, deep links, native modules, and persistent storage.

## Summary

Three risks dominate the 1-star Play-review surface:

1. **No top-level React error boundary and no crash reporter.** Any thrown render
   error in any screen — already a known footgun on Android Fabric per
   `feedback_hooks_before_early_returns.md` — escapes to the OS as a Java crash
   ("The Cold Files keeps stopping") with zero in-app fallback UI and zero remote
   triage signal. There is **no Sentry, no Bugsnag, no Crashlytics, no global
   ErrorUtils handler** anywhere in the bundle. Once an AAB ships, a single bad
   render in production is invisible to ops until reviews start landing.
2. **Image-load failures degrade silently.** Hot-linked NamUs/FBI/LASD photos can
   404 or time out. [`components/cf/photo-frame.tsx`](../../../mobile/components/cf/photo-frame.tsx#L122)
   uses bare `<Image source={{ uri }} />` with **no `onError` handler**, so a
   failed remote fetch leaves the elev1 background visible under brackets and a
   "PHOTO 01 / SHARED BY FAMILY" caption — looks like a styled empty rectangle,
   not a known failure. Same pattern in [`photo-gallery.tsx`](../../../mobile/components/cf/photo-gallery.tsx#L119)
   and [`photo-lightbox.tsx`](../../../mobile/components/cf/photo-lightbox.tsx#L83).
3. **Auth-callback failures route the user back to `/` with no message.**
   [`app/auth-callback.tsx:49`](../../../mobile/app/auth-callback.tsx#L49) and
   [`lib/hooks/use-auth-callback.ts:48`](../../../mobile/lib/hooks/use-auth-callback.ts#L48)
   both swallow `exchangeCodeForSession` rejections with a bare `catch {}` and
   then `router.replace('/')`. Expired magic links, network failures, malformed
   tokens — all silently kick the user back to the home tab still signed out
   with no explanation. The only path back is repeating the email-magic-link
   flow with no idea why it failed the first time.

## Error boundary coverage

- **Top-level**: NONE. [`app/_layout.tsx`](../../../mobile/app/_layout.tsx) wraps
  `<Stack>` in `GestureHandlerRootView` + `SafeAreaProvider` + `ThemeProvider`
  but no `ErrorBoundary`. A thrown render error anywhere in the tree unmounts
  the React root with no fallback UI; on Android Fabric this surfaces as a
  blank/grey screen at best, a Java crash at worst.
- **Per-route**: NONE. Expo Router supports `ErrorBoundary` exports per route
  segment (e.g. `app/case/ErrorBoundary.tsx`). None defined.
- **Per-screen**: NONE. Hand-rolled `<ErrorState>` UIs exist in
  [`components/cf/error-state.tsx`](../../../mobile/components/cf/error-state.tsx)
  and are wired into hooks for *fetch* errors (good), but they are not React
  error boundaries — they don't catch render-time throws.
- `grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError"` →
  zero hits across the entire `mobile/` tree.

## Network error paths

`grep -rn` against `getSupabase()` + `.from(` + `.rpc(` + `functions.invoke`
across [`app/`](../../../mobile/app) and [`lib/`](../../../mobile/lib) found
~28 distinct call sites. Of those:

- **Robust pattern (good)** — used by every reusable read hook
  ([`use-case-detail.ts`](../../../mobile/lib/hooks/use-case-detail.ts),
  [`use-case-list.ts`](../../../mobile/lib/hooks/use-case-list.ts),
  [`use-cases-in-bbox.ts`](../../../mobile/lib/hooks/use-cases-in-bbox.ts),
  [`use-cases-near.ts`](../../../mobile/lib/hooks/use-cases-near.ts),
  [`use-cases-near-case.ts`](../../../mobile/lib/hooks/use-cases-near-case.ts),
  [`use-case-events.ts`](../../../mobile/lib/hooks/use-case-events.ts),
  [`use-watch-zones.ts`](../../../mobile/lib/hooks/use-watch-zones.ts)).
  Both `.then(success, rejection)` arms wired; PostgREST `error` field
  inspected; `loading` always cleared in both arms. Promise cancel guard
  via `cancelled` flag. Exemplary.
- **Robust write pattern** — [`use-submit-tip.ts`](../../../mobile/lib/hooks/use-submit-tip.ts),
  [`use-watch-zones.ts:create/remove`](../../../mobile/lib/hooks/use-watch-zones.ts#L102),
  [`takedown-request/[slug].tsx:handleSubmit`](../../../mobile/app/takedown-request/[slug].tsx#L130).
  `try/catch` wraps the await chain, error surfaced via `Alert.alert` or
  inline state, `submitting` cleared in `finally`. Solid.

**Unhandled / partially handled — five concrete gaps:**

- **[`app/zone/[id].tsx:81-93`](../../../mobile/app/zone/[id].tsx#L81)** —
  `cases_in_polygon` RPC has only the success arm. No rejection handler. On
  network failure, `loading` stays `true` permanently → the user sees an
  endless spinner over "CASES IN THIS ZONE" with no retry.
- **[`app/takedown-request/[slug].tsx:94-117`](../../../mobile/app/takedown-request/[slug].tsx#L94)** —
  The case-summary read (`from('cases').select(...).maybeSingle()`) has no
  rejection handler and ignores `error` in the `.then(({ data })...)`. Network
  failure renders a takedown form without the "ABOUT THIS CASE" header — user
  doesn't know which case they're filing against.
- **[`app/watch-zone.tsx:217-235`](../../../mobile/app/watch-zone.tsx#L217)** —
  `cases_within_radius` returns an `error`, the `else` branch silently falls
  through with `onCount(0)`. User sees "0 cases nearby" instead of "couldn't
  load count" — they can't distinguish empty area from broken network.
- **[`app/watch-zone.tsx:474-486`](../../../mobile/app/watch-zone.tsx#L474)** —
  `reverse-geocode` Edge Function. Bare `try/catch {}` keeps the date-based
  fallback name. Acceptable, but only because the fallback exists; if the
  spec ever required the geocoded label, this is a silent prod-codepath
  failure (per `feedback_silent_whitespace_in_config.md`).
- **[`lib/hooks/use-user.ts:39-43`](../../../mobile/lib/hooks/use-user.ts#L39)** —
  `supabase.auth.getSession()` with no `.catch()`. On network failure during
  cold launch (offline, captive-portal Wi-Fi, supabase outage), `loading`
  stays `true` indefinitely → consumers (`useWatchZones`, `Me` tab) never
  hydrate.

**Console error logging:**
`console.warn` is used exactly once
([`use-submit-tip.ts:111`](../../../mobile/lib/hooks/use-submit-tip.ts#L111)),
intentionally without a slug to avoid logcat re-identification of which case a
user tipped on. No `console.error`. No logging service. Bug-report channel for
production triage is **email + diagnostics text** (see
[`lib/diagnostics.ts`](../../../mobile/lib/diagnostics.ts) and the Help/contact
flow in [`app/(tabs)/me.tsx`](../../../mobile/app/(tabs)/me.tsx#L59)) — fine for
opt-in support requests, useless for the silent-failure population.

## Empty / loading / error states by screen

| Screen | Loading | Empty | Error | Notes |
| --- | --- | --- | --- | --- |
| [`(tabs)/index`](../../../mobile/app/(tabs)/index.tsx) (Map) | ✓ ActivityIndicator + UPDATING chip | ✓ EmptyState w/ variants | ✓ ErrorState overlay w/ retry | Best-in-class. Holds prior pins on transient errors so the map doesn't blank. |
| [`(tabs)/list`](../../../mobile/app/(tabs)/list.tsx) | ✓ | ✓ EmptyState | ✓ ErrorState w/ retry | Pull-to-refresh. Bucket strips show absence as info. |
| [`(tabs)/saved`](../../../mobile/app/(tabs)/saved.tsx) | ✓ per pane | ✓ per pane | ✗ no error path | `useSavedCases` swallows fetch errors silently ([line 199](../../../mobile/lib/hooks/use-saved-cases.ts#L199)). User sees stale "no saved cases" instead of an error. |
| [`(tabs)/me`](../../../mobile/app/(tabs)/me.tsx) | ✓ via `useSourceMix` | ✓ "No sources yet" | ✓ "Couldn't load sources" row | Source mix has all three states. Counts are local, can't fail. |
| [`case/[slug]`](../../../mobile/app/case/[slug].tsx) | ✓ | ✓ "no longer available" branch | ✓ ErrorState + retry + back | Carefully handled — separate not-found vs error copy. |
| [`tip/[slug]`](../../../mobile/app/tip/[slug].tsx) | ✗ no hook-error UI | ✗ falls back to `slug` | ✗ no error UI | If `useCaseDetail` errors, header reads "re: Unidentified person · undefined" with no signal. Submit handler does have try/catch → fallback bar. |
| [`zone/[id]`](../../../mobile/app/zone/[id].tsx) | ✓ for zone list | ✓ "Zone not found" | ✗ no error UI | `cases_in_polygon` failure → permanent spinner. |
| [`takedown-request/[slug]`](../../../mobile/app/takedown-request/[slug].tsx) | ✗ no skeleton for case header | ✗ no "case unknown" branch | ✗ network failure invisible | Submit path solid; case-summary fetch is the gap. |
| [`auth-callback`](../../../mobile/app/auth-callback.tsx) | ✓ ActivityIndicator | n/a | ✗ silent redirect to `/` | Critical UX dead-end. |
| [`sign-in`](../../../mobile/app/sign-in.tsx) | ✓ | n/a | ✓ inline `errorMessage` | Surfaces raw `error.message` from `signInWithOtp` — leaks PostgREST jargon. |
| [`delete-account`](../../../mobile/app/delete-account.tsx) | ✓ | n/a | ✓ inline | Same — surfaces raw `e.message`. |
| [`watch-zone`](../../../mobile/app/watch-zone.tsx) | ✓ | n/a | ✓ Alert on save failure | Cases-near-count silently zeros on RPC failure. |
| [`notifications`](../../../mobile/app/notifications.tsx) | ✓ | n/a | ✓ Alert + inline `pushError` chip | Alert text dumps raw `result.error` / `err.message`. |
| [`data-export`](../../../mobile/app/data-export.tsx) | ✓ | n/a | ✓ inline `errorMessage` | Generic copy fallback. |
| [`tip-history`](../../../mobile/app/tip-history.tsx) (via [hook](../../../mobile/lib/hooks/use-tip-history.ts)) | ✓ | implicit (empty `tips`) | ✓ "Couldn't load tip history." | Nice. |
| [`search`](../../../mobile/app/search.tsx) | n/a (in-memory) | ✓ | n/a | Pure client-side filter. |
| [`onboarding`](../../../mobile/app/onboarding.tsx) | n/a | n/a | n/a | Linear flow, no fetches. |
| [`region-prefs`](../../../mobile/app/region-prefs.tsx) | ✓ via `ready` flag | ✓ implicit | n/a | Pure local state. |
| [`diagnostics`](../../../mobile/app/diagnostics.tsx) | n/a | n/a | n/a | Read-only assembly of process state. |

## Permission denial paths

- **Location**: [`useHere`](../../../mobile/lib/hooks/use-here.ts) handles
  denied/undetermined cleanly. Permission denied → returns the default-center
  `lat/lng` with `fresh: false`; map FAB switches to "request" mode. The
  `requestAndAcquire` rejection arm flips to `'denied'` so the UI can re-prompt
  ([line 203](../../../mobile/lib/hooks/use-here.ts#L203)). `getCurrentPositionAsync`
  network/hardware error during the watch is a silent `.catch(() => {})`
  ([line 126](../../../mobile/lib/hooks/use-here.ts#L126)). Acceptable — the
  watch retries on every 5s tick.
- **Notifications**: [`usePushToken`](../../../mobile/lib/hooks/use-push-token.ts)
  has a clean three-branch UI in
  [`app/notifications.tsx:PermissionBlock`](../../../mobile/app/notifications.tsx#L173):
  undetermined → "Turn on", granted-without-token → "Register push token",
  denied → "Notifications are blocked. Open Settings →" with a working deeplink.
  Best-handled permission flow in the app.
- **Photo permission**: not requested anywhere — the app doesn't capture or
  upload images. Not applicable.
- **Camera / Microphone**: not used.

## Map tile load failure

[`components/cf/leaflet-map.tsx`](../../../mobile/components/cf/leaflet-map.tsx)
hosts Leaflet inside a WebView. **No `onError`, `onHttpError`, or `renderError`
prop on the WebView.** If `basemaps.cartocdn.com` is unreachable (DNS, captive
portal, regional ISP block) the user sees pin glyphs floating over the elev1
background with no tile imagery and no in-app explanation that anything is
wrong. The only signal is visual — and it can read as a styling choice rather
than a failure. Same gap in [`draw-zone-map.tsx`](../../../mobile/components/cf/draw-zone-map.tsx),
[`leaflet-watch-zone.tsx`](../../../mobile/components/cf/leaflet-watch-zone.tsx),
[`case-location-map.tsx`](../../../mobile/components/cf/case-location-map.tsx).

`onMessage` does parse the WebView post messages defensively
([`leaflet-map.tsx:278-296`](../../../mobile/components/cf/leaflet-map.tsx#L278) wraps
`JSON.parse` in a try, [`draw-zone-map.tsx:80`](../../../mobile/components/cf/draw-zone-map.tsx#L80)
is the same pattern). Good — a malformed bridge payload won't crash JS.

## Deep-link not-found handling

- **`/case/[slug]` with bad slug**: ✓ Handled. `useCaseDetail` returns
  `EMPTY` with `error: null`; the screen detects `!c` and renders the
  "This case is no longer available." copy with a Back button
  ([`case/[slug].tsx:111-132`](../../../mobile/app/case/[slug].tsx#L111)).
- **`/tip/[slug]` with bad slug**: ✗ Partially. `useCaseDetail` returns
  `data.case = null`; the screen header degrades to "re: Unidentified person",
  the submit flow falls through to `FALLBACK_ROUTE` (Investigating agency).
  Submission still succeeds against `caseId = slug` which the Edge Function
  will reject — at which point the `catch` arm in `handleSubmit` sets phase to
  `'fallback'` with `setFallbackResult(null)`, leaving the user with an
  un-targeted "Try again" button. Not crash-class but the path is unclear.
- **`/zone/[id]` with bad id**: ✓ Handled. "Zone not found" copy with
  back-to-Saved instruction ([`zone/[id].tsx:109-129`](../../../mobile/app/zone/[id].tsx#L109)).
- **`/takedown-request/[slug]` with bad slug**: ✗ No not-found handling.
  `caseSummary` stays `null`, the "ABOUT THIS CASE" block silently doesn't
  render, the form remains submittable but `canSubmit` gates on
  `!!caseSummary` so the AmberCTA stays disabled with the "FILL REQUIRED
  FIELDS" caption. The user can't tell *which* required field they're missing.

## Crash-reporting status

**None wired in.** No `Sentry`, `@sentry/*`, `bugsnag`, `crashlytics`, or
`firebase-crashlytics` import anywhere in `package.json` or the source tree.
The only mention is a forward-looking comment in
[`app.config.ts`](../../../mobile/app.config.ts) referencing "future Sentry/Stripe/etc keys".

`google-services.json` is present in the repo, but only as the FCM bind for
`expo-notifications`. No Firebase Crashlytics linkage.

This is the largest single gap in the audit. For an app that depends on
Android Fabric (newArchEnabled = true per `app.config.ts`), with a memorialized
"hooks before early returns" rule that can still slip past code review,
shipping with no crash telemetry leaves ops blind to the failure mode the
codebase has actually been bitten by.

## Critical findings

1. **No top-level error boundary, no crash reporter** (see Summary §1).
   Recommendation: wrap `<Stack>` in [`app/_layout.tsx`](../../../mobile/app/_layout.tsx)
   with a class-component `<ErrorBoundary>` rendering a "Something went wrong /
   Reload" UI; install `@sentry/react-native` (or `expo-sentry-cli`) and
   capture both render throws and unhandled promise rejections via
   `ErrorUtils.setGlobalHandler`. Tag every release with
   `Constants.expoConfig.version` so OTA-vs-AAB telemetry is separable.

2. **Auth-callback failures route silently to `/`**
   ([`auth-callback.tsx:49`](../../../mobile/app/auth-callback.tsx#L49) +
   [`use-auth-callback.ts:48`](../../../mobile/lib/hooks/use-auth-callback.ts#L48)).
   Recommendation: the catch arm should `router.replace({ pathname: '/sign-in', params: { error: 'expired' } })`
   and the sign-in screen should surface a friendly "That link expired — send
   a new one" banner. Right now this is the worst silent-failure surface for
   first-time signed-in flows.

3. **`use-user.ts` blocks loading on `getSession()` with no rejection arm**
   ([`use-user.ts:39`](../../../mobile/lib/hooks/use-user.ts#L39)). Cold-launch
   on flaky networks freezes `Me` and `Saved/Zones` panes in the loading state.
   Add a `.catch()` that calls `setLoading(false)` with `session = null`.

## Important findings

4. **Photo `<Image>` has no `onError`**
   ([`photo-frame.tsx:122`](../../../mobile/components/cf/photo-frame.tsx#L122),
   [`photo-gallery.tsx:119`](../../../mobile/components/cf/photo-gallery.tsx#L119),
   [`photo-lightbox.tsx:83`](../../../mobile/components/cf/photo-lightbox.tsx#L83)).
   Add an `onError` prop that flips a local state to render the em-dash
   placeholder. Hot-linked NamUs/FBI/LASD URLs *will* 404 over the lifetime of
   any case (per `feedback_photo_sourcing_policy.md`); the silent broken-image
   today reads as design, not failure.

5. **Map tile-server failure has no UI**. WebView-based renderers
   ([`leaflet-map.tsx`](../../../mobile/components/cf/leaflet-map.tsx),
   [`draw-zone-map.tsx`](../../../mobile/components/cf/draw-zone-map.tsx)) need
   either an `onHttpError` callback that shows "Map unavailable — pan/zoom
   later" or a baseline of pin-only rendering against a known background. As-is
   the user sees pins floating in grey.

6. **`zone/[id].tsx` `cases_in_polygon` permanent-spinner gap**
   ([line 81](../../../mobile/app/zone/[id].tsx#L81)). Add the rejection arm.

7. **`takedown-request/[slug].tsx` case-summary fetch silently swallows failure**
   ([line 94](../../../mobile/app/takedown-request/[slug].tsx#L94)). Surface
   a "Couldn't load this case" inline so the user knows whether to try again
   or proceed.

8. **`useSavedCases` hydration error returns empty rows silently**
   ([line 199-205](../../../mobile/lib/hooks/use-saved-cases.ts#L199)). The
   only signal is `loading` flipping back to false. A user with 30 saved
   cases sees "No saved cases yet" on a network blip.

9. **Raw error messages bubbled to `Alert` and inline error rows**:
   - [`notifications.tsx:65-82`](../../../mobile/app/notifications.tsx#L65) —
     `result.error` → Alert body.
   - [`delete-account.tsx:80`](../../../mobile/app/delete-account.tsx#L80) —
     `e.message` → inline.
   - [`sign-in.tsx:61`](../../../mobile/app/sign-in.tsx#L61) —
     `error.message` from `signInWithOtp` → inline.
   - [`watch-zone.tsx:504`](../../../mobile/app/watch-zone.tsx#L504),
     [`zone/[id].tsx:146,397`](../../../mobile/app/zone/[id].tsx#L146) —
     RPC error message → Alert body.

   These can read as `JWT expired` / `duplicate key value violates unique
   constraint "user_watches_pkey"` / `Failed to fetch`. Recommendation: a
   `humanizeError(err)` helper in `lib/` that maps known PostgREST/Supabase
   error codes to user-readable copy, falling back to a generic
   "Something went wrong" with a "Show details" toggle.

10. **`tip/[slug].tsx` doesn't surface `useCaseDetail` errors**
    ([line 76](../../../mobile/app/tip/[slug].tsx#L76)). The header silently
    degrades. Should mirror `case/[slug].tsx`'s loading/error gates.

## Informational

- **JSON.parse coverage is solid.** All 8 AsyncStorage `JSON.parse` sites
  ([`use-saved-cases.ts:41`](../../../mobile/lib/hooks/use-saved-cases.ts#L41),
  [`use-tip-history.ts:96`](../../../mobile/lib/hooks/use-tip-history.ts#L96),
  [`use-notification-prefs.ts:46`](../../../mobile/lib/hooks/use-notification-prefs.ts#L46),
  [`use-region-prefs.ts:36`](../../../mobile/lib/hooks/use-region-prefs.ts#L36),
  [`use-submitted-tips.ts:36`](../../../mobile/lib/hooks/use-submitted-tips.ts#L36),
  [`use-me-counts.ts:39`](../../../mobile/lib/hooks/use-me-counts.ts#L39),
  [`data-export.ts:69,82`](../../../mobile/lib/data-export.ts#L69)) wrap
  `JSON.parse` in `try { } catch { /* fallback to default */ }`. WebView
  message parse sites
  ([`leaflet-map.tsx:280`](../../../mobile/components/cf/leaflet-map.tsx#L280),
  [`draw-zone-map.tsx:82`](../../../mobile/components/cf/draw-zone-map.tsx#L82))
  are also wrapped. **Zero unguarded `JSON.parse` calls** — corrupt-storage
  crash class is fully neutralized.

- **AsyncStorage write-failure handling is consistent.** `setItem` calls in
  the prefs/saved-cases/install-id paths all use `.catch(() => {})` with an
  in-memory fallback, treating the persistence layer as best-effort
  ([`use-notification-prefs.ts:64`](../../../mobile/lib/hooks/use-notification-prefs.ts#L64),
  [`use-push-token.ts:85,200,228`](../../../mobile/lib/hooks/use-push-token.ts#L85)).
  Quota-exceeded on Android (~6MB AsyncStorage default) won't crash the app.

- **Push-notification payload parsing**
  ([`use-notification-router.ts:65-67`](../../../mobile/lib/hooks/use-notification-router.ts#L65))
  reads `response.notification.request.content.data as NotificationData | null
  | undefined` and `routeFromData` defensively type-checks `data.case_slug`
  before navigating. A malformed payload routes nowhere — same as a
  no-payload home-icon launch. Cold-launch replay is wrapped in `.catch(() => {})`.
  No crash class here.

- **Designer-mode fallbacks are uniformly correct.** Every read hook checks
  `isSupabaseConfigured()` and returns `SAMPLE_*` data when false. This means
  Expo-Go "demo mode" never hits a real network path — designer iteration
  loop stays unblocked even when ops swap Supabase keys. Per CLAUDE.md
  alignment.

- **`useNotificationPrefs.loadPrefs` graceful normalization**
  ([line 47-51](../../../mobile/lib/hooks/use-notification-prefs.ts#L47)) and
  `useRegionPrefs.loadPrefs` defensive coerce
  ([line 39-44](../../../mobile/lib/hooks/use-region-prefs.ts#L39)) — both
  shape-validate persisted JSON before trusting it. Future schema bumps
  won't crash on stale storage payloads.

- **Hooks-before-early-returns rule is observed throughout.** Every hook
  audited (use-case-detail, use-notification-prefs, use-region-prefs,
  use-push-token, use-saved-cases) declares all hooks at the top before any
  conditional return; loading flags live in state, not in a guard. CLAUDE.md
  rule is being followed in practice. The mechanical net (eslint
  `react-hooks/rules-of-hooks`) is the missing safety belt — confirm it's
  enabled in [`eslint.config.js`](../../../mobile/eslint.config.js).

- **Tip-flow has the cleanest end-to-end error story in the codebase.**
  [`tip/[slug].tsx:handleSubmit`](../../../mobile/app/tip/[slug].tsx#L102) +
  [`use-submit-tip.ts`](../../../mobile/lib/hooks/use-submit-tip.ts) catch
  every failure mode (Edge Function reject, no-target response, deep-link
  fail, network rejection) and present a `FallbackBar` with copy-link +
  call-tip-line affordances. This is the model the rest of the app should
  match.
