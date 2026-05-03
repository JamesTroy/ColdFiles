import { describe, expect, it } from 'vitest';
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

interface TableBehavior {
  /** Rows returned from `.select()`/`.in()` query chains. */
  selectRows?: unknown[];
  /** Single-row result for `.maybeSingle()`/`.single()`. */
  singleRow?: unknown;
  /** Insert-returning row (e.g., `.insert(...).select('id').single()`). */
  insertReturning?: unknown;
}

function buildMockSupabase(behaviors: Record<string, TableBehavior>): {
  client: any;
  calls: ChainCall[];
} {
  const calls: ChainCall[] = [];

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
  };
  return { client, calls };
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
    const { client, calls } = buildMockSupabase({
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
  });
});
