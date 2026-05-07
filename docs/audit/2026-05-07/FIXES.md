# Audit Fixes Applied — ColdFiles Mobile (2026-05-07)

All six audit reports' findings addressed across two waves of parallel agents. Working tree is dirty, no commits made — you decide branching/PR shape per CLAUDE.md's "PRs ship one surface or one theme" rule.

## What's green
- `cd mobile && npm run preflight` → `tsc --noEmit && expo lint --max-warnings 0` both pass.
- `npm install` already run (Wave 1A added `expo-secure-store ~15.0.7` to `package.json`).
- Lint baseline clean: 0 errors, 0 warnings (4 pre-existing warnings cleaned up in the final pass to make the new CI gate green from day one).

## What still needs YOUR action
1. **`npx expo prebuild --clean -p android`** — regenerates `AndroidManifest.xml` with the permission removals + `allowBackup="false"`. Required before next AAB.
2. **Append to root `.githooks/pre-push`** to wire the new mobile preflight gate (Wave 2D's pattern):
   ```sh
   echo "→ pre-push: mobile preflight"
   (cd mobile && npm run preflight)
   ```
3. **Verify `migrations/03_account_deletion_and_retention.sql` cascades `push_tokens`** — Wave 1A's account-deletion fix relies on the existing `auth.users` cascade to drop the server row. Sanity-check before relying on it.
4. **Decision: drop `@maplibre/maplibre-react-native`?** Performance audit estimates 5-8MB of dead native code. Wave 1C left it in place pending your call. If yes: `npm uninstall @maplibre/maplibre-react-native` + delete `MapsView` references.
5. **Decision: privacy-doc versioning?** Tile-vendor copy changed (CCPA service-provider enumeration). Wave 1B flagged that `tos-version.ts` covers Terms only. Either extend it to `legal-doc-versions.ts` or add a parallel `privacy-version.ts` + banner so existing users see the change.
6. **Decision: crash reporter?** Error boundary is wired with an `onError` seam at `mobile/components/cf/error-boundary.tsx`, but no Sentry/Crashlytics SDK installed (your "no analytics SDK" posture is intentional per the audit). When you want one, the seam plugs in cleanly.

## Wave 1A — Auth & Session hardening
- [`mobile/package.json`](../../../mobile/package.json) — `expo-secure-store ~15.0.7` added (SDK 54 line).
- [`mobile/lib/supabase.ts`](../../../mobile/lib/supabase.ts) — JWT moved from `AsyncStorage` to `expo-secure-store` (Keystore-backed). `requireAuthentication: false` so refresh doesn't biometric-prompt. Stale OAuth doc comment removed. PKCE + Android intent-hijack defense preserved.
- [`mobile/lib/hooks/use-push-token.ts`](../../../mobile/lib/hooks/use-push-token.ts) — `onAuthStateChange` listener: SIGNED_OUT clears local; SIGNED_IN re-registers if previously opted-in. Ref pattern to mount once.
- [`mobile/app/auth-callback.tsx`](../../../mobile/app/auth-callback.tsx) + [`mobile/lib/hooks/use-auth-callback.ts`](../../../mobile/lib/hooks/use-auth-callback.ts) — "Sign-in link expired" Alert with Back-to-sign-in. No-`?code=` silent redirect preserved (intent-hijack defense).
- [`mobile/app/delete-account.tsx`](../../../mobile/app/delete-account.tsx) — `unregisterPush()` before RPC, `multiRemove(['cf:push_registration:v1','cf:notif_prefs:v1'])` after success, friendly error copy + `console.warn` of raw, lint-error apostrophe fixed.

## Wave 1B — Native config + privacy alignment
- [`mobile/app.config.ts`](../../../mobile/app.config.ts) — inline `withTightenedAndroidManifest` plugin: `tools:node="remove"` for `ACCESS_FINE_LOCATION` / `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` / `SYSTEM_ALERT_WINDOW`; `allowBackup="false"` + `fullBackupContent="false"` on `<application>`. Uses transitive `expo/config-plugins`; no new deps.
- [`mobile/app/privacy.tsx`](../../../mobile/app/privacy.tsx) — "Mapbox" → OpenFreeMap + CARTO disclosure.
- [`app/legal/privacy/page.tsx`](../../../app/legal/privacy/page.tsx) — same alignment, web voice; `lastUpdated` bumped to 2026-05-07.

## Wave 1C — Performance hot paths
- [`mobile/app/(tabs)/list.tsx`](../../../mobile/app/(tabs)/list.tsx) — `ScrollView` + `.map()` → `FlatList` (`removeClippedSubviews`, `maxToRenderPerBatch=10`, `windowSize=7`, `initialNumToRender=12`). Header chrome in `ListHeaderComponent`. Horizontal-ScrollView `flexGrow:0/flexShrink:0` pinning preserved per memory rule.
- [`mobile/app/(tabs)/saved.tsx`](../../../mobile/app/(tabs)/saved.tsx) — both panes (cases + zones) virtualized with same knobs.
- [`mobile/components/cf/photo-frame.tsx`](../../../mobile/components/cf/photo-frame.tsx) + [`photo-gallery.tsx`](../../../mobile/components/cf/photo-gallery.tsx) + [`photo-lightbox.tsx`](../../../mobile/components/cf/photo-lightbox.tsx) — `<Image>` → `expo-image` with `cachePolicy="memory-disk"`, `transition={150}`, `onError` fallback to existing placeholder. Hot-link 404s no longer render as styled empty space.
- [`mobile/lib/hooks/use-cases-in-bbox.ts`](../../../mobile/lib/hooks/use-cases-in-bbox.ts) — `JSON.stringify` deps replaced with `useMemo`-stabilized join keys.
- [`mobile/lib/hooks/use-case-detail.ts`](../../../mobile/lib/hooks/use-case-detail.ts) — sequential → `Promise.all` parallel fan-out via PostgREST inner-join filter on `cases.slug`. Partial-failure semantics preserved.

## Wave 2D — Code quality cleanup
- [`mobile/lib/format.ts`](../../../mobile/lib/format.ts) — broadened canonical `displayName` to accept narrow map-tier rows; exported `alphaToDays(alpha)`.
- [`mobile/components/cf/case-row.tsx`](../../../mobile/components/cf/case-row.tsx) + [`(tabs)/saved.tsx`](../../../mobile/app/(tabs)/saved.tsx) — local `displayName` re-implementations removed; canonical imported. Doe-case label drift across screens fixed.
- [`mobile/app/(tabs)/index.tsx`](../../../mobile/app/(tabs)/index.tsx) + [`(tabs)/list.tsx`](../../../mobile/app/(tabs)/list.tsx) — `alphaToDays` deduplicated; canonical imported. Plus markers memo split in `index.tsx`: `baseMarkers` (cases-only, heavy) + `markers` (selectedSlug, cheap stamping). Both `useMemo`s stay before any conditional return.
- **Deleted (orphan)**: [`peek-sheet.tsx`](../../../mobile/components/cf/), [`map-canvas.tsx`](../../../mobile/components/cf/), [`watch-zone-map.tsx`](../../../mobile/components/cf/) — grep confirmed zero importers in production code.
- [`mobile/eas.json`](../../../mobile/eas.json) — `cli.requireCommit: true` (EAS refuses dirty-tree builds, forcing the commit/push path through the pre-push hook).
- [`mobile/package.json`](../../../mobile/package.json) — `"preflight": "tsc --noEmit && expo lint --max-warnings 0"` script added.
- [`mobile/.githooks/pre-push`](../../../mobile/.githooks/pre-push) — created (chmod +x), runs preflight from mobile/.

## Wave 2E — Error handling coverage
- **CREATED** [`mobile/components/cf/error-boundary.tsx`](../../../mobile/components/cf/error-boundary.tsx) — class component, `static getDerivedStateFromError`, `componentDidCatch` (`console.warn`), `reportError` seam + `onError` prop, amber-tinted fallback "Something broke. Tap to reload." with reset button.
- [`mobile/app/_layout.tsx`](../../../mobile/app/_layout.tsx) — `<ErrorBoundary>` wraps `<Stack>` + `OnboardingGate` + `StatusBar`. `useAuthCallback()` left mounted above the boundary so callback effects run regardless of render-error state.
- [`mobile/app/zone/[id].tsx`](../../../mobile/app/zone/[id].tsx) — `cases_in_polygon` rejection arm + `RefreshControl` retry, "Couldn't load cases for this zone. Pull to retry." inline copy. Delete + rename Alerts wrapped.
- [`mobile/app/watch-zone.tsx`](../../../mobile/app/watch-zone.tsx) — `cases_within_radius` error no longer masquerades as `onCount(0)`; chip flips to "COULDN'T PREVIEW ZONE COUNT". SaveSheet Alert wrapped.
- [`mobile/app/takedown-request/[slug].tsx`](../../../mobile/app/takedown-request/[slug].tsx) — visible inline error block on case-summary fetch failure. Submit Alert wrapped.
- [`mobile/app/notifications.tsx`](../../../mobile/app/notifications.tsx) + [`mobile/app/sign-in.tsx`](../../../mobile/app/sign-in.tsx) — raw PostgREST `error.message` Alerts replaced with friendly copy; raw `console.warn`'d.
- [`mobile/lib/hooks/use-user.ts`](../../../mobile/lib/hooks/use-user.ts) — `getSession()` rejection arm resolves to `session: null` (cold-launch hang fix).
- [`mobile/lib/hooks/use-saved-cases.ts`](../../../mobile/lib/hooks/use-saved-cases.ts) — hydration error `console.warn`'d (was silent).

## Final lint cleanup
- [`mobile/app/sign-in.tsx`](../../../mobile/app/sign-in.tsx) — unused `ActivityIndicator` import removed.
- [`mobile/app/case/[slug].tsx`](../../../mobile/app/case/[slug].tsx) — unused `formatDateMonthDay` removed from import.
- [`mobile/app/(tabs)/index.tsx`](../../../mobile/app/(tabs)/index.tsx) — unused `handleClearSelection` removed.
- [`mobile/components/cf/cases-near-case-section.tsx`](../../../mobile/components/cf/cases-near-case-section.tsx) — `Array<T>` → `T[]` style.

## Diff stat
```
32 files changed, 889 insertions(+), 626 deletions(-)
```
- Modified: 30
- Deleted: 3 (orphans)
- Created: 1 (`error-boundary.tsx`)
- Plus `.githooks/pre-push` + 6 audit reports + this file.

## Suggested PR shape (per CLAUDE.md "one surface or one theme" rule)
Five branches map cleanly to the wave structure. All preserve per-fix partial-revert via merge-commit (not squash) per the `.claude.md` "Multi-commit PRs preserve per-fix partial-revert" rule:

1. `fix/auth-secure-store` — Wave 1A files
2. `fix/android-manifest-tightening` — Wave 1B files (mobile + web privacy)
3. `feat/perf-virtualization-and-image-cache` — Wave 1C files
4. `chore/code-quality-dedup-and-ci-gate` — Wave 2D files (incl. orphan deletions)
5. `feat/error-boundary-and-coverage` — Wave 2E files

Lint-cleanup commits (4 trivial edits) can ride along on whichever branch touches the same surface (sign-in.tsx → branch 5; case/[slug].tsx → branch 5; (tabs)/index.tsx → branch 4; cases-near-case-section.tsx → standalone or branch 4).

Branches 1+2 require a native rebuild → bundle into one release per CLAUDE.md "Release sequence" (release branch, version bump, tag, build, merge before AAB upload). Branches 3+4+5 do not.
