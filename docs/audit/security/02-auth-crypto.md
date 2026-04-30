# Audit 02 — Auth, Session, Data Security & Cryptography

Scope: Supabase magic-link auth (email-OTP only), deep-link callback, account
deletion, tip-routing audit log, content/IP hashing.

Stack snapshot
- Mobile: Expo SDK 54 RN, `@supabase/supabase-js` with `AsyncStorage` session
  persistence (`mobile/lib/supabase.ts:41-56`).
- Backend: Supabase Postgres + Edge Functions (Deno).
- Deep link scheme: `coldfile://` (`mobile/app.config.ts:19`).
- Auth flow: `signInWithOtp` → `coldfile://auth-callback` →
  `exchangeCodeForSession` (PKCE) or `setSession` (implicit).

Severity legend: CRITICAL / HIGH / MEDIUM / LOW.

---

## 1. Auth & Session Review

### 1.1 [CRITICAL] Service-role JWT and Stripe secret are present in a local
plaintext `.env` at the repository root

File: `/Users/jtroy/Desktop/ColdFiles/.env:11`, `:18`

```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs… (role: service_role, exp 2093)
STRIPE_SECRET_KEY=sk_test_51TRaHD…
```

- `.gitignore:12-15` does exclude `.env` and the file does not appear in
  `git ls-files`. Repo history is clean for now.
- Risk: the service-role JWT bypasses every RLS policy in the entire schema
  (`migrations/01_schema.sql:595-645`). Any local-machine compromise, accidental
  paste into chat, or stray `tar`/IDE-sync exfiltrates a god-mode credential
  with a 2036 expiry (`exp: 2093052043`). Rotation is non-trivial because the
  same JWT signs all admin operations.
- The Stripe secret is a `sk_test_…` (test environment), so blast radius is
  limited to Stripe sandbox — but a live secret would replace it before launch
  and the same file pattern is the leak vector.

Action: rotate the service-role JWT now (Supabase dashboard → Settings → API →
"Reset"), move the new value into a password manager + EAS env / Supabase
Function secret, and delete the local `.env` (or replace with `…=__rotate_me__`
placeholders). Add a `.env` pre-commit hook (`detect-secrets` or `gitleaks`)
since the file lives at the repo root where `git add .` is a one-keystroke
mistake.

### 1.2 [HIGH] `enable_signup = true` on Supabase auth — no allowlist, no captcha

File: `/Users/jtroy/Desktop/ColdFiles/supabase/config.toml:43`

```
[auth]
enable_signup = true
```

The OTP endpoint (`signInWithOtp`) implicitly creates a user when the email
doesn't exist. With no rate-limit shield (Supabase project default is ~30/h
per IP, not aggressive enough to deter scripted abuse), an attacker can:
1. Pump arbitrary email addresses into `auth.users` to bloat the table or
   sign Cold File up as the apparent sender of unsolicited emails (Supabase's
   default sender is your project's domain).
2. Spray a single inbox with magic-link emails as a low-grade harassment
   vector (the user types something into a CF screen but the attacker fires
   `signInWithOtp` from outside).

Action: enable Captcha (Cloudflare Turnstile is supported natively) on the
OTP endpoint via Supabase dashboard → Auth → Settings; set per-IP rate limit
to ≤ 5/min on OTP. The mobile flow already requires user interaction so the
captcha cost is one-time per sign-in.

### 1.3 [HIGH] Redirect-URL allowlist must be exact, not wildcarded

File: project setting in Supabase dashboard (referenced from
`mobile/lib/hooks/use-user.ts:78` `emailRedirectTo: 'coldfile://auth-callback'`).

The audit prompt notes "the Supabase URL config requires `coldfile://**`
redirect — is that wildcarded too broadly?" It is. A `coldfile://**` glob
would let any path be a magic-link landing target — including paths that
the app does not own, e.g. `coldfile://attacker-controlled-deeplink#access_token=…`
in the case where another app on the device claims the same scheme (Android
allows multiple apps to register the same custom scheme; the resolver shows
a chooser, but a previously-installed lookalike app with the same scheme
could intercept).

Action: in Supabase dashboard → Authentication → URL Configuration →
Redirect URLs, set the allowlist to the **exact** value
`coldfile://auth-callback` (no wildcard). This is what the client requests
anyway (`use-user.ts:78`) — there is no path the wildcard unlocks for the
real app. Consider adding Android App Links (verified domain
`https://coldfile.app/auth-callback` with assetlinks.json) for v1.0.1 so the
OS routes the link only to the signed app — that closes the scheme-squatting
hole entirely.

### 1.4 [MEDIUM] Deep-link `URL.match(/[?&]code=([^&#]+)/)` is permissive

Files: `mobile/app/auth-callback.tsx:38`, `mobile/lib/hooks/use-auth-callback.ts:39`

The PKCE branch matches `?code=` anywhere in the URL string with no scheme
guard at all in `auth-callback.tsx` (the hook does check `startsWith(REDIRECT_PREFIX)`
at `use-auth-callback.ts:36`, but the screen does not). On a cold-launch the
screen reads `Linking.getInitialURL()` and forwards anything containing
`?code=` to `exchangeCodeForSession`. If the user arrives via any other deep
link that happens to carry a `code=` query parameter (e.g., a future tip
share-link with `?code=ABCD` for a case identifier), Supabase will burn the
client's PKCE state attempting to exchange it.

Action: in `mobile/app/auth-callback.tsx:34`, add the same `startsWith`
guard the hook uses, e.g.

```ts
if (!target.startsWith('coldfile://auth-callback')) {
  if (!cancelled) router.replace('/');
  return;
}
```

### 1.5 [MEDIUM] Both PKCE and implicit handlers are wired with no preference

Files: `mobile/app/auth-callback.tsx:37-65`, `mobile/lib/hooks/use-auth-callback.ts:38-60`

The code intentionally supports both flows "in case Supabase's project
setting changes" (`use-auth-callback.ts:13-15`). PKCE is strictly stronger
than implicit — implicit puts `access_token` + `refresh_token` directly in
the URL hash, where they can land in OS deep-link logs, third-party SDK
breadcrumbs, or shared clipboard if the user copies the URL.

Action: pick PKCE in the Supabase dashboard (Authentication → Providers →
Email → "Confirm email" + the PKCE flow toggle) and **delete** the implicit
fallback in the client. Remove `mobile/app/auth-callback.tsx:48-65` and
`mobile/lib/hooks/use-auth-callback.ts:50-61`. If you keep the dual-flow
posture, document under what condition implicit would ever be chosen — or it
becomes a permanent footgun.

### 1.6 [MEDIUM] `auth-callback.tsx` and `use-auth-callback.ts` swallow all
errors silently (`catch {}`)

Files: `mobile/app/auth-callback.tsx:44`, `:60`,
`mobile/lib/hooks/use-auth-callback.ts:44`, `:60`

A failed `exchangeCodeForSession` (expired code, replay attempt, malformed
code) writes nothing to telemetry. The user sees a spinner → home, with no
indication that auth failed; they will tap "send link" again, which is fine
for the user but blinds you to magic-link replay attempts and abuse patterns
in logs.

Action: log to a telemetry sink (or at minimum `console.warn` with a stable
prefix) so the production-build crash/log pipeline retains the failure mode.
Optionally surface a subtle toast ("Sign-in link expired — request a new
one") to the user.

### 1.7 [MEDIUM] No explicit `getSession` re-validation when the app foregrounds

File: `mobile/lib/hooks/use-user.ts:39-48`

The hook calls `getSession()` once on mount and trusts `onAuthStateChange`
events thereafter. `autoRefreshToken: true` (`supabase.ts:45`) handles
refresh while the JS context is alive, but RN apps can be backgrounded for
days; on resume, supabase-js's refresh timer may have missed its window
(refresh_token_rotation logic is internal). If the refresh token is
revoked-on-deletion (the deletion path nulls user_id and deletes the
auth.users row at `migrations/03_account_deletion_and_retention.sql:57`), a
backgrounded device can still hold a session it shouldn't.

Action: add an `AppState.addEventListener('change', …)` hook that calls
`supabase.auth.getSession()` (or `getUser()`) on foreground. Supabase's
docs recommend this pattern explicitly for RN.

### 1.8 [LOW] `delete_my_account` returns `{ ok: true }` even if the cascade
silently no-ops

File: `migrations/03_account_deletion_and_retention.sql:36-61`

The function returns success after `delete from auth.users where id = uid`
without checking the row count. If a future RLS policy or trigger blocks the
delete, the client believes the account is gone; the user signs out
client-side (`mobile/app/delete-account.tsx:76`) and the row remains.
Idempotent, but confusing for a Play-Store-mandated flow.

Action: capture `get diagnostics row_count` after the delete and return
`{ ok: false, error: 'cascade_failed' }` when zero rows changed.

### 1.9 [LOW] `tip_routings` audit-log hash and `delete_my_account`
nulling pattern is correct — record this as defensible

The decision to null `user_id` on `tip_routings` (preserving `content_hash`
and `ip_hash` for 12 months of abuse detection) before the `auth.users`
cascade is the right shape: the audit log loses its user pointer
immediately, but the abuse fingerprints stick around long enough to catch a
spammer who deletes-and-recreates accounts. Document this in the privacy
policy if you haven't already; it is a mild deviation from "delete = total
forget" that some users may probe.

### Auth & Session: no findings

- Session storage: AsyncStorage on RN is the canonical choice for Supabase
  RN apps (`mobile/lib/supabase.ts:43`). RN does not expose Keychain to
  AsyncStorage by default, but on Android the data is in app-private
  storage; on iOS the keychain wrap is via Expo's `expo-secure-store` which
  is **not** wired here. See below for the upgrade-path note (1.10).
- JWT validation: `extractUserId` in
  `supabase/functions/tip-route-submit/index.ts:209-225` uses
  `supabase.auth.getUser()` against the inbound `Authorization` header,
  which round-trips to the auth server and validates the JWT signature. No
  client-side trust on the bearer.
- RLS coverage on `auth.uid()` guards:
  `user_watches_owner` (`migrations/01_schema.sql:633`) and
  `user_subscriptions_owner` (`:636`) both use `user_id = auth.uid()`
  correctly.

### 1.10 [MEDIUM] Session storage uses AsyncStorage, not SecureStore

File: `mobile/lib/supabase.ts:43`

AsyncStorage on Android stores values unencrypted in the app-private
`/data/data/<pkg>/databases/RKStorage` SQLite file. On a rooted device, an
attacker with shell access can read the access_token and refresh_token. The
threat is a stolen/rooted device, not a remote attacker.

Action: swap to `expo-secure-store` (iOS Keychain + Android EncryptedSharedPreferences)
behind a thin `Storage` adapter. Supabase's `createClient` accepts any
`{getItem,setItem,removeItem}` shape. This is one focused PR; ship before
v1.0 store submission since Play Store surfaces "encrypted at rest" claims
in the Data Safety form.

---

## 2. Data Security

### 2.1 [HIGH] Mobile `.env` ships the anon JWT in source-form alongside the
URL — bundled into every APK

Files: `mobile/.env:8-12`, `mobile/lib/supabase.ts:25-26`

`EXPO_PUBLIC_*` envs land in the JavaScript bundle. The anon key is
**designed** to be public (the comment at `mobile/.env:11` is correct), but
two facts are easy to miss:
1. The anon key encodes the project ref and signs requests as `role: anon`.
   It is not a secret per se; what gates damage is RLS.
2. RLS does gate writes (no public write policies on `cases`, `case_media`,
   etc.) — so the anon key cannot tamper. But it **can** read every
   `cases_*` row (`migrations/01_schema.sql:608-628`) and insert into
   `tip_routings` and `takedown_requests` with no further auth
   (`:640-645`). That is the design (anonymous tips are first-class), but it
   means anyone with the URL + anon key can submit tip-routing rows without
   running the app.

Combined with the 2.2 finding below (no rate-limit on `tip-route-submit`),
this is a write-amplification vector: a script can fire 10k inserts/min into
`tip_routings`, padding the abuse-detection table with garbage and possibly
exhausting the storage tier.

Action (split):
- Anon key exposure: accept; this is supabase architecture. Document in the
  privacy/security model doc.
- Tip-route abuse: see 2.2.

### 2.2 [HIGH] `tip-route-submit` Edge Function is unauthenticated and
unrate-limited; comment admits this is a TODO

File: `supabase/functions/tip-route-submit/index.ts:17-23`, `:51-104`

```
// Rate-limiting: TODO. The ip_hash + content_hash columns are the levers; …
```

`verify_jwt = false` (`supabase/config.toml:60`) — anonymous tips are
intentional, but the function performs a write to `tip_routings` on every
call, with the only validation being `case_id` exists. An attacker can:
- Spam any number of `tip_routings` rows by enumerating `case_id` UUIDs
  (which are predictable in shape but not value, so this requires scraping
  the public read policy first — ~5 minutes of scripting).
- Burn Edge Function invocation quota.
- Pollute `ip_hash` distribution so the eventual abuse heuristic has noise
  baked in.

Action: ship a minimum-viable rate limit before store submission. Two
defensible cuts:
1. In-function: `select count(*) from tip_routings where ip_hash = $1 and
   created_at > now() - interval '1 minute'` and return 429 if > 5. Add an
   index on `(ip_hash, created_at desc)` to keep it cheap.
2. Cloudflare WAF in front of `*.supabase.co/functions/v1/tip-route-submit`
   if you have a Pro plan — set `5 req/min/IP`.

### 2.3 [HIGH] `tip_routings` has RLS-insert open-with-`true` and **no select
policy**, but anon role retains `INSERT` privilege via base grants

File: `migrations/01_schema.sql:603`, `:640-641`

```
alter table tip_routings enable row level security;
create policy tip_routings_insert on tip_routings
  for insert with check (true);
```

This is correct as a write-only audit log — no `select` policy means the
anon role cannot read rows back. Verify with one psql query before launch:

```sql
select has_table_privilege('anon', 'public.tip_routings', 'select');
-- expected: false (no policy + RLS on = no access)
```

Action: write a small smoke test (Vitest in `tools/` or a Supabase RPC
test) that asserts the anon role can insert but cannot select; run it in
CI. Same for `takedown_requests`.

### 2.4 [MEDIUM] DLP claim "tip content never enters our infra" — verified, but
fragile

Trace:
- User types tip body into the modal (`mobile/app/tip/[slug]` not read but
  inferred from the hook's contract).
- `useSubmitTip.submit({ content })` calls
  `hashTipContent(content)` (`mobile/lib/hooks/use-submit-tip.ts:73-75`).
- The hook posts only `{ case_id, content_hash, user_agent_summary }` to
  the Edge Function (`:91-99`). No `content` field.
- `tip-route-submit` reads only `body.content_hash` and writes it to the
  audit row (`tip-route-submit/index.ts:91`).
- The Edge Function then returns the resolved agency target; the **client**
  opens the deep link to the agency form, where the user re-pastes the body
  (or it is preserved across the OS clipboard handoff).

The claim holds. The fragility is that the contract is purely conventional
— a future hook author who adds `body.content = input.content` to the
fetch payload silently breaks the central privacy invariant. There is no
type-system enforcement.

Action: add a Vitest assertion against the union type
`SubmitTipPayload`'s key set such that `'content' in payload === false`.
Cheap, durable.

### 2.5 [MEDIUM] Hardcoded SHA-256 salt — `COLD_FILE_TIP_HASH_SALT_V1`

File: `mobile/lib/hash.ts:17`

The doc-comment is clear ("not a security boundary, just pepper") and the
threat model is correct: rainbow-table lookups against canned phrases
("kill", "I know who", names of public figures). The salt is bundled into
every APK (`EXPO_PUBLIC` is the bundle, and this is a `const` in
`lib/hash.ts`), so its value is visible to anyone who unpacks the APK with
`apktool`.

Once the salt is known, the hash provides ~no protection against an
adversary who has a target plaintext: they can compute the hash and confirm.
Against a passive observer of the database, the salt does prevent generic
rainbow-table lookups for short text — but the abuse model here is
"bursts of identical content_hash from one ip_hash," and that pattern
detection works **regardless of salt knowledge**.

Verdict: salt is mislabeled as security; it is correctly labeled as a
"don't accidentally hit a public table" guardrail. The doc-comment is
accurate. The risk is naming drift — a future engineer may treat this
constant as a secret. Consider renaming to `TIP_HASH_PEPPER` and adding a
comment that this **is not** a secret.

Action: optional. Documented behavior already.

### Data Security: no findings

- Encryption at rest: Supabase Postgres uses AES-256 at-rest by default;
  nothing in this codebase bypasses it (no raw S3 writes, no custom
  filesystem persistence). Storage bucket `case-media` is `public = true`
  (`supabase/config.toml:24`) — that is intentional (case media is on-device
  cached + publicly displayed) and not a finding.
- Encryption in transit: `@supabase/supabase-js` builds against `https://…`
  exclusively (`mobile/.env:8`); RN's fetch follows iOS ATS / Android
  network-security-config defaults (TLS-only). No `cleartextTrafficPermitted`
  flag is set anywhere in the project (verified: no
  `android/app/src/main/res/xml/network_security_config.xml`).
- Backup retention: handled by Supabase project tier defaults; not in
  scope of source review.

---

## 3. Cryptography Audit

### 3.1 [LOW] Content-hash salt is short, plain ASCII, single global value

File: `mobile/lib/hash.ts:17`

```ts
const SALT = 'COLD_FILE_TIP_HASH_SALT_V1';
```

26 chars, low entropy. Combined with SHA-256 of the salt+content, the
preimage resistance against an attacker who has the plaintext is unchanged
(SHA-256 is preimage-resistant); against rainbow-table lookups for short
plaintexts (e.g., "Help"), the salt makes the table miss as long as the
salt remains unknown — but it ships in every APK (see 2.5). Result: a
moderately motivated reverser sees the salt within an hour.

This matches the documented threat model and is fine for the audit-log use
case. If the salt's label ever drifts toward "security boundary," replace
with a 32-byte random value held in a Supabase Function env and **derive
on-server** (move the hash to the Edge Function, accepting that the
plaintext then crosses your network — a different tradeoff than the current
one).

### 3.2 [MEDIUM] `ip_hash` uses a fixed-namespace salt and SHA-256 — small
input space defeats the hash

File: `supabase/functions/tip-route-submit/index.ts:196-207`

```ts
const data = new TextEncoder().encode(`coldfile-ip-v1:${ip}`);
const buf = await crypto.subtle.digest('SHA-256', data);
```

The IPv4 space is 2^32 (~4.3B). A motivated attacker can precompute every
`SHA-256("coldfile-ip-v1:" + ip)` for the entire IPv4 space in ~1 hour on
commodity GPU and reverse the audit log: given a `tip_routings.ip_hash`,
identify the source IP. IPv6 is much harder (2^128) but rotating-prefix
mobile clients fall back to recognizable /64s.

The fixed prefix `coldfile-ip-v1:` is not a secret (it's compiled into the
function source which lives in this repo) — same problem as the content
salt.

Action: move the IP salt to a Function secret (`Deno.env.get('IP_HASH_SALT')`,
≥ 32 bytes random) so the precompute attack requires the secret first. This
is a one-line config change in the Supabase dashboard plus a one-line code
change. Do this before launch — the data is otherwise reverseable from any
backup snapshot leaked.

### 3.3 [LOW] `requester_email_hash` on `takedown_requests` is column-only,
no helper, no salt-doc

File: `migrations/01_schema.sql:391`

The schema declares the column "hashed for follow-up only" but no code in
the repo writes it (`grep -r requester_email_hash` returns only the schema
line). The takedown flow currently routes through email
(`mobile/app/takedown.tsx:27`) so the column may be written by a future
admin tool. When that happens, ensure the same secret-salt principle from
3.2 is followed — and add a `hashEmail` helper so the salt is centralized.

Action: add a stub `hashEmail` helper now (even unused) so the convention
exists when the admin tool ships.

### 3.4 [LOW] No password hashing — confirmed N/A

Magic-link only flow (`mobile/lib/hooks/use-user.ts:71-81`). No
`signInWithPassword`, no `updateUser({ password })` calls anywhere
(`grep -r 'signInWithPassword\|updateUser' mobile/` returns nothing).
Documented for completeness.

### 3.5 [LOW] RNG quality

- `gen_random_uuid()` (`migrations/01_schema.sql:8` — pgcrypto extension)
  uses `/dev/urandom` via OpenSSL on the Postgres container; v4 UUIDs with
  122 bits of entropy. Sufficient.
- `Crypto.digestStringAsync` (`mobile/lib/hash.ts:26`) and
  `crypto.subtle.digest` (`tip-route-submit/index.ts:203`) are
  digest-only, no RNG involvement.
- No client-side `Math.random()` is used as a security primitive
  (`grep -rn "Math.random" mobile/lib/` returns nothing security-adjacent).

### 3.6 [LOW] TLS / no plaintext fallback

- `mobile/.env:8` URL is `https://`; no `http://` for Supabase appears
  anywhere in `mobile/lib/`.
- iOS ATS is on by default (no `NSAppTransportSecurity` exception in
  `mobile/app.config.ts`).
- Android: `app.config.ts` does not include `usesCleartextTraffic: true` and
  the prebuild output (`android/`) was not inspected here, but Expo's
  default network-security-config disallows cleartext on API 28+.

### Cryptography: no findings

- TLS configuration: no plaintext fallback found in any client or server
  code path.
- Digest primitives: SHA-256 is appropriate for non-secret hashing
  (audit-log fingerprinting). Not a password store; no need for argon2/bcrypt.

---

## Findings index by severity

| ID  | Sev      | Topic                                                     | Files                                                                                  |
| --- | -------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1.1 | CRITICAL | Service-role JWT + Stripe secret in local plaintext .env  | `/.env:11,18`                                                                          |
| 1.2 | HIGH     | Auth `enable_signup = true` with no captcha / rate limit  | `supabase/config.toml:43`                                                               |
| 1.3 | HIGH     | Redirect-URL allowlist must be exact, not wildcarded      | Supabase dashboard (referenced from `mobile/lib/hooks/use-user.ts:78`)                 |
| 2.1 | HIGH     | Anon JWT in mobile bundle: design-correct, doc gap        | `mobile/.env:11`                                                                       |
| 2.2 | HIGH     | `tip-route-submit` is anon + unrate-limited                | `supabase/functions/tip-route-submit/index.ts:17-23,51-104`                            |
| 2.3 | HIGH     | tip_routings RLS write-only — verify in CI                | `migrations/01_schema.sql:603,640-641`                                                  |
| 1.4 | MEDIUM   | Permissive `?code=` deep-link match, missing scheme guard | `mobile/app/auth-callback.tsx:38`                                                       |
| 1.5 | MEDIUM   | Both PKCE + implicit handlers wired                       | `mobile/app/auth-callback.tsx:37-65`, `mobile/lib/hooks/use-auth-callback.ts:38-60`     |
| 1.6 | MEDIUM   | Silent `catch {}` on auth-callback errors                 | `mobile/app/auth-callback.tsx:44,60`, `mobile/lib/hooks/use-auth-callback.ts:44,60`     |
| 1.7 | MEDIUM   | No foreground-resume re-validation of session             | `mobile/lib/hooks/use-user.ts:39-48`                                                    |
| 1.10| MEDIUM   | AsyncStorage instead of SecureStore for session           | `mobile/lib/supabase.ts:43`                                                             |
| 2.4 | MEDIUM   | "Tip content never enters infra" — no type enforcement    | `mobile/lib/hooks/use-submit-tip.ts:91-99`                                              |
| 2.5 | MEDIUM   | Hardcoded SHA-256 content salt (mislabeled risk)          | `mobile/lib/hash.ts:17`                                                                 |
| 3.2 | MEDIUM   | `ip_hash` salt is fixed string — IPv4 precompute attack   | `supabase/functions/tip-route-submit/index.ts:196-207`                                  |
| 1.8 | LOW      | `delete_my_account` doesn't check row count               | `migrations/03_account_deletion_and_retention.sql:36-61`                                |
| 1.9 | LOW      | Tip-routing audit retention pattern — defensible          | `migrations/01_schema.sql:353-364`, `migrations/03_*.sql:49-54`                         |
| 3.1 | LOW      | Content salt entropy / scope                              | `mobile/lib/hash.ts:17`                                                                 |
| 3.3 | LOW      | `requester_email_hash` lacks helper / salt convention     | `migrations/01_schema.sql:391`                                                          |
| 3.4 | LOW      | Password hashing — confirmed N/A                          | n/a                                                                                    |
| 3.5 | LOW      | RNG quality                                               | `migrations/01_schema.sql:8`, `mobile/lib/hash.ts:26`, `tip-route-submit/index.ts:203` |
| 3.6 | LOW      | TLS / no plaintext fallback                               | `mobile/.env:8`, `mobile/app.config.ts`                                                 |

No-findings categories: encryption-at-rest, encryption-in-transit, password
hashing, RNG, TLS configuration, JWT signature validation in
`tip-route-submit`, RLS coverage on `auth.uid()` user-owned tables.
