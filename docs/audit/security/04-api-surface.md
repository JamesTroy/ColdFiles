# 04 — API Surface, Rate Limiting, CORS & Headers

Audit date: 2026-04-29
Scope: Supabase Edge Functions (`supabase/functions/*`), Postgres RPCs invoked via `@supabase/supabase-js` with anon JWT, web property at `coldfile.app` (Next.js 15 on Vercel).
Method: static review of `supabase/functions/`, `migrations/01_schema.sql`, `migrations/02_*.sql`, `migrations/03_account_deletion_and_retention.sql`, `supabase/config.toml`, and the Next.js root (`app/`, `package.json`, absence of `next.config.*` / `vercel.json` / `middleware.ts`).

Severity legend
- 🔴 CRITICAL — exploitable now, ship-blocker
- 🟠 HIGH — real risk, fix before submission
- 🟡 MEDIUM — defense-in-depth, fix soon
- 🔵 LOW — informational

---

## 1. API Security (OWASP API Top 10)

### 1.1 Direct anon writes to `tip_routings` bypass the Edge Function — 🔴 CRITICAL
Files: `migrations/01_schema.sql:640-641`, `supabase/functions/tip-route-submit/index.ts:51-104`.

The RLS policy is:
```sql
create policy tip_routings_insert on tip_routings
  for insert with check (true);
```
That `with check (true)` is unrestricted: any caller holding the **anon** JWT (which is shipped in the mobile bundle and embedded in the Vercel build) can `POST /rest/v1/tip_routings` with arbitrary `case_id`, `routed_to_agency_id`, `routed_to_url`, `content_hash`, `ip_hash`, `user_agent_summary`, and `user_id`.

Consequences:
- **A2 / A3 (BFLA + injection of audit data).** The Edge Function is the *only* code path that hashes the IP and resolves the route; PostgREST direct insert lets an attacker forge `ip_hash` to a different SHA-256 every call (defeating the abuse-detection lever called out at `tip-route-submit/index.ts:21-23`) and forge `user_id` to any UUID they want, including a real user's, smearing them in the audit log.
- **A1 (BOLA).** No `case_id` existence check — attacker can write rows referencing UUIDs that aren't real cases, polluting the moderation queue's content-hash collision detection.
- **Cost amplification.** Each direct insert is one PostgREST round-trip — cheaper than tip-route-submit but still bills DB egress and storage.

Fix: tighten the policy to `with check (false)` and route every legitimate insert through the Edge Function (it uses `SUPABASE_SERVICE_ROLE_KEY`, bypassing RLS), or to `with check (auth.uid() is null or auth.uid() = user_id)` plus a server-set `ip_hash` trigger. The current "tips are anonymous, so allow anyone" framing in the policy comment confuses *anonymous in identity* with *unauthenticated insert path*.

### 1.2 Direct anon writes to `takedown_requests` — 🔴 CRITICAL
Files: `migrations/01_schema.sql:644-645`, `migrations/01_schema.sql:387-400`.

Same pattern, worse downside. `takedown_requests` is the rights-holder takedown channel called out in the photo legal posture doc:
```sql
create policy takedown_requests_insert on takedown_requests
  for insert with check (true);
```
An attacker holding the anon key can forge takedown requests against any `case_id`, set `requester_relationship='family'`, set arbitrary `requester_email_hash`, and write any `reason` string. The default `status='pending'` lands them in the moderation queue. There is no Edge Function in front of this table, so PostgREST direct write is the *only* path — but it has zero validation.

Fix: route through a `request-takedown` Edge Function that captcha-gates the submission, or at minimum constrain the policy so the row's `requester_relationship` is one of an allow-list and add a per-IP rate limit at the function layer. Until then, the takedown channel is a denial-of-attention vector against the small ops team.

### 1.3 RLS off on `source_runs`, `robots_cache`, `geocode_cache`, `dedupe_review_queue` — 🟠 HIGH
File: `migrations/01_schema.sql:595-605` (the `enable row level security` block).

These four tables are created (lines 407, 427, 434, 451) but **not** included in the RLS-enable block. In Supabase's default PostgREST exposure, `public` schema tables are reachable from the anon role unless RLS denies. That means:
- `source_runs` — anon can read every scrape run's stats, error payloads (which include scraped URLs and stack traces), and timing. Not catastrophic but discloses scrape cadence and error patterns to anyone profiling the app.
- `robots_cache` — discloses which hosts have been crawled and the parsed rules.
- `geocode_cache` — discloses every location string we've ever resolved, including any PII-adjacent strings (names+addresses) that flowed through the geocoder. Re-identification risk against Doe cases is non-zero.
- `dedupe_review_queue` — discloses which case pairs the resolver flagged as possible duplicates with similarity scores. Tells an outsider where our entity-resolution is uncertain.

Anon can also INSERT into all four tables — pollute `geocode_cache` with bogus coords, fill `dedupe_review_queue` with garbage rows, etc.

Fix: `alter table … enable row level security;` for all four with no policy (= service-role-only).

### 1.4 `tip-route-submit` excessive data exposure: agency phone always returned — 🟡 MEDIUM
File: `supabase/functions/tip-route-submit/index.ts:103, 137-194`.

The function returns `{ agency_name, route_kind, tip_url, tip_phone }` to any anonymous caller for any `case_id`. The schema's `cases.tip_phone` and `agencies.phone_tip` aren't restricted columns — they're public-record agency contact info, so this isn't a leak. However: the function will resolve and return route info for *any* case UUID an attacker enumerates (or scrapes from `cases_in_bbox`), giving a clean machine-readable map of "which case routes to which Crime-Stoppers P3 ID, which state clearinghouse, which FBI fallback." That's a reconnaissance gift for someone building a counter-tip-flood tool.

Fix: this is acceptable for v1 (the data is public anyway) but consider adding a per-case rate limit so a single client can't enumerate all routes in a few minutes.

### 1.5 `tip-route-submit` `verify_jwt=false` is justified — 🔵 LOW
File: `supabase/config.toml:58-61`, `supabase/functions/tip-route-submit/index.ts:18-20, 209-225`.

Configured intentionally (anonymous tips are first-class). Internally uses service-role for the audit insert and an anon-key-with-bearer client *only* for `auth.getUser()` to populate `user_id` when present. The service-role key never crosses the function boundary. This is the right shape; no change needed.

### 1.6 `ingest-source` auth substring check is brittle but not exploitable — 🟡 MEDIUM
File: `supabase/functions/ingest-source/index.ts:30-39`.

```ts
if (
  !authz.includes(serviceKey ?? '___never') &&
  (!expectedSecret || tickSecret !== expectedSecret)
) {
  return json({ error: 'unauthorized' }, 401);
}
```
The `authz.includes(serviceKey)` substring match (vs. `authz === \`Bearer ${serviceKey}\``) is loose. If `SUPABASE_SERVICE_ROLE_KEY` is ever absent at runtime, the comparison becomes `!authz.includes('___never')`, which is true for any non-`___never`-containing header, so the check falls through to the tick-secret path — fine on its own, but a future maintainer rearranging this is one keystroke from inverting the logic. Also, `Authorization: Bearer <random text containing the service key>` would also pass. With the service-role key being a bearer token that no honest client ever sends, this is theoretical but worth tightening.

Fix: `if (authz !== \`Bearer ${serviceKey}\` && tickSecret !== expectedSecret) return 401;` and require both env vars to be present at boot.

### 1.7 `ingest-source` ?source param is allow-listed — 🔵 LOW
File: `supabase/functions/ingest-source/index.ts:14-27`.

`SOURCE_BY_SLUG[slug]` is a static lookup; unknown slugs 404. No injection vector. Good.

### 1.8 `ingest-tick`, `photo-cache`, `geocode-pending` shared-secret auth — 🔵 LOW
Files: `supabase/functions/ingest-tick/index.ts:11-15`, `supabase/functions/photo-cache/index.ts:13-16`, `supabase/functions/geocode-pending/index.ts:11-14`.

All three gate on `x-ingest-tick-secret === INGEST_TICK_SECRET`. Constant-time comparison would be ideal; current comparison (`!== expectedSecret`) is timing-attackable in theory but the secret entropy + Edge Function jitter make this purely informational.

### 1.9 SQL injection: state code path — 🔵 LOW
File: `supabase/functions/tip-route-submit/index.ts:178-190`.

`STATE_CLEARINGHOUSES[state]` is a typed object lookup; `state` comes from `cases.location_state` which is `char(2)` in the schema. Not an injection path.

### 1.10 SQL injection: `cases_in_polygon(polygon_wkt text)` — 🟡 MEDIUM
File: `migrations/02_cases_in_bbox_recency_alpha.sql:178-224`.

The RPC accepts a free-form `text` polygon WKT and passes it directly to `st_geomfromtext(polygon_wkt)`. PostGIS will throw on malformed WKT, but the function is `language sql` so the input is parameterized — no SQL injection. However, an attacker can submit pathological polygon geometries (millions of vertices, self-intersecting, near-zero-area) that force `st_within` over every row in `cases` to spend large CPU. Combined with the lack of rate limit on the anon key, this is a DoS amplifier.

Fix: validate `polygon_wkt` against an upper vertex count and area bound before calling the spatial predicate, or wrap the function with a `SET LOCAL statement_timeout` cap.

### 1.11 `delete_my_account` is correctly self-only — 🔵 LOW
File: `migrations/03_account_deletion_and_retention.sql:36-64`.

`security definer` + `auth.uid()` guard + `revoke from public, anon` + `grant execute to authenticated`. Anon cannot call it. No change.

### 1.12 `cases_within_radius` / `cases_in_bbox` excessive exposure — 🔵 LOW
Files: `migrations/01_schema.sql:472-541, 549-588`, `migrations/02_cases_in_bbox_recency_alpha.sql`.

Returns `victim_name`, `victim_age`, `narrative_short`, `primary_photo_url`, lat/lng, distance. Same data that already renders in the UI. RLS on `cases` filters `deleted_at is null` (line 609). Photo URL goes through `case_media_public_read` policy. No change.

### 1.13 No row count cap on `cases_within_radius` `radius_miles` — 🟡 MEDIUM
File: `migrations/01_schema.sql:472-479`.

`radius_miles double precision default 25` — caller can pass `radius_miles=99999`, which becomes a global `st_dwithin` against every row in `cases`. `result_limit` caps the *return* but `st_distance` runs against every candidate inside the radius before the limit applies. Combined with the K-NN order-by (`<->`), the planner uses the spatial index, but a globe-spanning radius forces a full scan.

Fix: clamp `radius_miles` to an upper bound (e.g. 250) inside the function body, or add a `check` constraint on the parameter at the SQL layer.

---

## 2. Rate Limiting

There is no rate limiting wired anywhere. Cost analysis below treats Supabase Edge Functions on the Pro plan (~$2 per 1M invocations after the included 2M, ~$0.10 per GB-s of execution time, ~$0.09 per GB egress).

### 2.1 `tip-route-submit` abuse cost — 🟠 HIGH
File: `supabase/functions/tip-route-submit/index.ts`, full file.

Per-call work: 1 read on `cases` with embedded `agencies` join (one indexed lookup), 1 insert on `tip_routings`, 1 SHA-256 of the IP. Edge Function cold start ~150ms; warm path ~30-50ms. Single client over HTTP/2 to the same Edge region can sustain ~50-100 req/s without breaking a sweat (each request ~2KB request, ~300B response). A coordinated burst from a single IP could hit ~500 req/s with HTTP/3 multiplexing.

At 100 req/s sustained:
- 8.6M invocations/day → ~$13/day in invocation overage above the included tier.
- ~50ms × 100 = 5s of execution per second → ~432K GB-s/day at the default 256 MB allocation → ~$10/day.
- DB writes: 100/s = 8.6M rows/day. `tip_routings` is unindexed on `ip_hash`, so growth is purely linear; the 12-month purge cron (`migrations/03_account_deletion_and_retention.sql:92-96`) caps storage but not ingestion cost.

Estimated abuse cost: **~$25-50/day per attacker** at sustained 100 req/s, scaling linearly. A short burst (10 minutes) is ~$0.20 — too cheap to deter casual abuse, free for anyone with a botnet.

Recommended limits:
- 5 req/min per IP (legitimate user submits ≤1 tip per case; multi-tip is rare).
- 50 req/hour per IP for the population of tips across cases.
- Hard cap of 500 req/day per IP across all Edge Functions combined.
- Implementation: a Supabase Edge Function-side check against a small `rate_limit_ip` table with a `(ip_hash, window_start)` PK and `count` column, incremented atomically. Or use Cloudflare Rate Limiting in front of the Functions URL — cheaper and won't bill DB.

### 2.2 `cases_within_radius` / `cases_in_bbox` abuse cost — 🟠 HIGH
Files: `migrations/01_schema.sql:472-588`, `migrations/02_cases_in_bbox_recency_alpha.sql`.

These are the *hot* read paths. Map pan = bbox call; home screen scroll = radius call. Per call: one PostGIS spatial-index range scan + small filter. Warm typical latency ~20-40ms.

Anon key has no DB-level rate limit. A single attacker can sustain ~200-500 RPC calls/s against `cases_in_bbox` from one client. At 200/s for an hour:
- 720K calls. Each touches the GIST index on `location_point`. CPU on the Postgres instance climbs proportionally. On the small Pro-tier compute, this saturates at 50-80% on a single attacker.
- DB egress: rows × ~150B avg × 720K ≈ ~30-100 MB depending on viewport density. Modest egress cost.
- The real risk is **CPU starvation of legitimate queries** during the burst, not direct dollar cost.

Recommended limits:
- 30 req/s per IP for read RPCs (a frantic map-panner does ~5 req/s).
- Burst credit of 100 over 10s, then settle.
- Add a `max_radius_miles=250` clamp inside `cases_within_radius` (see 1.13).

### 2.3 `cases_in_polygon` is the worst attack surface — 🟠 HIGH
File: `migrations/02_cases_in_bbox_recency_alpha.sql:178-224`.

Combined with 1.10: an attacker sends a 10K-vertex pathological polygon at 100 req/s. Each call forces `st_within` against every row in `cases` (the bounding box is the entire planet). On a 50K-row dataset, single-call latency goes from ~30ms to several seconds. Saturates Postgres in seconds.

Fix: clamp polygon complexity (vertex count ≤ 200, perimeter ≤ a sane bound) before calling `st_within`, *and* rate-limit the RPC at 5 req/s.

### 2.4 Per-endpoint recommended ceilings (summary) — 🟡 MEDIUM
| Endpoint | Per-IP RPM | Per-IP RPH | Notes |
|---|---|---|---|
| `tip-route-submit` | 5 | 50 | Real users: ~1/case, rarely >5/hour |
| `cases_in_bbox` | 60 | 1500 | Map pan; bursts of ~10/s OK |
| `cases_within_radius` | 60 | 1500 | Home scroll |
| `cases_in_polygon` | 5 | 60 | Watch-zone editing; UI-bound to a slow gesture |
| `delete_my_account` | 1 | 5 | Idempotent self-action |
| `request-takedown` (TBD) | 2 | 10 | Once it exists per 1.2 |

---

## 3. CORS & Security Headers

### 3.1 `tip-route-submit` returns `access-control-allow-origin: *` — 🟡 MEDIUM
File: `supabase/functions/tip-route-submit/index.ts:227-236`.

```ts
headers: {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, content-type, apikey',
}
```
The mobile client (RN) ignores CORS — the policy is irrelevant there. The web client (`coldfile.app`) makes no Edge Function calls in v1.0 (web is a static legal-pages property reading directly from Supabase REST). So `*` is actively over-permissive for zero benefit. Today this isn't exploited (the function has no auth that a cross-origin attacker could hijack — anon key is public anyway, and there are no cookies). But once auth lands, `*` plus `Authorization` becomes a problem.

Fix: replace `*` with `https://coldfile.app` (and `http://localhost:8081` for local Expo dev gated by an env check). Drop `apikey` from `access-control-allow-headers` if the web client never sends one.

The other Edge Functions (`ingest-source`, `ingest-tick`, `photo-cache`, `geocode-pending`) don't set ACAO at all. They're cron-only and never called from a browser, so this is correct.

### 3.2 No CORS preflight (OPTIONS) handler in `tip-route-submit` — 🔵 LOW
File: `supabase/functions/tip-route-submit/index.ts:51-54`.

Function rejects non-POST with 405. Browsers issuing a preflight `OPTIONS` request get 405 + the ACAO headers — preflight will fail. Today no browser calls this, so it's a hypothetical. When the web takes a write path, add an explicit `if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });`.

### 3.3 Next.js: no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy — 🟠 HIGH
Files: absence of `next.config.*` (none in repo), `app/layout.tsx:1-69`, no `vercel.json`, no `middleware.ts` (none in repo).

The web property ships zero security headers. Vercel sets some defaults at the edge (HSTS via the platform's default cert config, `Strict-Transport-Security: max-age=63072000` on the hosted domain), but the rest are absent:
- **No CSP.** Legal pages render only static content + Google Fonts (`app/layout.tsx:13-38` via `next/font/google`), so a strict default-src CSP is achievable. Without it, any future XSS regression is unbounded.
- **No `X-Frame-Options: DENY`.** Pages are framable. A clickjack attacker could iframe `/account/delete` and overlay the email-trigger link to trick a logged-in user.
- **No `X-Content-Type-Options: nosniff`.** Browser default is helpful but explicit is the right posture.
- **No `Referrer-Policy`.** Default referrer leaks paths to outbound links (e.g. when the takedown page links to a state agency).
- **No `Permissions-Policy`.** Should disable `geolocation`, `camera`, `microphone`, etc., on the legal pages — none of them need these features.

Fix: add `next.config.ts` with a `headers()` hook returning the standard set, e.g.:
```ts
async headers() {
  return [{
    source: '/:path*',
    headers: [
      { key: 'Content-Security-Policy', value: "default-src 'self'; img-src 'self' data: https://*.supabase.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
    ],
  }];
}
```
The CSP `script-src 'self'` will need `'unsafe-inline'` only if Next 15's default app-router output uses inline boot scripts; verify with `next build && next start` and either nonce them or accept a bounded `'unsafe-inline'` for the boot script.

### 3.4 Edge Function responses lack hardening headers — 🔵 LOW
Files: all five Edge Function `json()` helpers.

None set `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` (relevant for `tip-route-submit`'s response which contains the resolved route), or `Strict-Transport-Security`. Supabase's HTTP edge sets HSTS at the transport layer, so HSTS is OK. The other two are best-practice gaps.

Fix: add `'x-content-type-options': 'nosniff'` and `'cache-control': 'no-store'` to every `json()` helper.

### 3.5 No CSRF token on `delete_my_account` — 🔵 LOW
File: `migrations/03_account_deletion_and_retention.sql:36-64`, `mobile/app/delete-account.tsx`.

The RPC requires a valid Supabase session JWT (carried in the `Authorization` header by `@supabase/supabase-js`, not a cookie). Header-based bearer auth is not CSRF-vulnerable from a browser cross-origin request unless we move to cookie auth later. No action.

---

## Summary of findings

| ID | Severity | Title |
|---|---|---|
| 1.1 | 🔴 CRITICAL | Direct anon writes to `tip_routings` bypass the Edge Function |
| 1.2 | 🔴 CRITICAL | Direct anon writes to `takedown_requests` |
| 1.3 | 🟠 HIGH | RLS off on `source_runs`, `robots_cache`, `geocode_cache`, `dedupe_review_queue` |
| 2.1 | 🟠 HIGH | `tip-route-submit` has no rate limit; ~$25-50/day per attacker at 100 RPS |
| 2.2 | 🟠 HIGH | `cases_in_bbox` / `cases_within_radius` have no rate limit; CPU starvation risk |
| 2.3 | 🟠 HIGH | `cases_in_polygon` accepts unbounded WKT; pathological polygons saturate Postgres |
| 3.3 | 🟠 HIGH | Next.js missing CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| 1.4 | 🟡 MEDIUM | `tip-route-submit` enables route enumeration |
| 1.6 | 🟡 MEDIUM | `ingest-source` substring auth check is brittle |
| 1.10 | 🟡 MEDIUM | `cases_in_polygon` accepts free-form WKT — DoS via geometry |
| 1.13 | 🟡 MEDIUM | `cases_within_radius` has no max-radius clamp |
| 2.4 | 🟡 MEDIUM | Per-endpoint rate-limit ceilings not yet defined or enforced |
| 3.1 | 🟡 MEDIUM | `tip-route-submit` returns `access-control-allow-origin: *` |
| 1.5 | 🔵 LOW | `verify_jwt=false` on `tip-route-submit` is justified |
| 1.7 | 🔵 LOW | `ingest-source` source slug is allow-listed |
| 1.8 | 🔵 LOW | Cron-secret comparison is non-constant-time |
| 1.9 | 🔵 LOW | State-routes lookup is type-safe |
| 1.11 | 🔵 LOW | `delete_my_account` is correctly self-only |
| 1.12 | 🔵 LOW | RPC return columns are appropriate |
| 3.2 | 🔵 LOW | `tip-route-submit` lacks an OPTIONS preflight handler |
| 3.4 | 🔵 LOW | Edge Function responses lack `nosniff` / `no-store` |
| 3.5 | 🔵 LOW | Header bearer auth is not CSRF-vulnerable |

Ship-blockers: 1.1, 1.2.
Pre-Play-submission: 1.3, 2.1, 2.2, 2.3, 3.3.
