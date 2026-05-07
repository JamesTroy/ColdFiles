import { describe, expect, it, vi } from 'vitest';
import { persistRecord } from '../persist.ts';
import type { CaseRecord, RunStats, SourceConfig } from '../types.ts';
import { PoliteFetcher } from '../http.ts';

// Tier-3 routing is the CLAUDE.md anchor: "Dedupe trades silent-wrongful-
// merges for visible-duplicates-in-list." A Tier-3-only candidate
// (lastname_age_sex matched, no stronger key) MUST land as a new case +
// queue the pair in dedupe_review_queue. Auto-merging a Tier-3-only match
// would silently collapse two unrelated cases — the failure mode the
// architecture is built to prevent. This pins the contract.

interface ChainCall {
  table: string;
  method: string;
  args: unknown[];
}

interface RpcCall {
  fn: string;
  params: unknown;
}

interface TableBehavior {
  /** Rows returned from `.select()`/`.in()` query chains. */
  selectRows?: unknown[];
  /** Single-row result for `.maybeSingle()`/`.single()`. */
  singleRow?: unknown;
  /** Insert-returning row (e.g., `.insert(...).select('id').single()`). */
  insertReturning?: unknown;
}

interface MockOptions {
  /**
   * RPC return values keyed by function name. claim_dedupe_key returns the
   * winning case_id; defaults to "no concurrent claim" (returns the
   * candidate id from the call's p_case_id) so the happy path needs no
   * configuration. Tests of the race-lost path override per scenario.
   */
  rpcResults?: Record<string, (params: any) => unknown>;
}

function buildMockSupabase(
  behaviors: Record<string, TableBehavior>,
  options: MockOptions = {},
): {
  client: any;
  calls: ChainCall[];
  rpcCalls: RpcCall[];
} {
  const calls: ChainCall[] = [];
  const rpcCalls: RpcCall[] = [];

  function makeChain(table: string): any {
    const chain: any = {};
    let isInsertReturn = false;

    const methods = [
      'select', 'insert', 'update', 'upsert', 'delete',
      'eq', 'in', 'is', 'or', 'limit', 'order',
    ];
    for (const m of methods) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        if (m === 'insert' || m === 'update' || m === 'upsert') {
          isInsertReturn = m === 'insert';
        }
        return chain;
      };
    }
    chain.maybeSingle = () => {
      const data = behaviors[table]?.singleRow ?? null;
      return Promise.resolve({ data, error: null });
    };
    chain.single = () => {
      const data = isInsertReturn
        ? behaviors[table]?.insertReturning ?? null
        : behaviors[table]?.singleRow ?? null;
      return Promise.resolve({ data, error: null });
    };
    // Terminating .then on the chain (used by upsert/insert/update without .single).
    chain.then = (resolve: (v: { data: unknown; error: null }) => void, _reject?: (e: unknown) => void) => {
      const data = behaviors[table]?.selectRows ?? null;
      resolve({ data, error: null });
      return Promise.resolve({ data, error: null });
    };
    // Make the chain itself awaitable + return select rows.
    chain[Symbol.asyncIterator] = undefined;
    chain._isMockChain = true;
    return new Proxy(chain, {
      get(target, prop, recv) {
        // For `.in()` / `.eq()` / etc that should resolve to selectRows when awaited.
        if (prop === 'then') {
          return (resolve: (v: { data: unknown; error: null }) => void) => {
            resolve({ data: behaviors[table]?.selectRows ?? null, error: null });
          };
        }
        return Reflect.get(target, prop, recv);
      },
    });
  }

  const client = {
    from: (table: string) => makeChain(table),
    rpc: (fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      const handler = options.rpcResults?.[fn];
      // Default: claim_dedupe_key resolves with the candidate id (no race).
      const data = handler
        ? handler(params)
        : fn === 'claim_dedupe_key'
          ? (params as { p_case_id: string }).p_case_id
          : null;
      return Promise.resolve({ data, error: null });
    },
  };
  return { client, calls, rpcCalls };
}

const baseRecord = (over: Partial<CaseRecord> = {}): CaseRecord => ({
  source_external_id: 'src-tier3-1',
  source_url: 'https://example.com/case/1',
  kind: 'missing',
  status: 'open',
  incident_date_quality: 'exact',
  photos: [],
  raw: {},
  victim_first_name: 'Jane',
  victim_last_name: 'Doe',
  victim_age: 23,
  victim_sex: 'female',
  ...over,
});

// Minimal cast — persist.ts only reads `slug` + a few fields from SourceConfig.
// Building a fully valid one for the test would pull in unrelated strategy
// types we don't exercise.
const baseSource = {
  slug: 'test_source',
  name: 'Test Source',
  kind: 'aggregator',
  trustWeight: 50,
} as unknown as SourceConfig;

const baseCtx = (client: any) => ({
  supabase: client,
  source: baseSource,
  sourceId: 'src-id-fake',
  trustWeight: 50,
  fetcher: new PoliteFetcher(0),
});

const newStats = (): RunStats => ({
  cases_seen: 0,
  cases_new: 0,
  cases_updated: 0,
  cases_unchanged: 0,
  errors: [],
});

describe('persistRecord — Tier-3 routing (CLAUDE.md anchor)', () => {
  it('Tier-3-only match → routes to review queue, NOT auto-merge', async () => {
    // Existing case in DB matched on lastname_age_sex ONLY.
    const { client, calls } = buildMockSupabase({
      case_dedupe_keys: {
        selectRows: [
          { case_id: 'existing-case-uuid', key_type: 'lastname_age_sex', key_value: 'doe_23_female' },
        ],
      },
      cases: {
        insertReturning: { id: 'new-case-uuid' },
        // For queueForTier3Review's read of existing case + ensureGeocode's read of new.
        singleRow: { id: 'existing-case-uuid', kind: 'missing', victim_sex: 'female', location_point: null },
      },
      dedupe_review_queue: { selectRows: [] },
      case_dedupe_keys_upsert: { selectRows: [] },
      case_sources: { selectRows: [] },
    });

    const stats = newStats();
    await persistRecord(baseCtx(client), baseRecord(), stats);

    // The new case was created.
    const casesInserts = calls.filter((c) => c.table === 'cases' && c.method === 'insert');
    expect(casesInserts).toHaveLength(1);

    // The pair was queued for review.
    const reviewInserts = calls.filter(
      (c) => c.table === 'dedupe_review_queue' && c.method === 'insert',
    );
    expect(reviewInserts).toHaveLength(1);
    const queued = reviewInserts[0].args[0] as Record<string, unknown>;
    expect((queued.match_keys as { matched_key_types: string[] }).matched_key_types).toEqual([
      'lastname_age_sex',
    ]);
    expect((queued.match_keys as { reason: string }).reason).toBe('tier3_only_no_stronger_match');
    expect(queued.status).toBe('pending');

    // Stats bumped as new — NOT updated.
    expect(stats.cases_new).toBe(1);
    expect(stats.cases_updated).toBe(0);

    // Critical: cases.update was NOT called (would mean auto-merge).
    const casesUpdates = calls.filter((c) => c.table === 'cases' && c.method === 'update');
    // ensureGeocode may call update with location_point — filter to merge-shaped updates
    // (those would set victim_* / narrative / etc., not just location_point).
    const mergeUpdates = casesUpdates.filter((c) => {
      const arg = c.args[0] as Record<string, unknown>;
      return arg && Object.keys(arg).some((k) => k.startsWith('victim_') || k === 'narrative' || k === 'has_photo');
    });
    expect(mergeUpdates).toHaveLength(0);
  });

  it('Tier-3-only match with tier3ToReview=false (kill-switch) → auto-merges', async () => {
    const { client, calls } = buildMockSupabase({
      case_dedupe_keys: {
        selectRows: [
          { case_id: 'existing-case-uuid', key_type: 'lastname_age_sex', key_value: 'doe_23_female' },
        ],
      },
      cases: {
        // Existing row read by mergeIntoExistingCase for conflict detection + merge.
        singleRow: {
          id: 'existing-case-uuid',
          kind: 'missing',
          victim_first_name: 'Jane',
          victim_last_name: 'Doe',
          victim_age: 23,
          victim_sex: 'female',
          has_photo: false,
          has_sketch: false,
          has_reconstruction: false,
          location_point: null,
        },
      },
      case_sources: { selectRows: [{ trust_weight: 40 }] },
      dedupe_review_queue: { selectRows: [] },
    });

    const stats = newStats();
    await persistRecord({ ...baseCtx(client), tier3ToReview: false }, baseRecord(), stats);

    // No new case insert.
    const casesInserts = calls.filter((c) => c.table === 'cases' && c.method === 'insert');
    expect(casesInserts).toHaveLength(0);

    // No review queue write.
    const reviewInserts = calls.filter(
      (c) => c.table === 'dedupe_review_queue' && c.method === 'insert',
    );
    expect(reviewInserts).toHaveLength(0);

    // Stats bumped as updated — NOT new.
    expect(stats.cases_new).toBe(0);
    expect(stats.cases_updated).toBe(1);
  });

  it('Tier-1 match (namus_number) → auto-merges, never queues for review', async () => {
    const rec = baseRecord({ namus_number: 'MP12345' });
    const { client, calls } = buildMockSupabase({
      case_dedupe_keys: {
        // Both the strong namus key AND the lastname_age_sex hit on the same case.
        // This is the "Tier-3 + stronger" path; routing must pick the stronger.
        selectRows: [
          { case_id: 'existing-case-uuid', key_type: 'namus_number', key_value: 'mp12345' },
          { case_id: 'existing-case-uuid', key_type: 'lastname_age_sex', key_value: 'doe_23_female' },
        ],
      },
      cases: {
        singleRow: {
          id: 'existing-case-uuid',
          kind: 'missing',
          victim_sex: 'female',
          has_photo: false,
          has_sketch: false,
          has_reconstruction: false,
          location_point: null,
        },
      },
      case_sources: { selectRows: [{ trust_weight: 30 }] },
    });

    const stats = newStats();
    await persistRecord(baseCtx(client), rec, stats);

    // Strong match → merge path.
    const reviewInserts = calls.filter(
      (c) => c.table === 'dedupe_review_queue' && c.method === 'insert',
    );
    expect(reviewInserts).toHaveLength(0);
    expect(stats.cases_updated).toBe(1);
    expect(stats.cases_new).toBe(0);
  });

  it('No dedupe match → creates new case, no review queue entry', async () => {
    const { client, calls, rpcCalls } = buildMockSupabase({
      case_dedupe_keys: { selectRows: [] }, // no keys hit
      cases: {
        insertReturning: { id: 'fresh-case-uuid' },
        singleRow: { id: 'fresh-case-uuid', location_point: null },
      },
    });

    const stats = newStats();
    await persistRecord(baseCtx(client), baseRecord(), stats);

    expect(stats.cases_new).toBe(1);
    expect(stats.cases_updated).toBe(0);

    const reviewInserts = calls.filter(
      (c) => c.table === 'dedupe_review_queue' && c.method === 'insert',
    );
    expect(reviewInserts).toHaveLength(0);

    const casesInserts = calls.filter((c) => c.table === 'cases' && c.method === 'insert');
    expect(casesInserts).toHaveLength(1);

    // Race fix: claim_dedupe_key was called for the strongest key, with
    // our candidate case_id — confirms the new atomic-claim path is wired.
    const claimCalls = rpcCalls.filter((r) => r.fn === 'claim_dedupe_key');
    expect(claimCalls.length).toBeGreaterThanOrEqual(1);
    const firstClaim = claimCalls[0].params as { p_case_id: string; p_key_type: string };
    expect(firstClaim.p_case_id).toBe('fresh-case-uuid');
    expect(firstClaim.p_key_type).toBe('lastname_age_sex');
  });

  it('Race lost on strongest key → cleans up provisional row + merges into winner', async () => {
    // No prior dedupe match (concurrent peer hadn't yet claimed when this
    // run did its read), but BY THE TIME we try to claim, the peer's row
    // has landed. claim_dedupe_key returns the peer's case_id instead of
    // ours — the loser pivots to merge.
    const { client, calls, rpcCalls } = buildMockSupabase(
      {
        case_dedupe_keys: { selectRows: [] },
        cases: {
          insertReturning: { id: 'our-candidate-uuid' },
          // Read by mergeIntoExistingCase after race-lost:
          singleRow: {
            id: 'winner-case-uuid',
            kind: 'missing',
            victim_sex: 'female',
            has_photo: false,
            has_sketch: false,
            has_reconstruction: false,
            location_point: null,
          },
        },
        case_sources: { selectRows: [{ trust_weight: 30 }] },
      },
      {
        rpcResults: {
          claim_dedupe_key: () => 'winner-case-uuid', // peer won
        },
      },
    );

    const stats = newStats();
    await persistRecord(baseCtx(client), baseRecord(), stats);

    // Provisional cases row was cleaned up.
    const casesDeletes = calls.filter((c) => c.table === 'cases' && c.method === 'delete');
    expect(casesDeletes).toHaveLength(1);

    // Treated as merged, not new.
    expect(stats.cases_new).toBe(0);
    expect(stats.cases_updated).toBe(1);

    // No review-queue insert for a race loss (would be wrong — same case).
    const reviewInserts = calls.filter(
      (c) => c.table === 'dedupe_review_queue' && c.method === 'insert',
    );
    expect(reviewInserts).toHaveLength(0);

    // claim_dedupe_key was called.
    expect(rpcCalls.filter((r) => r.fn === 'claim_dedupe_key').length).toBeGreaterThanOrEqual(1);
  });

  it('Timeline events on the record → forwarded to case_events upsert', async () => {
    // PR #16 contract: any record.events on the CaseRecord lands in
    // case_events alongside the case row write, regardless of whether
    // the case was created or merged. This pins the integration so a
    // future refactor can't silently drop the call.
    const { client, calls } = buildMockSupabase({
      case_dedupe_keys: { selectRows: [] },
      cases: {
        insertReturning: { id: 'fresh-case-uuid' },
        singleRow: { id: 'fresh-case-uuid', location_point: null },
      },
    });

    const stats = newStats();
    await persistRecord(
      baseCtx(client),
      baseRecord({
        events: [
          {
            event_kind: 'last_seen',
            headline: 'Last seen 1985-06-13',
            event_date: '1985-06-13',
            source_url: 'https://example.com/case/1',
            source_quote: 'Missing Since: June 13, 1985',
          },
        ],
      }),
      stats,
    );

    const eventInserts = calls.filter(
      (c) => c.table === 'case_events' && c.method === 'upsert',
    );
    expect(eventInserts).toHaveLength(1);
    const rows = eventInserts[0].args[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].case_id).toBe('fresh-case-uuid');
    expect(rows[0].event_kind).toBe('last_seen');
    expect(rows[0].ingest_signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Split-conflict on secondary key → logs structured warning, does NOT auto-merge', async () => {
    // Strongest key (name_state_year) lands cleanly for our new case;
    // a SECONDARY key (lastname_age_sex) already points to a DIFFERENT
    // existing case. This is evidence two cases describe the same person
    // but share no Tier-1/2 key — policy not pinned yet (CLAUDE.md
    // dedupe-asymmetry only covers Tier-3 review-queue routing). Default
    // to log + continue with the primary's case_id.
    const rec = baseRecord({
      victim_first_name: 'Jane',
      victim_last_name: 'Doe',
      location_state: 'CA',
      incident_date: '1985-06-13',
      victim_age: 23,
      victim_sex: 'female',
    });

    const { client, rpcCalls } = buildMockSupabase(
      {
        case_dedupe_keys: { selectRows: [] },
        cases: {
          insertReturning: { id: 'our-new-case-uuid' },
          singleRow: { id: 'our-new-case-uuid', location_point: null },
        },
      },
      {
        rpcResults: {
          claim_dedupe_key: (params: { p_case_id: string; p_key_type: string }) => {
            if (params.p_key_type === 'name_state_year') return params.p_case_id; // we won the strongest
            if (params.p_key_type === 'lastname_age_sex') return 'pre-existing-other-case-uuid'; // split-conflict
            return params.p_case_id;
          },
        },
      },
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const stats = newStats();
      await persistRecord(baseCtx(client), rec, stats);

      // Strongest key won → counted as new.
      expect(stats.cases_new).toBe(1);
      expect(stats.cases_updated).toBe(0);

      // Both keys claimed.
      const claimTypes = rpcCalls
        .filter((r) => r.fn === 'claim_dedupe_key')
        .map((r) => (r.params as { p_key_type: string }).p_key_type);
      expect(claimTypes).toContain('name_state_year');
      expect(claimTypes).toContain('lastname_age_sex');

      // Structured split-conflict log line.
      const splitConflictLogged = warnSpy.mock.calls.some((args) => {
        const line = String(args[0] ?? '');
        return (
          line.includes('split-conflict') &&
          line.includes('our-new-case-uuid') &&
          line.includes('pre-existing-other-case-uuid')
        );
      });
      expect(splitConflictLogged).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('persistRecord — status_update_only flag', () => {
  it('match found → merges status flip into existing case (cases_updated bumped)', async () => {
    // Existing case matched on lastname_age_sex (Tier-3-only) — for a
    // status-update-only record, we WANT this to merge unconditionally
    // even though normally Tier-3 routes to review. The flag's whole
    // point is "just update status on whatever case matches."
    const { client, calls } = buildMockSupabase({
      case_dedupe_keys: {
        selectRows: [
          { case_id: 'existing-case-uuid', key_type: 'lastname_age_sex', key_value: 'redden_28_female' },
        ],
      },
      cases: {
        singleRow: {
          id: 'existing-case-uuid',
          kind: 'homicide',
          status: 'open', // currently open in DB
          victim_sex: 'female',
          has_photo: false,
          has_sketch: false,
          has_reconstruction: false,
          location_point: null,
        },
      },
      case_sources: { selectRows: [{ trust_weight: 50 }] },
    });

    const stats = newStats();
    await persistRecord(
      baseCtx(client),
      baseRecord({
        kind: 'homicide',
        status: 'cleared_arrest',
        victim_first_name: 'Nikki',
        victim_last_name: 'Redden',
        victim_age: 28,
        victim_sex: 'female',
        status_update_only: true,
      }),
      stats,
    );

    // Status update merged into existing case — counted as an update.
    expect(stats.cases_updated).toBe(1);
    expect(stats.cases_new).toBe(0);
    expect(stats.cases_seen).toBe(1);

    // Critical: NO new case insert (status-update posts must never
    // create new cases — they're update-only).
    const casesInserts = calls.filter((c) => c.table === 'cases' && c.method === 'insert');
    expect(casesInserts).toHaveLength(0);

    // No review-queue entry — the flag bypasses Tier-3 review routing.
    const reviewInserts = calls.filter(
      (c) => c.table === 'dedupe_review_queue' && c.method === 'insert',
    );
    expect(reviewInserts).toHaveLength(0);
  });

  it('no match → logs structured "skipped" line + does NOT insert a new case', async () => {
    const { client, calls } = buildMockSupabase({
      case_dedupe_keys: { selectRows: [] }, // no match
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const stats = newStats();
      await persistRecord(
        baseCtx(client),
        baseRecord({
          kind: 'homicide',
          status: 'cleared_arrest',
          victim_first_name: 'Unknown',
          victim_last_name: 'NoMatch',
          status_update_only: true,
          source_url: 'https://projectcoldcase.org/2018/04/24/arrest-made-in-unknown-nomatch-case/',
        }),
        stats,
      );

      // No new case created — the flag's whole purpose.
      const casesInserts = calls.filter((c) => c.table === 'cases' && c.method === 'insert');
      expect(casesInserts).toHaveLength(0);

      // Counters: seen=1, but neither new nor updated — the record
      // was acknowledged but didn't land anywhere.
      expect(stats.cases_seen).toBe(1);
      expect(stats.cases_new).toBe(0);
      expect(stats.cases_updated).toBe(0);

      // Structured log line gives operators the data to retry.
      const skipLogged = warnSpy.mock.calls.some((args) => {
        const line = String(args[0] ?? '');
        return (
          line.includes('status_update_only') &&
          line.includes('no dedupe match') &&
          line.includes('cleared_arrest')
        );
      });
      expect(skipLogged).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('persistRecord — same-source re-scrape lookup (case_sources)', () => {
  // The same-source path is for the re-scrape identity case: same
  // source + same source_external_id always means same case from
  // that source's POV. Authoritative via the existing unique
  // (source_id, source_external_id) constraint on case_sources.
  // This pins the contract so a future refactor can't silently drop
  // the lookup back into the natural-key dedupe path (which then
  // trips slug uniqueness as a backstop — the production-log noise
  // this fix exists to eliminate).

  it('Prior case_sources row for same (source_id, external_id) → merges directly', async () => {
    const { client, calls } = buildMockSupabase({
      case_sources: {
        // The new same-source maybeSingle() lookup hits this row.
        singleRow: { case_id: 'prior-same-source-case-uuid' },
        // mergeIntoExistingCase later reads case_sources for prior trust weights.
        selectRows: [{ trust_weight: 40 }],
      },
      cases: {
        // mergeIntoExistingCase reads existing case for conflict detection +
        // ensureGeocode reads it again for location_point.
        singleRow: {
          id: 'prior-same-source-case-uuid',
          kind: 'missing',
          victim_first_name: 'Jane',
          victim_last_name: 'Doe',
          victim_age: 23,
          victim_sex: 'female',
          has_photo: false,
          has_sketch: false,
          has_reconstruction: false,
          location_point: null,
        },
      },
    });

    const stats = newStats();
    await persistRecord(baseCtx(client), baseRecord(), stats);

    // No new case insert — the same-source lookup short-circuited
    // ahead of any natural-key dedupe attempt.
    const casesInserts = calls.filter((c) => c.table === 'cases' && c.method === 'insert');
    expect(casesInserts).toHaveLength(0);

    // No dedupe-keys lookup — the same-source path never reaches it.
    // This is the load-bearing assertion: if a future refactor moves
    // the lookup AFTER generateDedupeKeys, this fails.
    const dedupeLookups = calls.filter(
      (c) => c.table === 'case_dedupe_keys' && c.method === 'select',
    );
    expect(dedupeLookups).toHaveLength(0);

    // Merge ran — cases.update with merge-shaped fields (victim_*, narrative).
    const casesUpdates = calls.filter((c) => c.table === 'cases' && c.method === 'update');
    const mergeUpdates = casesUpdates.filter((c) => {
      const arg = c.args[0] as Record<string, unknown>;
      return (
        arg &&
        Object.keys(arg).some(
          (k) => k.startsWith('victim_') || k === 'narrative' || k === 'has_photo',
        )
      );
    });
    expect(mergeUpdates.length).toBeGreaterThanOrEqual(1);

    // Stats: counted as updated, not new.
    expect(stats.cases_updated).toBe(1);
    expect(stats.cases_new).toBe(0);
    expect(stats.cases_seen).toBe(1);
  });

  it('No prior case_sources row → falls through to natural-key dedupe path', async () => {
    // case_sources.singleRow defaults to null → the same-source
    // lookup misses cleanly. Then the existing dedupe-keys path runs
    // and (here) finds nothing → createNewCase fires.
    const { client, calls } = buildMockSupabase({
      case_dedupe_keys: { selectRows: [] }, // no natural-key hit
      cases: {
        insertReturning: { id: 'fresh-case-uuid' },
        singleRow: { id: 'fresh-case-uuid', location_point: null },
      },
    });

    const stats = newStats();
    await persistRecord(baseCtx(client), baseRecord(), stats);

    // Same-source lookup happened (the .select on case_sources before
    // anything else).
    const sameSourceLookups = calls.filter(
      (c) => c.table === 'case_sources' && c.method === 'select',
    );
    expect(sameSourceLookups.length).toBeGreaterThanOrEqual(1);

    // Fell through: dedupe-keys lookup ran AND createNewCase inserted.
    const dedupeLookups = calls.filter(
      (c) => c.table === 'case_dedupe_keys' && c.method === 'select',
    );
    expect(dedupeLookups.length).toBeGreaterThanOrEqual(1);

    const casesInserts = calls.filter((c) => c.table === 'cases' && c.method === 'insert');
    expect(casesInserts).toHaveLength(1);

    expect(stats.cases_new).toBe(1);
    expect(stats.cases_updated).toBe(0);
  });

  it('Empty source_external_id → skips same-source lookup, falls straight through', async () => {
    // Defensive guard: an extractor that emits a record with no
    // external_id (rare; usually a misconfiguration) shouldn't trip
    // a case_sources query that would match every other row with an
    // empty external_id. Skip the same-source path entirely.
    const { client, calls } = buildMockSupabase({
      case_dedupe_keys: { selectRows: [] },
      cases: {
        insertReturning: { id: 'fresh-case-uuid' },
        singleRow: { id: 'fresh-case-uuid', location_point: null },
      },
    });

    const stats = newStats();
    await persistRecord(
      baseCtx(client),
      baseRecord({ source_external_id: '' }),
      stats,
    );

    // No same-source select on case_sources — guarded out.
    // (The case_sources upsert still happens at the tail of createNewCase,
    // so we filter to just .select calls to isolate the lookup.)
    const sameSourceLookups = calls.filter(
      (c) => c.table === 'case_sources' && c.method === 'select',
    );
    expect(sameSourceLookups).toHaveLength(0);

    expect(stats.cases_new).toBe(1);
  });
});

describe('persistRecord — payload_hash short-circuit (steady-state optimization)', () => {
  // When the same source re-scrapes a case it already wrote, and the
  // payload hasn't changed, skip the merge entirely. The merge would
  // be a no-op against unchanged content; the round-trip cost is
  // pure waste in steady-state cron operation. This pins the contract:
  //   - hash matches → bump last_ingested_at, skip everything else
  //   - hash differs → fall through to full merge
  //   - no prior hash → fall through to full merge (covered by the
  //     prior describe block's "merges directly" test)

  // Compute the expected payload hash the way persistRecord computes it.
  async function computePayloadHash(record: CaseRecord): Promise<string> {
    const payloadJson = JSON.stringify({
      ...record,
      photos: record.photos.map((p) => p.url),
    });
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(payloadJson),
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  it('Payload hash matches prior → skips merge, bumps last_ingested_at only', async () => {
    // Persistence layer's job here: read prior payload_hash from
    // case_sources, see it matches, do nothing except bump
    // last_ingested_at on case_sources. No cases.update, no merge,
    // no event upsert, no geocode call, no media work.
    const record = baseRecord();
    const expectedHash = await computePayloadHash(record);

    const { client, calls } = buildMockSupabase({
      case_sources: {
        // Prior row hash matches what THIS scrape will compute.
        singleRow: {
          case_id: 'prior-same-source-case-uuid',
          payload_hash: expectedHash,
        },
      },
    });

    const stats = newStats();
    await persistRecord(baseCtx(client), record, stats);

    // No merge → no cases.update / cases.insert.
    const casesUpdates = calls.filter(
      (c) => c.table === 'cases' && (c.method === 'update' || c.method === 'insert'),
    );
    expect(casesUpdates).toHaveLength(0);

    // No dedupe-keys lookup either — same-source short-circuited
    // before the natural-key path.
    const dedupeLookups = calls.filter(
      (c) => c.table === 'case_dedupe_keys' && c.method === 'select',
    );
    expect(dedupeLookups).toHaveLength(0);

    // No event upsert.
    const eventUpserts = calls.filter(
      (c) => c.table === 'case_events' && c.method === 'upsert',
    );
    expect(eventUpserts).toHaveLength(0);

    // The ONE write that DOES happen: bump case_sources.last_ingested_at.
    const caseSourcesUpdates = calls.filter(
      (c) => c.table === 'case_sources' && c.method === 'update',
    );
    expect(caseSourcesUpdates).toHaveLength(1);
    const updateArg = caseSourcesUpdates[0].args[0] as Record<string, unknown>;
    // The update payload should set last_ingested_at and nothing else
    // — payload_hash, raw_payload, trust_weight all stay put.
    expect(Object.keys(updateArg)).toEqual(['last_ingested_at']);

    // Stats: counted as UNCHANGED (we observed the case but nothing
    // was different). cases_updated stays at zero — that counter now
    // means "fields actually changed and we wrote," not just "we
    // re-observed this case."
    expect(stats.cases_unchanged).toBe(1);
    expect(stats.cases_updated).toBe(0);
    expect(stats.cases_seen).toBe(1);
    expect(stats.cases_new).toBe(0);
  });

  it('Payload hash differs from prior → falls through to merge path', async () => {
    // Prior hash exists but doesn't match the incoming payload —
    // content changed since last scrape (a field updated, an alias
    // added, etc.). Take the full merge path.
    const { client, calls } = buildMockSupabase({
      case_sources: {
        singleRow: {
          case_id: 'prior-same-source-case-uuid',
          payload_hash: 'sha256-from-an-earlier-scrape-that-no-longer-matches',
        },
        selectRows: [{ trust_weight: 40 }],
      },
      cases: {
        singleRow: {
          id: 'prior-same-source-case-uuid',
          kind: 'missing',
          victim_first_name: 'Jane',
          victim_last_name: 'Doe',
          victim_age: 23,
          victim_sex: 'female',
          has_photo: false,
          has_sketch: false,
          has_reconstruction: false,
          location_point: null,
        },
      },
    });

    const stats = newStats();
    await persistRecord(baseCtx(client), baseRecord(), stats);

    // Merge ran — cases.update with merge-shaped fields.
    const casesUpdates = calls.filter((c) => c.table === 'cases' && c.method === 'update');
    const mergeUpdates = casesUpdates.filter((c) => {
      const arg = c.args[0] as Record<string, unknown>;
      return (
        arg &&
        Object.keys(arg).some(
          (k) => k.startsWith('victim_') || k === 'narrative' || k === 'has_photo',
        )
      );
    });
    expect(mergeUpdates.length).toBeGreaterThanOrEqual(1);

    // last_ingested_at-only update should NOT appear (the merge path's
    // upsert handles last_ingested_at as part of its full row).
    const noopBump = casesUpdates.filter((c) => {
      const arg = c.args[0] as Record<string, unknown>;
      return arg && Object.keys(arg).length === 1 && 'last_ingested_at' in arg;
    });
    expect(noopBump).toHaveLength(0);

    expect(stats.cases_updated).toBe(1);
  });
});
