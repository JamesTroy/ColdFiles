# Data Security Audit — ColdFiles Mobile (2026-05-07)

## Summary

The app's data-handling posture is unusually conservative for the category: tip
content is hashed locally and never leaves the device, location is COARSE-only
in the Expo config with passive `Accuracy.Balanced` watching, no analytics or
crash SDK is wired in, all backend traffic terminates at Supabase over TLS,
and the in-app *Privacy* / *Delete account* / *Download my data* screens
exist and call live RPCs. The architecture is materially aligned with what
the user wants to declare on the Play Data Safety form.

Three issues account for the bulk of risk:

1. **Manifest / config drift** — the generated [`AndroidManifest.xml`](../../../mobile/android/app/src/main/AndroidManifest.xml)
   declares `ACCESS_FINE_LOCATION`, `READ_EXTERNAL_STORAGE`,
   `WRITE_EXTERNAL_STORAGE`, and `SYSTEM_ALERT_WINDOW` even though
   [`mobile/app.config.ts`](../../../mobile/app.config.ts) only lists
   `ACCESS_COARSE_LOCATION`. Play Console will flag the AAB's effective
   permissions, not the Expo config — which means the Data Safety form will
   read "precise location" and "device storage" even though the privacy
   policy commits to neither.
2. **`android:allowBackup="true"`** in the manifest. Every AsyncStorage key
   (`cf:saved_cases:v1`, `cf:submitted_tips:v1`, `cf:install_id:v1`,
   `cf:push_registration:v1`, the Supabase auth session) lands in Google
   Drive auto-backup unencrypted-at-OS-level on devices with backup enabled.
   Tip receipts and saved-case slugs are arguably the most identifying
   PII the app holds.
3. **In-app privacy policy claims a different tile vendor than the app
   actually uses** — [`mobile/app/privacy.tsx:91`](../../../mobile/app/privacy.tsx)
   discloses Mapbox; the runtime stack uses `tiles.openfreemap.org` (MapLibre
   path, [`constants/theme.ts:227`](../../../mobile/constants/theme.ts)) and
   `basemaps.cartocdn.com` (WebView Leaflet fallback,
   [`components/cf/leaflet-map.tsx:761`](../../../mobile/components/cf/leaflet-map.tsx)).
   The web policy at [`app/legal/privacy/page.tsx:116`](../../../app/legal/privacy/page.tsx)
   says "OpenStreetMap" — also not literally the vendor the user IP reaches.

None of these are exfiltration paths. They're posture-vs-claim mismatches
that surface as Play Console rejections, CCPA-disclosure inaccuracy, or
backup-leakage on a lost device.

## Data classes the app touches

| Class | Collected? | Stored where | In transit to | Linked to user | Play DSF declaration |
| --- | --- | --- | --- | --- | --- |
| Approximate location | Yes (foreground only, on user request via `requestAndAcquire`) | Not retained — used in the radius RPC, discarded after the response | Supabase (`cases_within_radius`, `cases_in_bbox` RPCs) | No (lat/lng not persisted server-side) | **Approximate location** — collected, not shared, not linked, optional, "App functionality" |
| Watch zone polygon | Yes (only if user draws one) | `user_watches` table on Supabase (RLS-gated) | Supabase | Yes (auth.uid()) | **Approximate location** (geometry the user drew, not real-time location) — collected, not shared, linked, optional, "App functionality" |
| Email | Yes (sign-in only; app works without an account) | Supabase Auth (`auth.users`) | Supabase, Resend (magic-link delivery only) | Yes | **Email address** — collected, not shared, linked, optional, "Account management" |
| Push token (Expo `ExponentPushToken[…]`) | Yes (only if user grants notif permission) | `push_tokens` table on Supabase | Supabase, Expo Push relay → APNs/FCM | Maybe (linked to auth.uid() when authed; install_id-keyed otherwise) | **Other identifiers — Device or other IDs** — collected, not shared, linked-when-authed, optional, "App functionality" |
| Install UUID (`cf:install_id:v1`) | Yes (generated client-side at first push registration) | AsyncStorage + `push_tokens.install_id` | Supabase | Maybe (joined to user_id when authed) | Subsumed under "Device or other IDs" above |
| Tip content hash | Yes (SHA-256 of salted user-typed text) | `tip_routings.content_hash` | Supabase, Edge Function `tip-route-submit` | Yes (when authed; `user_id` nulled at account delete) | NOT a Data Safety class — hash is non-reversible, not user data per the form taxonomy |
| Tip plaintext content | **NO — hashed locally, never transmitted** | Never persisted | Never transmitted | N/A | NOT collected |
| Submitted-tip receipts (case slug + agency name) | Yes (device-local only) | AsyncStorage (`cf:submitted_tips:v1`) | Never transmitted | Device-local | NOT collected by the developer per Play taxonomy (lives only on the user's device) |
| Saved cases | Yes (device-local; auth-side sync deferred) | AsyncStorage (`cf:saved_cases:v1`) | Never transmitted today | Device-local | NOT collected |
| One-way IP hash | Server-side only — set by Edge Function | `tip_routings.ip_hash` (server) | N/A (set at the Edge Function, never round-trips to the client) | When authed | **IP address** in the in-app policy enumeration; on Play DSF, hashed IP for abuse prevention can be declared under "App activity → App diagnostics" or omitted-as-not-collected if it never leaves Supabase as PII |
| User-agent summary (`mobile/expo`) | Yes (sent with tip routing) | `tip_routings` row (server) | Supabase | When authed | "App diagnostics" — collected, not shared, linked, required, "Fraud prevention/security" |
| Photos (user-captured) | **NO** — `expo-image-picker` is NOT in `dependencies`, no `expo-camera`, no media-capture path. App only displays agency photos. | N/A | N/A | N/A | NOT collected. Agency case photos shown via `<Image source={{ uri }}>` are content the *app displays*, not user data. |
| Contacts | NO | — | — | — | NOT collected |
| Financial info | NO | — | — | — | NOT collected |
| Sensitive personal info | NO (no health, no orientation, no political, no biometric) | — | — | — | NOT collected |
| Notification preferences | Yes (toggles + push prefs JSON) | AsyncStorage (`cf:notif_prefs:v1`) + `push_tokens.prefs` | Supabase | When registered | "App activity" or "App preferences" — collected, not shared, linked, optional, "App functionality" |
| In-app activity (saved-tab segment, map-zones-visible flag, last-seen TOS version) | Yes | AsyncStorage only (`cf:saved_segment:v1`, `cf:zones_visible:v1`, `cf:tos_seen:v1`) | Never transmitted | Device-local | NOT collected (developer never sees these values) |
| Crash data, performance data, analytics | **NO** — no Sentry, Bugsnag, Firebase Analytics, Amplitude, PostHog, Mixpanel, or Segment SDK present | — | — | — | NOT collected |

## Data-at-rest

All persistent client state lives in **AsyncStorage** (unencrypted in the app
sandbox). No `expo-secure-store`, no `expo-sqlite`, no `expo-file-system`
in dependencies — confirmed against [`mobile/package.json`](../../../mobile/package.json).

- **Supabase auth session (JWT, refresh token):** [`mobile/lib/supabase.ts:43`](../../../mobile/lib/supabase.ts) — `storage: AsyncStorage`. PKCE flow is enabled which closes the deep-link intent-hijack vector; the token itself sits in plaintext AsyncStorage, which is OS-sandbox protected on a non-rooted device but is **caught by Android auto-backup** (see Critical findings).
- **Saved cases:** [`mobile/lib/hooks/use-saved-cases.ts:23`](../../../mobile/lib/hooks/use-saved-cases.ts) — key `cf:saved_cases:v1`, JSON map of slugs → savedAt. No server copy today.
- **Submitted-tip receipts:** [`mobile/lib/hooks/use-submitted-tips.ts:18`](../../../mobile/lib/hooks/use-submitted-tips.ts) — key `cf:submitted_tips:v1`, JSON map of slugs → { agencyName, submittedAt }. Local-only; the server-side equivalent is the routing audit row keyed by user_id (when authed) or unauthenticated.
- **Install ID:** [`mobile/lib/hooks/use-push-token.ts:40`](../../../mobile/lib/hooks/use-push-token.ts) — key `cf:install_id:v1`, generated via `crypto.randomUUID()` (or `Math.random` fallback). Comment at lines 76-78 explicitly notes "not security-load-bearing (it's a row-keying token, not a secret)" — fine.
- **Push registration row id:** same file, key `cf:push_registration:v1`. Server row id; not a credential.
- **Notification prefs:** [`mobile/lib/hooks/use-notification-prefs.ts`](../../../mobile/lib/hooks/use-notification-prefs.ts) — key `cf:notif_prefs:v1`.
- **Saved-tab segment + zones-visible flag + region prefs + last-seen TOS version:** [`mobile/app/(tabs)/saved.tsx:40`](../../../mobile/app/(tabs)/saved.tsx), [`mobile/app/(tabs)/index.tsx:80`](../../../mobile/app/(tabs)/index.tsx), [`mobile/lib/hooks/use-region-prefs.ts:32`](../../../mobile/lib/hooks/use-region-prefs.ts), [`mobile/lib/hooks/use-tos-version.ts:56`](../../../mobile/lib/hooks/use-tos-version.ts) — UI state.
- **Onboarding-completed flag:** [`mobile/lib/hooks/use-onboarding.ts:41`](../../../mobile/lib/hooks/use-onboarding.ts).

There is no SQLite / file-system cache. Photos shown on case detail render
through `<Image source={{ uri }}>` — Expo's image cache is in the OS image
cache, not a developer-managed store.

## Data-in-transit

- **Supabase (database, auth, RPC, Edge Functions):** TLS via `EXPO_PUBLIC_SUPABASE_URL`. Region is whatever the project was provisioned in (not visible in the client; declared in the Supabase dashboard). RPCs touched from the client: `cases_within_radius`, `cases_in_bbox`, `list_my_watch_zones`, `create_watch_zone`, `delete_watch_zone`, `register_push_token`, `update_push_token_prefs`, `delete_my_account`, `source_health`. Edge Functions invoked: `tip-route-submit`, `reverse-geocode` (called from [`mobile/app/watch-zone.tsx:475`](../../../mobile/app/watch-zone.tsx) on save-sheet open, sends the centroid coordinates).
- **OSM tile fetches (MapLibre Native path, when re-enabled):** `https://tiles.openfreemap.org/styles/dark` and downstream tile URLs. TLS. The user's IP address reaches `openfreemap.org` on every map pan/zoom.
- **OSM tile fetches (Leaflet WebView path, the v1 default per [`mobile/components/cf/maps-view.tsx:67`](../../../mobile/components/cf/maps-view.tsx)):** `https://{a|b|c|d}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png` ([`leaflet-map.tsx:761`](../../../mobile/components/cf/leaflet-map.tsx)). TLS. The user's IP reaches CARTO's CDN.
- **Push delivery:** Expo's push relay terminates the `ExponentPushToken[...]`; APNs/FCM delivery happens server-side from the Edge Functions, not from the mobile client. The mobile client's only outbound is the `register_push_token` RPC.
- **Magic-link email (sign-in):** Supabase Auth → Resend. From the client's perspective this is a single Supabase call; Resend never sees the device.
- **Coldfile.app outbound links:** [`mobile/app/case/[slug].tsx:90`](../../../mobile/app/case/[slug].tsx) — case share URL. [`mobile/app/privacy.tsx:3`](../../../mobile/app/privacy.tsx) — full-policy link. Not transmissions of user data; user-initiated browser handoffs.
- **Tip-target deep links:** [`mobile/app/tip/[slug].tsx:142`](../../../mobile/app/tip/[slug].tsx) — `Linking.openURL(target)` to whatever URL the `tip-route-submit` Edge Function returned (agency form, P3 tip line, `tel:` URI). The tip text never makes this trip — only the user's choice to go to the agency does.

No HTTP-only endpoints anywhere in the client paths.

## Third-party data flows

Per the user's framing in
`feedback_data_safety_form_distinctions.md`, the question is "to whom does
user data flow for *their own* purposes" — not "what vendors process data
on our behalf."

- **Supabase** — vendor processor. Database + auth + Edge Functions. NOT a "share" on Data Safety.
- **Resend** — vendor processor (transactional email for magic-link). NOT a "share" on Data Safety.
- **Expo Push relay** — vendor processor (token-based fan-out to APNs/FCM). NOT a "share."
- **Apple APNs / Google FCM** — platform delivery; per the Play DSF spec, FCM token-bound delivery is platform infrastructure, not a third-party share.
- **OpenFreeMap (`tiles.openfreemap.org`)** — community OSM tile service. The user's IP reaches it on every map render. **This is the one consumer-IP-leak that warrants disclosure** even though it's a vendor relationship — the form's "data shared" axis isn't about contracts, it's about whether user data leaves the device for someone other than the developer.
- **CARTO (`basemaps.cartocdn.com`)** — same shape. The current default map renderer (Leaflet WebView path) hits CARTO, not OpenFreeMap.
- **Vercel** — hosts `coldfile.app` (web). Mobile-app users only reach Vercel if they tap the "Full policy" link or the `coldfile.app/case/<slug>` share URL externally. Not in the app's own data path.

The privacy policy lists Supabase + APNs/FCM + Mapbox + Resend + Vercel — see the inaccuracy note about Mapbox in the Critical findings.

## Photo sourcing policy compliance

Per memory `feedback_photo_sourcing_policy.md`: NamUs / FBI / LASD can be
hot-linked; Charley Project / Doe Network must be mirrored to our Storage;
HTTP must be mirrored; NCMEC requires registration.

The mobile client does **not** make per-source decisions — the policy is
enforced upstream by the scraper before a `case_media` row is written.
Confirmed in [`mobile/lib/photo-policy.ts`](../../../mobile/lib/photo-policy.ts):

> "The 'no hot-link' guarantee for Charley Project / Doe Network is
> structurally enforced upstream — the scraper
> (`supabase/functions/_shared/media.ts`) downloads photo bytes to Supabase
> Storage BEFORE inserting the case_media row, and writes the Storage
> public URL into `url`. Every persisted case_media row therefore already
> points at our Storage, regardless of source. There is no separate
> `mirror_url` column."

`effectivePhotoUri()` returns whatever `media.url` already holds. There is
no client-side path where a Charley/Doe URL could be hot-linked — the
column has been mirrored at ingest time.

The only HTTP-only photo-display risk would be if a future migration
inserts a non-Storage URL into `case_media.url`. The mobile client has no
URL-scheme guard (e.g., reject `http://`); a misbehaving ingest path could
push an HTTP URL through `<Image>` without warning. Not currently a leak —
just a tripwire that doesn't exist.

## Critical findings

1. **`AndroidManifest.xml` carries permissions the privacy policy and Data
   Safety form do not declare.** The generated manifest at
   [`mobile/android/app/src/main/AndroidManifest.xml`](../../../mobile/android/app/src/main/AndroidManifest.xml)
   shipping in v1.0.3 includes:
   - `ACCESS_FINE_LOCATION` — but [`mobile/app.config.ts:74`](../../../mobile/app.config.ts) explicitly lists ONLY `ACCESS_COARSE_LOCATION`, with a comment that says fine-grained "would mismatch the privacy policy / Data Safety form, both of which declare approximate location only." Play Console reads the AAB's manifest, not the Expo config.
   - `READ_EXTERNAL_STORAGE` + `WRITE_EXTERNAL_STORAGE` — no media-capture, image-picker, or filesystem code path requires these. Likely a stale `expo prebuild` artefact from a prior dependency. Triggers Play's "Files and docs" / "Photos and videos" data-class declaration.
   - `SYSTEM_ALERT_WINDOW` — overlay permission. No code in the client uses it. Play flags this as a sensitive permission requiring justification.

   The fix is to regenerate `android/` from the current Expo config (`npx expo prebuild --clean -p android`) and verify the manifest before the next AAB. This audit does not apply the fix per scope.

2. **`android:allowBackup="true"`** at [`AndroidManifest.xml:16`](../../../mobile/android/app/src/main/AndroidManifest.xml). Effects:
   - The Supabase JWT session is in AsyncStorage and is therefore in Google Drive auto-backup. A user who restores a backup onto a device they don't own (or who doesn't realize backups are encrypted only at the GDrive layer) lands signed in as the prior user.
   - The full submitted-tip receipt store (`cf:submitted_tips:v1`) — case slugs the user has tipped on — backs up. This is the most identifying PII the app stores.
   - Saved cases similarly back up.

   Recommended posture for an app at this sensitivity tier is `android:allowBackup="false"` plus `android:fullBackupContent` rules excluding the Supabase auth keys, OR a documented decision that the threat model accepts cloud-backup exposure. The privacy policy currently says nothing about device backups.

3. **Tile-vendor disclosure mismatch.** [`mobile/app/privacy.tsx:91`](../../../mobile/app/privacy.tsx) discloses Mapbox. The runtime vendor is OpenFreeMap (MapLibre path) or CARTO (current Leaflet WebView path). Web policy [`app/legal/privacy/page.tsx:116`](../../../app/legal/privacy/page.tsx) says OpenStreetMap, which is also not literally true — OSM is the data source, but the IP-receiving CDN is OpenFreeMap or CARTO. CCPA §1798.130 requires accurate enumeration of service providers. Pick one source of truth and reconcile both surfaces.

## Important findings

4. **Web account-deletion path is asserted in code comments but unverified.**
   [`mobile/app/delete-account.tsx:15`](../../../mobile/app/delete-account.tsx)
   describes a web counterpart at `https://coldfile.app/account/delete`. Not
   in scope for this audit, but Play's deletion-self-service requirement
   wants both an in-app and a non-app path; if the `/account/delete` route
   doesn't exist on the web app, the Play declaration is incomplete.

5. **`use-here.ts` actively watches the user's location whenever the app is
   foregrounded after permission has been granted** ([`use-here.ts:147`](../../../mobile/lib/hooks/use-here.ts)). This is a `Location.Accuracy.Balanced` watch with `timeInterval: 5000`. The privacy policy says "Approximate location is used briefly when you ask the app to show cases near you." The actual behavior is "until permission is revoked, location updates flow at 5-second cadence in the foreground." The policy's "briefly when you ask" phrasing understates what the code does. Re-word the policy to match the code, or shorten the watch lifecycle to match the policy.

6. **`Constants.installationId` etc. are not used, but `cf:install_id:v1`
   is a developer-generated stable identifier.** Stable across uninstall
   only if AsyncStorage survives — which it does NOT through `adb uninstall`,
   but it DOES through allowBackup (see #2). For Play Data Safety, this is
   a "Device or other IDs" declaration; the install_id is linked to user_id
   server-side once the user signs in.

7. **Tip-routing audit log has user-id linkage.** [`use-submit-tip.ts`](../../../mobile/lib/hooks/use-submit-tip.ts)
   POSTs to `tip-route-submit` with `case_id`, `content_hash`, `user_agent_summary`. The Edge Function (server-side, not in this audit) inserts a `tip_routings` row with `auth.uid()` if authed. The privacy policy correctly discloses this. Account deletion ([`delete-account.tsx`](../../../mobile/app/delete-account.tsx)) calls `delete_my_account()` which the screen comments confirm "nulls user_id on the user's tip_routings rows" — that's the right shape.

8. **Reverse-geocode of watch-zone centroid sends coordinates to Supabase.**
   [`watch-zone.tsx:475`](../../../mobile/app/watch-zone.tsx) — when the
   save-sheet opens, the lat/lng of the centroid hits the `reverse-geocode`
   Edge Function for a default zone label. This is a deliberate one-shot,
   discarded after the response per the policy's "approximate location
   not retained" claim. Disclosure is accurate.

9. **`console.warn` at [`use-submit-tip.ts:111`](../../../mobile/lib/hooks/use-submit-tip.ts)** — the comment explicitly mentions logcat/Play-bug-reports as a re-identification vector and intentionally omits the slug from the warning. This is the right pattern; it's the only `console.*` call in `lib/` or `app/` that touches PII-adjacent state, and it has been audited.

10. **`google-services.json` is committed to the repo** — confirmed at
    [`mobile/google-services.json`](../../../mobile/google-services.json).
    The decision is documented in [`app.config.ts:46-55`](../../../mobile/app.config.ts) on the basis that Firebase Android API keys are package-name + SHA-1 restricted. This is the standard Expo-Firebase posture and not a finding by itself, just flagging it for the audit-trail.

11. **No crash / analytics SDK is wired in.** Direct evidence: zero matches for `Sentry`, `Bugsnag`, `firebase-analytics`, `@sentry`, `posthog`, `amplitude`, `mixpanel`, `segment` across the client tree (excluding node_modules). Data Safety form should declare "Crashlytics / analytics" as **not collected**.

## Play Data Safety form alignment

Apply the user's framing from `feedback_data_safety_form_distinctions.md`:
*source aggregation isn't user-data collection; vendor processing isn't
third-party "sharing."*

**Data classes to declare as collected:**

| Class | Collected | Shared | Linked | Optional | Purpose |
| --- | --- | --- | --- | --- | --- |
| Approximate location | Yes | No | No (radius queries are stateless) | Yes | App functionality |
| Approximate location (watch-zone polygon) | Yes | No | Yes | Yes | App functionality |
| Email address | Yes | No | Yes | Yes | Account management |
| Other identifiers — Device or other IDs (install_id + Expo push token) | Yes | No | When authed: Yes; otherwise: No | Yes | App functionality |
| App activity — App preferences (notification toggles) | Yes | No | When push-registered: Yes | Yes | App functionality |
| App activity — Other actions (tip routing audit row) | Yes | No | When authed: Yes | Optional in spirit (the user chose to submit) | Fraud prevention / security |
| App info / performance — Diagnostics (`x-cold-file-client: mobile` header, `userAgentSummary`) | Yes | No | Linked to row when authed | Required | Fraud prevention / security |

**Data classes to declare as NOT collected:**

- Personal info: name, address, phone, race, political/religious, orientation, other.
- Financial info: any.
- Health and fitness: any.
- Messages: emails, SMS, in-app messages from other users (none exist).
- Photos and videos: NOT collected — manifest's storage permissions notwithstanding (see Critical #1; the **app code never invokes a media-picker or camera**, so the declaration should match code-behavior, but you must first remove the manifest permissions for the Console to accept that).
- Audio: any.
- Files and docs: NOT collected — same caveat as Photos.
- Calendar / Contacts: any.
- App activity — In-app search history: explicitly NOT logged server-side.
- App activity — Web browsing: NOT collected.
- Crash logs / performance: NOT collected (no SDK wired in).

**On "sharing":** the Data Safety form defines sharing as transferring user
data to a third party for that party's own purposes. None of Supabase,
Expo Push, APNs, FCM, Resend, or Vercel meets that bar — they are vendor
processors under DPAs. Declare each Data Safety class as **not shared**.

The one nuance worth capturing in the form's free-text justification (or
on the in-app policy):

- Map tile vendors (OpenFreeMap and/or CARTO) receive the user's IP on every
  tile request. Per the user's memory, this is vendor processing, not a
  "share" — but the developer should reconcile the in-app policy
  ([`mobile/app/privacy.tsx:91`](../../../mobile/app/privacy.tsx)) and the web
  policy ([`app/legal/privacy/page.tsx:116`](../../../app/legal/privacy/page.tsx)) to
  name the actual vendor before submitting the form.

**Security practices to declare:**

- Data is encrypted in transit: **Yes** — all client-server traffic is TLS.
- You can request that data be deleted: **Yes** — in-app via [`delete-account.tsx`](../../../mobile/app/delete-account.tsx); the web counterpart should be verified before declaring it.
- Data isn't encrypted at rest (on-device): the manifest's `allowBackup="true"` plus AsyncStorage means **device-local data is not encrypted at rest beyond OS sandboxing**. Don't claim "all data encrypted at rest" without addressing Critical #2 first.
- Independent security review: state honestly per current state.

## File reference index

- [`/Users/jtroy/Desktop/ColdFiles/CLAUDE.md`](../../../CLAUDE.md)
- [`/Users/jtroy/Desktop/ColdFiles/SECURITY.md`](../../../SECURITY.md)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/app.config.ts`](../../../mobile/app.config.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/package.json`](../../../mobile/package.json)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/google-services.json`](../../../mobile/google-services.json)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/android/app/src/main/AndroidManifest.xml`](../../../mobile/android/app/src/main/AndroidManifest.xml)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/supabase.ts`](../../../mobile/lib/supabase.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/data-export.ts`](../../../mobile/lib/data-export.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/hash.ts`](../../../mobile/lib/hash.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/photo-policy.ts`](../../../mobile/lib/photo-policy.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/diagnostics.ts`](../../../mobile/lib/diagnostics.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-here.ts`](../../../mobile/lib/hooks/use-here.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-push-token.ts`](../../../mobile/lib/hooks/use-push-token.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-saved-cases.ts`](../../../mobile/lib/hooks/use-saved-cases.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-submitted-tips.ts`](../../../mobile/lib/hooks/use-submitted-tips.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-watch-zones.ts`](../../../mobile/lib/hooks/use-watch-zones.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-submit-tip.ts`](../../../mobile/lib/hooks/use-submit-tip.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/lib/hooks/use-notification-prefs.ts`](../../../mobile/lib/hooks/use-notification-prefs.ts)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/app/tip/[slug].tsx`](../../../mobile/app/tip/[slug].tsx)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/app/watch-zone.tsx`](../../../mobile/app/watch-zone.tsx)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/app/delete-account.tsx`](../../../mobile/app/delete-account.tsx)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/app/data-export.tsx`](../../../mobile/app/data-export.tsx)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/app/privacy.tsx`](../../../mobile/app/privacy.tsx)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/app/notifications.tsx`](../../../mobile/app/notifications.tsx)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/components/cf/leaflet-map.tsx`](../../../mobile/components/cf/leaflet-map.tsx)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/components/cf/photo-frame.tsx`](../../../mobile/components/cf/photo-frame.tsx)
- [`/Users/jtroy/Desktop/ColdFiles/mobile/constants/theme.ts`](../../../mobile/constants/theme.ts)
- [`/Users/jtroy/Desktop/ColdFiles/app/legal/privacy/page.tsx`](../../../app/legal/privacy/page.tsx)
