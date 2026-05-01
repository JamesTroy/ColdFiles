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
