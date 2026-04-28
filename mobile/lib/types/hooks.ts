/**
 * Hook contract types — load-bearing.
 *
 *   Read hooks return  { data, loading, error, source }
 *   Write hooks return { submit, submitting, lastResult, error }
 *
 * They're intentionally non-interchangeable. A read hook can't be accidentally
 * treated as a write hook (or vice versa) because the destructuring fails at
 * the type level. Future hook authors get this rule from the type file
 * regardless of whether they've read docs/04_DESIGN_SYSTEM.md.
 *
 * Read precedent: lib/hooks/use-cases-near.ts, use-case-list.ts, use-case-detail.ts
 * Write precedent: lib/hooks/use-submit-tip.ts (the first write path in the app)
 */

/**
 * Read-hook contract. `data` always present (falls back to sample data when
 * Supabase is unconfigured). `loading` is the in-flight flag. `error` is the
 * most-recent error. `source` is 'live' (real backend) or 'sample' (designer
 * mode), so screens can show subtle indicators when running on fallback data.
 */
export interface QueryResult<T> {
  data: T;
  loading: boolean;
  error: Error | null;
  source: 'live' | 'sample';
}

/**
 * Write-hook contract. `submit(input)` returns a Promise so the caller can
 * await on it for choreography (e.g. the 200ms anticipation pause + deep-link
 * sequence in the submit-tip modal). `submitting` is the in-flight flag.
 * `lastResult` carries the most-recent successful response so screens can
 * render the post-state without a follow-up fetch. `error` clears on the next
 * submit() call.
 *
 * Generic `Input` is the argument shape; `Output` is what the server returns.
 */
export interface WriteHookShape<Input, Output> {
  submit: (input: Input) => Promise<Output>;
  submitting: boolean;
  lastResult: Output | null;
  error: Error | null;
}

/**
 * NOTE — future primitive, not yet extracted.
 *
 * useSubmitTip already broadcasts to useMeCounts after a successful handoff
 * (notifyMeCountsChanged) and the saved-cases store does the same. The pattern
 * "writes that affect counts/state on other screens emit, reads on those
 * screens subscribe" is the second write-hook insight — first was the
 * read-vs-write contract distinction here.
 *
 * When a third write hook lands (likely useCreateWatchZone, which will
 * affect the Me-tab counter AND the Map's freshness signal), extract the
 * pattern as a third primitive:
 *
 *     interface BroadcastingWrite<Input, Output, BroadcastKey extends string>
 *       extends WriteHookShape<Input, Output> { ... }
 *
 * Premature abstraction is more expensive than the duplication. Wait for the
 * pattern to be undeniable across three callers before formalizing it. This
 * comment is the bookmark — when you find yourself writing the third
 * notify*Changed() call, that's the moment.
 */
