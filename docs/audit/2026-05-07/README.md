# Pre-Submission Audit — ColdFiles Mobile (2026-05-07)

Six audits run against the Google Play AAB target (`mobile/`):

- [Code Quality](./code-quality.md)
- [Security](./security.md)
- [Performance Profiler](./performance.md)
- [Auth & Session Review](./auth-session.md)
- [Data Security](./data-security.md)
- [Error Handling](./error-handling.md)

## Headline

The app is in a **shippable** state — no audit returned a Critical that should block the next AAB. Three cross-cutting themes account for almost everything that surfaced.

## Cross-cutting themes

### 1. Manifest drift is the biggest unforced error
Both the **Security** and **Data Security** audits flagged that the generated [`AndroidManifest.xml`](../../../mobile/android/app/src/main/AndroidManifest.xml) declares permissions that contradict what the JS code actually uses and what the privacy policy + Data Safety form commit to:

- `ACCESS_FINE_LOCATION` (auto-merged by `expo-location`) vs. COARSE-only declared in [`app.config.ts:74`](../../../mobile/app.config.ts#L74)
- `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` (no image-picker, no camera in deps)
- `SYSTEM_ALERT_WINDOW` (transitive auto-inject, never used)

Play reads the AAB, not Expo config — Console will surface "precise location," "Files and docs," and "Photos and videos" as collected data classes that the privacy policy explicitly disclaims. Fix is a clean `expo prebuild` plus `tools:node="remove"` overrides for the transitive injects.

### 2. AsyncStorage holds too much for a tip-routing app
**Security**, **Auth & Session**, and **Data Security** all converged on the same finding from different angles:

- [`lib/supabase.ts:43`](../../../mobile/lib/supabase.ts#L43) uses `AsyncStorage` for the Supabase JWT — `expo-secure-store` is not installed.
- `cf:submitted_tips:v1` (case slugs the user has tipped on) and saved-case slugs also live in AsyncStorage.
- [`AndroidManifest.xml:16`](../../../mobile/android/app/src/main/AndroidManifest.xml#L16) has `android:allowBackup="true"`, which means all of the above flows into Google Drive auto-backup.

Single fix lane: add `expo-secure-store`, migrate the auth `storage:` adapter, and either set `allowBackup="false"` or scope `<full-backup-content>` to exclude the sensitive AsyncStorage namespace. Native rebuild required — bundle this with the manifest cleanup above into one release.

### 3. Production-triage signal is dark
**Error Handling** found zero React error boundaries and zero crash reporter (Sentry/Crashlytics/Bugsnag — confirmed by zero-match grep across `mobile/`). Combined with the Hermes/Fabric blank-grey-screen failure mode that the project's `feedback_hooks_before_early_returns.md` memory documents, this means a render throw in production = silent user departure with no signal.

The **Code Quality** audit also confirms there's no CI gate forcing `tsc --noEmit` and `expo lint` before AAB build. A single pre-flight check (`npx tsc --noEmit && npx expo lint --max-warnings 0`) hooked into `eas build` closes the loop.

## Triage matrix

### Block-or-bundle-with-next-AAB (do these together since they all need a native rebuild)
1. **Manifest cleanup** — clean prebuild, `tools:node="remove"` for transitive permissions, set `allowBackup="false"`. (Security + Data Security)
2. **`expo-secure-store` for the auth session.** (Security + Auth + Data Security)
3. **Top-level React error boundary + crash reporter.** Sentry has the lightest Expo footprint; without it, the next blank-grey-screen incident will be invisible. (Error Handling)
4. **Account-deletion completeness** — verify `migrations/03_account_deletion_and_retention.sql` cascades `push_tokens` and clears `cf:push_registration:v1` locally. Add `onAuthStateChange` listener to re-register push tokens on user-id change. (Auth)
5. **Tile-vendor disclosure alignment** — privacy policy says "Mapbox," runtime is OpenFreeMap + CARTO. Update both [`mobile/app/privacy.tsx:91`](../../../mobile/app/privacy.tsx#L91) and [`app/legal/privacy/page.tsx:116`](../../../app/legal/privacy/page.tsx#L116). (Data Security)

### Important — next sprint (no native rebuild required)
- Convert `(tabs)/list.tsx` and `(tabs)/saved.tsx` from `<ScrollView>` + `.map()` to `FlatList` (template: `map-bottom-sheet.tsx` already does this correctly). (Performance)
- Switch the three photo call sites (`photo-frame`, `photo-gallery`, `photo-lightbox`) from `<Image>` to `expo-image` for memory + disk cache. (Performance)
- Drop `@maplibre/maplibre-react-native` if `MapsView` is genuinely dead — saves ~5–8MB. Confirm before removing. (Performance)
- `Linking.openURL` HTTPS-scheme guard at [`case-events-section.tsx:91`](../../../mobile/components/cf/case-events-section.tsx#L91). (Security)
- Surface auth-callback failure messages — both [`auth-callback.tsx:49`](../../../mobile/app/auth-callback.tsx#L49) and [`use-auth-callback.ts:48`](../../../mobile/lib/hooks/use-auth-callback.ts#L48) currently swallow expired-link errors. (Error Handling + Auth)
- Add `onError` to `<Image>` in photo components so 404s show a placeholder, not styled empty space. (Error Handling)
- Wrap raw PostgREST `error.message` `Alert`s in 5+ screens with user-readable copy. (Error Handling)
- De-duplicate `displayName(row)` re-implementations to use the canonical `lib/format.ts` (Doe-case label drift between screens). (Code Quality)
- Pre-flight CI gate: `npx tsc --noEmit && npx expo lint --max-warnings 0`. (Code Quality)

### Strong defaults to preserve (do not churn)
- Hooks-before-early-returns rule respected everywhere (load-bearing project rule). `react-hooks/rules-of-hooks` ESLint plugin is on.
- PKCE-only auth with explicit Android intent-hijack defense, code-comment-named.
- Anonymous-by-default tip submission with local SHA-256+salt — content never leaves the device.
- Photo-mirror policy structurally enforced upstream — client cannot accidentally hot-link a Charley/Doe HTTP source.
- Zero analytics/crash SDKs (intentional posture for a tip-line app).
- `tsc --noEmit` clean under `strict: true`.
- `npm audit`: 0 critical, 0 high.
- All 8 AsyncStorage `JSON.parse` sites have try/catch with fallbacks (zero corrupt-storage crash class).
- Tip-flow error handling is the model — handles Edge Function reject, no-target, deep-link fail, with copy-link + call-tip-line fallbacks.
- Single memoized Supabase client (no double-instance risk).
- Hermes + Fabric + React Compiler all correctly enabled.

## Coverage

| Audit | LOC | File |
| --- | --- | --- |
| Code Quality | 106 | [code-quality.md](./code-quality.md) |
| Security | 277 | [security.md](./security.md) |
| Performance | 349 | [performance.md](./performance.md) |
| Auth & Session | 130 | [auth-session.md](./auth-session.md) |
| Data Security | 282 | [data-security.md](./data-security.md) |
| Error Handling | 342 | [error-handling.md](./error-handling.md) |
