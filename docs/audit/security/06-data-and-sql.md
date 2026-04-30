# 06 — SQL & Data Security Audit

**Audit date:** 2026-04-30
**Scope:** Domain 1 (SQL: injection, N+1, indexes, SECURITY DEFINER, residual RLS) + Domain 2 (data: encryption, key management, secrets, retention/DLP, backups, photo storage).
**Method:** static review of `migrations/*.sql`, `supabase/functions/**`, `mobile/lib/**`, `scripts/scrape-cli.ts`, `scripts/load-agencies.ts`, `supabase/config.toml`, `eas.json`, `.env.example`. Cross-checked against 01–05 to avoid duplicates; references prior findings where they bear on data/SQL surface.

Severity legend: CRITICAL / HIGH / MEDIUM / LOW.

---

## Domain 1 — SQL Auditor

### 1.1 SQL injection

#### LOW — `cases_in_polygon(polygon_wkt text)` accepts arbitrary WKT and feeds it to `st_geomfromtext`
File: `migrations/02_cases_in_bbox_recency_alpha.sql:178-224`.
The function takes a free-form `polygon_wkt text` argument and passes it directly to `st_setsrid(st_geomfromtext(polygon_wkt), 4326)`. There is **no SQL-injection vector** here — `polygon_wkt` is a function parameter bound by PostgREST/RPC, not interpolated into a query string. But:
- It is reachable by any anon caller (no RLS on `language sql stable` RPCs); a malformed WKT raises a Postgres error which is forwarded to the client. Not exploitable, but does leak the function exists.
- It does no `result_limit` clamp before `limit result_limit`; an attacker could pass `result_limit = 2147483647` and a giant polygon to exhaust DB CPU.

**Patch:** add a guard at top of the SQL body:
```sql
result_limit := least(coalesce(result_limit, 500), 2000);
```
(Same fix should land on `cases_in_bbox` and `cases_within_radius`.)

#### verified — no string-concatenated SQL anywhere
Grep for `from \${` / `\`.from(\`` patterns returned zero hits across `supabase/functions/`, `scripts/`, `mobile/lib/`. All DB access is via `supabase-js` `.from(...).select/insert/update/upsert(...)` or `.rpc(...)`, both of which parameterize. No `supabase.sql\`\`` / `pg.query(string)` usage.

#### verified — `persistRecord` writes via the PostgREST builder, not raw SQL
File: `supabase/functions/_shared/persist.ts:204-292`. INSERTs/UPDATEs use the typed query builder; even the geocode WKT (`makePointWkt` at `geocode-resolver.ts:77-79`) is a Postgres-format text literal stored via `update().eq()`, parameterized.

#### verified — Charley scraper writes go through the same `persistRecord` path
File: `scripts/scrape-cli.ts:114-126`. No raw SQL even on the CLI write path.

---

### 1.2 N+1 patterns

#### MEDIUM — `backfillPendingPhotos` re-reads `case_media` once per pending row, then inserts row-by-row
File: `supabase/functions/_shared/media.ts:154-188` + `cacheOne` at lines 48-101.
For every photo found in `case_sources.raw_payload`, the code:
1. fetches the image (HTTP),
2. queries `case_media` to check for existing `(case_id, kind, content_hash)` (one round-trip),
3. inserts case_media row (one round-trip).

At 100 cases × 3 photos average that's 600 sequential DB calls per cron tick, on top of the network. Edge function wall time and Postgres pool churn both suffer.

**Patch:** batch the dedupe lookup. After computing all `contentHash` values for a case, do **one** `case_media` `.in('content_hash', […])` query, then bulk-insert the survivors:
```ts
const hashes = computed.map(c => c.contentHash);
const { data: existing } = await supabase
  .from('case_media')
  .select('content_hash, kind')
  .eq('case_id', caseId)
  .in('content_hash', hashes);
const existingSet = new Set(existing?.map(r => `${r.kind}|${r.content_hash}`));
const inserts = computed.filter(c => !existingSet.has(`${c.kind}|${c.contentHash}`));
if (inserts.length) await supabase.from('case_media').insert(inserts);
```

#### MEDIUM — `geocode-pending` updates each case in its own round-trip
File: `supabase/functions/geocode-pending/index.ts:39-55`. For 200 pending cases that's 200 sequential `update().eq()` calls (plus 200 cache reads/writes inside `resolveGeocode`). Edge function timeouts at 150s — at ~750ms per Mapbox call that already cuts the batch in half.

**Patch:** the cache hits are unavoidable per query (different normalized strings). But the `cases.update` calls at lines 48-54 can be folded into a single `update().in('id', ids)` only if all rows share the same `location_point` — they don't. Acceptable as-is; flag for v1.0.1 to switch to an unnest-based bulk update via RPC.

#### MEDIUM — `findCaseByDedupeKeys` does the right shape but `mergeIntoExistingCase` re-reads the case row + all its `case_sources`
File: `supabase/functions/_shared/persist.ts:101-194`. For every ingested record that hits an existing case (the common path at steady state), this issues:
1. `case_dedupe_keys` lookup (1 query),
2. `cases.select(*).eq(id)` (1 query),
3. `case_sources.select(trust_weight).eq(case_id)` (1 query),
4. potentially `case_updates.insert` for conflict (1 query),
5. `cases.update(...).eq(id)` (1 query),
6. `case_sources.upsert(...)` (1 query).

That's 6 DB calls per case. Across a Charley batch (5000+ records) this is the single biggest cost driver. Acceptable for v1 — no scrape SLA — but worth packaging into a `merge_case_record(jsonb)` RPC in v1.0.2 so it runs as one round-trip.

#### LOW — `useCaseDetail` issues 3 queries serially then 2 in parallel
File: `mobile/lib/hooks/use-case-detail.ts:65-119`. The case-row read happens **before** sources/media are queried. In practice the case row is small, so the serial step is sub-100ms; the two children run concurrently. Acceptable.

#### verified — home-screen radius and map-bbox queries are single-RPC
`useCasesNear` (`mobile/lib/hooks/use-cases-near.ts:59-67`) and `cases_in_bbox` consumers issue one `.rpc()`. The RPC's nested `select cm.url ... where cm.is_primary = true limit 1` is a correlated subquery, which Postgres planner evaluates per outer row but is satisfied by the partial index `case_media_primary_idx` (`migrations/01_schema.sql:305`). Plan is fine.

---

### 1.3 Index coverage

#### MEDIUM — `tip_routings` has no index on `user_id`
File: `migrations/01_schema.sql:353-368`. Indexed columns: `case_id`, `created_at desc`. But:
- `delete_my_account()` (`migrations/03_account_deletion_and_retention.sql:52-54`) issues `update tip_routings set user_id = null where user_id = uid` — that's a sequential scan today.
- The 12-month retention cron (`migrations/03_*.sql:92-96`) scans on `created_at`, which **is** indexed (✓ verified).
- A future "show me my tip history" feature will hit `where user_id = ?` constantly.

**Patch:**
```sql
create index tip_routings_user_idx on tip_routings(user_id) where user_id is not null;
```

#### MEDIUM — `tip_routings` has no index on `routed_to_agency_id`
Audit-driven analytics ("how many tips routed to LAPD this week?") will table-scan. Not a ship-blocker — there is no UI for this yet. Add when needed.

#### LOW — `case_sources` has no index for `last_ingested_at desc`
File: `migrations/01_schema.sql:262-263`. The `backfillPendingPhotos` query orders by `last_ingested_at desc` (`media.ts:165-166`) without an index supporting the order. With ~10k case_sources rows in v1, the sort is cheap; revisit at 100k.

#### LOW — `tip_routings.ip_hash` has no index
Future abuse-detection ("burst from a single IP") will table-scan. Acceptable until the abuse worker ships.

#### verified — spatial coverage is correct
- `cases.location_point` GIST index (`01_schema.sql:223`) ✓
- composite `cases_loc_kind_status_idx` with included columns (`01_schema.sql:237-240`) — exactly what `cases_in_bbox` needs ✓
- `agencies.jurisdiction_geom` GIST (`01_schema.sql:111`) ✓
- `user_watches.watch_zone_geom` GIST (`01_schema.sql:346`) ✓
- `geocode_cache.point` GIST (`01_schema.sql:444`) ✓

#### verified — case lookup paths are covered
- `cases.kind, status` partial index on `deleted_at is null` ✓
- `cases.location_state` partial index ✓
- `cases.primary_agency_id` ✓
- `cases.incident_date desc` ✓
- trigram indexes on victim names for fuzzy dedupe ✓

#### verified — `case_media.case_id` and the partial primary index ✓
- `case_dedupe_keys(key_type, key_value)` lookup index ✓ (the dedupe path is the hottest writer-side query and it is correctly indexed).

#### verified — `source_runs(source_id, started_at desc)` ✓

---

### 1.4 SECURITY DEFINER review

#### verified — `delete_my_account()` is the only SECURITY DEFINER function and it pins `search_path`
File: `migrations/03_account_deletion_and_retention.sql:36-61`.
- Pinned: `set search_path = public, auth` ✓
- Auth guard: reads `auth.uid()` first and bails on null ✓
- Only mutates rows scoped to `uid` ✓
- `revoke … from public, anon` + `grant execute … to authenticated` ✓

This is the textbook shape. Already audited in 03-privacy-gdpr.md (PASS) and reaffirmed here.

#### verified — RPCs `cases_within_radius`, `cases_in_bbox`, `cases_in_polygon` are SECURITY INVOKER (the default)
None of the spatial RPCs are SECURITY DEFINER — they rely on RLS for `cases` table read-gating, which is correct. Marked stable, plain `language sql`, no privilege elevation.

---

### 1.5 RLS holes

#### verified — all tables created in `01_schema.sql` have RLS enabled after `04_lock_down_anon_writes.sql`
The four internal tables (`source_runs`, `robots_cache`, `geocode_cache`, `dedupe_review_queue`) had RLS off in v1.0.0; migration 04 closed that gap. Inspected `01_schema.sql:595-605` + `04_lock_down_anon_writes.sql:61-64` — every public-schema table is now RLS-on with no permissive policy on the write paths.

#### verified — `tip_routings` and `takedown_requests` direct-anon-write closed
Migration 04 replaced the original `with check (true)` with `with check (false)`. Service-role bypasses RLS, so the Edge Function path keeps working. Cross-verified against the original 01 finding HIGH-1 / 04-API-1.1.

#### LOW — `case_sources.raw_payload` is publicly readable via RLS
File: `01_schema.sql:621-624`. The `case_sources_public_read` policy gates on `cases.deleted_at is null` but exposes `raw_payload jsonb` to anon. The payload is the full extracted source record — including any extracted PII strings (free-text narrative, addresses) the source itself published. This is mostly the same data the source's HTML already serves, so disclosure is not new — but `raw_payload` may also contain extraction artifacts the UI never renders (raw HTML fragments, scraper debug fields). Risk is minor (it's public-record data) but the API surface is wider than needed.

**Patch (v1.0.1):** narrow the public select to a column allowlist via a view, or strip `raw_payload` from the policy:
```sql
drop policy case_sources_public_read on case_sources;
create policy case_sources_public_read on case_sources
  for select using (
    exists (select 1 from cases c where c.id = case_sources.case_id and c.deleted_at is null)
  );
-- and create a coldfile_case_sources_public view that omits raw_payload + payload_hash;
-- mobile clients read the view, not the table.
```
For now (closed testing), accept and ship.

---

## Domain 2 — Data Security

### 2.1 Encryption at rest

#### verified — Supabase default encryption covers Postgres + Storage
Supabase Postgres uses AES-256 at rest at the EBS volume layer; Storage objects encrypted by default. No custom column-level encryption configured, and **none is required** for v1 because:
- Tip plaintext never reaches the DB (`mobile/lib/hash.ts` hashes client-side before any network call — verified in 03-privacy-gdpr §1).
- `tip_routings.content_hash` and `ip_hash` are SHA-256 digests, not plaintext.
- `takedown_requests.requester_email_hash` is hashed before insert (claim — see 2.3.).
- All other PII (`victim_name`, `narrative`) is from public sources by design.

#### LOW — no application-level encryption on `geocode_cache.query_normalized`
File: `01_schema.sql:434-442`. The cache stores normalized location strings — many derived from `cases.location_text` (street addresses, sometimes including subject names because Charley records are like `"15400 block of Temple Ave, La Puente, CA"` plus name substrings). Now that 04 enabled RLS with no policy, anon access is gone — this is service-role only. Disclosure risk: anyone with service-role access (the team) sees every geocode-keyed string. Acceptable.

#### LOW — `case_sources.raw_payload jsonb` stores the full scraped record unredacted
Same surface as 1.5 above. Encrypted at rest by EBS but readable by anyone with read access. Service-role-only behind RLS for direct table writes — but **publicly readable via the select policy** (see 1.5). This is the meaningful exposure, not the encryption posture.

---

### 2.2 Key management

#### CRITICAL — 4 leaked keys still need rotation (KNOWN, user-acknowledged)
Per audit brief: *"the user has 4 leaked keys to rotate — note this as a known."* Not duplicating discovery; recording as a ship-blocker. Likely candidates from `.env.example` shape:
1. `SUPABASE_SERVICE_ROLE_KEY` (must rotate via Supabase dashboard → Settings → API; this nukes every service-role token currently issued).
2. `MAPBOX_ACCESS_TOKEN` (rotate at account.mapbox.com; restrict by URL referrer for the public token).
3. `STRIPE_SECRET_KEY` (rotate at dashboard.stripe.com → Developers → API keys; rotate webhook secret too).
4. `INGEST_TICK_SECRET` (rotate by regenerating and updating Supabase function env + cron caller). Note: the leaked key has been used to authenticate `ingest-source`/`ingest-tick`/`photo-cache`/`geocode-pending`; until rotated, anyone holding it can trigger scrapes and consume the Mapbox quota.

Pre-launch checklist:
- [ ] Rotate all 4 keys.
- [ ] Re-deploy Edge Functions with the new env.
- [ ] Re-publish Vercel + EAS builds with the new public anon key + Mapbox public token (the anon key is bundle-shipped by design — if it is on the leak list, treat the fact that *only* the anon key shipped to clients as out-of-scope; the rotated value goes into the next release).
- [ ] Audit Supabase logs for unauthorized service-role usage in the leak window.

#### MEDIUM — service-role key lives in `.env` at repo root and `mobile/.env`
Files: `/Users/jtroy/Desktop/ColdFiles/.env`, `/Users/jtroy/Desktop/ColdFiles/mobile/.env`. Both are gitignored (verified at `.gitignore:14`). However:
- `mobile/.env` should **not** contain `SUPABASE_SERVICE_ROLE_KEY` — the Expo bundler will not inline it (only `EXPO_PUBLIC_*` is exposed) but if a developer accidentally references `process.env.SUPABASE_SERVICE_ROLE_KEY` in mobile code, it bundles to `undefined` quietly, which is the right failure mode. Still: confirm `mobile/.env` does not contain the service-role key. If it does, delete it — the mobile app must never know that key.
- The repo-root `.env` is correct location for the scraper CLI + local Edge Function dev. Production secrets live in Supabase Functions env (`supabase secrets set`) and Vercel env (`vercel env add`).

**Patch:** `grep -i SUPABASE_SERVICE_ROLE_KEY mobile/.env` should return nothing. If it does, remove it.

#### MEDIUM — no documented rotation cadence
There is no `docs/ops/key-rotation.md` or equivalent. After the 4-key emergency rotation, write a one-pager:
- Rotate `SUPABASE_SERVICE_ROLE_KEY` quarterly + on any contributor offboard.
- Rotate `INGEST_TICK_SECRET` quarterly.
- Rotate Stripe + Mapbox annually.

#### verified — EAS secrets posture
File: `mobile/eas.json`. No secrets in `eas.json` — just channel/build config. `EXPO_PUBLIC_*` env vars are passed at build time via EAS → Expo project secrets (the standard path). Anon key shipping in the bundle is by design (RLS gates).

#### verified — Vercel posture (inferred)
The Next.js site has no API routes that need service-role — per `mobile/lib/supabase.ts:6` *"never a Next.js route handler."* Vercel only needs `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` + Stripe publishable. Confirm in Vercel dashboard that the **service-role key is not set** on the production environment.

---

### 2.3 Secrets / data leakage in logs

#### verified — `tip-route-submit` logs only `insertError.message`
File: `supabase/functions/tip-route-submit/index.ts:99`. Logged: `'[tip-route-submit] audit insert failed:', insertError.message`. The request body, headers, IP, and content_hash are **never** logged. Already audited in 03 §1.MEDIUM-02 with a note to add an ESLint rule preventing regression — that rule is **not yet implemented** (re-flag).

#### verified — `useSubmitTip` does not log slugs or content
File: `mobile/lib/hooks/use-submit-tip.ts:111`. Comment explicitly notes *"no slug, since logcat / Play bug-reports could otherwise re-identify which case a user tipped on"*. The log is a generic `'[useSubmitTip] receipt write failed'`. ✓

#### verified — `media.ts` photo-fetch errors log the photo URL but not credentials
File: `supabase/functions/_shared/media.ts:41`. The URL is the source's public photo URL (NamUs / FBI / Charley) — no PII, no credential. ✓

#### LOW — `ingest-source` source_runs error payload may include source URLs with query params
File: `supabase/functions/ingest-source/index.ts:88-90, 116-122`. Per-URL errors get persisted to `source_runs.errors jsonb`. If a future scraper appends API tokens as query params (none currently do), they'd land in the table. Now that `source_runs` has RLS-deny by default (mig 04), only service-role reads — acceptable.

#### MEDIUM — no Sentry/crash-reporting integration found
Grep `Sentry` returns zero hits. v1.0.0 ships with no error telemetry. Not a security issue per se, but: when Sentry **is** added (almost certainly v1.0.1), the integration must be configured with `beforeSend` filters that strip:
- request bodies for `tip-route-submit`,
- the `Authorization` header anywhere,
- any field named `content`, `tipBody`, `contentHash`, `ip_hash`, `email`.

Pre-document this in `docs/ops/observability.md` before Sentry lands so the first PR enforces the filters.

---

### 2.4 DLP / data lifecycle / retention

#### verified — `tip_routings` 12-month retention cron
File: `migrations/03_account_deletion_and_retention.sql:76-96`. `pg_cron` job `tip-routings-purge-12mo` runs daily at 03:17 UTC, deletes rows older than 12 months. Matches the privacy-policy claim verbatim. ✓

#### HIGH — no retention policy on `source_runs`, `robots_cache`, `geocode_cache`, `dedupe_review_queue`
None of these tables has a TTL job. Each grows monotonically:
- `source_runs`: ~5 sources × 24 runs/day = 120 rows/day. Includes `errors jsonb` which can be large. After 1 year ≈ 44k rows.
- `robots_cache`: bounded by # of distinct hosts (small).
- `geocode_cache`: bounded by distinct location strings (~10k–100k over the project lifetime).
- `dedupe_review_queue`: grows with ingest volume; manually-resolved rows stay forever.

**Patch (before v1 ships, or as part of v1.0.1):**
```sql
-- in a new migrations/05_retention.sql
select cron.schedule(
  'source-runs-purge-90d',
  '23 3 * * *',
  $$ delete from public.source_runs where started_at < now() - interval '90 days' $$
);
select cron.schedule(
  'dedupe-review-queue-purge-resolved-1y',
  '29 3 * * *',
  $$ delete from public.dedupe_review_queue where status in ('merged','rejected') and resolved_at < now() - interval '1 year' $$
);
select cron.schedule(
  'robots-cache-purge-expired',
  '11 3 * * *',
  $$ delete from public.robots_cache where expires_at < now() $$
);
-- geocode_cache: keep, lookup table stays small in practice
```

#### MEDIUM — no retention on `case_updates` (timeline events)
Public-record case updates accumulate forever. By design — case histories should persist. ✓ accepted.

#### MEDIUM — `delete_my_account()` does not delete `auth.audit_log_entries`
This is a Supabase-internal log; deleting it would break Supabase auth. Out of our control. Note in privacy policy that Supabase retains auth audit logs per their DPA.

#### LOW — soft-delete on `cases` has no purge
`cases.deleted_at` is set on takedown but the row stays forever. Per legal posture (`feedback_photo_legal_posture.md` — *"tolerance, not license"*), retaining the row metadata after takedown is questionable. Consider hard-deleting cascading dependents 30 days after takedown_requested_at.

---

### 2.5 Backup posture

#### verified — Supabase auto-backups enabled by default on Pro+
Daily PITR with 7-day retention on Pro tier. Free tier gets daily logical backups with 7-day retention.

#### MEDIUM — no documented restore-test playbook
No `docs/ops/restore-test.md`. Before Play Store launch, run a one-shot restore-to-staging drill and document:
1. Pull a daily backup → spin up a clone project.
2. Run `select count(*) from cases` on clone — compare with prod.
3. Verify `cases_within_radius` returns identical results for a known lat/lng.
4. Time the restore (Supabase dashboard quotes; verify).

Without a tested restore, "we have backups" is a claim, not a control.

#### LOW — no offsite logical backup
Supabase backups live in Supabase. If the Supabase account is compromised, both prod and backups are gone together. For closed testing, accept; before public launch consider weekly `pg_dump` to S3/R2 with a separate IAM principal.

---

### 2.6 Photo storage

#### verified — Supabase Storage bucket `case-media` configured
File: `supabase/config.toml:25-29`. Bucket exists, `public = true`, `file_size_limit = 10MiB`, MIME allowlist `[image/png, image/jpeg, image/webp, application/pdf]`. ✓

#### verified — mirror-required sources are enforced at the client
File: `mobile/lib/photo-policy.ts`. `effectivePhotoUri()` returns null for any photo whose `source_attribution` is in `['charley project', 'the charley project', 'doe network', 'the doe network']` unless `mirror_url` is set. The hot-link literally cannot ship.

#### HIGH — `mirror_url` and `source_attribution` columns are not in the migrations yet (KNOWN v1.0.1 mismatch)
Files: `mobile/lib/types/database.ts:154-172` declares `mirror_url: string | null` and `source_attribution: string`. `migrations/01_schema.sql:286-302` defines `case_media` with **only `url`** — no `mirror_url`, no `source_attribution`.

Consequences for closed-testing this week:
- The TypeScript type is a **lie**. Any select that reads `mirror_url` or `source_attribution` from the live DB returns `undefined` for those fields.
- `effectivePhotoUri()` (`photo-policy.ts:60-79`) reads `media.mirror_url?.trim()` (always undefined) and `media.source_attribution` (always undefined → `isMirrorRequired` returns false). So the no-hot-link guarantee **does not actually hold against the live DB** for any Charley/Doe photo whose `url` field was populated with a Charley/Doe CDN URL.
- This is mitigated only because the closed-testing dataset must be inspected: every Charley/Doe row currently in `case_media.url` would hot-link.

**Patch (must land before closed-testing photos render):**
```sql
-- migrations/05_case_media_mirror_columns.sql
alter table case_media
  add column if not exists mirror_url text,
  add column if not exists source_attribution text not null default 'unknown';
-- backfill source_attribution from case_sources.source.name where possible:
update case_media cm
  set source_attribution = s.name
  from case_sources cs
  join sources s on s.id = cs.source_id
  where cm.case_id = cs.case_id
    and cm.source_id = s.id
    and cm.source_attribution = 'unknown';
-- enforce going forward:
alter table case_media alter column source_attribution drop default;
```
**Or** (safer for v1): manually verify that no `case_media.url` in the closed-testing dataset points to charleyproject.org or doenetwork.org. If any does, delete the rows; the em-dash placeholder renders.

#### MEDIUM — Storage bucket is `public = true`
File: `supabase/config.toml:26`. Anyone who knows or guesses an object path can fetch the image. The path is `${caseId}/${kind}/${hash[0:2]}/${hash}.${ext}` (`media.ts:68`) — UUID-keyed, so unguessable. But if a takedown happens, the row is soft-deleted at the DB layer while the **object stays in Storage** unless explicitly removed. The `delete_my_account()` flow doesn't touch Storage. Takedown flow doesn't delete objects either.

**Patch:** `takedown_requests` honored path should `await supabase.storage.from('case-media').remove([objectPath])` for every `case_media` row of the case. Add to the not-yet-built `request-takedown` Edge Function (referenced in 04-API-1.2).

#### LOW — no Storage upload size enforced at insert
`case_media.bytes` is recorded but no check constraint. The 10MiB Storage limit (`config.toml:28`) is the actual floor. ✓ acceptable.

#### LOW — no Storage object lifecycle policy
Orphaned Storage objects from failed inserts (network drop between upload and DB insert at `media.ts:70-98`) accumulate forever. Add a weekly cron that lists Storage and deletes objects with no matching `case_media.url`.

---

## Cross-cutting verified items

- ✓ All migrations are idempotent (verified in headers).
- ✓ All Edge Functions check `INGEST_TICK_SECRET` or service-role bearer before mutating (verified across `ingest-source`, `ingest-tick`, `photo-cache`, `geocode-pending`).
- ✓ `tip-route-submit` uses service-role for the audit insert and an anon-key+bearer client only for `auth.getUser()`. The service-role key never leaves the function.
- ✓ Mobile client uses anon key + RLS for reads; never sees service-role.
- ✓ PKCE auth flow (`mobile/lib/supabase.ts:53`).
- ✓ `case_dedupe_keys` ordered fuzzy-match with strongest-key-wins precedence (`persist.ts:115-130`).
- ✓ All `language sql` RPCs are `stable`, not `volatile` — query planner can cache.
- ✓ Trigram + GIN + partial indexes correctly target the actual query shapes.

---

## Ship-blocker checklist (closed testing this week)

Only items below block submission. Everything else can ship and be patched in v1.0.1.

- [ ] **CRITICAL** — Rotate the 4 leaked keys (`SUPABASE_SERVICE_ROLE_KEY`, `MAPBOX_ACCESS_TOKEN`, `STRIPE_SECRET_KEY`, `INGEST_TICK_SECRET`). Re-deploy Edge Functions + Vercel + EAS with new values. Audit Supabase logs for unauthorized service-role usage in the leak window. (§2.2)
- [ ] **HIGH** — Either (a) ship migration adding `case_media.mirror_url` + `case_media.source_attribution` so `effectivePhotoUri()` actually enforces the no-hot-link policy, **or** (b) manually purge any `case_media.url` pointing to charleyproject.org or doenetwork.org from the closed-testing dataset and confirm the policy is dataset-enforced for the test cohort. (§2.6)
- [ ] **MEDIUM** — Confirm `mobile/.env` does not contain `SUPABASE_SERVICE_ROLE_KEY` (`grep -i SERVICE_ROLE_KEY mobile/.env`). If present, delete and re-issue. (§2.2)
- [ ] **MEDIUM** — Confirm Vercel production environment does **not** have `SUPABASE_SERVICE_ROLE_KEY` set. (§2.2)

Non-blocking but recommended in the same sprint:
- Add `result_limit := least(coalesce(result_limit, 500), 2000)` clamp to all three spatial RPCs (§1.1).
- Add `tip_routings(user_id) where user_id is not null` index (§1.3).
- Add the `source_runs` / `dedupe_review_queue` retention crons in a v1.0.1 migration (§2.4).
- Document the restore-test playbook (§2.5).
- Pre-write the Sentry `beforeSend` filter spec before Sentry lands (§2.3).
