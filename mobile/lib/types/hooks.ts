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
