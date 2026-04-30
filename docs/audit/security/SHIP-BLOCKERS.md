# Ship-blocker punch list — closed testing this week

Distilled from `01-10` audits + the agent fixes already applied today. Anything
already done has the diff/commit reference; anything left is yours.

---

## ✅ Done this session

| What | Where | Notes |
|---|---|---|
| Migration 04 — anon-write lockdown | `migrations/04_lock_down_anon_writes.sql` | Verified live: direct anon write to `tip_routings` returns 401 RLS denial. Edge Function path still works (service-role bypass). |
| Source-chip URL scheme guard | `mobile/components/cf/source-chip.tsx:27` | Rejects non-`http(s)` source URLs before `expo-web-browser`. |
| Local-build signing fail-loud (ephemeral) | `mobile/android/app/build.gradle:115` | Release config now `null` so `./gradlew assembleRelease` errors instead of producing a debug-signed AAB. **Note:** `mobile/android/` is gitignored (Expo regenerates it on `npx expo prebuild`), so this edit is ephemeral. EAS Build itself is unaffected — it injects managed release credentials in the cloud. Durable fix is a config plugin and tracked under v1.0.1. |
| Explicit `.env` in mobile gitignore | `mobile/.gitignore:34` | Belt + suspenders — root `.gitignore` already covered it. |
| Stale root `eas.json` deleted | — | Was the Expo-init template (no node pin, no submit profile). Real config is `mobile/eas.json`. |
| SSRF guard for scrape pipeline | `supabase/functions/_shared/http.ts` | `assertSafeUrl` blocks non-public destinations (RFC1918, loopback, IMDS, IPv6 ULA, IPv4-mapped). `safeFetch` re-validates each redirect, caps body at 25MB, 30s timeout, 5-redirect max. |
| Sitemap recursion host-pinned | `supabase/functions/_shared/pipeline.ts:140` | `sitemapDiscovery` refuses cross-host `<loc>` entries; can't be lured off a source's domain by a poisoned sitemap. |
| `case_media` schema/types reconciled | `mobile/lib/types/database.ts`, `mobile/lib/photo-policy.ts`, `mobile/lib/sample-data.ts`, `mobile/app/case/[slug].tsx` | Dropped `mirror_url` / `source_attribution` / `is_reconstruction` from mobile types. They didn't exist in the DB. The no-hot-link guarantee was already structurally enforced upstream — `cacheMediaForCase` downloads bytes to Storage *before* inserting `case_media.url`, so `url` is always a Supabase Storage URL by construction. `is_reconstruction` is now derived from `kind` (`reconstruction` / `sketch_*` / `age_progression`). Per-photo source attribution falls back to the case's primary agency until v1.0.1 adds the column. |
| `tip-route-submit` rate limit + body cap + OPTIONS + envvar guard | `supabase/functions/tip-route-submit/index.ts` | 5 req/min and 30 req/hour per `ip_hash`. 4KB body cap. UUID validation on `case_id`. Fail-loud `mustEnv()` boot check (no more silent `?? ''`). Audit-insert failures now log structured JSON instead of console.error string. |
| Migration 05 — rate-limit + retention | `migrations/05_indexes_and_retention.sql` | `tip_routings (ip_hash, created_at desc)` index for the rate-limit query. `tip_routings (user_id)` partial index for `delete_my_account()`. Retention crons for `source_runs` (90d), `robots_cache` (30d), `geocode_cache` (1y), `dedupe_review_queue` resolved rows (90d). Idempotent. |

83/83 vitest tests still pass. `tsc --noEmit` clean on root + mobile.

---

## 🔴 You — must do before opening closed testing

### 1. Apply Migration 05 to Supabase
Open the Supabase Dashboard → SQL Editor → paste the contents of
`migrations/05_indexes_and_retention.sql` → Run. Then sanity-check:

```sql
select indexname from pg_indexes
  where tablename = 'tip_routings'
    and indexname in ('tip_routings_iphash_created_idx', 'tip_routings_user_idx');
-- expect 2 rows

select jobname, schedule from cron.job
  where jobname like '%purge%' order by jobname;
-- expect: dedupe-queue-purge-90d, geocode-cache-purge-1y,
--         robots-cache-purge-30d, source-runs-purge-90d, tip-routings-purge-12mo
```

### 2. Redeploy the `tip-route-submit` Edge Function
The function got rewritten this session (rate limit, body cap, env guard,
OPTIONS handler, fail-loud envvar check). Without redeploying, none of those
land in prod.

```bash
cd /Users/jtroy/Desktop/ColdFiles
supabase functions deploy tip-route-submit
```

Smoke test from a fresh terminal:

```bash
# Should succeed (returns route JSON)
curl -i -X POST "$SUPABASE_URL/functions/v1/tip-route-submit" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"case_id":"<a real case uuid>"}'

# Should return 429 after 5 rapid POSTs from the same IP
for i in $(seq 1 7); do curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$SUPABASE_URL/functions/v1/tip-route-submit" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"case_id":"<uuid>"}'; done
# expect: 200 200 200 200 200 429 429
```

### 3. Rotate the 4 leaked dev keys
Carry-forward from yesterday's chat-transcript leak. Order matters because
clients break in the middle of a rotation:

| Key | Where to rotate | Where to update |
|---|---|---|
| Supabase **service-role** | Dashboard → Settings → API → "Reset service_role key" | `mobile/.env`, root `.env`, **Vercel env (Production only)**, Supabase Edge Function secrets |
| Supabase **anon** | Same page, "Reset anon key" | `mobile/.env` (publishable, lower-risk but still rotate), root `.env`, Vercel env |
| Stripe `sk_test_...` | Stripe Dashboard → Developers → API keys → roll the test key | `.env` (Stripe webhook isn't yet wired; still rotate hygienically) |
| Mapbox `pk....` | Mapbox account → Access tokens → rotate | Wherever it's referenced (per audit, only `.env` placeholder — check `app.config.ts` doesn't bake it in) |

After rotation, also push to EAS secrets so the next AAB build picks them up:

```bash
cd mobile
eas secret:list  # confirm current secrets
eas secret:create --scope project --name SUPABASE_URL --value "..." --force
eas secret:create --scope project --name SUPABASE_ANON_KEY --value "..." --force
```

### 4. Verify GitHub repo is **private**
The audit docs (`docs/audit/security/01-10`) are an attacker's roadmap — they
enumerate every API surface, every limit, every known weakness. If the repo
is public on GitHub, fix before anything else:

- github.com → repo → Settings → "Change visibility" → Private
- While there, enable **Branch protection** on `main`:
  Settings → Rules → Add ruleset → Restrict deletions + Block force pushes
  (no PR-review requirement needed for solo dev).
- Settings → Code security → enable **Secret scanning** + **Push protection**.

### 5. Verify Vercel env scoping
The leaked Supabase service-role key still resolves to a real DB. After you
rotate it (item 3), the new value goes into Vercel Production env. Verify it
is **NOT** also in Preview env — preview deploys land at public URLs and
would expose the new key:

- Vercel Dashboard → Project → Settings → Environment Variables
- For each Supabase key: confirm "Environments" shows only **Production**
  (or specific Preview branches you control), not "All Environments."

### 6. Verify Supabase Auth dashboard rate limits
Audit 08 flagged `signInWithOtp` as having no app-level captcha; we lean on
Supabase's defaults. Confirm what those defaults are:

- Supabase Dashboard → Authentication → Rate Limits
- Defaults for free tier: ~30 emails/hour project-wide, 4/hour per email.
  These are fine for closed testing. Tighten to ~10/hour project-wide if
  you want a stricter posture.

### 7. Promote internal → closed testing in Play Console
Per yesterday's notes — internal track is at version 1 (1.0.0). Promote to
closed testing once items 1-6 are green. Recruit ≥12 testers per the message
in `docs/08_PLAY_STORE_LISTING.md`.

---

## 🔴 Watch-zone + takedown launch checklist (v1.0.1)

Added with commits 4f65257 / 578b17a / 2e5e8eb. Apply in order.

### 8. Apply Migrations 06 + 07
```sql
-- Dashboard → SQL Editor — paste each in turn
\i migrations/06_watch_zones.sql
\i migrations/07_takedown_columns.sql
```

Sanity-check after Migration 06:
```sql
select proname from pg_proc
  where proname in ('create_watch_zone','list_my_watch_zones','delete_watch_zone');
-- expect 3 rows
```

Sanity-check after Migration 07:
```sql
select column_name from information_schema.columns
  where table_name = 'takedown_requests'
    and column_name in ('reference_code','requester_relationship_other','resolutions','requester_phone_hash');
-- expect 4 rows
```

### 9. Deploy three Edge Functions
```bash
supabase functions deploy tip-route-submit       # rate-limit + body cap (commit 56aaa50)
supabase functions deploy takedown-submit        # new — case-scoped form
supabase functions deploy reverse-geocode        # new — Save & Name default
```

### 10. Wire Resend — **required, not optional**

The takedown-submit Edge Function gracefully degrades to "DB row only" when
Resend env vars are absent — but **shipping in that mode is wrong for
v1.0.1**. The submitter confirmation email is the trust signal. A family
member who doesn't see a receipt within 30 seconds will assume the form
broke and re-submit; the second submission trips the per-(case_id, email)
rate limit and they get the opaque "we'll reply to your earlier message"
copy. Now they're confused, you've lost trust, and the queue still only has
one row.

Set these on `takedown-submit` (Supabase Dashboard → Functions → secrets):

```
RESEND_API_KEY        re_xxxxxxxxxxxx           # from resend.com
TAKEDOWN_NOTIFY_FROM  noreply@coldfile.app      # verify this domain in Resend first
TAKEDOWN_NOTIFY_TO    you@coldfile.app          # operator inbox
TAKEDOWN_REPLY_TO     takedown@coldfile.app     # what submitter "Reply" lands in
```

Domain verification in Resend takes ~10 min (DNS records). Don't promote to
closed testing until this is green.

### 11. Smoke-test the takedown flow end-to-end

Before shipping:

1. Open the app, tap any case, scroll to "REPORT AN ISSUE WITH THIS CASE."
2. Fill the form with your own email. Submit.
3. **Expect within 30s:** confirmation email at your inbox carrying
   `CF-XXXXX` reference, restating case + relationship + resolutions +
   reason verbatim.
4. **Expect within 30s:** operator notify at the `TAKEDOWN_NOTIFY_TO`
   inbox, subject prefixed `[CF-XXXXX]`. Hit Reply — your draft should
   land in the original submitter's inbox (verifies `reply_to`).
5. Try submitting again from the same email on the same case. Should
   return the opaque rate-limit copy after a few attempts (expected).

### 12. Watch list (informational, no immediate action)

These came up in the post-merge review. None block closed testing; flagging
so they're greppable later:

- **Geocode cache 3-decimal precision (~111m)** — fine for "Watch zone —
  South Bay" naming. If we ever surface the geocoded label as a per-case
  "near {place}" tag elsewhere, the grain will feel coarse near coastlines
  and county lines. Bump to 4-decimal cache key if/when that ships.
- **(case_id, email_hash, created_at) rate-limit index hot path** — fine
  through v1.0.x volumes. If Edge Function p99s start spiking, this is
  where to look first.
- **Slider radius lag on low-end Android (Pixel 6a, etc.)** —
  `injectJavaScript` for `cfSetRadius` fires per slider tick. If testing
  reveals the circle "snaps" rather than glides, add a 16ms-throttle wrapper
  around the inject and post the authoritative final value via
  `postMessage` on slider release. See
  `mobile/components/cf/draw-zone-map.tsx` for the inject site.
- **Static-thumbnail strategy when MapLibre unblocks** — when the Fabric
  fix lands and we can render real zone snapshots, **flip the whole Saved
  → Zones list at once**. Mixed real + abstract tiles will read as
  inconsistent rather than composed. Either backfill all or stay abstract.
- **Polygon mode + Edit-shape are paired** — both ship in v1.0.2 in the
  same PR. They share enough plumbing (vertex preload, rubber-band render,
  kinks detection) that splitting them is more work, not less. Don't ship
  Edit-shape circle-only — users expect "edit shape" to work on whatever
  shape they drew, and a circle-only edit screen creates a forever-asterisk.

---

## 🟠 Deferred to v1.0.1 (NOT closed-test blockers)

Captured here so they don't get lost — these surface in audits but don't
threaten the 12-tester closed-test window.

- **Sentry mobile crash telemetry** — Play Console crash reports cover the
  closed-test gap. Wire `@sentry/react-native` once the user base grows past
  Play Console's free-tier visibility limits.
- **CSP `'unsafe-inline'` removal on `coldfile.app`** — Next.js 15 inline
  styles and the JSON-LD block require it today. Migrate to nonce-based CSP
  when re-architecting `app/layout.tsx`.
- **Edge Function CORS origin tightening** — `access-control-allow-origin: *`
  is fine because mobile is native HTTP and the website doesn't call the
  function. Tighten to `coldfile.app` when web-side tip submission ships.
- **N+1 in `backfillPendingPhotos` + `mergeIntoExistingCase`** — scraper
  performance, not security or correctness. Per-photo dedupe lookup and 6
  round-trips per ingest hit. Batch-into-IN-list rewrite when scrape volume
  warrants.
- **Storage cleanup on takedown** — current schema soft-deletes the DB row
  but leaves the Storage object. Add a takedown Edge Function that calls
  `storage.from('case-media').remove([objectPath])` when v1.0.1 ships the
  request-takedown Edge Function (referenced in migration 04 comments).
- **`watch_zone_geom` area cap** — no UI to create a watch zone yet, so the
  stalker-zone risk (audit 10 T3) doesn't exist in v1.0. Add a `check`
  constraint when the watch-zone editor lands.
- **Migrations directory** — currently `migrations/*.sql` not
  `supabase/migrations/*.sql`. Apply via Dashboard SQL editor; the
  `supabase db push` workflow doesn't track them. Fine for solo-dev; revisit
  if collaborators join.
- **Restore-test playbook** — Supabase auto-backups exist but never tested.
  Run a recovery drill into a scratch project before opening to >100 users.
- **Incident playbooks** — leaked-key, abuse, takedown, deletion, Play Store
  policy. Audit 10 sketched the shape; write the actual runbooks in
  `docs/runbooks/` post-launch.
- **Dependabot / Renovate** — solo dev, low-frequency dep churn. Wire when a
  collaborator joins or after the first non-trivial CVE bump.
- **Durable Android release-signing guard** — the build.gradle edit landed in
  this session is ephemeral (gitignored). Wrap as a config plugin
  (`plugins/with-release-signing-null.js` or similar) referenced in
  `mobile/app.config.ts` so it survives `expo prebuild`. Not urgent because
  EAS Build is the prod path and handles signing correctly.

---

## Audit reports

The 10 reports are at `docs/audit/security/01-10`. Headlines:

| # | File | Headline |
|---|---|---|
| 01 | `01-code-vulns.md` | General code vulns sweep. |
| 02 | `02-auth-crypto.md` | PKCE-only, hash-on-device, structurally airtight. |
| 03 | `03-privacy-gdpr.md` | 0 CRITICALs — plaintext can't reach the server. |
| 04 | `04-api-surface.md` | Edge Function + RLS surface; Migration 04 closed the anon-write hole. |
| 05 | `05-dependencies.md` | Lockfile pinned, no postinstall scripts, no known CVEs. |
| 06 | `06-data-and-sql.md` | No injection or dynamic SQL anywhere. `case_media` schema mismatch surfaced (now fixed). |
| 07 | `07-web-surface.md` | All headers verified live. SSRF was the real finding (now fixed). |
| 08 | `08-abuse-and-secrets.md` | Rate-limit gap was real (now fixed). Zero secrets in git history. |
| 09 | `09-iam-and-sdlc.md` | Build.gradle release-signing + stale eas.json fixed. GitHub visibility = your action. |
| 10 | `10-threat-and-ir.md` | Threat model + IR playbooks. Most IR work is post-launch. |
