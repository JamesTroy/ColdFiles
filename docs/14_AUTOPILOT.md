# Autopilot — pre-authorized decisions

Standing authorizations Claude (the assistant) can act on without
re-asking. The point of writing them down is so the day-to-day decision
flow stops bottlenecking on "ping the operator" for things the operator
has already decided.

The rule: if an action shape appears under **Do without asking**, take
it. If it appears under **Always confirm first**, stop and ask, even
under auto-mode. Anything not covered defaults to the auto-mode rule of
"reasonable assumption, low-risk OK, course-correct on the fly."

Date each entry on add. When an entry stops being right, edit or
remove — drift is the failure mode here, not under-documentation.

---

## Do without asking

### Git / branches / PRs (added 2026-05-12)

- **Create branches, commit, push, open PRs** following the
  `type(scope): subject` convention in `CLAUDE.md`.
- **Merge own PRs after CI green** if the PR is single-surface and
  the diff matches the PR description. Multi-commit PRs land as merge
  commits, not squash (per `CLAUDE.md` "Multi-commit PRs preserve
  per-fix partial-revert").
- **Stack branches** rather than mixing surfaces in one PR. Stacked PRs
  do NOT auto-cascade on GitHub merge per
  `feedback_stacked_prs_dont_cascade` — surface that explicitly if a
  stack is in play.
- **Close Dependabot PRs** that bump `expo-*` packages to SDK-N-aligned
  majors while `expo` itself stays on the prior SDK (per
  `feedback_dependabot_expo_per_package`).
- **Apply npm `overrides`** to force a transitive CVE patch when the
  parent pin holds back Dependabot (per
  `feedback_transitive_cve_npm_overrides`).

### Code edits (added 2026-05-12)

- **Routine code edits** across the mobile app, web property, Edge
  Functions, scraper CLI, and SQL migrations.
- **Memory cleanup**: delete or update memory entries that are
  verified-stale by reading the current code. Confirm by reading first
  ("Before recommending from memory" rule in the auto-memory section).
- **Scraper config writes** — new sources, source schedule changes,
  extractor patches.

### Edge Function deploys (added 2026-05-12)

- **Edge Function code changes** ship via `deploy-functions.yml` on
  merge to main. No manual `supabase functions deploy` step.
- **Manual redeploy via workflow_dispatch** if a deploy needs to be
  re-run (e.g., a flaky network during the first deploy).

### Photo sourcing (added 2026-05-12)

- **Hot-link** photos from NamUs, FBI, LASD without further review.
- **Mirror** photos from Charley Project and Doe Network, with
  `case_media.source_attribution` populated.
- Per `feedback_photo_sourcing_policy`. Anything outside this list
  goes to "Always confirm first."

### Tip and DNA-funding routing (added 2026-05-12)

- **Externalize**: any "let users contact about a case" surface routes
  to P3 Tips / agency form / FBI. Any "fund DNA on a case" surface
  routes to Othram DNA Solves / Season of Justice. Both with
  audit-only logging — no in-app intake, no held funds (per
  `feedback_tip_route_externalize` + `feedback_dna_funding_externalize`).

---

## Always confirm first

These need explicit operator OK every time, regardless of auto-mode.

### Production data (added 2026-05-12)

- **Applying SQL migrations to the prod Supabase project** (via the
  Supabase SQL editor or `supabase db push`). Writing the migration
  file is fine; applying it is the gated step.
- **Schema drops, table truncations, `delete from … where true`** —
  any reversible-only-by-restore operation against prod data.
- **RLS policy changes** — even when the migration is written, the
  apply step gates on the operator because RLS changes can silently
  expose or hide data without surfacing as an error.

### Release sequencing (added 2026-05-12)

- **Native rebuilds** (`eas build --profile production`) — the version
  bump + tag + AAB upload sequence in `CLAUDE.md` "Release sequence"
  is operator-driven.
- **OTA pushes** (`eas update --channel production`) — gated because
  OTAs against a not-yet-rolled-out runtime are silent per
  `feedback_ota_runtime_orphan`. The operator verifies the runtime
  match in EAS dashboard before the OTA fires.

### Secrets and credentials (added 2026-05-12)

- **Rotating Supabase service-role key, Mapbox token, EAS token,
  GitHub Actions secrets** — even when rotation is overdue.
- **Adding new secrets to `.env`, GitHub Actions, or Supabase Vault** —
  Claude can describe what to add and where; the operator writes the
  value.

### External publication (added 2026-05-12)

- **Posting anywhere outside the repo**: PR comments on third-party
  repos, GitHub Discussions, Reddit / Websleuths / podcast outreach,
  email to agencies, LE-direct contacts, NamUs / Charley operators.
- **Uploading content to third-party tools** (diagram renderers,
  pastebins, gists). Even when not sensitive, the operator approves
  the destination.

### Destructive git (added 2026-05-12)

- **Force-push to `main`** — always.
- **Force-push to any shared branch** (release branches, anything
  another contributor might be tracking).
- **`git reset --hard`, `git clean -fd`, branch deletion of
  unmerged work**.
- **Amending a commit that has already been pushed**.

### Memory entries about people (added 2026-05-12)

- **Saving any memory containing a third party's name** (agency
  contacts, NamUs operators, podcast hosts, family members). Confirm
  scope + storage before writing.

---

## How this doc stays honest

Re-read this list when:

- A new release ships.
- A new surface gets added (new source, new Edge Function, new
  third-party integration).
- An entry surprises future-Claude — that's the signal it's drifted.

When an entry stops being right, edit or remove it in the same commit
that changes the underlying decision. Do not silently widen
"Do without asking" without an explicit operator note in the PR
description. The point is not breadth of authorization; the point is
that authorization is written down rather than re-litigated each turn.
