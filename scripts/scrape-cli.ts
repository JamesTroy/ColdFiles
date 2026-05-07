#!/usr/bin/env tsx
// Local CLI for the scraper pipeline.
//
//   npm run scrape:dryrun -- --source=charley_project --limit=5
//   npm run scrape         -- --source=charley_project --limit=50
//   npm run scrape:tick    (run every source whose next_run_at is due)
//
// Dryrun does not write to the DB. Real run requires NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY in the env (see .env.example).

import { createClient } from '@supabase/supabase-js';
import {
  discoverDetailUrls,
  extractDetail,
  dryRun,
} from '../supabase/functions/_shared/pipeline.ts';
import { PoliteFetcher } from '../supabase/functions/_shared/http.ts';
import {
  ensureSourceRow,
  persistRecord,
} from '../supabase/functions/_shared/persist.ts';
import { generateDedupeKeys } from '../supabase/functions/_shared/dedupe.ts';
import type { RunStats } from '../supabase/functions/_shared/types.ts';
import { SOURCE_BY_SLUG, getSourceOrThrow } from '../sources/index.ts';

interface Args {
  source?: string;
  limit?: number;
  /**
   * Persist concurrency. Fetches stay serial (PoliteFetcher's lastRequest
   * timestamp isn't lock-protected; parallel fetches would race and break
   * the rate-limit contract per source). The persist phase is 5-10 Supabase
   * round-trips per record — that's where the wall-clock time lives, and
   * those round-trips don't share any rate-limit state, so we can pool
   * them safely. Default 1 preserves the old fully-sequential behavior.
   */
  concurrency: number;
  dryrun: boolean;
  tick: boolean;
}

/**
 * Read the first set + non-whitespace env var from `names`, trimmed.
 * Whitespace-only values resolve to undefined — same posture as missing.
 *
 * Why this exists: GitHub Actions secret entry trims nothing on save, so a
 * pasted value with a stray newline survives into env and then trips
 * supabase-js's URL validator with "Must be a valid HTTP or HTTPS URL"
 * — confusing because the secret IS set. This helper makes whitespace
 * a no-op instead of a silent footgun. Same hazard the
 * `feedback_silent_whitespace_in_config.md` memory pinned for the Vault
 * watch_zone_hit alerts incident — once is enough.
 */
function readEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryrun: false, tick: false, concurrency: 1 };
  for (const a of argv.slice(2)) {
    if (a === '--dryrun') out.dryrun = true;
    else if (a === '--tick') out.tick = true;
    else if (a.startsWith('--source=')) out.source = a.slice('--source='.length);
    else if (a.startsWith('--limit=')) out.limit = parseInt(a.slice('--limit='.length), 10);
    else if (a.startsWith('--concurrency=')) {
      const n = parseInt(a.slice('--concurrency='.length), 10);
      if (Number.isFinite(n) && n > 0) out.concurrency = n;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.tick) return runTick();
  if (!args.source) {
    console.error('error: --source=<slug> required (or pass --tick to run all due sources)');
    console.error(`available sources: ${Object.keys(SOURCE_BY_SLUG).join(', ')}`);
    process.exit(2);
  }

  const source = getSourceOrThrow(args.source);

  if (args.dryrun) {
    console.log(`[${source.slug}] dryrun, limit=${args.limit ?? 'none'}`);
    const result = await dryRun(source, {
      detailLimit: args.limit,
      onProgress: (e) => {
        switch (e.kind) {
          case 'list_page':
            console.log(`[${source.slug}] list page #${e.index}: ${e.url}`);
            break;
          case 'detail_url_queued':
            // muted — too chatty
            break;
          case 'detail_extracted': {
            const r = e.record;
            console.log(
              `[${source.slug}] ${r.victim_name ?? '<no name>'} | ` +
              `age=${r.victim_age ?? '?'} sex=${r.victim_sex ?? '?'} ` +
              `state=${r.location_state ?? '?'} date=${r.incident_date ?? '?'} ` +
              `photos=${r.photos.length} keys=${generateDedupeKeys(r).map((k) => k.type).join(',')}`,
            );
            break;
          }
          case 'extract_error':
            console.warn(`[${source.slug}] error on ${e.url}: ${e.error}`);
            break;
          case 'robots_blocked':
            console.warn(`[${source.slug}] robots blocked: ${e.url}`);
            break;
        }
      },
    });
    console.log(
      `[${source.slug}] dryrun summary: ${result.records_extracted} records / ${result.detail_urls_seen} URLs seen`,
    );
    return;
  }

  // Real run.
  const supabaseUrl = readEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const supabaseKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required (whitespace-only values are treated as missing).',
    );
    process.exit(2);
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const sourceId = await ensureSourceRow(supabase, source);
  const fetcher = new PoliteFetcher(source.rateLimitMs, source.userAgent);
  const stats: RunStats = {
    cases_seen: 0,
    cases_new: 0,
    cases_updated: 0,
    cases_unchanged: 0,
    errors: [],
  };

  const urls = await discoverDetailUrls(source, fetcher, { detailLimit: args.limit });
  console.log(
    `[${source.slug}] discovered ${urls.length} detail URLs · persist concurrency=${args.concurrency}`,
  );

  // Persist pool: a Set of in-flight persist promises, capped at
  // args.concurrency. Fetches remain serial; only persists overlap. We
  // wait via Promise.race when the pool is full so the next fetch can
  // start as soon as ANY persist finishes — overlap fetch+persist time
  // without breaking PoliteFetcher's per-source rate-limit contract.
  const pool: Set<Promise<void>> = new Set();
  const persistCtx = {
    supabase,
    source,
    sourceId,
    trustWeight: source.trustWeight,
    fetcher,
    mapboxToken: readEnv('MAPBOX_ACCESS_TOKEN'),
    // Kill-switch: DEDUPE_TIER3_TO_REVIEW=false reverts to the old
    // auto-merge path for Tier-3 candidates. Default on.
    tier3ToReview: process.env.DEDUPE_TIER3_TO_REVIEW?.trim() !== 'false',
  };

  for (const u of urls) {
    const out = await extractDetail(source, u, fetcher);
    if ('error' in out) {
      stats.errors.push({ url: u, message: out.error });
      console.warn(`[${source.slug}] ! ${u}: ${out.error}`);
      continue;
    }

    while (pool.size >= args.concurrency) {
      await Promise.race(pool);
    }

    const task = (async () => {
      try {
        await persistRecord(persistCtx, out, stats);
        console.log(
          `[${source.slug}] ✓ ${out.victim_name ?? '<no name>'} (${u}) — ` +
            `seen=${stats.cases_seen} new=${stats.cases_new} upd=${stats.cases_updated} unch=${stats.cases_unchanged}`,
        );
      } catch (err) {
        stats.errors.push({ url: u, message: errMessage(err) });
        console.error(`[${source.slug}] persist error: ${errMessage(err)}`);
      }
    })();
    pool.add(task);
    void task.finally(() => pool.delete(task));
  }

  // Drain the pool before reporting final stats so the totals are accurate.
  await Promise.all(pool);

  console.log(
    `\n[${source.slug}] done — seen=${stats.cases_seen} new=${stats.cases_new} ` +
      `upd=${stats.cases_updated} unch=${stats.cases_unchanged} errors=${stats.errors.length}`,
  );
}

async function runTick() {
  // Local --tick: walk every active source from the registry, run if due.
  // The Edge Function ingest-tick is the real production cron; this is for dev.
  const supabaseUrl = readEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const supabaseKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required (whitespace-only values are treated as missing).',
    );
    process.exit(2);
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const { data: due } = await supabase
    .from('sources')
    .select('slug, next_run_at')
    .eq('active', true)
    .lte('next_run_at', new Date().toISOString());

  if (!due || due.length === 0) {
    console.log('no sources due');
    return;
  }

  for (const row of due) {
    const source = SOURCE_BY_SLUG[row.slug];
    if (!source) continue;
    console.log(`[tick] running ${row.slug}`);
    process.argv = [process.argv[0], process.argv[1], `--source=${row.slug}`];
    await main();
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    // Supabase PostgREST errors come back as plain objects {code, message,
    // details, hint}. Bare String(obj) gives "[object Object]"; pull the
    // useful fields out instead.
    const e = err as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint, e.code]
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (parts.length > 0) return parts.join(' · ');
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
