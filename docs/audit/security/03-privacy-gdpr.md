# Privacy / GDPR / CCPA Audit — The Cold File

**Auditor:** internal review pass
**Date:** 2026-04-29
**Scope:** trace every PII flow against the privacy-policy claims at
`/Users/jtroy/Desktop/ColdFiles/app/legal/privacy/page.tsx` (hosted at
coldfile.app/legal/privacy). Compliance items: GDPR, CCPA / CPRA, CalOPPA,
Google Play Data Safety, Apple App Store privacy nutrition label.

The data-safety walkthrough referenced in the brief
(`docs/coldfile-data-safety-walkthrough.md`) **does not exist** in the repo.
That is itself a finding — see 8.LOW-01.

Severity legend:
- **CRITICAL** — privacy-policy claim is contradicted by code (material
  misrepresentation risk under FTC §5, Cal. Bus. & Prof. §22576, GDPR Art. 13)
- **HIGH** — real privacy concern, fix before submission
- **MEDIUM** — defense-in-depth / cleanup
- **LOW** — informational

---

## 1. Tip-content claim — "we never see what you wrote"

**Policy:** `app/legal/privacy/page.tsx:62-66` — *"The Cold File never sees the
content of your tips… The content of the tip itself is never recorded."*
Plain-language summary at line 21-22 repeats the claim.

### What the code actually does

- Plaintext `tipBody` lives in React state at
  `mobile/app/tip/[slug].tsx:81` (`useState('')`) and is hashed locally before
  any network call: `mobile/lib/hooks/use-submit-tip.ts:73-75` →
  `mobile/lib/hash.ts:23-30` (SHA-256 with the project-wide salt
  `COLD_FILE_TIP_HASH_SALT_V1`).
- The Edge Function payload at
  `mobile/lib/hooks/use-submit-tip.ts:91-100` is `{ case_id, content_hash,
  user_agent_summary }` — **no `content` field**.
- `supabase/functions/tip-route-submit/index.ts:85-94` inserts only
  `case_id, user_id, routed_to_agency_id, routed_to_url, routed_to_kind,
  content_hash, ip_hash, user_agent_summary`. No body field, no derived field,
  no extra columns. RLS at `migrations/01_schema.sql:640-641` allows insert
  but no read by clients.
- The Edge Function's only `console.error` line
  (`tip-route-submit/index.ts:99`) logs `insertError.message` — the Postgres
  error string, never the request body. Verified the file does **not**
  `JSON.stringify` the request anywhere.
- The deep-link target hand-off (`mobile/app/tip/[slug].tsx:135` →
  `Linking.openURL(target)`) sends the user to an external agency form. The
  text the user types into that form is invisible to The Cold File by
  construction.

### Findings

**[1.PASS] The tip-content claim is airtight at the application layer.**
The plaintext literally cannot reach the server because (a) the hook hashes
client-side before invoking the Edge Function, (b) the Edge Function's typed
body interface (`RequestBody` at `tip-route-submit/index.ts:29-33`) has no
`content` field, and (c) the insert spread is closed.

**[1.MEDIUM-01] Salt is not a secret and is in the bundled JS.**
`mobile/lib/hash.ts:17` — `const SALT = 'COLD_FILE_TIP_HASH_SALT_V1';`. This
is a constant in the client bundle, so any attacker with the APK can produce
the same hashes. The hash provides duplicate-detection only (the file's own
docstring acknowledges this); it does **not** prevent rainbow-table recovery
of short / common tip strings ("I saw him at the gas station on Friday").
Defensible as long as the policy honestly says hashes are for abuse-detection
duplicate matching — which it does (`app/legal/privacy/page.tsx:64`). Add a
note in `docs/05_TIP_ROUTING.md` that hashes are not a confidentiality
boundary, only an integrity / dedup signal.

**[1.MEDIUM-02] Edge Function `console.error` writes to Supabase Function
Logs, which Supabase retains.** `tip-route-submit/index.ts:99` is benign as
written (it logs only `insertError.message`), but if a future contributor
swaps in `console.error('insert failed:', insertError, body)` the request
body becomes visible to every operator with Function Logs access. Add a
comment marking the line load-bearing for the privacy claim, and add an ESLint
rule or test that fails if the body variable is referenced inside any
`console.*` call in `supabase/functions/tip-route-submit/`.

**[1.LOW-01] The fallback path leaks the tip via clipboard.**
`mobile/app/tip/[slug].tsx:351` — when the deep-link fails the user can copy
the agency URL (not the tip body), which is fine. But the user must then
re-paste their tip into a browser, where keyboard / autofill / clipboard
sync (e.g., Apple Universal Clipboard, Google Keyboard cloud sync) may
expose the text to providers outside The Cold File's chain. The policy is
silent on this. Consider a single sentence: *"Once your tip leaves the app,
the agency, your browser, your keyboard, and your clipboard provider may
all see it. We have no visibility into any of these."*

---

## 2. Location handling — "we do not retain your location"

**Policy:** `app/legal/privacy/page.tsx:34` — *"We do not retain your
location, build a history of your movements, or correlate your location with
any identifier."* Retention table at line 110: *"Location queries: not
retained after the query result is returned."*

### What the code actually does

- `mobile/lib/hooks/use-here.ts` requests `Accuracy.Balanced` foreground
  permission only (line 88), stores the fix in React state with a 30-second
  fresh-flag timer (line 96-99), and flips back to stale. **No persistence to
  AsyncStorage, no analytics, no upload.**
- `mobile/app.config.ts:58` declares `ACCESS_COARSE_LOCATION` only — explicit
  comment at line 55-58 says fine location is rejected to keep the Data
  Safety form honest. iOS `infoPlist` at line 26-27 declares
  `NSLocationWhenInUseUsageDescription` only (no `Always`).
- `mobile/lib/hooks/use-cases-near.ts:60-67` passes `lat, lng` as RPC
  arguments to `cases_within_radius`. Postgres function is `language sql
  stable` (`migrations/01_schema.sql:497-541`) — no INSERT, no audit table,
  no temp table. Coordinates are arguments only and are not bound to any
  insert.
- No row in any user-facing table stores the user's `here` lat/lng. The only
  geometry persisted on the user side is `user_watches.watch_zone_geom`
  (`migrations/01_schema.sql:335`), which is user-authored and tied to
  `user_id`. The mobile app does **not** currently insert into `user_watches`
  (verified by grepping for `user_watches` writes — none exist in
  `mobile/`), consistent with the policy's "future release" caveat
  (`app/legal/privacy/page.tsx:41`).

### Findings

**[2.PASS] In-flight only at the application layer.** Location is sent as
an RPC argument and never stored by app-level code.

**[2.MEDIUM-03] Provider-level Postgres logs may capture lat/lng as RPC
parameters.** Supabase's default `log_statement = 'none'` and
`log_min_duration_statement = -1` mean function arguments are not logged in
production, but **slow-query logging or a misconfigured `pg_audit` extension
will capture every `select cases_within_radius(34.42, -119.4, …)` call**.
The privacy policy disclaims this only implicitly ("operated on
infrastructure operated in the United States" at line 42). Add a one-line
provider note: *"Our database provider, Supabase, may briefly log query
parameters in operational logs; we have configured the project to disable
statement logging."* And verify in the Supabase dashboard that
`log_statement` and `pg_audit` are disabled on the project. If you cannot
verify, the policy claim weakens from "we do not retain" to "we do not
intentionally retain"; the wording should reflect that.

**[2.LOW-02] Map tile providers see the user's viewport.** Disclosed at
`app/legal/privacy/page.tsx:101` — *"OpenStreetMap provides map tiles and
rendering; it sees the map area you are currently viewing."* The actual
tile endpoints are `tiles.openfreemap.org`
(`mobile/constants/theme.ts:155`) and `tile.openstreetmap.org`
(`mobile/components/cf/leaflet-map.tsx:417`,
`leaflet-watch-zone.tsx:216`). OpenFreeMap is a separate (Hungarian) tile
service. Either widen the policy to "OpenStreetMap and OpenFreeMap (a
volunteer-funded OSM tile mirror)" or migrate fully to one provider.

---

## 3. Account info — "deletable via in-app flow, 7-day active purge"

**Policy:** `app/legal/privacy/page.tsx:43` — *"your email and any saved-case
records are permanently deleted from our active database within 7 days.
Supabase retains backup copies of authentication data for up to 30 days,
after which your email is purged from all systems."* Retention claim at
line 112.

### What the code actually does

- `mobile/app/delete-account.tsx:74` invokes RPC `delete_my_account`.
- `migrations/03_account_deletion_and_retention.sql:36-61` defines the RPC.
  It (a) nulls `tip_routings.user_id` for the calling user, (b) deletes
  `auth.users` for the calling user. `user_watches`, `user_subscriptions`
  cascade via the FKs at `migrations/01_schema.sql:333, 372`.
- Saved cases live in **device-local AsyncStorage** only
  (`mobile/lib/hooks/use-saved-cases.ts:50` — no server table), so on the
  device they persist until sign-out / app uninstall (the screen copy at
  `delete-account.tsx:137` discloses this honestly).
- The RPC is `security definer`, ACLs locked to `authenticated`
  (`migrations/03_account_deletion_and_retention.sql:63-64`).

### Findings

**[3.PASS] Delete is synchronous, not eventual; the policy's "within 7 days"
is overly conservative — actual deletion is immediate.** The 7-day window
is a margin for retries / replication, which is fine.

**[3.HIGH-01] Policy says saved cases are deleted; the RPC does not touch
device storage.** `app/legal/privacy/page.tsx:43` claims *"your email **and
any saved-case records** are permanently deleted."* The RPC at
`migrations/03_account_deletion_and_retention.sql:36-61` only writes to
`tip_routings.user_id` and `auth.users`. There is no server-side
`saved_cases` table to delete (saved cases are AsyncStorage-only —
`use-saved-cases.ts:18, 50`). The screen copy at
`delete-account.tsx:137` correctly discloses this — *"device-local saves
stay until you sign out"* — but the **public web policy at line 43 does
not**. A reader of the public policy reasonably believes deletion wipes
saved cases, when in fact uninstalling the app or clearing app storage is
required.

Two acceptable fixes (pick one):

1. Tighten the policy to match the screen copy: *"your email and any
   server-synced saved-case records are deleted… device-local saved cases
   remain on your phone until you uninstall or sign out."*
2. Have `delete_my_account()` also instruct the client to clear AsyncStorage
   keys `cf:saved_cases:v1` and `cf:submitted_tips:v1` — already harmless
   because the user is being signed out.

The screen copy is the source of truth in the in-app context (Play Store
auditors check there); the public policy must catch up.

**[3.MEDIUM-04] No web-accessible deletion path is wired.**
`mobile/app/delete-account.tsx:14-18` says *"The web-accessible counterpart
lives at https://coldfile.app/account/delete."* Verified — no such route
exists in `app/`. Required by Play Store policy as of mid-2024 for apps
with accounts: a public URL where users without the app installed can
request deletion. The privacy policy's only fallback is the
`privacy@coldfile.app` email, which Play reviewers may or may not accept.

**[3.MEDIUM-05] `delete_my_account()` returns silent success when not
authenticated.** Line 45-47 returns `{'ok': false, 'error':
'not_authenticated'}` but the screen at
`mobile/app/delete-account.tsx:75` only checks `error` from the RPC
envelope, not the JSON `ok` field. A request without a session would
appear "successful" to the user. Trivial fix: have the screen check
`data?.ok` and surface the error.

**[3.LOW-03] The 30-day backup-purge claim is provider-controlled.** The
policy is honest: it says "Supabase retains backup copies." This is
out-of-scope for the audit; flag only that the 30-day window is **claimed**,
not enforced by The Cold File. If Supabase changes its retention defaults,
the policy is stale silently. Add a quarterly check.

---

## 4. Audit log — "tip-routing audit retained 12 months"

**Policy:** `app/legal/privacy/page.tsx:111` — *"Tip-routing audit log:
retained for 12 months, then automatically deleted."* Disclosed fields at
line 64: *"the case ID you were viewing; the time of the routing; a one-way
hash of your tip text; a hashed approximation of your IP address; a coarse
summary of your device and operating system; and your user ID, if you are
signed in."*

### What the code actually does

- Schema at `migrations/01_schema.sql:353-364`: `tip_routings(id, case_id,
  user_id, routed_to_agency_id, routed_to_url, routed_to_kind,
  content_hash, ip_hash, user_agent_summary, created_at)`.
- Cron at `migrations/03_account_deletion_and_retention.sql:92-96` schedules
  daily `delete from public.tip_routings where created_at < now() -
  interval '12 months'` at 03:17 UTC. The job-name dedup loop at lines
  80-90 prevents duplicate registrations on rerun.

### Findings

**[4.HIGH-02] The audit log stores **two undisclosed fields**: routing
target URL and routing kind.** Policy at `app/legal/privacy/page.tsx:64`
discloses six fields. Schema at `migrations/01_schema.sql:357-359` writes
**eight**:

| Field                  | Disclosed in policy? |
|------------------------|----------------------|
| `case_id`              | Yes — "case ID"      |
| `created_at`           | Yes — "time"         |
| `content_hash`         | Yes — "one-way hash of your tip text" |
| `ip_hash`              | Yes — "hashed approximation of your IP" |
| `user_agent_summary`   | Yes — "coarse summary of your device" |
| `user_id`              | Yes — "user ID, if signed in" |
| `routed_to_agency_id`  | **NO**               |
| `routed_to_url`        | **NO**               |
| `routed_to_kind`       | **NO**               |

The routing target is not personal data per se, but it does establish a
record that "user X tipped about case Y to agency Z" — which is not
directly disclosed. Mitigations:

1. Update the policy: *"…and which agency or tip channel we routed you to,
   so the in-app receipt can name it."*
2. Or drop those columns (impossible — they are needed to render the
   receipt at `mobile/lib/hooks/use-submit-tip.ts:120` and the Me-tab
   list).

Disclose, don't drop. This is a one-sentence policy patch, but **without
it the policy is materially incomplete.**

**[4.MEDIUM-06] The cron job is registered but no test verifies it runs
or that the WHERE clause is right.** `cron.schedule` is fire-and-forget;
if pg_cron is paused on the project (it can be on Supabase Free) the
12-month claim quietly fails. Add an assertion script that:
1. Inserts a row with `created_at = now() - interval '13 months'`.
2. Calls `select cron.run_job((select jobid from cron.job where jobname =
   'tip-routings-purge-12mo'))` (or the scheduled wrapper).
3. Asserts the row is gone.

This is a once-a-year correctness check, not a hot-path test, but the
12-month retention claim is enforceable only as far as the cron actually
fires.

**[4.LOW-04] The `tip_routings_insert` policy at
`migrations/01_schema.sql:640-641` is `for insert with check (true)`.**
This is correct for an anonymous-tips-first design, but the absence of any
SELECT policy means even the user who created the row cannot read it back.
This matches the privacy policy claim (no user-facing receipt UI reads
from this table — receipts are AsyncStorage-only via
`use-submitted-tips.ts`). Defensible. Document the choice in
`docs/05_TIP_ROUTING.md`.

---

## 5. CCPA / CPRA — "no sale, no cross-context behavioral advertising"

**Policy:** `app/legal/privacy/page.tsx:126` — *"The Cold File does not sell
or share personal information for cross-context behavioral advertising."*
Reinforced at line 56: *"We do not sell or rent any data. We do not run
advertisements. We do not have advertising partners."*

### What the code actually does

- **Zero analytics SDKs.** Searched for amplitude, mixpanel, segment, sentry,
  datadog, posthog, bugsnag, firebase analytics, admob, gtag, appcenter,
  crashlytics — **no matches** outside docstrings.
- `mobile/package.json` dependency list is clean: only Expo / Supabase /
  navigation / map libraries. No tracking SDKs.
- `mobile/lib/hash.ts` and `mobile/lib/supabase.ts` have a single header
  `x-cold-file-client: 'mobile'` — used to identify mobile-vs-web in
  Postgres logs. Not an advertising identifier.
- `mobile/app.config.ts` does not request `IDFA`, `TrackingTransparency`,
  or `AAID`. No `expo-tracking-transparency` plugin is registered.

### Findings

**[5.PASS]** No sale, no cross-context behavioral advertising, no third-
party analytics integrations. The CCPA claim is supported.

**[5.MEDIUM-07] In-app privacy screen `mobile/app/privacy.tsx` is **out of
sync** with the public policy.** Line 20 says *"Crash reports. If the app
crashes, an anonymous report is sent to help us fix bugs."* But the public
policy at `app/legal/privacy/page.tsx:49` says *"Version 1.0 of The Cold
File does not include automated crash reporting."* And the codebase has
no crash-reporting SDK. The mobile copy is wrong on its face.

Line 36 also lists *"Apple / Google (push notification delivery)"*, but
the public policy at line 103 says push is *"not used in version 1.0."*
And `mobile/app.config.ts` has no `expo-notifications` plugin or APN /
FCM setup — verified.

The mobile in-app privacy page is outdated relative to the public policy
and the actual code. Replace the contents of
`mobile/app/privacy.tsx` with the same text as
`app/legal/privacy/page.tsx`, or drive both from the same source. **Two
inconsistent privacy texts is a CalOPPA / Play Store compliance risk.**

---

## 6. GDPR / EEA — "US-only, not targeted at EEA"

**Policy:** `app/legal/privacy/page.tsx:132` — *"The Cold File is operated in
the United States and is not currently targeted at users in the EEA or the
UK."*

### What the code actually does

- App is English-only. No locale files, no `i18n` library in
  `mobile/package.json`.
- No currency formatting (verified — `Intl.NumberFormat` not used; no EUR /
  GBP strings).
- Region locks: not enforced. The Play Store listing at
  `docs/08_PLAY_STORE_LISTING.md` (referenced — exists per `ls`) is the
  external gate. App.config.ts does not declare `availableCountries` or a
  region restriction.
- Cases are US-only by data source — NamUs, Charley Project, Doe Network,
  agencies — confirmed at `app/legal/privacy/page.tsx:71`.
- No EU-targeted marketing (no marketing infrastructure exists; the policy
  at line 41 says no marketing email is sent).

### Findings

**[6.PASS] No EU targeting in the product surface.** GDPR Art. 3 territorial
scope is unlikely to attach because the app neither targets EEA users
(US-only data, English-only, US-state location codes baked into the
schema at `migrations/01_schema.sql:175-176`) nor monitors EEA behavior
(no analytics).

**[6.MEDIUM-08] Lawful basis for incidentally-processed EEA users is not
stated.** The policy says *"If you reach out, we will respond in good
faith."* GDPR-compliant rigor wants an explicit Art. 6(1)(f) legitimate-
interest basis declared, even for the residual EEA users who download from
unsupported regions. Add a single line to the EEA section: *"For any
processing of EEA / UK users that does occur, our lawful basis is GDPR
Article 6(1)(f) — legitimate interest in operating the service and
detecting tip-line abuse — balanced against the minimal data we collect
and the option to use the app without an account."*

**[6.MEDIUM-09] No data-controller / DPO mention.** Not strictly required
for non-EEA-targeted apps under GDPR Art. 27, but standard practice.
*"Matte Black Dev LLC is the data controller. We are not required to
appoint an EU representative because we do not target the EEA. EEA
inquiries: privacy@coldfile.app."*

**[6.LOW-05] The data-safety walkthrough referenced in this audit's brief
(`docs/coldfile-data-safety-walkthrough.md`) is missing.** Without it,
auditors / Play Store reviewers cannot trace the Data Safety form
declarations back to evidence. Create the walkthrough as a checklist
mapping each Data Safety question to (a) the policy section, (b) the
code line. Out-of-scope for this audit but blocks Data Safety review.

---

## 7. Cross-cutting findings

**[7.HIGH-03] `markCaseTipped` failure is logged with the case slug, which
when joined with the device's local clock can re-identify a tip event.**
`mobile/lib/hooks/use-submit-tip.ts:108-110` — `console.warn('[useSubmitTip]
markCaseTipped failed:', err)`. Benign in-app, but if the user's device
ships logs anywhere (Android adb logcat → bug-report attached to a Play
Store review), the slug + timestamp pair is identifiable. Lower the log
level to a no-op in production, or log only the error class, not the
context. Trivial fix; flagging because the trust contract is "we never see
which cases you tipped about" — the local log breaks that for anyone with
device-log access.

**[7.MEDIUM-10] No "Right to Know" automation.** Policy at
`app/legal/privacy/page.tsx:120` says *"Access: email
privacy@coldfile.app to ask what information, if any, we hold about you."*
That is acceptable under CCPA §1798.130, but consider an in-app *"Export
my data"* button that runs the trivial query (the user's tip-routing rows
+ saved cases + email). It's a 30-line addition that makes the access
right enforceable without manual operator response, and Play Store
reviewers grade it favorably.

**[7.MEDIUM-11] No "Last verified" / version stamp on the policy
beyond the date.** `app/legal/privacy/page.tsx:15` shows
`lastUpdated="2026-04-29"`. The policy says prior versions are kept on
request (line 146). Add a Git-tagged versions/ subdirectory of the policy
file so prior text is auditable without an email request.

---

## 8. Out-of-scope but worth flagging

**[8.LOW-01] Missing `docs/coldfile-data-safety-walkthrough.md`.** The
brief references it; this audit cannot verify Play Store Data Safety form
correctness without it. Create the file before submission.

**[8.LOW-02] No security.txt at coldfile.app.** Policy at line 139 invites
disclosure to `security@coldfile.app`. Standard practice (RFC 9116) is a
`/.well-known/security.txt` route. Three-line addition to the Next app.

---

## Severity totals

| Severity   | Count |
|------------|-------|
| CRITICAL   | 0     |
| HIGH       | 3     |
| MEDIUM     | 11    |
| LOW        | 6     |

**No CRITICAL findings.** The central trust claim — "we never see what you
wrote" — is supported by the code. Three HIGH-severity findings are policy
gaps (saved-case deletion wording, undisclosed audit columns, device-side
slug logging in a console.warn) that must be fixed before public submission;
none invalidate the product's core privacy posture.

---

## Recommended fix order (pre-submission)

1. **3.HIGH-01** — patch `app/legal/privacy/page.tsx:43` with the screen-copy
   wording, OR have `delete_my_account` flow clear AsyncStorage on success.
2. **4.HIGH-02** — add the routing-target sentence to
   `app/legal/privacy/page.tsx:64`.
3. **5.MEDIUM-07** — replace `mobile/app/privacy.tsx` content (drop crash-
   report and push-notification claims; sync to public policy).
4. **7.HIGH-03** — strip the slug from the `console.warn`.
5. **3.MEDIUM-04** — wire a public `coldfile.app/account/delete` page or
   drop the in-code reference.
6. **6.MEDIUM-08** — add the GDPR Art. 6(1)(f) legitimate-interest sentence.
7. **4.MEDIUM-06** — add a once-a-year retention-cron correctness test.
8. **8.LOW-01** — write the data-safety walkthrough.

The remaining MEDIUM / LOW items are housekeeping and can ship in 1.0.1.
