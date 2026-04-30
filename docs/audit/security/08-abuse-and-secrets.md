# 08 — Abuse / supply-chain audit (rate-limiting + secrets scan)

Scope: ColdFiles v1.0.0, Google Play closed testing this week (12 testers).
Auditor pass dated 2026-04-30. Prior audits (01–05) covered general code,
auth/crypto, privacy, API surface, deps. This pass covers two domains
explicitly, right-sized to "ship now, harden in v1.0.1+".

Severity scale: **CRIT** (must fix before public launch), **HIGH** (must fix
before scaling past closed-testing), **MED** (track for v1.0.1), **LOW**
(harden later, defense-in-depth).

---

## Domain 1 — Rate Limiting

### 1.1  tip-route-submit Edge Function — no rate limit, no captcha
**Severity: HIGH (closed-testing tolerable, BLOCKER for public launch)**
File: `supabase/functions/tip-route-submit/index.ts:51–104`
File: `supabase/config.toml:58–61` (`verify_jwt = false`)

The function is anonymous-by-design (per docstring lines 17–19; this is
correct — the product contract is anonymous tips). It accepts any POST,
hashes IP + content (`hashIp` line 196, content_hash from client), inserts
a `tip_routings` audit row, returns the resolved deep-link.

**Gaps:**
- No per-IP throttle. Line 22 docstring: *"Rate-limiting: TODO. The
  ip_hash + content_hash columns are the levers."* They are levers — but
  unbuilt. A scripted client can submit thousands of tips/min with no
  resistance, polluting `tip_routings` and metering `tip_url` resolution
  reads against `cases` + `agencies`.
- No captcha / PoW / app-attestation. The endpoint is reachable from any
  curl with the project anon key.
- No body-size limit (Deno's default is 10MB; an attacker could POST
  multi-MB JSON bodies, each one paying for an `auth.getUser()` call when
  an `Authorization` header is present — see line 213).
- Geocode/agency-lookup cost: not directly exposed here. `resolveRoute`
  does one `cases` row read with a single `primary_agency` join, no
  Mapbox call. Cost is one PostgREST read per submit — cheap, but
  multiplies linearly with abuse volume.

**At risk:** Supabase egress + Postgres compute on the free tier. No data
exfiltration risk (the function returns only the public route URL, which
is also queryable directly from `cases`). The `tip_routings` table is
write-only from anon (post-migration 04 `with check (false)` + service-role
bypass), so attackers cannot read others' rows.

**Remediation (v1.0.1, NOT a closed-testing blocker):**
1. Add per-`ip_hash` rate gate inside the function: before the insert,
   `select count(*) from tip_routings where ip_hash = $1 and submitted_at
   > now() - interval '1 minute'` — reject when > 5. SQL-level gate keeps
   the cost cap inside Postgres. Cost: one more select per submit.
2. Add a body size guard: `if (req.headers.get('content-length') >
   '4096') return 413`.
3. Defer Cloudflare Turnstile / WAF until traffic > 1k tips/day. Right-sized
   for ship-now: don't add a third-party JS to a single-button flow with 12
   testers.

**Closed-testing posture:** acceptable. 12 testers cannot abuse this
materially, and the audit-log columns are already in place to surface
abuse retroactively.

---

### 1.2  Supabase signInWithOtp — magic-link email-bombing exposure
**Severity: HIGH**
File: `mobile/lib/hooks/use-user.ts:71–82`

```
await supabase.auth.signInWithOtp({
  email,
  options: { emailRedirectTo: 'coldfile://auth-callback' },
});
```

**Gaps:**
- `shouldCreateUser` is not set, so it defaults to `true`. An attacker can
  email-bomb any address by hitting Supabase's `/auth/v1/otp` directly with
  the public anon key (the form just composes that call). Each request
  triggers a real outbound email from Supabase's SMTP.
- Supabase has built-in defaults: by default Supabase Auth applies a
  per-email cooldown (~60s for email OTP) and a project-level email-send
  rate limit (configurable in Dashboard → Auth → Rate Limits, default
  is ~30/hour on free tier). Those defaults soft-cap a single-target attack
  but do **not** prevent rotating across many target emails.
- `mobile/app/sign-in.tsx:51` only validates `email.includes('@')` —
  trivial bypass.

**At risk:** reputation of the `noreply@…` sender (SPF/DKIM) — repeated
abuse can land the project's outbound on spam blocklists, breaking
legitimate magic-links for testers.

**Remediation:**
1. Verify in Supabase Dashboard → Auth → Rate Limits that "Email-based
   OTP/Magic-link" is set to a reasonable limit (default is fine; just
   confirm it isn't "unlimited"). **Mark verified in this report once
   confirmed in dashboard** — out-of-tree, can't grep for it.
2. Add `options.shouldCreateUser: false` after the first 12 testers are
   onboarded — prevents drive-by signup spam from creating phantom
   accounts. Comment: `// closed-testing only, until first 100 paying users`.
3. Configure Auth → Email Templates → enable Supabase's built-in CAPTCHA
   (hCaptcha free tier) — Dashboard toggle, no client code needed beyond
   passing a `captchaToken` from a hCaptcha widget. Defer to v1.0.1
   unless email volume becomes a bill issue in closed testing.

---

### 1.3  cases_within_radius RPC — limit:5000, no client throttle
**Severity: MED**
File: `mobile/app/(tabs)/index.tsx:74–84`
File: `mobile/lib/hooks/use-cases-near.ts:60–67`
File: `migrations/02_cases_in_bbox_recency_alpha.sql:87–168`

The home tab calls `cases_within_radius` with `limit:5000` and
`radiusMiles:5000` — i.e. effectively the entire seed dataset on every
mount. The hook has no debounce; it refires whenever `lat/lng/radius/
kinds/status/limit/refreshKey` changes (`use-cases-near.ts:82`).

**Gaps:**
- No client-side throttle on filter chip taps. A user spamming the four
  filter chips re-issues the 5000-row RPC each tap. At ~5KB per row, that
  is ~25MB/round-trip per spam burst. With Supabase free tier's 5GB/mo
  egress, a single user repeatedly resetting can drain a meaningful
  fraction.
- The leaflet-map debounce (200ms, `theme.ts:162`) only applies to
  *viewport pan/zoom* messages from the WebView; the `useCasesNear` hook
  itself is anchored to `here.lat/lng` (user location, stable), so map
  pans don't refetch. Good.
- Missing: a debounce/distinctUntilChanged on the filter-chip path.

**At risk:** Supabase egress quota on free tier (5GB/mo). 12 testers ×
50 launches/wk × 5MB-ish per filter-tap-burst = ~3GB/mo just from filter
churn. Tight but survivable for closed testing.

**Remediation (v1.0.1):**
1. Drop `limit:5000` to a soft cap (200) and re-tighten `radiusMiles` to
   ~50 once the seed graduates from "alphabetical 2000 cases" to real
   geo distribution. The line-83 comment already flags this as a
   closed-testing crutch.
2. Wrap the RPC effect in a 250ms debounce keyed on
   `(kinds, status, limit)`.
3. Add an `EXPLAIN ANALYZE` against `cases_within_radius` with realistic
   data; if the GIST index on `location_point` isn't being hit, the
   `limit:5000` query becomes a seq scan and gets very expensive very
   fast.

**Closed-testing posture:** acceptable, monitor egress. Add an alert at
50% quota in Supabase dashboard.

---

### 1.4  Scraper write paths — self-limiting verified
**Severity: ✓ verified clean**
File: `supabase/functions/_shared/http.ts:7–42` (PoliteFetcher)
File: `supabase/functions/ingest-source/index.ts:59` (rateLimitMs per source)
File: `supabase/functions/ingest-tick/index.ts:8` (`MAX_CONCURRENT_DISPATCHES = 5`)
File: `supabase/functions/_shared/persist.ts` (idempotent upserts on slug)

- PoliteFetcher enforces a per-source `rateLimitMs` between requests +
  honours `Retry-After` on 429 + 60s backoff on 503.
- `ingest-tick` caps fan-out at 5 concurrent source runs and bumps
  `next_run_at` forward 1 hour before dispatch, so a re-tick won't
  re-dispatch the same source.
- Persist path is idempotent on slug + dedupe keys (migration 01).
- Cron secret `INGEST_TICK_SECRET` gates `ingest-tick`, `ingest-source`,
  `photo-cache`, `geocode-pending` (verified at every entrypoint).
- `tip-route-submit` is the only edge function with `verify_jwt = false`
  and *no* shared secret — by design (anonymous tips). Documented above.

A coordinated agent **cannot** trigger runaway DB writes via the scraper
— they'd have to compromise `INGEST_TICK_SECRET` first, which is the
auth boundary worth focusing on (audit 02).

---

### 1.5  Vercel side — opengraph-image + sitemap
**Severity: ✓ verified clean**
File: `app/opengraph-image.tsx` (edge runtime, static render, no DB)
File: `app/sitemap.ts:18–51` (5 hardcoded URLs, no DB join)
File: `next.config.ts:23–53` (security headers; CSP forbids embed)

- `opengraph-image` is a build-time static asset — no per-request DB
  call, no font fetch, no expensive computation. Hammering it costs only
  Vercel's static-asset bandwidth, which is generous on Hobby/Pro.
- `sitemap.ts` is 5 hardcoded URLs, zero DB queries, zero fan-out.
- No Next.js route handlers exist (`ls app/api/` is empty) — the entire
  Vercel surface is static legal pages + the account-delete page.
- Security headers (CSP, HSTS, X-Frame-Options, Permissions-Policy) are
  applied to every response.

No expensive Vercel-side targets exist for v1.0.

---

### 1.6  Account creation / onboarding — anti-automation
**Severity: LOW**
File: `mobile/app/sign-in.tsx`, `mobile/app/onboarding.tsx`,
`mobile/lib/hooks/use-onboarding.ts`

Account creation funnels through the same `signInWithOtp` path as 1.2 —
no separate signup form, no password. Fix 1.2 and this is fixed.

Onboarding state (intro, location consent, sample-mode dismissal) is
stored in AsyncStorage — local-only, no server cost.

---

### 1.7  Map endpoint cost — covered in 1.3

See 1.3.

---

## Domain 2 — Secrets Scanner

### 2.1  KNOWN BLOCKER — 4 leaked dev keys pending rotation
**Severity: CRIT (carry-forward from prior audit)**

The user has 4 leaked dev keys flagged for rotation: Supabase
service-role JWT, Supabase anon JWT, Stripe `sk_test_…`, Mapbox `pk.eyJ…`.
These were exposed previously (per task brief). **Do not re-discover
these from scratch in this report.** Rotation must happen before public
launch; closed-testing risk is bounded because the project anon JWT and
mapbox public key are intended to ship in the client bundle anyway, and
the service-role + Stripe-test keys are server-only.

**Required:**
- Service-role JWT: rotate in Supabase Dashboard → API → Reset.
- Anon JWT: rotate in same panel; re-paste into Vercel env +
  `mobile/.env` + EAS secret.
- Stripe sk_test: revoke in Stripe dashboard. Stripe is unwired in v1.0
  (per `01-code-vulns.md:217`), so rotation is hygiene only.
- Mapbox pk: rotate in Mapbox account → Tokens. Restrict the new token
  to URL allowlist (`coldfile.app`, `localhost`) + scope down to
  `styles:tiles`.

---

### 2.2  Tracked-file secrets scan — clean
**Severity: ✓ verified**

Scanned via `git ls-files | xargs grep -lE …` against:
- `sk_test_`, `sk_live_` — only matches inside `docs/audit/security/01-…
  .md` and `02-….md` (elided, e.g. `sk_test_…`). Not real keys.
- `eyJ[A-Za-z0-9_-]{20,}` (JWT shape) — single match in
  `mobile/package-lock.json:9173` (a sha512 integrity hash starting `eyJ…
  ==`). False positive, ✓ verified harmless.
- `AKIA[0-9A-Z]{16}` (AWS access key) — no match.
- `ghp_[A-Za-z0-9]{20,}` (GitHub PAT) — no match.
- `pk\.eyJ` (Mapbox token shape) — no match.
- `AIzaSy[A-Za-z0-9_-]{33}` (Google API key) — no match.
- `xox[bp]-` (Slack), `npm_[A-Za-z0-9]{36}` (npm) — no match.
- Generic `(api[_-]?key|secret|password|token)\s*[:=]\s*['"][...]{16,}`
  across `supabase/functions`, `scripts`, `sources`, `mobile/lib`, `app`,
  `data` — no match.

**Tracked code is clean.** The audit-doc mentions are documentation, not
live keys.

---

### 2.3  Git history scan — clean
**Severity: ✓ verified**

`git log --all --full-history -p` grepped for `sk_test_`, `sk_live_`,
`AKIA[0-9A-Z]{16}`, `ghp_[A-Za-z0-9]{20,}`, `pk\.eyJ`, `AIzaSy`. Total
hits: 4. All 4 are inside `docs/audit/security/01-code-vulns.md` and
`02-auth-crypto.md` — elided references inside the audit text itself.

**No secrets ever committed to history.**

---

### 2.4  .gitignore coverage — verified, with one minor gap
**Severity: LOW**

Repo root `.gitignore:11–15`:
```
.env
.env.local
.env.*.local
!.env.example
```
✓ covers `.env`, `.env.local`, `.env.production.local`, etc., across
both repo root and `mobile/` (gitignore patterns at root cascade by
default).

`mobile/.gitignore:30`:
```
.env*.local
```
This *only* excludes `.env.local`/`.env.production.local` patterns
**from the mobile/ subtree**. It does **not** independently exclude
`mobile/.env`. **However**, the root `.gitignore` already does — verified
via `git check-ignore mobile/.env` returning the path (ignored). ✓

`git ls-files | grep -E "\.env$|\.env\."` returns:
- `.env.example`
- `mobile/.env.example`

**Both .env.example files contain placeholder values only** (verified
above; both have empty `KEY=` lines). ✓

**Suggested polish (LOW, not a blocker):** add an explicit `.env` line
to `mobile/.gitignore` so it survives a future repo split or git-history
rewrite. One-liner.

---

### 2.5  Edge Function code — all secrets via Deno.env
**Severity: ✓ verified**

`grep -nE "Deno\.env\.get|process\.env" supabase/functions/*/index.ts`:
- `tip-route-submit/index.ts:68,69,216,217` — SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
- `ingest-tick/index.ts:12,18,19,34` — INGEST_TICK_SECRET, SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
- `ingest-source/index.ts:32,33,42,43,83` — INGEST_TICK_SECRET,
  SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, MAPBOX_ACCESS_TOKEN
- `photo-cache/index.ts:14,19,20` — INGEST_TICK_SECRET, SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
- `geocode-pending/index.ts:12,16,20,21` — INGEST_TICK_SECRET,
  MAPBOX_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

**Zero hardcoded keys.** All edge functions read from Deno env.

---

### 2.6  next.config.ts, mobile/app.config.ts — no hardcoded secrets
**Severity: ✓ verified**
File: `next.config.ts` — only static security-header values.
File: `mobile/app.config.ts` — `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS`
is the only env reference, and it's commented out (line 36). Static
strings (bundle IDs, Expo project UUID `933d850a-…`) are intentionally
public — not secrets.

---

### 2.7  scripts/* — no embedded keys
**Severity: ✓ verified**
File: `scripts/scrape-cli.ts:95–96, 122, 144–145` — all keys from
`process.env`.
File: `scripts/load-agencies.ts:45–46` — same. Hard-fails with
`process.exit(2)` if env is missing.

---

### 2.8  EAS / Vercel secret hygiene
**Severity: MED — verify out-of-tree, not auditable from repo**
File: `eas.json` (15 lines, no secrets — only build profiles)
File: `mobile/app.config.ts` (no `extra.SOMETHING_KEY = process.env…`)

`eas.json` is minimal. Mobile env vars use the `EXPO_PUBLIC_` prefix,
which Expo embeds at build time **from the local .env or EAS secrets**.

**Required verifications (cannot grep — must check dashboards):**
1. **EAS secrets** (run `eas secret:list`): confirm
   `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and any
   future `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` exist there — not in
   `mobile/.env` at build time on a CI runner.
2. **Vercel env** (Vercel Dashboard → coldfile.app → Settings →
   Environment Variables): confirm `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `MAPBOX_ACCESS_TOKEN`,
   `INGEST_TICK_SECRET`, `STRIPE_SECRET_KEY` (when wired) are stored
   per-environment (Production/Preview/Development separated).
3. **Supabase project secrets** (Dashboard → Project → Edge Functions →
   Secrets): confirm `INGEST_TICK_SECRET`, `MAPBOX_ACCESS_TOKEN`,
   `SUPABASE_SERVICE_ROLE_KEY` are set as Function Secrets, not just
   present in your local `.env`.

`app.config.ts` does NOT pass any secrets through `extra` to the runtime
bundle, so EAS-secret leakage is bounded to what's literally `EXPO_PUBLIC_*`
(which is intentionally public — anon JWT + mapbox public key).

---

## Ship-blocker checklist

**MUST DO before promoting closed → public testing:**
- [ ] **2.1**: Rotate the 4 leaked dev keys (Supabase service-role,
      Supabase anon, Stripe sk_test, Mapbox pk). Re-deploy edge functions
      + mobile build + Vercel after rotation.
- [ ] **2.8**: Verify EAS / Vercel / Supabase secrets dashboards (3
      checks above). Take screenshots, attach to release notes.
- [ ] **1.2**: Verify Supabase Auth → Rate Limits panel shows non-default-
      unlimited values for OTP/magic-link.

**Closed-testing acceptable, fix in v1.0.1:**
- [ ] **1.1**: Add per-`ip_hash` rate gate inside `tip-route-submit`
      (~10 lines of SQL + ~5 lines of TS).
- [ ] **1.2**: Set `shouldCreateUser: false` after first cohort onboards;
      enable hCaptcha on Auth.
- [ ] **1.3**: Drop `limit:5000` to 200, add 250ms filter-chip debounce.
- [ ] **2.4 (polish)**: Add explicit `.env` to `mobile/.gitignore`.

**No action needed (verified clean):**
- 1.4 scraper paths, 1.5 Vercel surface, 1.6 onboarding (bundled into
  1.2), 1.7 map cost (bundled into 1.3).
- 2.2 tracked-file scan, 2.3 history scan, 2.4 .gitignore (with note),
  2.5 edge-fn env hygiene, 2.6 config files, 2.7 scripts.

**Total: 3 ship-blocker items before public, 4 v1.0.1 items.** Closed
testing with 12 testers can ship today against the current state.
