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
