# 09 — Cloud IAM & Secure SDLC

**Audit date:** 2026-04-30
**Scope:** IAM posture across Vercel, Supabase, EAS/Expo, Google Play, GitHub; secure SDLC across CI/CD, hooks, branch protection, build pipelines (Vercel + EAS), Supabase migrations workflow, release artifact signing.
**Posture this week:** Solo dev shipping Google Play **closed testing** from `main`. No collaborators yet. Right-sized for that — recommendations bias toward "what blocks this week" vs "what to harden post-launch / before adding contributors."
**Companion docs:** `docs/audit/security/01-05.md` (code, auth+crypto, privacy, API surface, deps).

Severity legend: 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · 🔵 LOW · ⚪ INFO

---

## Executive summary

Two **ship-blockers** for a real production release surfaced. Both are SDLC, not IAM:

1. **🔴 Release builds are signed with `debug.keystore`** — `mobile/android/app/build.gradle:115` reuses the debug keystore for `release`. For closed testing via EAS managed credentials this is bypassed (EAS injects its own upload key during `eas build --profile production`), but if anyone runs `./gradlew assembleRelease` locally, they ship a debug-signed AAB that Play will reject — and worse, if ever uploaded once, the package is married to that key forever.
2. **🟠 Two `eas.json` files disagree** — `eas.json` (root) sets `appVersionSource: "remote"`; `mobile/eas.json` sets `"local"`. Only the file in the project root EAS reads counts (`mobile/eas.json` wins because the Expo project root is `mobile/`). The stale root file is a footgun: someone running `eas build` from the repo root with the wrong cwd will pick up the wrong profile (no node pinning, no submit track, no AAB output).

Everything else is solo-dev-normal: single-account chokepoints across Vercel/Supabase/EAS/Play/GitHub. Document the recovery contacts before you onboard a collaborator. Most "what to do post-launch" items don't block this week.

No CI/CD exists (`.github/workflows/` does not exist) — this is fine for a solo dev who runs `eas build` and `vercel deploy` from a laptop. Build reproducibility is acceptable: Node is pinned in `mobile/eas.json`; the Expo SDK is locked. Lockfiles are committed for both projects.

---

# Domain 1 — Cloud IAM

All IAM evidence below was gathered from local repo state (`.vercel/project.json`, `eas.json`, `app.config.ts`, `supabase/config.toml`, git remote, `.gitignore`). The actual permission matrices live in the consoles — items marked **VERIFY** require the user to log in and confirm.

## 1.1 — Vercel

**Evidence in repo**
- `.vercel/project.json:1` — projectId `prj_RlhwaGnjcicQZSWt4NHHS8gLOTZu`, orgId `team_C6XENykWSmLbZQXvqWxqeaBx`, projectName `cold-files`.
- The orgId starts with `team_` not `user_`, meaning the project is owned by a **Vercel team**, not a personal hobby account. That's correct for a real product (allows transfer + invite without re-creating the project) and it does support Pro/Team-tier env-var scoping.
- No `vercel.json` in repo. Framework auto-detection via Next.js 15 + `next.config.ts`. Build command and output are inferred. Not a finding — Next.js zero-config on Vercel is the supported path — but it does mean the build command is whatever the Vercel project dashboard says it is, not what's in the repo. **VERIFY in console.**
- `next.config.ts:26-54` ships strict security headers (`X-Frame-Options DENY`, HSTS preload, CSP). These ride along on every Vercel deployment. Already covered in 04-api-surface.

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 1.1.1 | 🟡 MEDIUM | **Single-owner team chokepoint.** Solo dev = single human with Owner on the Vercel team. If the account is locked out, the deployed `coldfile.app` keeps serving traffic but no one can push, rotate env vars, or transfer the domain. | **VERIFY** in Vercel: Settings → Members. If only one human exists, add a backup recovery email on the account, enable 2FA with backup codes printed somewhere offline, and write down where the recovery codes live. Don't add a second human until you have a contributor agreement. |
| 1.1.2 | 🟡 MEDIUM | **Env-var scoping is invisible from the repo.** Cannot see whether `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `INGEST_TICK_SECRET` are scoped to Production-only, or also exposed to Preview deployments. Preview deploys go to public `*-vercel.app` URLs. If service-role is in Preview, every PR-style preview gets database admin. | **VERIFY** in Vercel: Project → Settings → Environment Variables. For each secret, confirm "Environments" is **Production only** unless the Preview also needs it. Specifically `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` must NOT be in Preview. `INGEST_TICK_SECRET` only matters for the cron-driven ingest (see audit 04 §3). |
| 1.1.3 | 🟡 MEDIUM | **`NEXT_PUBLIC_*` keys ship to the client bundle.** This is by design (anon key + Mapbox public token are intentionally shipped). But if anyone ever sets `SUPABASE_SERVICE_ROLE_KEY` to `NEXT_PUBLIC_…` it leaks instantly. | **VERIFY** the env-var names in Vercel match the `.env.example` exactly: only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` should be `NEXT_PUBLIC_*`. |
| 1.1.4 | 🔵 LOW | **Domain config access** — coldfile.app DNS is presumably proxied or pointed at Vercel; whoever owns the registrar account also has takeover authority. | **VERIFY** registrar: 2FA on, recovery email is current, transfer-lock is enabled. Document where the registrar credentials live. |
| 1.1.5 | 🔵 LOW | **Production-promote permissions.** On a Pro team, by default any team member with Developer role can deploy to Production. Solo dev means this is moot, but the moment you add a collaborator they can ship to prod unless you scope them down. | Pre-collaborator: in Vercel, set new members to **Member** (no prod deploy) until trust is established. The "Promote to Production" gate is a Pro-tier feature; if you're on Hobby it doesn't apply. |

## 1.2 — Supabase

**Evidence in repo**
- `supabase/config.toml:5` — project_id `coldfile`. Local-dev shape only; production config is in the dashboard.
- `supabase/config.toml:42-61` — five Edge Functions all run with `verify_jwt = false`. They authenticate themselves with `SUPABASE_SERVICE_ROLE_KEY` (audit 04 §1 confirmed this is the intended pattern for write-only audit fields after migration `04_lock_down_anon_writes.sql`).
- `migrations/04_lock_down_anon_writes.sql:1` — confirms service-role is the only write path for `tip_routings` and `takedown_requests`.

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 1.2.1 | 🟠 HIGH | **Service-role key is in `.env`** (root `.env` line 12 — gitignored, not committed; verified via `git check-ignore`). It is also pasted into Vercel env vars, EAS secrets are not used for it, and it presumably authenticates Edge Functions via Supabase Dashboard auto-injection. The same key holds god-mode on the database. | **VERIFY** in Supabase Dashboard → Settings → API: this is a single key with no granular scopes. **Pre-collaborator action:** before adding anyone, generate a fresh service-role key and rotate everywhere it's used (Vercel prod env, local `.env`). Track every place the key is pasted. The Supabase project supports rotation without downtime — just paste the new key and let the old one age out. |
| 1.2.2 | 🟡 MEDIUM | **Project Members visibility unknown from repo.** Solo dev = single Owner on the Supabase project. Same lockout risk as Vercel. | **VERIFY** in Supabase: Project Settings → Team. Confirm only the owner exists. Enable 2FA on the Supabase account. |
| 1.2.3 | 🔵 LOW | **Anon key visibility is intentional** — `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are shipped to clients. RLS gates row access (audit 02 §1, audit 04). This is fine. | No action. The `mobile/.env.example:11` comment correctly notes "Public-safe (RLS enforces row-level access)." |
| 1.2.4 | 🔵 LOW | **Dashboard access = full database admin.** Whoever logs into the Supabase web UI can drop tables, edit RLS, read every row including `tip_routings.ip_hash`. | Same as 1.2.2 — until you add a collaborator, this is just "the owner has owner access." When you do add one, use the Developer role (read-only on production data) unless they need migration rights. |
| 1.2.5 | 🟡 MEDIUM | **No documented service-role key rotation cadence.** | Add to a runbook (or post-launch task list): rotate service-role every 90 days or after any contractor offboarding. The mechanics: dashboard → API → Reset service_role → repaste in Vercel + local `.env`. |

## 1.3 — EAS / Expo

**Evidence in repo**
- `mobile/app.config.ts:93-95` — EAS project ID `933d850a-4e1f-431b-9c0d-497094357a00` under user/owner determined by `eas.json`. No explicit owner set, so it falls under whichever account ran `eas init`.
- `mobile/eas.json` — three build profiles + one submit profile. `production.channel: "production"`, `submit.production.android.track: "internal"`, `releaseStatus: "draft"`.
- `mobile/eas.json:23` — `production.autoIncrement: false` means `versionCode` does not auto-increment. `app.config.ts:48` has `versionCode: 1` hard-coded. **Manual bump required for every production submit** (every Play upload of an AAB needs a unique versionCode or Play rejects it).
- No `EXPO_TOKEN` env in the repo (correct — should only live in CI when CI exists).

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 1.3.1 | 🟠 HIGH | **`appVersionSource` mismatch between two `eas.json` files.** Root `/eas.json:4` says `"remote"`, `mobile/eas.json:4` says `"local"`. EAS reads the file at the Expo project root, which is `mobile/`. The root file is **stale** and dangerous — it has no `node`, no `submit`, no Android `buildType`, no channels. Anyone running `eas build` from `/Users/jtroy/Desktop/ColdFiles` (not `/mobile`) hits the wrong file. | **DELETE** `/Users/jtroy/Desktop/ColdFiles/eas.json` (the root one). Confirm `eas build --profile production` only ever runs from `mobile/`. |
| 1.3.2 | 🟡 MEDIUM | **EAS account ownership invisible from repo.** Solo dev = owner on personal Expo account. Same chokepoint pattern. The Expo Personal Account → Organization migration is one-way and free. | **VERIFY** in `expo.dev` → Account Settings. Recommend creating an Expo **organization** account before adding collaborators (so the project lives under an org, not a personal account, and ownership transfer is just an invite). For solo this week: enable 2FA, save backup codes. |
| 1.3.3 | 🟡 MEDIUM | **Who can submit to Google Play?** EAS does the AAB upload via `eas submit`. The Google Play Service Account JSON used by EAS is uploaded once via `eas credentials` and lives encrypted on EAS servers. EAS team members with Submit access can trigger uploads. | **VERIFY** in expo.dev: Project → Credentials. Confirm only the owner has Submit credentials. The Google Play service account JSON should be the **upload key** (Internal app sharing + Internal testing tracks only) until you're confident in the pipeline — not the publish-anything key. |
| 1.3.4 | 🟡 MEDIUM | **EAS Secrets visibility.** EAS supports project-level secrets injected at build time. None are referenced in `mobile/eas.json` (all envs come from `mobile/.env` and `app.config.ts` reading `process.env`). For closed testing this is fine because `EXPO_PUBLIC_*` vars are public-safe. | **VERIFY** in expo.dev: Project → Secrets. Confirm no service-role / Stripe / Mapbox secrets are stored as EAS secrets (they shouldn't be — mobile only ships `EXPO_PUBLIC_*` and the anon key). |
| 1.3.5 | 🔵 LOW | **`autoIncrement: false`** on production. Manual bump required. Easy to forget. | Either flip to `autoIncrement: true` (EAS bumps `versionCode` server-side without touching the repo), or write a checklist note: "before `eas build --profile production`, bump `versionCode` in `app.config.ts:48`." For closed testing, manual is fine — only one or two releases. |

## 1.4 — Google Play Console

**Evidence in repo**
- `mobile/app.config.ts:40` — package `com.matteblackdev.coldfile`. Reserved against the Play developer account that uploaded the first AAB.
- `mobile/eas.json:32-34` — submit track `internal`, releaseStatus `draft`. Closed testing posture is correct.

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 1.4.1 | 🟠 HIGH | **Play developer account = single point of failure.** The $25 one-time developer fee was paid by one Google account; that account "owns" the Play listing forever. Account loss = listing loss, with no transfer path that doesn't require Google support tickets and proof of identity. | **VERIFY** in play.google.com/console: Setup → API access (which Service Accounts can do what), Users and permissions, billing email. Set up a recovery phone + recovery email on the underlying Google account. Print backup codes. **Do not** mix this Google account with personal — keep it on a dedicated email if possible, or at minimum add a second recovery option. |
| 1.4.2 | 🟡 MEDIUM | **Crash logs / financial data permissions.** Play Console has fine-grained roles. Default new-user role grants more than crash log read. | When adding the first collaborator (post-launch QA), use **App access > Release manager** or **Crashes only** roles, not Admin. Never grant **Financial data** unless the collaborator is the accountant. |
| 1.4.3 | 🟡 MEDIUM | **Service Account for EAS submit.** EAS submits via a Google Play service account JSON. That JSON has `releaseAdmin` or similar. If leaked from EAS, an attacker can publish an arbitrary AAB to your app's listing. | **VERIFY** the service account in play.google.com/console → Setup → API access has only the role needed for `track: internal` (probably "Release manager — Internal testing only"). Do not grant production publish until you actually need automated production releases. |
| 1.4.4 | 🔵 LOW | **App signing key custody.** Play App Signing is presumably enabled (default for new apps). Google holds the app signing key; you only hold the **upload key**. This is correct and means an upload-key compromise is recoverable (rotate via Play Console). | No action. Just confirm Play App Signing is **on** when you upload the first AAB. |

## 1.5 — GitHub

**Evidence in repo**
- `git remote -v`: `https://github.com/JamesTroy/ColdFiles.git`
- Branch: `main` only. No feature branches in flight (`git branch -a` shows just `main` + `origin/main`).
- No `.github/` directory exists at all (`ls -la .github/` returns nothing — verified). No workflows, no issue templates, no CODEOWNERS, no Dependabot config.

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 1.5.1 | 🟠 HIGH | **Repo public/private status not provable from local clone.** The remote URL alone doesn't tell us. If this repo is public, then everything in `migrations/`, `app/api/`, `mobile/`, plus the security audit docs themselves are world-readable — including audit 04, which is essentially an attacker's roadmap to the abuse surface. | **VERIFY immediately** at https://github.com/JamesTroy/ColdFiles/settings: confirm visibility is **Private**. If it is public, either flip to private or move the audit docs to a private repo. (The codebase itself can stay public — Next.js + Expo apps commonly are — but the audit docs reveal which mitigations are not yet shipped, which is leverage for an attacker.) |
| 1.5.2 | 🟠 HIGH | **No branch protection on `main`.** Solo dev pushing direct to main is fine for now, but if the GitHub account is compromised an attacker can rewrite history, force-push, or delete the branch with no recovery from the GitHub side (the laptop clone is recovery, but only if it's recent). | **VERIFY + ENABLE** at github.com/JamesTroy/ColdFiles/settings/branches: Add a rule for `main` with at minimum: **Require linear history**, **Do not allow bypassing the above settings** (off — you need to bypass for solo dev), **Restrict deletions**. Skip "require PR review" until you have a second human. The main protections that matter solo are deletion-restriction and force-push restriction. |
| 1.5.3 | 🟡 MEDIUM | **Secret scanning + push protection unknown.** GitHub Free tier on a public repo gets secret scanning; on a private repo it's a paid feature. | **VERIFY** at github.com/JamesTroy/ColdFiles/settings/security_analysis: enable **Secret scanning** and **Push protection** if visible (free on public, GHAS-paid on private). Push protection is the one that matters — it blocks a commit at push time if it contains a known token shape (Supabase service-role keys do match a known pattern). |
| 1.5.4 | 🟡 MEDIUM | **No CODEOWNERS, no SECURITY.md.** Means no security disclosure path documented. The TOS (per audit 03) presumably has a contact email, but a `SECURITY.md` is the GitHub-native path. | Post-launch: add `.github/SECURITY.md` with `contact@coldfile.app`, expected response window. Not a ship-blocker — the TOS handles disclosure. |
| 1.5.5 | 🔵 LOW | **2FA on GitHub account.** | **VERIFY** at github.com/settings/security: 2FA on, backup codes printed. |
| 1.5.6 | 🔵 LOW | **Personal Access Tokens.** PATs scoped to this repo bypass branch protection if used by automation. | **VERIFY** at github.com/settings/tokens: revoke any PAT not actively in use. Solo dev with no CI = there should be zero PATs. |

## 1.6 — Solo-dev IAM hygiene checklist (before adding any collaborator)

| Step | Why |
|------|-----|
| ☐ Enable 2FA + print backup codes for: Google (Play account), Vercel, Supabase, Expo, GitHub, registrar | Single-account chokepoints; loss = irreversible without support tickets |
| ☐ Document where backup codes are stored (paper / 1Password / etc.) | The codes are useless if you can't find them when locked out |
| ☐ Set Vercel env vars to **Production only** for: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `INGEST_TICK_SECRET` | Preview deployments are public-URL-accessible |
| ☐ Confirm GitHub repo is **Private** OR audit docs moved out | Audit docs reveal abuse surface |
| ☐ Enable GitHub branch protection on `main`: restrict deletions + force-push | Defense against account compromise |
| ☐ Confirm Play App Signing is **on** | Upload-key compromise is recoverable; release-key compromise is not |
| ☐ Rotate `SUPABASE_SERVICE_ROLE_KEY` to a fresh value, paste in Vercel + local `.env` | The key as it exists today has been pasted into multiple environments (`.env`, Vercel) over the project history; reset zeroes that exposure |

The above is a "before you onboard collaborator #2" list, not a launch blocker. None of these block closed testing this week — except 1.5.1 (repo visibility check), which should be done in the next 30 minutes.

---

# Domain 2 — Secure SDLC

## 2.1 — CI/CD

**Evidence in repo**
- `.github/workflows/` does **not exist**. No GitHub Actions, no Vercel Actions, nothing.
- Vercel auto-deploys from `main` (verified: `.vercel/project.json` is linked, repo connects to a Vercel project named `cold-files`). Every push to `main` triggers a Vercel build.
- EAS builds are run manually from the local machine (`eas build --profile production`).

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 2.1.1 | 🔵 LOW | **No CI = no test gate before production.** Solo dev + no CI is normal. The risk is that `npm run test` (vitest) and `npm run typecheck` are not enforced — broken code can land on `main` and Vercel will happily deploy it. | Optional minimal CI: a 20-line `.github/workflows/check.yml` running `npm ci && npm run typecheck && npm run test` on `pull_request`. Skip until you start using PRs. For solo direct-to-main, "I run `npm test` before `git push`" is acceptable hygiene. |
| 2.1.2 | 🟡 MEDIUM | **Vercel auto-deploys from `main` directly.** No staging branch, no preview-then-promote workflow. A bad commit goes live immediately. | Either (a) accept this for closed testing — rollback via Vercel "Promote previous deployment" button is one click — or (b) add a `staging` branch wired to Vercel as the production branch, and only fast-forward `staging → main` for releases. Option (b) is post-launch grade. For this week, document the rollback button. |
| 2.1.3 | 🔵 LOW | **No artifact signing or SBOM generation.** | Out of scope for closed testing. Revisit if/when you reach a contract that requires SLSA / SBOM. |

## 2.2 — Pre-commit hooks

**Evidence in repo**
- No `.husky/`, no `lefthook.yml`, no `.pre-commit-config.yaml`.
- `.git/hooks/` is empty (only the default samples were already removed; verified `ls .git/hooks/ | grep -v sample` returns nothing).
- No `husky` or `lefthook` in either `package.json`.

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 2.2.1 | 🟡 MEDIUM | **No pre-commit gate.** Means `git push` to `main` can ship a file with a hardcoded `SUPABASE_SERVICE_ROLE_KEY` if you forget. The `.gitignore` covers `.env`, but a `// const KEY = 'eyJ...'` in source is not caught. | Minimal hardening: add `gitleaks` as a pre-commit hook via `husky` (or just a `pre-commit` shell script in `.git/hooks/`). Even simpler: enable GitHub **Push Protection** (item 1.5.3) which catches it server-side. Push protection is the right choice for solo dev — no local install required, can't be skipped with `--no-verify`. |
| 2.2.2 | 🔵 LOW | **No lint-staged.** No automatic formatting on commit. | Cosmetic. Not a security finding. |

## 2.3 — Branch protection & code review

Already covered in §1.5.2. Solo dev: skip "require PR review." Restrict deletions + force-push is the one that matters.

## 2.4 — Build pipeline — EAS

**Evidence in repo**
- `mobile/eas.json:11,15,23` — Node pinned to `20.19.4` for all three profiles. Good — EAS won't pick up a future Node 20.x patch silently.
- `mobile/package.json:27` — Expo SDK pinned to `~54.0.33` (tilde = patch-only).
- `mobile/eas.json:25` — `production.android.buildType: "app-bundle"` → AAB output. Correct for Play Store.
- `mobile/eas.json:21` — `production.channel: "production"` matches `app.config.ts:84` updates URL. OTA channel is wired.
- `mobile/eas.json:14-15` — `preview.channel: "preview"`, APK output. Right for internal testing distribution.
- No `postinstall` or `preinstall` scripts in either `package.json` (verified). No `npm`-pulled lifecycle script can exfil during `eas build`.
- `mobile/package-lock.json` committed (504 KB lockfile present in repo).

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 2.4.1 | 🟠 HIGH | **Stale root `/eas.json`** (already filed as 1.3.1). | Delete `/Users/jtroy/Desktop/ColdFiles/eas.json`. |
| 2.4.2 | 🔵 LOW | **EAS build is reproducible enough.** Node pinned, Expo pinned, lockfile committed, no postinstall scripts. The build runs on EAS's image, which is itself a moving target (security patches), but the JS+native deps that ship to users are fully pinned. | No action. Document Node pin in any contributor README later. |
| 2.4.3 | 🔵 LOW | **`packages/expo-updates`** runtime version policy is `appVersion` (`mobile/app.config.ts:90`). OTA updates only reach matching app versions. This is the safe policy — runtime contract changes force a new AAB. | No action. |

## 2.5 — Build pipeline — Vercel

**Evidence in repo**
- No `vercel.json`. Framework auto-detection.
- `next.config.ts` ships security headers + nothing exotic.
- No `.vercelignore`.
- Lockfile (`package-lock.json`, 109 KB) committed.

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 2.5.1 | 🟡 MEDIUM | **No explicit Node version pin for the Vercel build.** Vercel default is whatever Next.js 15 prefers (currently Node 22 LTS); a future change in Vercel defaults could change the build runtime under you. | **VERIFY** in Vercel: Project → Settings → General → Node.js Version. Pin to 22.x (or whatever you developed against locally). The `package.json:8` has no `engines.node` field — adding `"engines": { "node": "22.x" }` to root `package.json` is the repo-side belt to Vercel's suspenders. |
| 2.5.2 | 🟡 MEDIUM | **Env-var injection at build vs runtime.** Some Next.js 15 envs inline at build time (`NEXT_PUBLIC_*`), some are runtime-only. If you ever change `NEXT_PUBLIC_SUPABASE_URL` you must re-deploy — env var changes alone don't invalidate cached builds for inlined vars. | Document. Not a security finding, but an operational footgun on key rotation. |
| 2.5.3 | 🔵 LOW | **Preview-vs-prod env separation.** Already filed as 1.1.2. | See 1.1.2. |
| 2.5.4 | 🔵 LOW | **Deploy logs visibility.** Vercel team-tier deploy logs visible to all team members. | Solo = moot. Pre-collaborator note: deploy logs can leak environment variable values if a build script `echo`s them. None do today; verify no future debug logging adds that. |

## 2.6 — Supabase migrations workflow

**Evidence in repo**
- `migrations/01_schema.sql`, `02_*.sql`, `03_*.sql`, `04_*.sql` — versioned, committed, monotonically named.
- These live at the **repo root** `migrations/`, NOT at `supabase/migrations/` (which is empty). The Supabase CLI's default migration path is `supabase/migrations/`, so `supabase db push` would not pick these up.
- `migrations/04_lock_down_anon_writes.sql:21` — explicitly says "Idempotent: safe to re-run." Good engineering practice.
- No script in `package.json` for applying migrations (no `db:push`, no `migrate:up`).

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 2.6.1 | 🟠 HIGH | **Migrations are applied manually with no recorded mechanism.** Files are at `migrations/*.sql` (not `supabase/migrations/`), so `supabase db push` doesn't see them. The user is presumably running them by hand via SQL Editor or `psql`. There is **no rollback playbook**, no record of which migrations have been applied to prod, and no migrations table inside the database confirming state. | **Pre-collaborator action**: either (a) move files to `supabase/migrations/` and start using `supabase db push` (which records `supabase_migrations.schema_migrations`), or (b) document the manual-apply checklist in a README under `migrations/` so the next person knows the workflow. For this week: confirm by hand that all four migrations have been applied to the production project. (Migration 04 in particular is an audit-04 ship-blocker — verify it's live.) |
| 2.6.2 | 🟡 MEDIUM | **No migration test/dry-run.** No staging Supabase project. Migrations land on prod or they don't land. | Ideal: spin up a free-tier Supabase project as staging, replay migrations there before prod. Not a ship-blocker — the four migrations to date are all idempotent. |
| 2.6.3 | 🔵 LOW | **No down-migration files.** Standard for Supabase / postgres practice (you write a forward fix, not a `DOWN`). | No action. |

## 2.7 — Dependency posture

Cross-references audit 05. Adding only the SDLC-process pieces here:

**Evidence in repo**
- Lockfiles committed: `package-lock.json` (root) + `mobile/package-lock.json`.
- No `dependabot.yml`, no `renovate.json`, no `.github/dependabot.yml`.

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 2.7.1 | 🟡 MEDIUM | **No automated dep updates.** Dependabot or Renovate would open PRs for security advisories. With no PR workflow this is less useful, but the security alerts on GitHub still fire if enabled. | **VERIFY** at github.com/JamesTroy/ColdFiles/settings/security_analysis: enable **Dependabot alerts** (free, no PRs). Skip Dependabot security PRs until you have a PR workflow. |

## 2.8 — Release artifact signing (Android AAB)

**Evidence in repo**
- `mobile/android/app/build.gradle:100-122`:
  ```gradle
  signingConfigs {
      debug {
          storeFile file('debug.keystore')
          storePassword 'android'
          keyAlias 'androiddebugkey'
          keyPassword 'android'
      }
  }
  buildTypes {
      release {
          // Caution! In production, you need to generate your own keystore file.
          signingConfig signingConfigs.debug
          ...
      }
  }
  ```
- `mobile/android/app/debug.keystore` is committed (verified — it's in the tree).
- `mobile/.gitignore:16` correctly excludes `*.jks`, `*.p8`, `*.p12`, `*.key` — production keystores would not be committed.

**Findings**

| # | Severity | Finding | What to do |
|---|----------|---------|------------|
| 2.8.1 | 🔴 CRITICAL | **`release` buildType is configured to sign with `signingConfigs.debug`** (the same debug keystore that ships with the React Native template, with the universally-known password `android`). For local `./gradlew assembleRelease` this would produce a **debug-signed release AAB** — Play would reject it, and if it ever did get through, the package would be married to a public, shared keystore forever (no upload-key recovery). | **THIS IS A SHIP-BLOCKER** if the user ever runs `./gradlew assembleRelease` locally. For closed testing via `eas build --profile production`, EAS managed credentials inject their own keystore at the build server (it bypasses this gradle config), so the actual AAB submitted to Play **is** signed correctly — but the moment anyone diverges from EAS managed credentials, this gradle config fires the debug-keystore footgun. **Action:** add a real `release` signingConfig in `build.gradle` driven by gradle properties (e.g., `RELEASE_STORE_FILE`, `RELEASE_KEY_ALIAS`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_PASSWORD`) sourced from `~/.gradle/gradle.properties` (NOT in repo), with a guarded fallback that throws if release vars are missing. Today's quick fix: change `signingConfig signingConfigs.debug` to `signingConfig null` in the `release` block, so a local release build fails loud rather than producing a debug-signed AAB. |
| 2.8.2 | 🟡 MEDIUM | **`debug.keystore` is committed to git.** This is React Native's default — the debug keystore is intended to be shared (the password `android` is hardcoded into Gradle's RN plugin). Not a leak. But it's a confusion vector: a future contributor sees `debug.keystore` committed and assumes that's how all keystores work. | Add a comment in `mobile/android/app/build.gradle` at line ~100 explicitly noting "DEBUG ONLY. Production signing is handled by EAS managed credentials. Never sign a release AAB with this keystore." |
| 2.8.3 | 🟡 MEDIUM | **EAS managed credential custody.** The actual release upload key for Play is managed by EAS. It can be downloaded with `eas credentials` → "Download keystore." Whoever runs that command and saves the file becomes a key custodian. | **Pre-collaborator action**: download the keystore once, store it offline (encrypted USB / 1Password attachment), confirm you have the SHA-1 fingerprint Play expects. If you ever lose access to EAS, you need that file to keep publishing under the same upload key. |
| 2.8.4 | 🔵 LOW | **Play App Signing.** Already filed as 1.4.4. | See 1.4.4. |

---

# Ship-blocker checklist (this week, closed testing)

Items that must clear before pushing the AAB to Play Closed Testing:

| # | Item | Severity | Where |
|---|------|----------|-------|
| ☐ 1 | **Confirm `eas build --profile production` is invoked from `mobile/` cwd** (not repo root) so EAS reads `mobile/eas.json`, not the stale root one | 🟠 HIGH | §1.3.1 |
| ☐ 2 | **Delete the stale root `/Users/jtroy/Desktop/ColdFiles/eas.json`** | 🟠 HIGH | §1.3.1 |
| ☐ 3 | **Verify GitHub repo is Private** at https://github.com/JamesTroy/ColdFiles/settings | 🟠 HIGH | §1.5.1 |
| ☐ 4 | **Verify Vercel env vars `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` are scoped Production-only** (not Preview) | 🟡 MEDIUM | §1.1.2 |
| ☐ 5 | **Verify EAS credentials → Google Play service account uses `track: internal` permissions only** | 🟡 MEDIUM | §1.4.3 |
| ☐ 6 | **Verify Play App Signing is enabled** when uploading the first AAB | 🔵 LOW | §1.4.4 |
| ☐ 7 | **Verify migration `04_lock_down_anon_writes.sql` has actually been applied to production Supabase** (not just the local file) | 🟠 HIGH | §2.6.1 |
| ☐ 8 | **Patch `mobile/android/app/build.gradle` release signingConfig** to NOT reuse `signingConfigs.debug` — minimum: change to `signingConfig null` to fail-loud on local release builds | 🔴 CRITICAL | §2.8.1 |
| ☐ 9 | **Enable GitHub Push Protection** (free on public, GHAS-paid on private) so a `git push` containing a Supabase service-role key shape is blocked server-side | 🟡 MEDIUM | §1.5.3, §2.2.1 |
| ☐ 10 | **Add `engines.node: "22.x"`** to root `package.json` to pin Vercel build runtime | 🟡 MEDIUM | §2.5.1 |

Items 1, 2, 3, 7, 8 are blockers. The rest are "do this week" but won't block the upload click. Item 8 in particular is easy to miss because EAS managed credentials make the gradle file irrelevant for the submitted AAB — but it's a landmine for any future developer.

# Post-launch (within 30 days)

- Move `migrations/*.sql` to `supabase/migrations/` and adopt `supabase db push` (§2.6.1).
- Rotate `SUPABASE_SERVICE_ROLE_KEY` (§1.6).
- Add `.github/SECURITY.md` (§1.5.4).
- Create Expo organization account, transfer project (§1.3.2).
- Document the runbook: where backup codes, EAS keystore download, registrar credentials all live (§1.6).
- Add a `staging` branch + protect Vercel "Production Branch" setting to it (§2.1.2).
- Enable Dependabot alerts (§2.7.1).

# Out of scope (defer until traction or contracts demand it)

- SLSA Level 4 / signed artifact verification chains.
- SBOM generation.
- Reproducible builds beyond Node + lockfile pinning.
- Automated PR-based migration testing against staging Supabase.
- Hardware-backed signing for the Play upload key.
- SOC2 / ISO27001 control framework mapping.

---

**Audit complete.** Two real ship-blockers (release keystore footgun, repo visibility check); one real workflow risk (migrations applied by hand with no record); the rest is solo-dev-normal IAM that needs a single pre-collaborator hardening pass.
