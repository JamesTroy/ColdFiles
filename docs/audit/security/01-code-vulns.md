# Cold File — Code Security Audit (01)

**Scope:** Pre-Play-Store security review. v1.0.0 closed-testing branch (`main` @ `1e37123`).
**Stack covered:** Next.js 15 web (`app/`), Expo SDK 54 mobile (`mobile/`), Supabase Postgres + Edge Functions (`supabase/functions/`, `migrations/`).
**Audit date:** 2026-04-29.

Severity legend:
- 🔴 **CRITICAL** — exploitable now, ship-blocker
- 🟠 **HIGH** — real risk, fix before submission
- 🟡 **MEDIUM** — defense-in-depth, fix soon
- 🔵 **LOW** — informational

---

## 1. General Security

### 🟠 HIGH-1 — Anonymous client can write arbitrary `tip_routings` rows, bypassing the audit pipeline
**Files:** `migrations/01_schema.sql:639-641`; `supabase/functions/tip-route-submit/index.ts:81-94`
The RLS policy on `tip_routings` is:
```sql
create policy tip_routings_insert on tip_routings
  for insert with check (true);
```
Combined with the public anon key, **any unauthenticated client can `POST /rest/v1/tip_routings` directly**, skipping the Edge Function entirely. They can fabricate `case_id`, `routed_to_url`, `ip_hash`, `content_hash`, and `user_agent_summary` at will. Consequences:
- Audit log credibility is destroyed — no row in `tip_routings` is provably routed through `tip-route-submit`.
- Spammable: attacker fills the table to drown abuse signals (the 12-month purge in `migrations/03_…sql:92-96` doesn't help short-term).
- `routed_to_url` accepts arbitrary text — could be used for indirect link-injection if the URL is ever surfaced to a moderator UI.

**Fix:** Replace the open insert policy with one that allows insert ONLY when `current_user = service_role`, and have the Edge Function continue to do the insert with the service-role client (it already does, `tip-route-submit/index.ts:67-71, 85-94`). Or move tip_routings inserts behind a SECURITY DEFINER `submit_tip_route()` function that authenticates the source.

### 🟠 HIGH-2 — Anonymous client can spam `takedown_requests`
**File:** `migrations/01_schema.sql:643-645`
```sql
create policy takedown_requests_insert on takedown_requests
  for insert with check (true);
```
Same shape as HIGH-1. A malicious actor fills the takedown queue with fabricated requests, drowning real family / rights-holder takedowns. Given the project's ethical posture (memory: `feedback_photo_legal_posture` — tolerance, not license), this is operationally serious: a takedown queue jammed with garbage means a real family member's request gets buried.

**Fix:** Same shape — require service-role insert, route legitimate requests through an Edge Function (`takedown-submit`) that enforces rate limits + simple anti-bot. Or at minimum add a per-IP-hash rate limit at insert time via a trigger.

### 🟡 MEDIUM-1 — Implicit-flow tokens consumed from `Linking.getInitialURL()` without origin validation
**File:** `mobile/app/auth-callback.tsx:34-65`
The handler accepts both PKCE (`?code=`) and implicit (`#access_token=...&refresh_token=...`) on the deep link. Implicit tokens go straight into `auth.setSession({ access_token, refresh_token })` (lines 54-59). On Android, deep-link claims aren't an absolute namespace boundary — an attacker who can craft a click on `coldfile://auth-callback#access_token=ATTACKER_TOKEN&refresh_token=...` can sign the user in as the attacker's account, then capture anything the user enters (email at sign-up time, watch zones, save lists tied to that account).

**Fix:** Use PKCE-only — Supabase's `signInWithOtp` already supports it. Or refuse to set a session if the URL came from an external app intent vs. the email handler (validate the email domain in the link metadata, or use App Links with verified Digital Asset Links so non-browser intents can't fire `coldfile://auth-callback`). At minimum, sign out any pre-existing session before calling `setSession` so a hijack is detectable.

### 🟡 MEDIUM-2 — Edge Function CORS is wildcard
**File:** `supabase/functions/tip-route-submit/index.ts:227-235`
```js
'access-control-allow-origin': '*',
'access-control-allow-headers': 'authorization, x-client-info, content-type, apikey',
```
Combined with HIGH-1 (open insert) this lets ANY origin trigger a tip routing including the audit log row from a phishing site. The mobile app needs CORS, but `*` is overly broad. The Next.js site at `coldfile.app` doesn't need to call this function (mobile-only).

**Fix:** Either whitelist `expo://`, `coldfile://`, and `https://coldfile.app`, or require a non-trivial CSRF token. (See section 4.)

### 🟡 MEDIUM-3 — `tip-route-submit` insert failure is silently swallowed
**File:** `supabase/functions/tip-route-submit/index.ts:96-100`
Audit-row insert errors only `console.error` and return the route anyway. If RLS or schema drift starts blocking the insert, every tip would still appear to succeed but no audit row is written. Since the audit log is the project's "we logged that a routing happened" privacy-policy commitment (`app/legal/privacy/page.tsx:22`), silent failure here is a privacy claim violation.

**Fix:** When the audit insert fails, return `503 audit_failed` so the client retries; tolerate retries with idempotency. Or fail the route resolution itself.

### 🔵 LOW-1 — `ingest-source` `SUPABASE_SERVICE_ROLE_KEY` substring match in auth check
**File:** `supabase/functions/ingest-source/index.ts:34-39`
```js
if (
  !authz.includes(serviceKey ?? '___never') &&
  (!expectedSecret || tickSecret !== expectedSecret)
) {
```
`authz.includes(serviceKey)` is a substring match, not an equality check — fine in practice since the JWT has high entropy, but `authz.startsWith('Bearer ' + serviceKey)` would be cleaner and prevent edge cases where the function is invoked with a header containing the key in an unusual position.

### 🔵 LOW-2 — `ingest-tick` fire-and-forget dispatch never confirms success
**File:** `supabase/functions/ingest-tick/index.ts:46-51`
The `next_run_at` is bumped before dispatch (lines 41-44), and dispatch is fire-and-forget (`fetch(...).catch(() => {})`). If the child runner crashes immediately, the source is silently skipped for an hour. Operational, not security — but the silent failure shape is worth a note.

---

## 2. SQL Auditor

### 🟢 No injection findings
All client→DB paths use supabase-js with parameter binding. The `cases_in_polygon(polygon_wkt text)` RPC (`migrations/02_cases_in_bbox_recency_alpha.sql:178`) takes WKT but feeds it through `st_geomfromtext` (a parser, not an exec). RPCs are `language sql stable` — no dynamic SQL.

### 🟡 MEDIUM-4 — RPCs not granted/revoked explicitly; rely on Postgres + Supabase defaults
**Files:** `migrations/01_schema.sql:472-541, 549-588`; `migrations/02_cases_in_bbox_recency_alpha.sql:21-73, 87-169, 178-224`
Only `delete_my_account()` revokes/grants explicitly (`migrations/03_…sql:63-64`). The bbox/radius/polygon RPCs lack `revoke … from public; grant execute … to anon, authenticated;`. They work today because Supabase's default config permits public execute on `language sql` functions and they internally respect RLS, but explicit grants are the standard hardening pattern and prevent surprises if defaults change.

**Fix:**
```sql
revoke all on function cases_within_radius(...) from public;
grant execute on function cases_within_radius(...) to anon, authenticated;
-- and the same for cases_in_bbox + cases_in_polygon
```

### ✅ `delete_my_account` security-definer is correctly fenced
**File:** `migrations/03_account_deletion_and_retention.sql:36-64`
- `set search_path = public, auth` — pinned, no schema-shadowing escalation.
- `auth.uid()` checked first, returns early if null.
- All writes scoped by `where … = uid` — cannot affect other users.
- `revoke all on function … from public, anon; grant execute … to authenticated` — locked to authenticated callers.
- The function is **idempotent on the user side** (the cascading deletes from `auth.users` clean up `user_watches` and `user_subscriptions`, the `user_id = null` on `tip_routings` preserves audit rows per privacy policy).

This is well written. No findings.

### 🔵 LOW-3 — Correlated subquery for `primary_photo_url` in `cases_within_radius`
**File:** `migrations/02_cases_in_bbox_recency_alpha.sql:134-139` (and `01_schema.sql:514-519`)
```sql
(
  select cm.url
  from case_media cm
  where cm.case_id = c.id and cm.is_primary = true
  limit 1
) as primary_photo_url,
```
Per result row in the radius lookup. With `result_limit default 100` and the partial index `case_media_primary_idx on case_media(case_id) where is_primary = true`, each lookup is index-cheap, but at scale this is still 100 index probes per query. Acceptable for v1.0; consider denormalizing `primary_photo_url` onto `cases` (or a materialized view) if the radius query ever needs to be sub-100ms p95.

### 🔵 LOW-4 — Missing index on `tip_routings.user_id`
**File:** `migrations/01_schema.sql:354-368`
`delete_my_account()` runs `update public.tip_routings set user_id = null where user_id = uid` (`migrations/03_…sql:52-54`). Today the only indexes on `tip_routings` are `case_id` and `created_at`. Self-deletion frequency is low, so this is informational — but if you ever extend the function to do `select count(*) from tip_routings where user_id = uid` (a "what we'll delete" preview), add `create index tip_routings_user_idx on tip_routings(user_id) where user_id is not null;`.

### 🔵 LOW-5 — `case_dedupe_keys` lookup fan-out
**File:** `supabase/functions/_shared/persist.ts:101-131`
`findCaseByDedupeKeys` does an `.in()` with `key_type` and `key_value` arrays — fine on the GIN-backed `case_dedupe_keys_lookup_idx`. The `.limit(50)` is right-sized.

---

## 3. XSS Prevention

### ✅ Next.js side — clean
- `app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx`, `app/legal/takedown/page.tsx` all render via the structured `LegalDoc` component (`app/_components/legal-doc.tsx`) — every paragraph passes through JSX text interpolation, which auto-escapes. No `dangerouslySetInnerHTML` anywhere in `app/`.
- `app/feature-graphic/page.tsx` is fully static (no user input).
- `app/account/delete/page.tsx` is static prose with mailto links.
- `app/page.tsx` is a static landing page.

Confirmed via `grep -rn "dangerouslySetInnerHTML\|innerHTML\|eval(" app/ mobile/ supabase/` — zero hits.

### 🟡 MEDIUM-5 — Leaflet WebView loads `markercluster` without Subresource Integrity
**Files:**
- `mobile/components/cf/leaflet-map.tsx:189` — `MarkerCluster.css` lacks `integrity=`
- `mobile/components/cf/leaflet-map.tsx:304` — `leaflet.markercluster.js` lacks `integrity=`
- `mobile/components/cf/leaflet-watch-zone.tsx:135` — Leaflet CSS has SRI; markercluster isn't loaded here, so this file is OK

`leaflet.js` itself (line 188 + 303) does carry an `integrity=sha256-…` attribute. The cluster plugin doesn't. If unpkg.com is compromised (or DNS-hijacked on a hostile network), the cluster script can ship arbitrary JS into a WebView whose origin-whitelist is `*`.

**Fix:** Either add SRI hashes to the markercluster `<link>` and `<script>` tags, or vendor both files into the app bundle (`mobile/assets/leaflet/`) and load them via `file://` — then SRI is moot and offline maps work too.

### 🟡 MEDIUM-6 — WebView `mixedContentMode="always"` and `originWhitelist=['*']`
**Files:** `mobile/components/cf/leaflet-map.tsx:137, 153`; `mobile/components/cf/leaflet-watch-zone.tsx:81, 97`
- `mixedContentMode="always"` allows HTTP loads inside an HTTPS WebView page. The HTML is generated locally (no `https://` host page), but the OSM tile URL is HTTP-by-default fallback-safe; an MITM on Android can downgrade `https://tile.openstreetmap.org` to HTTP with no error.
- `originWhitelist=['*']` lets the WebView navigate anywhere — combined with `mixedContentMode="always"`, an attacker who can inject a navigation (e.g. via a long-running tile request that returns a redirect) could bring the WebView to an attacker page.

**Fix:**
- `mixedContentMode="never"` (or omit it).
- `originWhitelist={['https://*', 'about:']}` at minimum — since all your CDN hosts are HTTPS.

### ✅ JSON.stringify interpolation is safe
**File:** `mobile/components/cf/leaflet-map.tsx:78-89, 549-550`
The marker payload reaches the WebView via `${JSON.stringify(markers)}`. `LeafletMarker` interface (lines 32-40) has only typed primitives (`id: string`, numeric `lat/lng`, enum `kind`, booleans, optional number). `id` is a slug constrained to `[a-z0-9-]+` by `buildSlug` (`supabase/functions/_shared/normalize.ts:226-241`). `victim_name` and other free-text are NOT interpolated into the WebView — confirmed by `grep -n "victim_name" mobile/components/cf/leaflet-map.tsx` returning no hits. The auto-escaping JSON does break out of `</script>` if an attacker controlled a slug containing `</script>`, but the slug regex makes that impossible.

(Even so, if you want belt-and-suspenders: replace `JSON.stringify(...)` interpolation with `<script type="application/json" id="cf-markers">…</script>` + `JSON.parse(document.getElementById('cf-markers').textContent)`. Not required given the current data model.)

---

## 4. CSRF & SSRF

### 🟡 MEDIUM-7 — Edge Function CORS wildcard + open RLS = effective CSRF on `tip_routings`
Cross-references HIGH-1, MEDIUM-2.
A malicious site can `fetch('https://gzfndxabaispgcotklni.supabase.co/rest/v1/tip_routings', { method: 'POST', mode: 'cors', headers: { apikey: <public-anon>, … }, body: JSON.stringify({...}) })`. The user's browser doesn't need to be signed in — anon writes are open. Same shape against `takedown_requests`. Since `apikey` is public and CORS is wildcard, this effectively means any website can write spam rows. Closing HIGH-1 + HIGH-2 closes this.

### ✅ SSRF — low actual risk, theoretical
**File:** `supabase/functions/_shared/http.ts:15-42` (PoliteFetcher), `supabase/functions/_shared/media.ts:48-101` (cacheOne)
The polite fetcher uses Deno/global `fetch` with default settings — `redirect: 'follow'` is the default and follows up to 20 redirects with no host validation. There is **no protocol or host allow-list** before the fetch. An attacker who controls a tracked source's HTML/JSON could inject `photo.url = 'http://169.254.169.254/latest/meta-data/'` or a redirect chain pointing to internal infra.

Why this is currently low risk:
1. Sources are hand-curated in `sources/index.ts`; only known-good origins (NamUs, Charley, etc.) are scraped.
2. Edge Functions on Supabase don't sit on AWS metadata service paths in the typical config.
3. The fetched response is hashed and uploaded to Storage as bytes — internal-IP responses would return HTML/JSON, fail the magic-byte check (`media.ts:117-121`), and land as `.bin` in storage where they're harmless.

But for ship-time hardening — and especially when `photo-cache` (`supabase/functions/photo-cache/index.ts`) is run as a backfill across large batches — tighten the fetcher.

**Fix (defense-in-depth):**
- Reject non-HTTP(S) schemes upfront in `PoliteFetcher.get`.
- Add a host-allow-list for the photo-fetch path: `case_sources.raw_payload` URLs whose host is in `sources.base_url` host set, plus the explicit aggregator domains.
- Set `redirect: 'manual'` and validate each redirect's host.
- Enforce a max content-length for the photo fetch (we set 10MiB at the storage tier in `supabase/config.toml:24,28`, but the fetch itself is unbounded — a slowloris source could exhaust function memory).

### ✅ CSRF on Edge Functions — protected by anon-key requirement
Supabase Edge Functions require an `apikey` header that browsers only send under explicit JS — not on simple form posts. So classic `<form action=...>` CSRF doesn't reach them. But because the anon key is public (it's in the bundle), any cross-origin JS can still call `tip-route-submit`. The CORS wildcard means the response is readable. See MEDIUM-2.

### ✅ `delete_my_account` is CSRF-safe
RPC requires a valid Supabase JWT in the `Authorization` header. JWTs live in AsyncStorage, not cookies, so a CSRF flow can't exfil them. The RPC's first check (`auth.uid()`) makes the function a no-op without a real session.

---

## 5. Secrets Scanner

### ✅ No leaked secrets in tracked code
Tracked `.env`-shaped files:
- `/Users/jtroy/Desktop/ColdFiles/.env.example` — empty placeholders only. (`git log -p` shows no real values were ever committed.)
- `/Users/jtroy/Desktop/ColdFiles/mobile/.env.example` — empty placeholders only.

`/Users/jtroy/Desktop/ColdFiles/.env` and `/Users/jtroy/Desktop/ColdFiles/mobile/.env` exist locally with real values but are gitignored (`.gitignore:11-15`):
```
.env
.env.local
.env.*.local
!.env.example
```
`git ls-files | grep -E "\.env"` returns only the two `.env.example` files. `git log --all --full-history -- .env mobile/.env` returns empty. The earlier-incident concern is **resolved** — no rotated keys remain in tracked history.

### 🔵 LOW-6 — Local `.env` files contain live keys; verify rotation status
**Files:** `/Users/jtroy/Desktop/ColdFiles/.env`, `/Users/jtroy/Desktop/ColdFiles/mobile/.env`
The local files contain a real Supabase service-role JWT (`eyJ…` decoded `role=service_role`), Mapbox tokens, and a Stripe test secret. These are not in git, so this is informational, but:
- If the project root has ever been included in a backup, archive, or shared zip, those keys are at risk and should be rotated.
- The Supabase URL `gzfndxabaispgcotklni.supabase.co` and the anon key are also baked into the mobile app bundle (Expo `EXPO_PUBLIC_*`) — that's by design (anon keys are public), but make sure the **service-role** key was never copied into mobile/.env (it wasn't — confirmed: `mobile/.env` has only `EXPO_PUBLIC_SUPABASE_ANON_KEY`).

The `Stripe test` key is `sk_test_…` — not a live Stripe secret. Acceptable for v1.0.0 since Stripe isn't wired yet (per `.env` comment, deferred to v1.0.1).

**Recommendation:** Pre-launch checklist item — rotate the Mapbox tokens + Stripe test secret before going live, since they were in a development working tree that may have transited assistants/devices. Anon Supabase key in mobile bundle is fine to keep.

### ✅ No tokens in package-lock or other tracked files
A scan for `eyJ…`, `sk_live_`, `pk_live_`, `AKIA`, `ghp_`, `xox[bp]-`, etc. across all tracked files returned only one match (a sha512 integrity hash starting with `eyJ` in `mobile/package-lock.json`) — false positive.

---

## Summary — What blocks ship?

**Ship-blockers:** None of the findings are 🔴 CRITICAL, but **HIGH-1 and HIGH-2 should be fixed before Play Store submission** because they undermine the privacy-policy claim that tip routings are an audit log written by the system, not user-controlled data.

**Recommended fix order (by effort / impact):**
1. Close `tip_routings` + `takedown_requests` open insert policies → HIGH-1, HIGH-2, MEDIUM-7. ~30 minutes; one migration.
2. Drop `mixedContentMode="always"` and tighten `originWhitelist` → MEDIUM-6. ~10 minutes.
3. Add SRI to markercluster → MEDIUM-5. ~10 minutes (or vendor it; ~30 minutes).
4. PKCE-only auth callback → MEDIUM-1. ~30 minutes.
5. Restrict CORS on `tip-route-submit` → MEDIUM-2. ~5 minutes.
6. Explicit `revoke/grant execute` on the bbox/radius/polygon RPCs → MEDIUM-4. ~10 minutes.

Everything else is post-ship cleanup.
