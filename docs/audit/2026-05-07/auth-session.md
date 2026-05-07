# Auth & Session Review — ColdFiles Mobile (2026-05-07)

## Summary

ColdFiles uses Supabase email magic-link auth (`signInWithOtp`) with PKCE flow, persisted to `AsyncStorage`. The client is correctly initialized once via a memoized factory, the deep-link callback ignores implicit-flow tokens (closing the Android intent-hijack vector that's called out explicitly in code comments), and most surfaces work anonymously — saved cases, tip submission, push registration, and case browsing all run pre-auth. Auth gating is consistent: only **watch zones** and **account deletion / data export** require a session.

Top three concerns:
1. **Session JWT lives in unencrypted `AsyncStorage`** — Keystore-backed [`expo-secure-store`](https://docs.expo.dev/versions/latest/sdk/securestore/) is not installed. For a tip-routing app whose audit log is the bridge between an email and a case-of-interest, a rooted/dumped device leaks the refresh token in plaintext.
2. **Sign-out is partial** — only the Supabase session is cleared. Saved cases, submitted-tip receipts, install id, and the local push registration id are *intentionally* retained, but the push token row server-side keeps `user_id` until orphan-prune runs, and there's no token rotation when account A signs out and account B signs in on the same device.
3. **Account deletion does not unregister the push token** — `delete_my_account` RPC nulls tip-routing user_id and deletes auth.users, but the local `cf:push_registration:v1` AsyncStorage row and the server-side `push_tokens` row both linger. Next launch silently keeps pushing to that device using the *deleted* user's prior subscription state until the orphan-prune sweeps.

## Session lifecycle

**Init.** Single memoized client per process via [`getSupabase()`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/supabase.ts#L34) — `cached` module-level closure means every import reuses one client. No double-instance risk.

Configuration ([`lib/supabase.ts:42-54`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/supabase.ts#L42)):
- `storage: AsyncStorage` — unencrypted on Android (see Critical findings).
- `persistSession: true` — correct for staying signed in across launches.
- `autoRefreshToken: true` — refresh handled by supabase-js's internal timer.
- `detectSessionInUrl: false` — correct for RN (no `window.location`).
- `flowType: 'pkce'` — the right call. Comments on lines 50-53 cite the Android intent-hijack rationale.

**Persist.** Session blob written to `AsyncStorage` under supabase-js's default keys. Survives cold launches.

**Refresh.** `autoRefreshToken: true` schedules refreshes inside supabase-js. There is no explicit `AppState` listener nor a `Notifications.subscribeOnTokenRefresh`-style hook for "app came to foreground after long background." When the app is backgrounded for >1h with the access token already expired, the refresh fires on next foreground via the next API call — supabase-js handles this transparently. Acceptable.

**Auth state observation.** [`useUser`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-user.ts) calls `getSession()` once on mount + subscribes to `onAuthStateChange`. Correct shape.

## Sign-in flow

**Provider.** Email-only magic link via `signInWithOtp` ([`use-user.ts:71`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-user.ts#L71)). No password, no OAuth, no Apple/Google. Despite the comment in `lib/supabase.ts:11` claiming "OAuth (Apple / Google) is wired through the same client when available," there's no UI path for it. Stale doc comment, not a bug.

**Deep link.** Magic-link email lands on `coldfile://auth-callback?code=…`. Two redundant handlers cooperate:
- [`useAuthCallback`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-auth-callback.ts) wired in `app/_layout.tsx:107` — handles cold launch + warm.
- [`app/auth-callback.tsx`](/Users/jtroy/Desktop/ColdFiles/mobile/app/auth-callback.tsx) renders a spinner and re-runs the same exchange on direct-route landing.

Both paths:
1. Read the URL via `Linking.getInitialURL()` (cold) or `addEventListener('url')` (warm).
2. Match `[?&]code=([^&#]+)` regex — **ignore URL-hash fragments** (implicit-flow tokens are never honored). This matters: the deep-link scheme `coldfile://` can be claimed by any installed Android app, so any token-bearing fragment URL would be untrusted. PKCE binds the exchange to the originating device's verifier, which is in keychain/AsyncStorage — even if an attacker intercepts the deep link, they cannot complete the exchange. Correct posture; well-defended in code comments at [`auth-callback.tsx:38-43`](/Users/jtroy/Desktop/ColdFiles/mobile/app/auth-callback.tsx#L38) and [`use-auth-callback.ts:38-42`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-auth-callback.ts#L38).
3. Call `exchangeCodeForSession(code)` — supabase-js validates the issuer and PKCE verifier server-side.
4. Replace to `/`.

The `auth-callback.tsx` route also has `gestureEnabled: false` ([`_layout.tsx:150`](/Users/jtroy/Desktop/ColdFiles/mobile/app/_layout.tsx#L150)) so swipe-back can't strand the user mid-exchange. Good defensive UX.

**No additional issuer/nonce validation.** The redirect URL comparison is a `startsWith(REDIRECT_PREFIX)` (literal `coldfile://auth-callback`). The actual security guarantee is upstream — Supabase's PKCE handshake authenticates `code` against a verifier the client mints. A user pasting another account's magic link would simply not have the matching verifier and `exchangeCodeForSession` would fail. Correct, though the silent `catch {}` in both callback handlers leaves the user staring at a spinner-then-home with no error surfaced (see Important findings).

**Error paths.** `signInWithEmail` returns `{ error }` and the screen renders `errorMessage`. The callback's `catch {}` is silent — comment says "UI re-prompts via the sign-in screen" but the user sees a spinner → home redirect with no toast.

## Sign-out / account deletion

**Sign-out** ([`use-user.ts:84`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-user.ts#L84)) — calls `supabase.auth.signOut()` only. The Me-tab confirm dialog ([`me.tsx:42-57`](/Users/jtroy/Desktop/ColdFiles/mobile/app/(tabs)/me.tsx#L42)) explicitly tells the user "Saved cases on this device stay where they are. Watch zones and synced data go away until you sign back in." That's truthful for the local artifacts (saved cases, submitted-tip receipts, region prefs, notification prefs all live in AsyncStorage and persist across sessions intentionally), but two things still leak:

- **Push token registration**: [`use-push-token.ts:217`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-push-token.ts#L217) `unregister()` exists but is NOT called by `signOut`. The local `cf:push_registration:v1` row stays. The server's `push_tokens` row keeps `user_id = <previous user>` until the orphan-prune job runs (which the comment says is v1.0.2, current version per `app.config.ts:16` is `1.0.3` — this should be verified).
- **Install id** (`cf:install_id:v1`) — survives sign-out (intentional per the use-push-token doc-comment design), but means a second user signing in inherits the same install identity. The RPC's `coalesce(excluded.user_id, push_tokens.user_id)` would re-key the row to the new user, so this is contained — but only when `requestAndRegister` runs again.

**Account deletion** ([`app/delete-account.tsx`](/Users/jtroy/Desktop/ColdFiles/mobile/app/delete-account.tsx)) — invokes `delete_my_account` RPC, then `signOut()`, then `router.replace('/')`. The RPC (per the file's own doc-comment) nulls `user_id` on tip-routing rows and deletes `auth.users`, cascading `user_watches` + `user_subscriptions`.

What this does NOT clean up on the device:
- Saved cases (`cf:saved_cases:v1`).
- Submitted-tip receipts (`cf:submitted_tips:v1`).
- Notification prefs (`cf:notification_prefs:v1`).
- Region prefs (`cf:region_prefs:v1`).
- TOS-version stamp.
- Push registration id (`cf:push_registration:v1`).
- Install id (`cf:install_id:v1`).
- Onboarding flag.

The screen body claims "Saved cases synced to your account (device-local saves stay until you sign out)" and "Watch zones and notification preferences" are removed — but **notification prefs are AsyncStorage-only and are NOT deleted**. The copy is misleading. See Important findings.

## Anonymous-user UX

What works without sign-in:
- All read paths (case list, case detail, map, search, near-me, regions).
- Saved cases (device-local AsyncStorage).
- Tip submission — `tip-route-submit` Edge Function is invoked without a session header expectation; the user-id link is null per [`use-submitted-tips.ts:6`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-submitted-tips.ts#L6) ("the schema's tip_routings.user_id is null for anonymous tips"). Correct posture for a tip-routing app: the tip-line trust contract requires anonymity be the default, not the upgrade.
- Push notifications — `register_push_token` accepts an `install_id` keyed row when `auth.uid()` is null. Watch-zone alerts deferred but the registration plumbing works pre-auth.
- Submitted-tips history (device-local).
- Data export — degrades to local-only artifacts when no session.
- Takedown request, privacy, terms, about, diagnostics, region prefs, notification prefs.

What requires auth:
- **Watch zones** — gated explicitly in [`watch-zone.tsx:98-101`](/Users/jtroy/Desktop/ColdFiles/mobile/app/watch-zone.tsx#L98) with a sign-in gate that has good copy ("Watch zones live with your account so you can check them across devices"). The hook also returns empty when not signed in ([`use-watch-zones.ts:65-69`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-watch-zones.ts#L65)).
- **Account deletion** — falls through to "You are not signed in" copy.
- **Data export** of watch zones — RPC body falls through to empty array if no session ([`data-export.ts:99-100`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/data-export.ts#L99)).

Gating is consistent and correctly minimal: nothing is gated for gating's sake. The Saved tab works for both segments (cases work pre-auth, zones segment shows empty state pre-auth). Strong showing.

## Critical findings

- **Session JWT in plaintext AsyncStorage on Android.** [`lib/supabase.ts:43`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/supabase.ts#L43) sets `storage: AsyncStorage`. On Android, AsyncStorage backs to an SQLite DB under `/data/data/com.matteblackdev.coldfile/databases/RKStorage` — readable by any process with root, by `adb backup` on debuggable builds, and dumpable by anyone with physical-device access on a rooted phone. The threat model for a tip-routing app explicitly includes a hostile spouse / coercive party with device access; the refresh token is the bridge from "I have your phone" to "I have your tip-line audit history server-side" (via the user_id linkage on tip_routings). [`expo-secure-store`](https://docs.expo.dev/versions/latest/sdk/securestore/) wraps Android Keystore + iOS Keychain and Supabase-js accepts it as the `storage` option directly. This is a one-import, one-line config change and a `npx expo prebuild` rebuild. Recommend before next AAB.

- **Account deletion leaves the push token authorized server-side.** [`app/delete-account.tsx:74-77`](/Users/jtroy/Desktop/ColdFiles/mobile/app/delete-account.tsx#L74) calls `delete_my_account` then `signOut()`, but never calls `unregister()` from `usePushToken`. The push_tokens row has its `user_id` cascade-dropped (per the RPC behavior, since `auth.users` cascades), but the `expo_push_token` row itself is keyed on token uniqueness, not user_id — and the install-id keyed row remains valid for fan-out. If the server's fan-out logic targets `install_id` rows where `user_id IS NULL` (the documented anon path), a deleted account's device continues receiving notifications it was subscribed to. Verify the cascade in `migrations/03_account_deletion_and_retention.sql` actually drops the push_tokens row, OR add `unregister()` + clear `cf:push_registration:v1` to the delete flow.

- **Stale push subscription on user-A → user-B sign-in on the same device.** [`use-push-token.ts:217-229`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-push-token.ts#L217) `unregister()` only clears local state. There's no rotation hook on auth-state-change; if user A signs out and user B signs in, user B inherits user A's `install_id`-keyed push subscription preferences AND watch-zone subscriptions until B re-runs `requestAndRegister`. The RPC's `coalesce` re-keys to B on the next register, but until that fires, push fan-out targeting "device with install_id X" is ambiguous. Add an `onAuthStateChange` listener that calls `unregister()` on `SIGNED_OUT` and re-runs registration on `SIGNED_IN` if the prior user_id differs.

## Important findings

- **Delete-account body copy says we delete notification prefs; we don't.** [`app/delete-account.tsx:138`](/Users/jtroy/Desktop/ColdFiles/mobile/app/delete-account.tsx#L138) lists "Watch zones and notification preferences" in the deletion summary. The watch zones part is true (RPC cascade). Notification prefs (`cf:notification_prefs:v1`, AsyncStorage) are NOT touched by the RPC and survive across deletion. Either (a) delete them in `runDelete` after the RPC succeeds, or (b) edit the copy to "Watch zones." This is the cleanest fix — and matches the privacy-policy posture that local prefs are not user-identifying.

- **Silent error in auth-callback handler.** Both [`auth-callback.tsx:49-51`](/Users/jtroy/Desktop/ColdFiles/mobile/app/auth-callback.tsx#L49) and [`use-auth-callback.ts:48-50`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-auth-callback.ts#L48) `catch {}` the `exchangeCodeForSession` rejection. Comments say "Code expired or invalid — UI re-prompts via the sign-in screen" but in practice the route replaces to `/` after a silent failure with no UX signal. A user clicking a 60-minutes-old magic link sees: tap → spinner → home → no sign-in. Recommend surfacing the error (toast / banner / route to `/sign-in` with `?error=expired`).

- **`detectSessionInUrl: false` + the `auth-callback.tsx` route's spinner duplicates the global hook.** Both fire on cold launch with the same URL. `exchangeCodeForSession` is idempotent server-side (the code is single-use, second call errors), but means the second handler always silently fails. Working as intended per the file's own "duplicated rather than relying on the global hook" comment. Worth a one-line check: if `getSession()` already returns a valid session, skip the exchange. Defensive, low-priority.

- **`use-user.ts` registers `onAuthStateChange` once with no AppState awareness.** Backgrounding the app for >2h while the access token has refreshed multiple times means the in-memory session may be stale relative to AsyncStorage by the time the user foregrounds. supabase-js's auto-refresh handles the network side, but the React subscriber chain only fires on its own `onAuthStateChange` events. Worked example: app backgrounded with valid session → 90 min later refresh fires server-side → app foregrounded → useUser still has the OLD session object pointer until the next state change. Not a security issue (queries use the JWT from the supabase-js storage layer, which IS fresh), but it's a stale render trap if any UI keys off `session.expires_at`. None do today; flag for future auth-aware UI.

- **Doc-comment in `lib/supabase.ts:11` is stale.** Claims "OAuth (Apple / Google) is wired through the same client when available" — there's no OAuth path in the codebase. Either delete the comment or land the OAuth path. Stale comments age into believed-truth.

## Informational

- **Single Supabase client instance.** Memoized via module-level `cached` ([`lib/supabase.ts:28-44`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/supabase.ts#L28)). No risk of multiple clients, no race on session storage.

- **PKCE-only flow is the right call.** Code-comment defense at [`lib/supabase.ts:50-53`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/supabase.ts#L50) and the deep-link handlers explicitly ignore `#access_token=` fragments. This is the documented Android intent-hijack mitigation and it's deliberately load-bearing — do not regress to implicit flow.

- **Tip submission is anonymous-by-default and that's correct.** [`use-submit-tip.ts:91-101`](/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-submit-tip.ts#L91) calls `tip-route-submit` Edge Function with `case_id` + `content_hash`. The plaintext never leaves the device (hashed via `lib/hash.ts` first). If the user happens to be signed in, the JWT is sent in the Edge Function header by supabase-js automatically — so the audit row links to user_id. The privacy policy + delete-account copy explicitly call this out (12-month retention, link severed at deletion). Correct trust contract.

- **No crash reporter, no analytics SDK.** `app.config.ts:3` mentions "future Sentry/Stripe/etc keys" but neither is wired. No third-party SDK leaks user identifier via stack traces. Strong default posture.

- **No user identifier in URLs.** Routes use case slugs, zone ids (UUIDs from RPC), tip slugs. No `?user_id=` anywhere. Confirmed via grep — only references are in privacy/delete-account copy explaining what user_id means.

- **OnboardingGate runs before auth state settles** ([`_layout.tsx:211-222`](/Users/jtroy/Desktop/ColdFiles/mobile/app/_layout.tsx#L211)) — fine because the gate only redirects on `state === 'pending'` (first launch), and that is decided independently of auth.

- **Hooks-before-early-return rule honored throughout.** `watch-zone.tsx:90-101` even has the explicit comment block warning future editors not to add hooks below the gate. Matches CLAUDE.md.

- **`global.headers` includes `'x-cold-file-client': 'mobile'`** — useful surface tagging in Postgres logs, no PII.

- **Open-redirect check is not applicable** — the auth-callback only fires on the `coldfile://auth-callback` scheme registered in `app.config.ts:19`. `Linking.getInitialURL` returns the OS-delivered URL bound to the registered scheme. There is no open-redirect surface for an attacker to exploit.

- **Token-leak via referrer is not applicable** — this is a native app, not a web view. No `Referer` header to leak.

- **`expo-secure-store` is not in `mobile/package.json`** — confirmed by grep on `package-lock.json`. Adding it for the Critical-finding-1 fix is a clean dependency add (no transitive risk; it's a first-party Expo module).
