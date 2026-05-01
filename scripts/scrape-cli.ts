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
  dryrun: boolean;
  tick: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryrun: false, tick: false };
  for (const a of argv.slice(2)) {
    if (a === '--dryrun') out.dryrun = true;
    else if (a === '--tick') out.tick = true;
    else if (a.startsWith('--source=')) out.source = a.slice('--source='.length);
    else if (a.startsWith('--limit=')) out.limit = parseInt(a.slice('--limit='.length), 10);
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
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { persistSession: false } },
  );

  const sourceId = await ensureSourceRow(supabase, source);
  const fetcher = new PoliteFetcher(source.rateLimitMs, source.userAgent);
  const stats: RunStats = { cases_seen: 0, cases_new: 0, cases_updated: 0, errors: [] };

  const urls = await discoverDetailUrls(source, fetcher, { detailLimit: args.limit });
  console.log(`[${source.slug}] discovered ${urls.length} detail URLs`);

  for (const u of urls) {
    const out = await extractDetail(source, u, fetcher);
    if ('error' in out) {
      stats.errors.push({ url: u, message: out.error });
      console.warn(`[${source.slug}] ! ${u}: ${out.error}`);
      continue;
    }
    try {
      await persistRecord(
        {
          supabase,
          source,
          sourceId,
          trustWeight: source.trustWeight,
          fetcher,
          mapboxToken: process.env.MAPBOX_ACCESS_TOKEN,
        },
        out,
        stats,
      );
      console.log(
        `[${source.slug}] ✓ ${out.victim_name ?? '<no name>'} (${u}) — ` +
        `seen=${stats.cases_seen} new=${stats.cases_new} upd=${stats.cases_updated}`,
      );
    } catch (err) {
      stats.errors.push({ url: u, message: errMessage(err) });
      console.error(`[${source.slug}] persist error: ${errMessage(err)}`);
    }
  }

  console.log(`\n[${source.slug}] done — seen=${stats.cases_seen} new=${stats.cases_new} upd=${stats.cases_updated} errors=${stats.errors.length}`);
}

async function runTick() {
  // Local --tick: walk every active source from the registry, run if due.
  // The Edge Function ingest-tick is the real production cron; this is for dev.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { persistSession: false } },
  );

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
