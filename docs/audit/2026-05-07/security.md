# Security Audit — ColdFiles Mobile (2026-05-07)

Scope: `/Users/jtroy/Desktop/ColdFiles/mobile/` only (the Android AAB
submitted to Google Play). Server-side concerns are noted only where the
mobile client is the load-bearing surface; everything else lives in
"Out-of-scope but worth flagging."

## Summary

Posture is solid for a v1.0.x submission. The auth flow is correctly
hardened (PKCE-only, implicit-flow path explicitly removed), no
service-role key is reachable from the bundle, all WebView surfaces use
local HTML with `mixedContentMode: 'never'` and a tight `originWhitelist`,
and there are no third-party analytics SDKs. `npm audit` reports zero
critical / high vulnerabilities.

Top three items, ranked by exploitability:

1. **Auth tokens in `AsyncStorage` (unencrypted at rest).** `lib/supabase.ts:43`.
   Architecturally a known trade-off, but worth tracking — on Android it
   means the JWT is recoverable from a rooted device or a compromised
   backup. Move to `expo-secure-store` (Android Keystore) before the
   tip-routing surface starts handling identifying tip content.
2. **Unrestricted `Linking.openURL(event.source_url)` in case events.**
   `components/cf/case-events-section.tsx:91`. Server-controlled URL;
   safe under correct RLS, but the client should still scheme-allowlist
   to `https:` so an injected `intent://` / `coldfile://` / `file://`
   row can't reach the OS dispatcher.
3. **Per-source photo URLs render via `Image.source = { uri }` with no
   scheme assertion.** `components/cf/photo-frame.tsx:122`. Persisted
   URLs are mirrored to Supabase Storage upstream so this is a
   defense-in-depth gap, not an active leak — but assert `https://` in
   `effectivePhotoUri` to make it structural.

## Critical (block release)

None. The shipped bundle does not contain a service-role key, secrets are
loaded from gitignored `.env` (not `app.config.ts`'s `extra`), and the
AAB-released AndroidManifest does not declare `usesCleartextTraffic=true`.

## Important

- **Auth-token persistence in `AsyncStorage`** —
  [`mobile/lib/supabase.ts:43`](../../../mobile/lib/supabase.ts).
  `storage: AsyncStorage` is documented and intentional, but on Android,
  AsyncStorage writes to plaintext SQLite under the app's data directory.
  On a non-rooted device sandboxing protects it; on rooted devices,
  unencrypted backups (`adb backup` against `allowBackup="true"` in
  the main manifest), or post-compromise exfil, the refresh token is
  recoverable. For the current threat model (anonymous tipping,
  saved-cases bookmarks) the impact is bounded — but watch zones (PII
  via location radius) and v1.0.2 tip-history sync raise the stakes.
  **Fix path:** plug `expo-secure-store` (Android Keystore + iOS
  Keychain) into the supabase client's `storage` option, or wrap with
  the Supabase recipe for SecureStore. Note: `android:allowBackup="true"`
  is set in
  [`mobile/android/app/src/main/AndroidManifest.xml:16`](../../../mobile/android/app/src/main/AndroidManifest.xml) —
  worth pairing the SecureStore move with `allowBackup="false"` (or a
  scoped backup-rules XML excluding the Supabase storage key).

- **`Linking.openURL` of server-controlled URL without scheme allowlist** —
  [`mobile/components/cf/case-events-section.tsx:91`](../../../mobile/components/cf/case-events-section.tsx).
  `void Linking.openURL(event.source_url)` is invoked on row tap with no
  scheme/host validation. Today the data flows from a scraped
  `case_events.source_url`; if a future ingest path or a write-RLS
  regression let an attacker inject `intent://...#Intent;...` or
  `coldfile://auth-callback?code=...` here, the OS dispatcher would
  honor it. Same shape applies to
  [`mobile/app/(tabs)/me.tsx:64`](../../../mobile/app/(tabs)/me.tsx)
  (mailto, fixed string — safe) and
  [`mobile/app/tip/[slug].tsx:142`](../../../mobile/app/tip/[slug].tsx)
  (server-resolved tip URL — same RLS dependency). **Fix:** require
  `^https?://` (or `^https://` once cleartext tips are ruled out) before
  `openURL` for any field that originates server-side.

- **Photo `Image` accepts arbitrary `uri`** —
  [`mobile/components/cf/photo-frame.tsx:122`](../../../mobile/components/cf/photo-frame.tsx).
  `effectivePhotoUri` only filters the `TODO_PHOTO_URL` placeholder; it
  does not assert `https://`. Per `lib/photo-policy.ts` the upstream
  scraper always rewrites to a Supabase Storage public URL, so in
  practice every persisted row is `https://*.supabase.co/...`. But a
  bad row (or a mis-mirrored ingest) could land an `http://` URI that
  Android RN would 1) refuse to load on production manifest (good —
  no `usesCleartextTraffic`), or 2) silently render a broken image.
  Cheap fix in `effectivePhotoUri`: `if (!url.startsWith('https://'))
  return null;`. Belt and suspenders.

## Informational

- **Supabase client uses anon key, not service-role.** Verified —
  [`mobile/lib/supabase.ts:25-26`](../../../mobile/lib/supabase.ts) reads
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The `EXPO_PUBLIC_` prefix bundles it
  into the AAB, which is correct for an anon key (RLS gates
  authorization). `mobile/.env.example` explicitly says "Service-role
  keys never go here." Posture is right.

- **`app.config.ts` `extra` contains no secrets.** Only `eas.projectId`,
  which is already a public identifier in EAS update URLs.
  [`mobile/app.config.ts:127-131`](../../../mobile/app.config.ts).

- **`google-services.json` is committed.** Not a finding —
  [`mobile/app.config.ts:42-56`](../../../mobile/app.config.ts) documents
  the rationale (Firebase Android keys are restricted by package name +
  SHA-1 fingerprint, so disclosure doesn't grant access outside the app).
  Standard Firebase posture.

- **Android permissions are minimum-necessary.**
  [`mobile/app.config.ts:74`](../../../mobile/app.config.ts) declares
  `ACCESS_COARSE_LOCATION` only. The generated AAB manifest at
  [`mobile/android/app/src/main/AndroidManifest.xml`](../../../mobile/android/app/src/main/AndroidManifest.xml)
  inherits this plus `INTERNET`, `VIBRATE`, `READ/WRITE_EXTERNAL_STORAGE`,
  and `SYSTEM_ALERT_WINDOW`. Two of these warrant a verification pass:
    - `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` are
      auto-injected by RN/Expo and effectively no-ops on API ≥ 33
      (scoped storage), but Play Console will still surface them in the
      permissions list. If nothing in the app reads/writes shared
      storage, set `tools:node="remove"` overrides via an Expo plugin
      or prebuild patch — keeps the Play listing tighter.
    - `SYSTEM_ALERT_WINDOW` (draw-over-other-apps) is a heavyweight
      permission. No app code requests it; likely auto-injected by a
      transitive dep (react-native-screens / gorhom bottom sheet?).
      Verify it's actually needed; if not, override it out.
    - `ACCESS_FINE_LOCATION` appears in the generated AAB manifest
      ([line 3](../../../mobile/android/app/src/main/AndroidManifest.xml))
      despite `app.config.ts` declaring only COARSE — `expo-location`
      auto-merges it. **This contradicts the in-comment claim**
      ([`app.config.ts:70-73`](../../../mobile/app.config.ts)) that
      FINE_LOCATION would mismatch the Data Safety form. Confirm before
      ship: either remove FINE via manifest merge override, or update
      the Data Safety declaration to match. This one matters — Play
      treats the discrepancy as a policy issue, not a naming nit.

- **Permission strings are explanatory.** `NSLocationWhenInUseUsageDescription`
  is set ([`app.config.ts:26`](../../../mobile/app.config.ts)). Android
  doesn't require runtime strings, but the privacy policy line "used
  briefly per query, not retained" is the substantive disclosure.

- **No cleartext traffic on the production AAB.** Cleartext
  `usesCleartextTraffic="true"` lives only in `debug` /
  `debugOptimized` manifests
  ([`mobile/android/app/src/debug/AndroidManifest.xml:6`](../../../mobile/android/app/src/debug/AndroidManifest.xml)),
  which are dev-only build variants, not the release AAB. Main manifest
  is clean.

- **No secrets in console logging.** A single `console.warn` exists at
  [`mobile/lib/hooks/use-submit-tip.ts:111`](../../../mobile/lib/hooks/use-submit-tip.ts):
  `'[useSubmitTip] receipt write failed'` — no slug, no content, no
  email. The comment on line 108-109 explicitly states slugs are
  excluded so logcat / Play bug-reports can't re-identify which case a
  user tipped on. Good hygiene.

- **WebView surfaces are tight.** Four WebView usages:
    - [`mobile/components/cf/leaflet-map.tsx:324`](../../../mobile/components/cf/leaflet-map.tsx)
    - [`mobile/components/cf/draw-zone-map.tsx:97`](../../../mobile/components/cf/draw-zone-map.tsx)
    - [`mobile/components/cf/case-location-map.tsx:61`](../../../mobile/components/cf/case-location-map.tsx)
    - [`mobile/components/cf/leaflet-watch-zone.tsx:78`](../../../mobile/components/cf/leaflet-watch-zone.tsx)

    All four ship local `source: { html }` (no remote-loaded WebView),
    set `mixedContentMode="never"`, and use a narrow `originWhitelist`
    (`basemaps.cartocdn.com` subdomains, `unpkg.com`, `about:blank`).
    `javaScriptEnabled` is on (required for Leaflet to function).
    `onMessage` handlers JSON.parse with try/catch and ignore malformed
    payloads
    ([`leaflet-map.tsx:309`](../../../mobile/components/cf/leaflet-map.tsx),
    [`draw-zone-map.tsx:86`](../../../mobile/components/cf/draw-zone-map.tsx)).
    `injectJavaScript` is used at
    [`draw-zone-map.tsx:67`](../../../mobile/components/cf/draw-zone-map.tsx)
    with `cfSetRadius(${radiusMeters})` — `radiusMeters` is a
    component-controlled number, not user/server input, so the
    template-literal interpolation is safe. **One nit:** the inlined
    Leaflet CSS/JS is loaded from `unpkg.com` with SRI integrity hashes
    on most refs; if `unpkg.com` is ever compromised the SRI catches
    it, but consider bundling Leaflet locally so the WebView has no
    network dependency at all (also helps offline UX).

- **Deep-link handling is hardened against the Android intent-hijack
  vector.**
  [`mobile/lib/hooks/use-auth-callback.ts:38-44`](../../../mobile/lib/hooks/use-auth-callback.ts)
  and
  [`mobile/app/auth-callback.tsx:40-44`](../../../mobile/app/auth-callback.tsx)
  both explicitly remove the implicit-flow URL-fragment path with a
  comment explaining why (a malicious app could have delivered
  attacker-controlled tokens via `coldfile://auth-callback#access_token=`).
  Only `?code=...` is honored, and PKCE binds the exchange to the
  originating device. Posture is correct and well-documented.

- **Tip flow.** Tip body is hashed locally with
  `expo-crypto`'s SHA-256 + a project salt before it leaves the device
  ([`mobile/lib/hash.ts:23`](../../../mobile/lib/hash.ts)) — the
  plaintext is never sent to Supabase. The salt is project-wide and
  documented as "pepper, not a security boundary"; this is correct
  framing — the hash is for dedupe / abuse signals, not confidentiality
  (since the user separately submits the plaintext to the agency form
  via the deep link). No replay-protection on the Edge Function call
  is observable from the client; the server-side rate-limiting and
  idempotency are out-of-scope for this audit but worth confirming
  separately. The receipt is written to AsyncStorage (slug + agency
  name + timestamp); on a rooted device this is recoverable, same
  caveat as the auth token.

- **No third-party analytics SDKs.** No Sentry, Mixpanel, Amplitude,
  Segment, or Firebase Analytics imports. The privacy policy at
  [`mobile/app/privacy.tsx:50`](../../../mobile/app/privacy.tsx) commits
  to "no third-party analytics that track you across apps" — code matches
  copy.

- **`app.config.ts` `runtimeVersion: { policy: 'appVersion' }` plus
  matching versionCode bump discipline.** Already tracked in
  `CLAUDE.md` "Release sequence" — worth noting that the OTA channel
  separation prevents an OTA from shipping a runtime contract change
  without a native rebuild, which is a security property as well as a
  release-correctness one.

## Dependency advisories (npm audit)

`cd mobile && npm audit --json` ran clean for the threat model: **0
critical, 0 high**.

Total: 4 moderate, all in dev-tooling chain (Expo CLI / Metro / PostCSS),
none in code that ships to the AAB.

| Package | Severity | Where | Notes |
| --- | --- | --- | --- |
| `postcss` | moderate (CWE-79) | dev — `@expo/metro-config` transitive | XSS via unescaped `</style>` in Stringify output. Affects build-time tooling only; not in the bundle. |
| `@expo/metro-config` | moderate | dev | Effect of the postcss issue. |
| `@expo/cli` | moderate | dev | Same chain. |
| `expo` | moderate (direct) | dev/runtime | Listed as direct but the advisory is for the CLI side. Fix is `expo@49.0.23` per the audit, which is a major-version downgrade from current `~54.0.33` and not appropriate. The advisory predates the current Expo line; treat as noise. |

Recommendation: no action required for ship. Re-run `npm audit` post
each Expo SDK bump and act on anything labeled high/critical.

## Out-of-scope but worth flagging

These are server-side or scraper-side concerns that surfaced while
auditing the mobile client. The mobile app is not the load-bearing
surface for any of them — track separately.

- **RLS coverage on every read path the mobile client uses.** Mobile
  hits `cases_within_radius` / `cases_in_bbox` (via Postgres RPC),
  `cases` (direct table read in `use-saved-cases.ts:159`), `case_media`,
  `case_events`, plus Edge Functions `tip-route-submit`,
  `takedown-submit`, and the `register_push_token` /
  `update_push_token_prefs` RPCs. The `SECURITY.md` explicitly calls
  out "soft-deleted cases, `takedown_requested_at` rows leaking through
  public read paths" as fast-response — the mobile read paths apply
  `.is('deleted_at', null)` client-side
  ([`use-saved-cases.ts:165`](../../../mobile/lib/hooks/use-saved-cases.ts),
  [`takedown-request/[slug].tsx:98`](../../../mobile/app/takedown-request/[slug].tsx)),
  but client-side filters are advisory. RLS must enforce takedown
  predicates server-side; verify in `migrations/`.

- **Edge Function auth on `tip-route-submit` / `takedown-submit`.** The
  client submits with the anon JWT
  ([`use-submit-tip.ts:91`](../../../mobile/lib/hooks/use-submit-tip.ts),
  [`takedown-request/[slug].tsx:135`](../../../mobile/app/takedown-request/[slug].tsx)).
  Since the surface is anonymous-tolerant by design (anon tips are a
  feature), the Edge Function side has to carry rate-limiting,
  per-IP/per-install spam controls, and content-hash uniqueness. None
  of these are visible from the mobile client.

- **`event.source_url` injection through ingest.** Already flagged
  above as a mobile-side fix (scheme allowlist before `openURL`), but
  the upstream concern is "what writes to `case_events.source_url`?"
  If any scraper path or RPC accepts unfiltered URLs, the audit at
  ingest time should reject non-`https://` schemes.

- **`SYSTEM_ALERT_WINDOW` in the generated manifest.** Track which
  transitive dep injected it; if it's gorhom bottom-sheet or
  react-native-screens you can override-remove via Expo plugin without
  losing functionality.

- **Push-fan-out auth.** `register_push_token` accepts an anonymous
  caller's `expo_push_token` + `install_id`. RLS / function security
  must prevent token-overwrite (an attacker registering with another
  user's `expo_push_token` to steal their push delivery). Out-of-scope
  here; verify the RPC body locks updates to rows where
  `auth.uid() = user_id` once a user is associated.
