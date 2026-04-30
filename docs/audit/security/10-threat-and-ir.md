# 10 — Threat Modeling (STRIDE) & Incident Response

**Audit date:** 2026-04-30
**Scope:** v1.0.0 closed-testing posture (12 testers, Google Play closed track this week).
**Builds on:** audits 01-05. Findings already addressed by audits 01-05 and Migration 04 are referenced, not re-litigated.
**Auditor stance:** solo dev shipping a missing-persons app. Right-size: no SOC, no 24x7, no PagerDuty. The minimum that survives the closed-test window without making yesterday's leaked-keys-in-chat incident worse.

Severity legend: CRITICAL / HIGH / MEDIUM / LOW. `✓ verified` = state confirmed by code/migration read on 2026-04-30.

---

## Domain 1 — Threat Modeling (STRIDE) — top 10 ranked

The 10 threats below are ranked by realistic likelihood × impact for the v1.0 surface. Each one names the surface, the existing mitigation, and what residual risk lives.

### T1 — [HIGH] Casual abuser submits floods of fake tips (Tampering / DoS)
**Surface:** Edge Function `tip-route-submit` (anon-callable, `verify_jwt = false`).
**Adversary:** any HTTP client with the public anon JWT (which is in the APK).
**Mitigation in place:**
- Migration 04 closed direct-anon insert into `tip_routings` (`✓ verified` migrations/04_lock_down_anon_writes.sql:31-34) — an attacker can no longer skip the function.
- Content is hashed client-side, so the function only routes — it doesn't *receive* or store tip text.
- `ip_hash` and `content_hash` columns exist as the abuse-detection levers.
**Residual risk:**
- The Edge Function itself is still unauthenticated and **unrate-limited** (audit 02 §2.2; `tip-route-submit/index.ts:21-23` admits "Rate-limiting: TODO"). A laptop script can hit it ~100 req/sec for the duration of the closed test, billing Edge Function quota and producing one `tip_routings` row per call.
- No alerting if quota burn spikes.
**Realistic outlook:** likely during closed test only if a tester shares a build with someone hostile; not catastrophic at 12-tester scale, but the ip_hash audit log fills with a single attacker's noise — enough to drown legitimate signals.
**Remediation (post-launch, but stub now):** add the in-function IP-hash rate-check from audit 02 §2.2 (5/min/ip_hash → 429). One Postgres index, one count query.

---

### T2 — [HIGH] Compromised dev laptop / leaked service-role key (Elevation, Spoofing, all)
**Surface:** local `.env` (`/.env:11`) — service-role JWT with `exp: 2093`.
**Adversary:** anyone with read access to the dev machine, an ill-typed `git add .`, an AI-assistant chat paste, a backup, or a stolen device.
**Mitigation in place:**
- `.env` is gitignored (`✓ verified` audit 01 §5).
- Yesterday's leaked-key incident did NOT make it into history — `git log -p` is clean (audit 01 §5).
- Anon key in mobile bundle is design-correct (audit 02 §2.1).
**Residual risk:**
- The service-role JWT is god-mode and bypasses every RLS policy. It is **not yet rotated** despite the leak incident (audit 02 §1.1 marked CRITICAL).
- `exp: 2093052043` — effectively forever. Once leaked, valid for ~70 years.
- No detection: there is no audit on which IPs use the service-role key. Supabase's project logs do show service-role calls, but nobody is reading them.
**Realistic outlook:** the incident already happened once. The probability of reoccurrence over a 12-week closed test is non-trivial.
**Remediation:** **ship-blocker** — rotate the service-role JWT before opening closed testing (see IR §3 below).

---

### T3 — [HIGH] Estranged stalker uses watch zones to surveil a known person (Information Disclosure / abuse-of-feature)
**Surface:** `user_watches` table with `watch_zone_geom geography(Polygon, 4326)` (`✓ verified` migrations/01_schema.sql:331-346) + the public `cases` read policy.
**Adversary:** estranged ex / stalker who knows their target's neighborhood and has a CF account. They draw a watch polygon over the target's home address. New cases inside the polygon → push notification → stalker monitors.
**Mitigation in place:**
- Watch zones are scoped to `auth.uid()` via RLS (`user_watches_owner` policy, audit 02 §1).
- Watch zones notify on **case** events (a missing-persons case being created/updated in that area), not arbitrary person events. The feature surfaces *missing-person reports*, not realtime location of named individuals.
- Push notifications are not yet wired (no `expo-notifications` plugin in `app.config.ts:plugins` — `✓ verified`). So the surveillance loop is currently passive: the stalker has to open the app.
**Residual risk:**
- No abuse heuristic on watch-zone *size* — a 50m polygon over a single home is a red flag; the schema doesn't constrain area.
- No friction on watch-zone creation — anonymous account → magic link → draw polygon, ~90 seconds.
- When push notifications ship (v1.0.1 per app.config.ts comment), the surveillance loop becomes active.
**Realistic outlook:** exists from day one; reaches "credible harm" the moment notifications ship.
**Remediation (before v1.0.1 push notifications, not blocking v1.0):**
- Enforce a minimum watch-zone area at the `user_watches` insert (CHECK constraint or trigger, e.g. `ST_Area(watch_zone_geom::geography) >= 200000` ≈ 0.2 km²).
- Cap watch zones per user (e.g. 5).
- Document explicitly in privacy policy that watch zones are area-based, not person-based.
- Pre-launch: add a "Why are we asking for your area?" copy line on the watch-zone create screen so casual abusers feel observed.

---

### T4 — [HIGH] Bad actor probes whether a specific tip was submitted (Information Disclosure / membership inference)
**Surface:** `tip_routings` table + `content_hash` column.
**Adversary:** someone who knows roughly what a tip-submitter wrote and wants to confirm it was sent (e.g. abuser surveilling a victim who may have tipped).
**Mitigation in place:**
- `tip_routings` has RLS enabled with no `select` policy → anon cannot read rows back (`✓ verified` audit 02 §2.3).
- After Migration 04, anon cannot insert either, so the attacker can't probe via collision detection.
- Content is hashed client-side with a salt; salt is in the bundle but the hash space is large enough that a *known plaintext* + bundle-extracted salt is the only cheap attack vector — and even then the attacker has to compromise the DB to compare.
**Residual risk:**
- A service-role compromise (T2) hands the attacker the full `tip_routings` table including `content_hash`. With the bundle salt and a known plaintext, membership inference becomes trivial.
- The salt is `COLD_FILE_TIP_HASH_SALT_V1` — single global, not per-tip. Two identical tips by different submitters produce identical hashes. That's the abuse-detection feature, but it's also a confirmation oracle.
**Realistic outlook:** low day-one probability; high impact if T2 fires. Compounds with T2.
**Remediation:** rotate service-role (T2) is the first lever. Audit 02 §3.2 already flagged this for `ip_hash`; the same logic applies to `content_hash`. Post-launch: move the content hash to a server-side HMAC with a Function-secret key, accepting that plaintext now crosses the wire (a different tradeoff — discuss with the user).

---

### T5 — [HIGH] Family member of a victim tries to get a photo taken down — flow exists but is drown-able (Repudiation / DoS-by-noise)
**Surface:** `takedown_requests` table + email-only takedown channel (`mobile/app/takedown.tsx`).
**Adversary:** legitimate family member trying to remove a Charley/Doe-mirrored photo. Per memory `feedback_photo_legal_posture`: tolerance, not license — the takedown channel is the legal pressure-release valve.
**Mitigation in place:**
- Migration 04 closed direct-anon insert into `takedown_requests` (`✓ verified` migrations/04:45-48). Spammers can no longer flood the table from the public anon key.
- The current submission path is the legal page's `mailto:` link to a human inbox — slow but unspoofable.
**Residual risk:**
- The mailto inbox itself is unmonitored unless the user reads it daily. **No alert on takedown requests.** A family member's email could sit unread for days.
- When the Edge Function `request-takedown` ships (Migration 04 anticipates this), it must rate-limit, captcha, and alert in-band.
- No SLA published — the privacy policy doesn't commit to a takedown response time, which is itself a legal-posture risk.
**Realistic outlook:** highest *operational* likelihood — at 12 testers it won't fire, but at the moment v1.0.0 reaches the public Charley/Doe photo set, expect 1-3 legitimate requests in the first month.
**Remediation:**
- **Pre-launch:** add an email auto-forward / Slack alert from the takedown inbox to the user's primary phone push. Manual but free.
- Publish a takedown SLA in the policy ("we respond within 72 hours").
- Post-launch: ship the `request-takedown` Edge Function with rate limit, captcha, and a moderation queue with email notification.

---

### T6 — [MEDIUM] Cases data scraper rate-burns Supabase quota (DoS)
**Surface:** Postgres `cases` table read via PostgREST and `cases_in_bbox`/`cases_within_radius` RPCs (anon-readable).
**Adversary:** someone scraping the cases dataset for their own project (cases are intentionally public, but bandwidth isn't free).
**Mitigation in place:**
- Cases data is intentionally public — no information leak.
- Supabase's free-tier includes 5GB egress/month; a full scrape of ~tens of thousands of cases is a few hundred MB.
**Residual risk:**
- No per-IP read-rate-limit on PostgREST. A misbehaving client can easily burn the egress allotment.
- No alert when the project approaches a billing threshold.
- The 4 internal tables (`source_runs`, `robots_cache`, `geocode_cache`, `dedupe_review_queue`) are now RLS-fenced (Migration 04 §c, `✓ verified`), so the scraper can't even probe scrape internals.
**Realistic outlook:** low at 12-tester scale; medium once the app appears in Play Store search results post-promotion.
**Remediation (post-launch):** Cloudflare or Supabase project-level rate-limit on PostgREST.

---

### T7 — [MEDIUM] Magic-link replay / scheme-squatting attacker (Spoofing)
**Surface:** `mobile/app/auth-callback.tsx` deep-link handler, Supabase redirect-URL allowlist.
**Adversary:** a malicious app on the device claims `coldfile://` (Android scheme collision) and intercepts the magic link.
**Mitigation in place:**
- Supabase redirect-URL allowlist is configured per audit 02 §1.3 (this needs to be verified as **exact** `coldfile://auth-callback`, not wildcard `coldfile://**`).
- Supabase's PKCE flow protects code-based auth.
**Residual risk:**
- Audit 02 §1.4, §1.5: implicit flow is wired alongside PKCE; the implicit branch puts tokens directly in the URL hash.
- AsyncStorage (not SecureStore) holds the resulting session (audit 02 §1.10).
- No App Links / Digital Asset Links yet — scheme is the only binding.
**Realistic outlook:** low — requires a malicious app on the same device. But at 12-tester scale where one tester might sideload a debugging twin, possible.
**Remediation:** ship App Links in v1.0.1 with `https://coldfile.app/auth-callback` and `assetlinks.json`. Audit 02 §1.3 covers the dashboard fix. Pre-launch: verify the dashboard redirect URL is exact, not wildcarded — this is the cheapest mitigation.

---

### T8 — [MEDIUM] Casual abuser drains the Edge-Function quota by enumerating route resolutions (DoS / reconnaissance)
**Surface:** `tip-route-submit` returns route info for any case_id (audit 04 §1.4).
**Adversary:** anyone scripting against the public anon key.
**Mitigation in place:**
- Returned data is public-record agency contact info (no PII).
- Migration 04 prevents direct DB writes; the Edge Function is the only abuse target now.
**Residual risk:**
- No rate limit (T1).
- A tip-flooding tool could pre-build a "case_id → tip channel" map, then hit each agency's intake form with junk that *bypasses* The Cold File entirely. ColdFiles becomes the reconnaissance gift.
**Realistic outlook:** low during closed test; medium post-public-launch.
**Remediation:** post-launch — same rate limit as T1.

---

### T9 — [LOW] Compromised scraper machine writes garbage into Supabase (Tampering)
**Surface:** scrapers run on user's laptop with service-role key, write Charley/Doe data into Supabase via `ingest-source` Edge Function.
**Adversary:** if the dev machine is compromised, the attacker has the service-role key (T2) and can also poison the cases dataset directly.
**Mitigation in place:**
- `ingest-source` requires service-role bearer or the `INGEST_TICK_SECRET` (audit 04 §1.6).
- All scraper writes are tagged with `case_sources.source_id` so post-incident attribution is possible.
- Scrapers run only on the dev machine, not in CI yet.
**Residual risk:**
- Folds into T2. If service-role rotates, scraper has to be rewired with the new key (operational, not security).
- No tamper-detection on cases — a garbage row inserted with the right `source_id` is indistinguishable from a real scrape until manual review.
**Realistic outlook:** entirely conditional on T2.
**Remediation:** rotation playbook (IR §3) explicitly lists scrapers as a downstream of the service-role rotation.

---

### T10 — [LOW] Photo-cache / mirror requests SSRF (Information Disclosure)
**Surface:** `supabase/functions/_shared/http.ts` PoliteFetcher; `photo-cache/index.ts`.
**Adversary:** a compromised upstream source page returns a `photo.url` pointing at internal infra (e.g. `http://169.254.169.254/...`).
**Mitigation in place:**
- Sources are hand-curated (audit 01 §4).
- Magic-byte check rejects non-image responses (`media.ts:117-121`).
- Internal-IP responses generally fail content-type checks.
**Residual risk:**
- No protocol/host allow-list before fetch (audit 01 §4 MEDIUM-7 fix list).
- No `redirect: 'manual'` — 20-redirect chain to internal targets is theoretically possible.
**Realistic outlook:** very low — Supabase Edge Functions don't sit on AWS metadata paths in typical config.
**Remediation:** audit 01 §4 already lists the host-allow-list / `redirect: 'manual'` fix. Not a closed-test blocker.

---

### Threat-rank summary

| #  | Threat                                            | Severity | Surface                  | Already mitigated by    | Closed-test blocker? |
|----|---------------------------------------------------|----------|--------------------------|-------------------------|----------------------|
| T1 | Tip-flood via Edge Function                       | HIGH     | tip-route-submit          | Migration 04 (partial)  | No (post-launch)     |
| T2 | Service-role key leak                             | HIGH     | dev laptop / .env         | Audit 02 §1.1 flag      | **YES — rotate**     |
| T3 | Stalker watch-zone abuse                          | HIGH     | user_watches              | Push not yet wired       | Document + cap (yes) |
| T4 | Tip-membership inference                          | HIGH     | tip_routings + salt       | Migration 04, RLS       | No (compounds T2)    |
| T5 | Takedown channel buried by noise OR ignored       | HIGH     | takedown_requests + email | Migration 04            | **YES — alert path** |
| T6 | Cases-data scrape burns quota                     | MED      | PostgREST                 | (none)                  | No                   |
| T7 | Magic-link scheme-squat                           | MED      | auth-callback             | Audit 02 §1.3-1.5       | Verify dashboard URL |
| T8 | Edge-Function reconnaissance / quota drain        | MED      | tip-route-submit          | Migration 04 (partial)  | No                   |
| T9 | Scraper-machine compromise                        | LOW      | scrapers via service-role | Folds into T2           | No (conditional)     |
| T10| Photo-cache SSRF                                  | LOW      | photo-cache               | Hand-curated sources    | No                   |

**Three threats actually block the week:** T2 (rotate the service-role JWT), T5 (alert path on takedown email), T3 (document + soft-cap watch zones). All three are <1 hour of work each.

---

## Domain 2 — Incident Response (right-sized for 12 testers)

### 1. Detection — what telemetry exists today

| Layer                  | Telemetry                                                 | Gap                                                         |
|------------------------|-----------------------------------------------------------|-------------------------------------------------------------|
| Mobile app             | None. No Sentry, no PostHog, no EAS error pipeline wired (`✓ verified` — `app.config.ts` mentions Sentry as future, no SDK installed; no `Sentry.init` in `mobile/app/_layout.tsx` etc.) | A crash in production is invisible until a tester emails. |
| Edge Functions         | `console.error` lines (e.g. `tip-route-submit/index.ts:99`, `ingest-tick/index.ts:46-51`); land in Supabase Function Logs | Logs are not streamed anywhere. Nobody is reading them.   |
| Supabase Postgres      | Project Logs UI, slow-query log, `pg_stat_*` views        | No alerting; no anomaly detection on row-count growth.    |
| Supabase Auth          | Auth event log in dashboard                               | Magic-link replay attempts (audit 02 §1.6) not surfaced.  |
| Vercel (coldfile.app)  | Vercel deployment + function logs (Vercel handles)        | OK — but the Next.js site is static; little to monitor.   |
| EAS (Expo)             | Build logs, OTA update history                            | OK for build telemetry; no runtime error reporting.       |

### 1.1 [HIGH] Mobile app has no crash/error reporting — a tester finding "the app crashes when I tap Send" is the only signal
**Location:** `mobile/`
**Gap:** No Sentry, EAS error reporting, or even `expo-error-recovery` initialized. A `TypeError` in a render path produces a white screen and an EAS build report only on debug builds.
**Remediation (pre-launch, ~30 min):** install `@sentry/react-native` and `sentry-expo`, init in `mobile/app/_layout.tsx` with the closed-test DSN. Free tier covers 5K events/month — fine for 12 testers. Capture: unhandled errors, network failures from `useSubmitTip`, magic-link callback errors (audit 02 §1.6 already flagged the silent `catch {}`).

### 1.2 [HIGH] Edge Function failures are silent to the user — `tip-route-submit` audit-insert errors return success
**Location:** `supabase/functions/tip-route-submit/index.ts:96-100`
**Gap:** Already raised in audit 01 MEDIUM-3 and audit 03 §1.MEDIUM-02. The `console.error` logs to Supabase Function Logs which nobody reads. If the audit insert starts failing (RLS drift, constraint addition), every tip silently un-audits and the user notices weeks later.
**Remediation (pre-launch, ~5 min):** wire a minimal log forwarder: post `console.error` lines to a Discord/Slack webhook (free; no infra). Or set up Supabase's built-in log drains if on Pro tier. Even `pg_cron` running every 15 minutes that selects `count(*) from supabase_functions.logs where level='error' and created_at > now() - interval '15 minutes'` and posts to a webhook works.

### 1.3 [HIGH] No detection of tip-channel abuse
**Location:** `tip_routings` table.
**Gap:** ip_hash and content_hash were designed as the abuse-detection levers (`tip-route-submit/index.ts:21-23`) but the queries aren't written or scheduled. A flood of 10K rows from one ip_hash sits unobserved.
**Remediation (pre-launch, ~30 min):** schedule a `pg_cron` job (Supabase supports this) that runs every 15 minutes:
```sql
select ip_hash, count(*) from tip_routings
where created_at > now() - interval '15 minutes'
group by ip_hash having count(*) > 20;
```
Wire results to a Discord/Slack webhook via a tiny PL/pgSQL function or a follow-up Edge Function.

### 1.4 [MEDIUM] No DB-exfiltration detection
**Location:** Supabase Postgres.
**Gap:** Supabase free tier doesn't ship anomaly detection. If a service-role-key holder dumps the entire `cases` table at 3 AM, the only signal is the bandwidth bill at the end of the month.
**Remediation (pre-launch, free tier):** enable Supabase's "billing alert" at 80% of free-tier egress. That's a one-toggle dashboard setting and the only realistic exfil canary on free tier. Post-launch (Pro tier): set up log drains to a SIEM-lite like Better Stack or Logtail.

---

### 2. Logging coverage

| What                          | Where                                  | Retention                       | Queryable after-fact?        |
|-------------------------------|----------------------------------------|---------------------------------|------------------------------|
| Tip routings (audit log)      | `tip_routings` table                   | 12 months (Migration 03)        | Yes — direct SQL             |
| Edge Function stdout/stderr   | Supabase Function Logs UI              | 7 days (free) / 90 days (Pro)   | Yes via dashboard, not API   |
| Postgres slow-queries         | Supabase Logs UI                       | Same                            | Yes via dashboard            |
| Auth events                   | Supabase Auth log                      | Same                            | Yes via dashboard            |
| Mobile crashes                | **Nothing**                            | n/a                             | No                           |
| Vercel function logs          | Vercel project                         | Per Vercel plan                 | Yes via Vercel CLI/UI        |
| Scraper runs                  | `source_runs` table                    | Indefinite (no purge yet)       | Yes — direct SQL             |

### 2.1 [MEDIUM] Function-log retention on free tier is 7 days
**Location:** Supabase project settings.
**Gap:** A bug reported on day 8 has no log evidence by the time the user investigates.
**Remediation:** keep a list of investigation-relevant queries pinned in a runbook so the user runs them within 7 days. Forensic-readiness checklist (§3) covers this. Post-launch: upgrade to Pro for 90-day retention before public release.

---

### 3. Forensic readiness — "tester says they submitted a tip but it never reached the agency"

Can the user trace it end-to-end **today**? Walking the path:

1. **Did the tip leave the device?** Mobile has no telemetry → **No, can't tell**. The `useSubmitTip` hook silently swallows errors. (Audit 02 §1.6.)
2. **Did the Edge Function receive it?** Yes — query Supabase Function Logs filtered by `tip-route-submit` invocation timestamps near the tester's report time. (Within 7 days.)
3. **Did the audit row land?** Yes — `select * from tip_routings where created_at between $window and $window + interval '5 min' order by created_at`. The user can match by `user_agent_summary` if the tester runs a recognizable build, or by ip_hash if the tester provides their public IP.
4. **What route was returned?** Yes — `routed_to_agency_id`, `routed_to_url`, `routed_to_kind` are all on the audit row.
5. **Did the user actually open the agency form?** **No, can't tell.** The handoff is `Linking.openURL(target)` — once the OS takes over, there's no telemetry. Whether the user pasted, typed, or abandoned is invisible to The Cold File. (This is by design — the privacy claim is "we never see what you wrote" — but it does cap how much trace-forensics is possible.)

### 3.1 [HIGH] Step 1 has no telemetry — the most common failure mode is undebuggable
**Remediation:** ship Sentry on mobile (§1.1). Specifically capture `[useSubmitTip] fetch failed` events. Without this, every "I tipped but nothing happened" report dead-ends.

### 3.2 [MEDIUM] No correlation ID end-to-end
**Gap:** there is no UUID generated client-side, attached to the request, and logged on both sides. A tester saying "I tipped at 3:45 PM" leaves you matching by timestamp alone.
**Remediation (post-launch):** generate a short correlation ID client-side, return it in the response, attach it to a `support_ref` field on `tip_routings`. Surface the correlation ID in the post-tip confirmation screen ("Reference: ABC-1234 — share this if you contact support"). Cheap, durable, low-effort.

---

### 4. Playbooks — minimum set before closed testing

The user needs **five** written playbooks before opening the closed track. Each should fit in a single markdown page in `docs/runbooks/` and be re-readable in 30 seconds during an actual incident.

#### 4.1 Playbook: leaked key (`docs/runbooks/leaked-key.md`)
The user has 4 keys that could leak: Supabase service-role JWT, Supabase anon JWT, Mapbox token, Stripe test secret. Plus `INGEST_TICK_SECRET`.

Per-key rotation order (do them in this exact sequence to avoid windows):

1. **Service-role JWT (highest blast radius).** Supabase dashboard → Settings → API → "Reset service_role key". Immediately:
   - Update `.env`.
   - Update `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` for Edge Functions.
   - Redeploy all Edge Functions (`supabase functions deploy --no-verify-jwt tip-route-submit`, etc.)
   - Update scraper CLI `.env` if separate (currently same).
   - Run `select count(*) from tip_routings where created_at > '<incident_time>'` to spot-check abuse during the leak window.
2. **Anon JWT.** Supabase dashboard → "Reset anon key". This breaks every installed mobile build until they receive an OTA update with the new bundle. With 12 testers: send a Discord/email blast, push an OTA via EAS Update (`eas update --branch production`). Build a new version and prompt force-update. **Plan for ~2 hours of unavailability for testers.**
3. **`INGEST_TICK_SECRET`.** Set new value in Supabase Function Secrets; update local `.env`; redeploy Edge Functions; restart any cron / scraper.
4. **Mapbox token.** Mapbox dashboard → reset → update `mobile/.env` → rebuild + OTA. (Note: ColdFiles uses MapLibre/OpenFreeMap per `app.config.ts`, so Mapbox token may already be unused — verify before rotating.)
5. **Stripe test secret.** Stripe dashboard → roll → update `.env`. No prod impact (test environment).

After-rotation: `git log --since=<incident> -p` to find any commit that may have leaked the key into history. If found: `git filter-repo` and force-push (rare but document the path).

#### 4.2 Playbook: Edge Function compromised / abused (`docs/runbooks/edge-function-abuse.md`)
Indicators: tip-route-submit invocation rate spikes 10x, `tip_routings` insert rate spikes, billing dashboard goes red.

Steps:
1. **Stop the bleeding.** Supabase dashboard → Edge Functions → `tip-route-submit` → "Pause" (or set `verify_jwt = true` temporarily and redeploy, breaking anon callers including legit testers — pick based on severity).
2. **Triage.** `select ip_hash, count(*) from tip_routings where created_at > now() - interval '1 hour' group by ip_hash order by count desc limit 20` — find the offending hashes.
3. **Patch.** Either ship the rate-limit code (T1) right then, or block at the network layer (Cloudflare in front of `*.supabase.co/functions/v1/tip-route-submit` if available).
4. **Forensics.** Export the function logs for the spike window before they roll off (7-day retention).
5. **Resume.** Un-pause the function with the patch in place.

#### 4.3 Playbook: data deletion request (GDPR/CCPA) (`docs/runbooks/data-deletion.md`)
The schema already supports user-initiated deletion via `delete_my_account()` (audit 02 §1.8 — known gap that it doesn't check row count). For an admin-initiated deletion (a request that arrives by email referencing a real user):

1. Verify the requester. Email-only is weak — ask them to send the deletion request *from the magic-link email*, OR provide a `support_ref` from `tip_routings` (post-§3.2).
2. Locate the user: `select id from auth.users where email = $1`.
3. Run `select public.delete_my_account()` impersonating the user via the Supabase admin SDK (or run the deletion SQL manually as service-role — same effect).
4. Confirm cascade: `select count(*) from user_watches where user_id = $1` and similar for `user_subscriptions`. Should be 0.
5. Audit row preservation (per privacy policy): `tip_routings.user_id` is nulled, not deleted. Confirm: `select count(*) from tip_routings where user_id = $1` should be 0.
6. Reply within 30 days (GDPR) / 45 days (CCPA).

#### 4.4 Playbook: takedown request (`docs/runbooks/takedown.md`)
Per memory `feedback_photo_legal_posture`: tolerance, not license. Takedowns are the legal pressure-release valve and **must** be honored fast.

1. Receive the email (mailto from privacy / takedown page).
2. Verify the requester's relationship: family member, rights-holder, subject of the photo. Don't require notarization — best-effort verification within 24 hours.
3. Locate the photo: `select id, case_id, source_attribution from case_media where url = $1` (or by case slug).
4. Soft-delete: `update case_media set deleted_at = now() where id = $1`. The `effectivePhotoUri` utility (referenced in commit 1e37123) is responsible for honoring the deletion.
5. Storage cleanup: if the photo was mirrored to Supabase Storage, delete the storage object too — use the Supabase Storage admin API.
6. Reply within 72 hours with confirmation.
7. **Log the takedown** in `takedown_requests` manually (since the Edge Function isn't shipped yet) — set `status='resolved'`, capture the email-hash, the reason, the requester relationship.

SLA commitment to publish in privacy policy: 72 hours acknowledgment, 7 days resolution.

#### 4.5 Playbook: Play Store policy violation (`docs/runbooks/play-store-violation.md`)
Most likely v1.0 violation surfaces: Data Safety form mismatch, deceptive behavior (the "we never see what you wrote" claim if the Edge Function is found to log content), location-permission disclosure.

1. Read the violation email. Note the policy section cited (e.g. "User Data — incomplete disclosure").
2. **If it's a Data Safety form gap:** open the form, update declarations to match what audit 03 verified. Re-submit. Allow 1-2 days for re-review.
3. **If it's a deceptive-behavior allegation:** stop the closed test (Play Console → Closed testing → "Pause"). Investigate the specific claim. The privacy-policy claim that's most likely to be challenged is "we never see what you wrote" — point Google at audit 01 §3, audit 02 §2.4, audit 03 §1, all of which verify the claim at the code level.
4. **If it's location precision:** confirm `app.config.ts` declares `ACCESS_COARSE_LOCATION` only (`✓ verified`). The policy declares approximate location only.
5. Reply via Play Console with: cite of code, link to privacy policy, link to audit doc. Include the audit's commit SHA so it's verifiable.
6. If escalated: take the legal-hold posture from the takedown playbook (preserve all logs).

---

### 5. Communication — reaching 12 testers in an emergency

Closed-test invitees are added by email in Play Console. The user has those 12 emails. Today there is no broadcast channel.

### 5.1 [HIGH] No emergency tester broadcast channel
**Gap:** if the user needs to push an emergency OTA, "stop using the build", or rotate keys (see §4.1 step 2 — this **breaks every installed app** until the OTA lands), the user has to email 12 people manually.
**Remediation (pre-launch, 15 min):** create a Discord server or a Telegram broadcast channel. Put the invite link in the closed-test welcome email and on the in-app "feedback" screen. **OR** at minimum: maintain a `docs/testers.md` (gitignored) with the 12 emails for one-shot mailmerge.

### 5.2 [MEDIUM] OTA path not exercised
**Gap:** EAS Update is configured (`eas.json` exists, `expo-updates` is in package.json) but the user has likely not yet pushed an update via `eas update --branch production` and confirmed it lands on a real device.
**Remediation (pre-launch, 20 min):** push a no-op OTA (`eas update --branch production --message "Smoke test OTA delivery"`) once before opening closed testing. Confirm on a tester device that the update appears within ~2 minutes.

---

### 6. Recovery — Supabase point-in-time restore

### 6.1 [HIGH] PITR has not been tested
**Gap:** Supabase free tier does **not** include PITR (Point-in-Time Recovery is a Pro+ feature). Free tier offers daily backups only, retained for 7 days, and they require manual restore via dashboard (which spins up a new project, not in-place).

The user is presumably still on free tier. So:
- "PITR" is not actually available.
- A daily backup *exists* but has not been restored even once for verification.
**Remediation (pre-launch, ~1 hour):**
1. In Supabase dashboard, confirm the daily backup status is green.
2. Spin up a free **scratch** Supabase project. From the main project's backup tab, restore the most recent daily snapshot to the scratch project. Verify table counts match. Verify Edge Functions still work (they don't transfer with the backup — code is in the repo, but secrets are not — note this in the runbook).
3. Decision point: upgrade to Pro ($25/mo) before public launch to get PITR + 90-day log retention. For 12-tester closed testing: free tier daily backup is acceptable, but the user must accept that worst-case data loss is ~24 hours.

### 6.2 [MEDIUM] No documented "restore from backup" runbook
**Remediation:** add `docs/runbooks/db-restore.md` capturing the verified-working restore steps from §6.1 step 2 above.

---

### 7. Inventory of existing IR muscle (the good news)

| Capability                              | State  | Note                                                     |
|-----------------------------------------|--------|----------------------------------------------------------|
| Account deletion (GDPR Art 17)          | ✓     | `delete_my_account()` SQL function (Migration 03).       |
| Audit log immutability for tips         | ✓     | `tip_routings` is RLS write-only post-Migration 04.       |
| Privacy policy with takedown contact    | ✓     | Per audit 03; legal pages shipped (commit 5710a58).      |
| Migration journal                       | ✓     | `migrations/` dir is the canonical record.               |
| Source attribution on photos            | ✓     | `case_media.source_attribution` mandatory (memory).      |
| Effective-photo-URI utility             | ✓     | Honors per-source mirroring policy (commit 1e37123).      |
| Service-role secret separation          | ✓     | Service-role never crosses to mobile bundle (audit 02).   |
| Auth event log                          | ✓     | Supabase Auth dashboard surfaces magic-link issuance.    |

---

## Ship-blocker checklist (for closed testing this week)

Only items in this checklist block opening Google Play closed testing. Everything else is post-launch.

- [ ] **Rotate service-role JWT.** Yesterday's leaked-keys-in-chat incident was the warning shot. (T2; audit 02 §1.1.) ~10 min.
- [ ] **Rotate Mapbox + Stripe test secret + INGEST_TICK_SECRET.** Same reason. (T2; audit 01 LOW-6.) ~15 min.
- [ ] **Verify Supabase redirect-URL allowlist is exact `coldfile://auth-callback`, not `coldfile://**` wildcard.** Dashboard check. (T7; audit 02 §1.3.) ~2 min.
- [ ] **Apply Migration 04** if not already applied to the production project. (Already authored, `✓ verified` migrations/04_lock_down_anon_writes.sql exists.) ~5 min.
- [ ] **Wire takedown-email alert.** Forward the takedown mailbox to phone push (Gmail + IFTTT, or just enable mobile email push for that inbox). T5. ~10 min.
- [ ] **Soft-cap watch zones.** Add `CHECK (ST_Area(watch_zone_geom::geography) >= 200000)` and a 5-zone-per-user trigger to `user_watches`. T3. ~15 min — or document the abuse window publicly and defer to v1.0.1 if push-notifications are also deferred (which they are per `app.config.ts`).
- [ ] **Install Sentry on mobile.** Without crash reporting, every "the app didn't work" report is undebuggable. IR §1.1, §3.1. ~30 min.
- [ ] **Wire one alert** for `tip_routings` ip_hash burst (§1.3) — `pg_cron` + Discord webhook. ~30 min. *Optional but cheap.*
- [ ] **Confirm Supabase daily backup is green** and **do one restore-to-scratch-project drill**. §6.1. ~45 min.
- [ ] **Set up a tester broadcast channel** (Discord/Telegram) and link it from the welcome email. §5.1. ~15 min.
- [ ] **Push one no-op OTA via `eas update`** to verify the OTA path works. §5.2. ~20 min.
- [ ] **Write the 5 playbooks** (leaked-key, edge-abuse, data-deletion, takedown, play-store-violation) as one-page runbooks in `docs/runbooks/`. ~90 min total. Don't skip — they're the difference between yesterday's incident being a quick fix and a multi-hour scramble.

**Total ship-blocker effort: ~5 hours.** Everything else from this audit is post-launch hardening.

---

## Appendix — what was NOT covered

- Detailed playbook *content* for each of the 5 runbooks: §4 sketches each but the user must write them out in full before opening closed testing.
- Compliance attestation language for Play Console Data Safety form — covered by audit 03.
- Code-level findings on individual files — covered by audits 01, 02, 04. Not duplicated here.
- Dependency CVEs — covered by audit 05.
- Long-term IR maturation (SIEM, on-call rotation, incident postmortem template). Not appropriate at solo-dev / 12-tester scale. Revisit at 1000 DAU or first paid revenue.
