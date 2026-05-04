# Project rules — The Cold File

This file holds rules that should be re-derived as rarely as possible. If
the same mistake shows up twice in the commit log, it earns a line here.

## Hooks before early returns. No exceptions.

React hooks (`useState`, `useEffect`, `useMemo`, `useCallback`,
`useRef`, etc.) must be declared before any conditional `return` in a
component. If a hook needs data that isn't available yet, do the
null-check inside the hook body, not before the hook call.

```tsx
// ✗ BAD — hook count differs between renders
if (!data) return <Loading />;
const [foo, setFoo] = useState<string | null>(null);
useEffect(() => setFoo(null), [data.slug]);

// ✓ GOOD — hooks always run, conditionals work on their inputs
const [foo, setFoo] = useState<string | null>(null);
useEffect(() => setFoo(null), [data?.slug]);
if (!data) return <Loading />;
```

The bug this prevents: when the component first renders without `data`,
only one hook fires. When it re-renders with `data` populated, all four
fire. React detects the mismatch and throws "Rendered more hooks than
during the previous render," which surfaces on Android Fabric as a
**blank grey screen** that doesn't show up in dev mode. It always slips
to production.

This pattern has bitten this codebase + parallel projects more than once.
Treat the rule as load-bearing.

If `react-hooks/rules-of-hooks` ESLint isn't enabled yet, that's the
mechanical safety net. The rule above is the human one.

## Migrations are numbered and ordered

Every migration in `migrations/` has a numeric prefix and runs in order.
Don't edit a migration after it has been applied to a Supabase project —
add a new one that mutates the prior state. Numbering is the source of
truth for "what state is the DB in"; SQL editors don't track applied
versions automatically.

## Auto-mode actions

Routine code edits, scrape config writes, and OTA pushes proceed without
confirmation per auto-mode. Production database mutations
(migrations, schema drops, force-pushes, key rotations) require explicit
user confirmation regardless of mode.

## Dedupe trades silent-wrongful-merges for visible-duplicates-in-list

When two cases match on `lastname_age_sex` only (no Tier-1/2 key — i.e.
no NamUs ID, no NCIC ID, no `name+state+year`, no `agency_case_number`),
the persist path does NOT auto-merge. The incoming record lands as its
own new case + a `dedupe_review_queue` row links the pair for v1.0.2's
review tooling.

This is a deliberate asymmetry. The cost of a same-case-shown-twice in
the user's list is a 30-second polish item. The cost of a wrongful merge
is a takedown email + trust hit + un-merge work under deadline. The
trade is correct for cold-case data — not an accident, not a bug.

If you're staring at duplicate cases in the list and tempted to "fix the
dedupe to be smarter" — first check whether the duplicates would have
auto-merged via `lastname_age_sex` only. If so, the right move is to
build the v1.0.2 review tooling (consume `dedupe_review_queue`, surface
candidate pairs to the operator), NOT to weaken the Tier-3 routing.
Operator-confirmed merges via the review tool are the path forward.

Kill-switch (in case the queue starts filling at unexpected volume):
`DEDUPE_TIER3_TO_REVIEW=false` env var on either runtime (scrape-cli +
the ingest-source Edge Function) reverts to the legacy auto-merge path.
Default-on; flip only as an operational safety valve.

See `supabase/functions/_shared/persist.ts:queueForTier3Review` for the
implementation.

## Release sequence — bump version BEFORE the AAB is uploaded

Native rebuilds (`eas build --profile production` against a fresh
`versionCode`) follow this order, not any other:

1. Cut a release branch off `main` (`release/v<X.Y.Z>`).
2. Bump `version` + `versionCode` in `mobile/app.config.ts` on the
   release branch.
3. Tag the bump commit (`v<X.Y.Z>`) so the AAB is built from a stable
   point in history.
4. Run `eas build` from the tag.
5. Merge the release branch back to `main` BEFORE uploading the AAB
   to Play Console.
6. Upload the AAB.

The order matters because `main` is the source of truth for "what
ships next." If the AAB lands in Play Console before the bump merges,
`main` claims the prior versionCode while Play has the new one. Anyone
who clones `main` and runs `eas build` produces an AAB Play Console
rejects with `versionCode N already used` — the same trap PR #5
created when the v1.0.3 AAB shipped while its release-branch PR
sat open. Branch first, bump first, tag first, merge before upload.

## Branch + commit conventions

Branches use a small fixed set of intent prefixes. The taxonomy is
additive — new prefixes earn a line here, not a quiet appearance in
`git log`.

  - `fix/<scope>` — bug fix, no new feature surface
  - `feat/<scope>` — new user-facing feature
  - `chore/<scope>` — build/tooling/gitignore/CI/dep bumps
  - `docs/<scope>` — pure prose, no code path
  - `ux/<scope>` — UX polish that's neither a bug fix nor a discrete
    new feature (legend rewordings, sheet snap-point tweaks, etc.)
  - `smoke/<scope>` — smoke / integration test infrastructure
  - `release/v<X.Y.Z>` — version bump for a native rebuild (see
    "Release sequence" above)

Commit subjects use the matching `type(scope): subject` shape. Scope
must be a real surface — not spelling drift. Canonical scopes today:

  - Mobile surfaces: `map`, `map-sheet`, `map-pin`, `zone`, `home`,
    `list`, `saved`, `case-detail`, `tip`, `about`, `onboarding`,
    `notifications`, `auth`
  - Server surfaces: `persist`, `dedupe`, `geocode`, `media`,
    `notify-fanout`, `tip-route`, `takedown`, `ingest`, `migrations`,
    `rls`, `rpc`
  - Doc surfaces: `app-config`, `gitignore`, `claude-md`, `readme`

Add a new scope when a real surface earns one; do NOT introduce
near-duplicates (`fix(mapsheet)` vs `fix(map-sheet)`, `fix(map header)`
with a literal space) — those silently fragment `git log --grep`
searches and never surface as a real signal.

### PRs ship one surface or one theme

A PR's commits should share a common subject. Two unrelated commits
on different screens belong in two PRs, even if both are small.
Reviewability is the test, not size: a reviewer should be able to
hold the diff in one mental model. Mixing a `fix(map)` with a
`feat(about)` in the same PR forces the reviewer to context-switch
mid-review and obscures whether the test plan covers both surfaces.

When a PR's commits start to drift across surfaces mid-work, split
into a stack of branches before pushing. The cost of two small PRs
is much less than the cost of one PR that's hard to review.

### Multi-commit PRs preserve per-fix partial-revert

Multi-commit PRs MUST land as true merge commits (not squash). The
per-commit SHAs stay individually addressable in `git log` so any
single fix can be reverted without touching its siblings. The
established pattern: 2-4 commits per PR, each commit a coherent
slice of the PR's theme, GitHub merge-commit (not squash). PR #3
and PR #7 are the worked examples — three commits each, all
revertable in isolation.
