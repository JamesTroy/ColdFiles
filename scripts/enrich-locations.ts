#!/usr/bin/env tsx
// Backfill CLI for narrative-based location extraction (Phase 2 of the
// location-recovery project). Runs across the existing city-precision
// (and county-precision, and unknown) cases, calls the LLM extraction
// + Mapbox geocoder, and writes back upgraded location_point /
// location_precision when the extraction is high-confidence and
// resolves to address or street precision.
//
// Resumable via the location_extraction_log table — cases already
// attempted are skipped. Re-run to retry transient failures (errored
// outcomes).
//
// Usage:
//   npm run enrich:dryrun -- --limit=20
//   npm run enrich        -- --limit=200 --concurrency=5
//   npm run enrich        -- --source=charley_project --limit=500
//   npm run enrich        -- --retry-errored
//
// Env requires:
//   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY
//   MAPBOX_ACCESS_TOKEN

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  extractAndUpgradeCase,
  type CaseInput,
  type ExtractionLogEntry,
  type ExtractionOutcome,
} from '../supabase/functions/_shared/extract-location.ts';

interface Args {
  limit: number;
  concurrency: number;
  dryrun: boolean;
  source?: string;
  retryErrored: boolean;
}

function readEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    limit: 50,
    concurrency: 3,
    dryrun: false,
    retryErrored: false,
  };
  for (const a of argv.slice(2)) {
    if (a === '--dryrun') out.dryrun = true;
    else if (a === '--retry-errored') out.retryErrored = true;
    else if (a.startsWith('--source=')) out.source = a.slice('--source='.length);
    else if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice('--limit='.length), 10);
      if (Number.isFinite(n) && n > 0) out.limit = n;
    } else if (a.startsWith('--concurrency=')) {
      const n = parseInt(a.slice('--concurrency='.length), 10);
      if (Number.isFinite(n) && n > 0) out.concurrency = n;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  const supabaseUrl = readEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  const anthropicKey = readEnv('ANTHROPIC_API_KEY');
  const mapboxToken = readEnv('MAPBOX_ACCESS_TOKEN');

  if (!supabaseUrl || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }
  if (!anthropicKey) {
    console.error('ANTHROPIC_API_KEY required');
    process.exit(1);
  }
  if (!mapboxToken) {
    console.error('MAPBOX_ACCESS_TOKEN required');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(
    `[enrich] starting backfill — limit=${args.limit} concurrency=${args.concurrency} dryrun=${args.dryrun} source=${args.source ?? 'all'}`,
  );

  const cases = await fetchUnprocessedCases(supabase, args);
  console.log(`[enrich] queued ${cases.length} cases`);

  if (cases.length === 0) {
    console.log('[enrich] nothing to do');
    return;
  }

  if (args.dryrun) {
    // Dryrun: print the first 3 cases that would be processed,
    // including narrative previews. Don't call the LLM.
    for (const c of cases.slice(0, 3)) {
      console.log(`\n[dryrun] case ${c.id} (${c.location_city}, ${c.location_state})`);
      console.log(`  precision: ${c.location_precision}`);
      console.log(`  agency:    ${c.primary_agency_name_raw ?? '(none)'}`);
      console.log(`  narrative: ${(c.narrative ?? c.narrative_short ?? '').slice(0, 200)}…`);
    }
    console.log(`\n[dryrun] would process ${cases.length} cases`);
    return;
  }

  const tally: Record<ExtractionOutcome, number> = {
    upgraded: 0,
    rejected_no_narrative: 0,
    rejected_no_signal: 0,
    rejected_low_confidence: 0,
    rejected_geocode_imprecise: 0,
    rejected_geocode_failed: 0,
    rejected_already_precise: 0,
    errored: 0,
  };

  const start = Date.now();
  await runWithConcurrency(args.concurrency, cases, async (caseRow) => {
    try {
      const result = await extractAndUpgradeCase(
        {
          supabase,
          anthropicApiKey: anthropicKey,
          mapboxToken,
        },
        caseRow,
      );
      tally[result.outcome] += 1;
      logProgress(caseRow, result, tally);
    } catch (err) {
      tally.errored += 1;
      console.error(
        `[enrich] case ${caseRow.id} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  const elapsedSec = Math.round((Date.now() - start) / 1000);
  console.log(`\n[enrich] done in ${elapsedSec}s`);
  console.log('[enrich] tally:');
  for (const [outcome, count] of Object.entries(tally)) {
    if (count > 0) console.log(`  ${outcome.padEnd(32)} ${count}`);
  }
  const upgradeRate =
    tally.upgraded + tally.rejected_no_narrative + tally.rejected_no_signal +
      tally.rejected_low_confidence + tally.rejected_geocode_imprecise +
      tally.rejected_geocode_failed >
    0
      ? (
          (100 * tally.upgraded) /
          (cases.length - tally.rejected_already_precise - tally.errored)
        ).toFixed(1)
      : 'n/a';
  console.log(`[enrich] upgrade rate (excl. already-precise + errored): ${upgradeRate}%`);
}

/**
 * Pull the next batch of cases that haven't been attempted yet.
 * Filters:
 *   - location_precision NOT in (address, street) — not already precise
 *   - location_precision IS DISTINCT FROM 'state' — state-level cases
 *     don't render on the map regardless, skip them
 *   - location_point IS NOT NULL — has SOMETHING to upgrade from
 *   - deleted_at IS NULL
 *   - case has either narrative >100 chars OR primary_agency_name_raw
 *   - NOT EXISTS in location_extraction_log (unless --retry-errored)
 *
 * Ordered by source priority (charley_project + doe_network_uid have
 * the richest narratives per the Phase 1 audit), then by recency
 * within source. Tunable via --source filter.
 */
async function fetchUnprocessedCases(
  supabase: SupabaseClient,
  args: Args,
): Promise<CaseInput[]> {
  // Two-step query:
  // 1. Pull candidate case IDs that match the precision/narrative filter.
  // 2. Filter out ones that already have a non-errored log entry.
  //
  // Doing this in two queries rather than one big LEFT JOIN keeps the
  // query plan simple and the second filter cheap (the log table is
  // initially empty; grows as the backfill runs).
  const candidateIds = await pullCandidateIds(supabase, args);
  if (candidateIds.length === 0) return [];

  const seen = await pullProcessedIds(supabase, candidateIds, args.retryErrored);
  const unseenIds = candidateIds.filter((id) => !seen.has(id));

  if (unseenIds.length === 0) return [];

  const { data, error } = await supabase
    .from('cases')
    .select(
      'id, narrative, narrative_short, primary_agency_name_raw, location_city, location_state, location_precision',
    )
    .in('id', unseenIds.slice(0, args.limit));
  if (error) throw new Error(`fetch cases failed: ${error.message}`);
  return (data ?? []) as CaseInput[];
}

async function pullCandidateIds(
  supabase: SupabaseClient,
  args: Args,
): Promise<string[]> {
  // Cap at 4× args.limit to leave headroom for already-processed ones
  // we'll filter out in step 2. Worst case we under-fetch and the run
  // gets fewer cases than --limit; the user just runs it again.
  const fetchCap = args.limit * 4;

  let query = supabase
    .from('cases')
    .select('id, location_precision, narrative, primary_agency_name_raw')
    .is('deleted_at', null)
    .not('location_point', 'is', null)
    .neq('location_precision', 'address')
    .neq('location_precision', 'street')
    .neq('location_precision', 'state')
    .limit(fetchCap)
    .order('id', { ascending: true });

  // Source filter: when --source=<slug> is passed, restrict to cases
  // that have an attribution from that source. case_sources is
  // many-to-many so we filter via an `in` on case_id from the join.
  if (args.source) {
    const { data: srcRows, error: srcErr } = await supabase
      .from('sources')
      .select('id')
      .eq('slug', args.source)
      .maybeSingle();
    if (srcErr || !srcRows) {
      throw new Error(`unknown source: ${args.source}`);
    }
    const sourceId = (srcRows as { id: string }).id;
    const { data: csRows, error: csErr } = await supabase
      .from('case_sources')
      .select('case_id')
      .eq('source_id', sourceId)
      .limit(fetchCap);
    if (csErr) throw new Error(`case_sources query failed: ${csErr.message}`);
    const caseIds = (csRows ?? []).map((r) => (r as { case_id: string }).case_id);
    if (caseIds.length === 0) return [];
    query = query.in('id', caseIds);
  }

  const { data, error } = await query;
  if (error) throw new Error(`candidate query failed: ${error.message}`);

  // Filter to cases that have either meaty narrative OR an agency
  // hint. Done client-side because Supabase doesn't expose
  // length(narrative) as a query operator without a custom RPC.
  return (data ?? [])
    .filter((c) => {
      const r = c as Record<string, unknown>;
      const n = typeof r.narrative === 'string' ? r.narrative.length : 0;
      const a = typeof r.primary_agency_name_raw === 'string';
      return n > 100 || a;
    })
    .map((c) => (c as { id: string }).id);
}

async function pullProcessedIds(
  supabase: SupabaseClient,
  candidateIds: string[],
  retryErrored: boolean,
): Promise<Set<string>> {
  const seen = new Set<string>();
  // Page through in chunks of 200 to avoid hitting URL-length caps on
  // the IN-list parameter.
  for (let i = 0; i < candidateIds.length; i += 200) {
    const chunk = candidateIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('location_extraction_log')
      .select('case_id, outcome')
      .in('case_id', chunk);
    if (error) throw new Error(`log query failed: ${error.message}`);
    for (const row of data ?? []) {
      const r = row as { case_id: string; outcome: string };
      if (retryErrored && r.outcome === 'errored') continue;
      seen.add(r.case_id);
    }
  }
  return seen;
}

/**
 * Run a worker pool with bounded concurrency. Order isn't preserved
 * — workers pull the next item off the shared cursor as they finish.
 * Awaits all workers before returning.
 */
async function runWithConcurrency<T>(
  concurrency: number,
  items: T[],
  work: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) return;
          await work(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

/**
 * Per-case progress line. Concise — one line, color-friendly tags
 * via single-letter glyphs.
 */
function logProgress(
  caseRow: CaseInput,
  result: ExtractionLogEntry,
  tally: Record<ExtractionOutcome, number>,
): void {
  const glyph =
    result.outcome === 'upgraded'
      ? '↑'
      : result.outcome === 'errored'
        ? '✗'
        : '·';
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const summary = `${tally.upgraded}↑ / ${total}`;
  const detail =
    result.outcome === 'upgraded'
      ? `${result.geocode_precision} ← "${(result.llm_candidate ?? '').slice(0, 60)}"`
      : result.outcome;
  console.log(
    `${glyph} [${summary.padEnd(12)}] ${caseRow.id.slice(0, 8)} ${detail}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
