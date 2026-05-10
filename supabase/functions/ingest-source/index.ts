// Edge Function: ingest-source
//   Single runner. Takes ?source=<slug>. Discovers list pages, extracts each detail,
//   resolves dedupe, persists to cases + case_sources + case_dedupe_keys.
//
// Cron path: ingest-tick fans out to this function for each due source.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { discoverDetailUrls, extractDetail } from '../_shared/pipeline.ts';
import { PoliteFetcher, fetchRobots, isAllowed } from '../_shared/http.ts';
import { ensureSourceRow, persistRecord } from '../_shared/persist.ts';
import { internalError } from '../_shared/responses.ts';
import type { RunStats } from '../_shared/types.ts';
import { SOURCE_BY_SLUG } from '../../../sources/index.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get('source');
  const limitParam = url.searchParams.get('limit');
  const detailLimit = limitParam ? parseInt(limitParam, 10) : undefined;

  if (!slug) {
    return json({ error: 'missing ?source=<slug>' }, 400);
  }

  const source = SOURCE_BY_SLUG[slug];
  if (!source) {
    return json({ error: `unknown source: ${slug}` }, 404);
  }

  // Auth: allow service-role bearer, or the cron-shared INGEST_TICK_SECRET.
  const authz = req.headers.get('authorization') ?? '';
  const tickSecret = req.headers.get('x-ingest-tick-secret');
  const expectedSecret = Deno.env.get('INGEST_TICK_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const bearerOk = !!serviceKey && authz === `Bearer ${serviceKey}`;
  const tickOk = !!expectedSecret && tickSecret === expectedSecret;
  if (!bearerOk && !tickOk) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const sourceId = await ensureSourceRow(supabase, source);

  // Open a source_runs row.
  const { data: runRow, error: runErr } = await supabase
    .from('source_runs')
    .insert({ source_id: sourceId, status: 'running' })
    .select('id')
    .single();
  if (runErr) return internalError(req, runErr, 'ingest-source.source_runs.insert');
  const runId = runRow.id as string;

  const stats: RunStats = { cases_seen: 0, cases_new: 0, cases_updated: 0, errors: [] };
  const fetcher = new PoliteFetcher(source.rateLimitMs, source.userAgent);

  try {
    const robots = await fetchRobots(fetcher, source.baseUrl, source.userAgent);
    const urls = await discoverDetailUrls(source, fetcher, { detailLimit });

    for (const detailUrl of urls) {
      const path = new URL(detailUrl).pathname;
      if (!isAllowed(robots, path)) continue;

      const out = await extractDetail(source, detailUrl, fetcher);
      if ('error' in out) {
        stats.errors.push({ url: detailUrl, message: out.error });
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
            mapboxToken: Deno.env.get('MAPBOX_ACCESS_TOKEN') ?? undefined,
            // Kill-switch: DEDUPE_TIER3_TO_REVIEW=false reverts to the old
            // auto-merge path for Tier-3 candidates. Default on. Set as a
            // function secret in Supabase Dashboard if you need to flip
            // without a redeploy.
            tier3ToReview: Deno.env.get('DEDUPE_TIER3_TO_REVIEW') !== 'false',
          },
          out,
          stats,
        );
      } catch (err) {
        stats.errors.push({ url: detailUrl, message: errMessage(err) });
      }
    }

    await supabase
      .from('source_runs')
      .update({
        status: 'success',
        finished_at: new Date().toISOString(),
        cases_seen: stats.cases_seen,
        cases_new: stats.cases_new,
        cases_updated: stats.cases_updated,
        errors: stats.errors.length ? stats.errors : null,
      })
      .eq('id', runId);

    await supabase
      .from('sources')
      .update({
        next_run_at: nextRunFromCron(source.scheduleCron),
        last_status: 'success',
      })
      .eq('id', sourceId);

    return json({ ok: true, slug, ...stats });
  } catch (err) {
    await supabase
      .from('source_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        errors: [{ url: 'pipeline', message: errMessage(err) }],
      })
      .eq('id', runId);
    return internalError(req, err, 'ingest-source.pipeline');
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Minimal cron-to-next-run-at calculator. Supports the 5-field standard
 * (minute hour day month weekday) with `*`, exact integers, and `*/N`.
 * Good enough for our scrape cadences. Returns ISO timestamp.
 */
function nextRunFromCron(expr: string): string {
  const [min, hr, dom, mon, dow] = expr.split(' ');
  const now = new Date();
  // Step forward minute-by-minute up to 14 days. Brute-force, plenty fast.
  const cap = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  for (
    const d = new Date(now.getTime() + 60_000);
    d < cap;
    d.setUTCMinutes(d.getUTCMinutes() + 1)
  ) {
    if (
      cronFieldMatches(min, d.getUTCMinutes(), 0, 59) &&
      cronFieldMatches(hr, d.getUTCHours(), 0, 23) &&
      cronFieldMatches(dom, d.getUTCDate(), 1, 31) &&
      cronFieldMatches(mon, d.getUTCMonth() + 1, 1, 12) &&
      cronFieldMatches(dow, d.getUTCDay(), 0, 6)
    ) {
      d.setUTCSeconds(0, 0);
      return d.toISOString();
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && (value - min) % step === 0;
  }
  if (field.includes(',')) {
    return field.split(',').some((f) => cronFieldMatches(f, value, min, max));
  }
  if (field.includes('-')) {
    const [a, b] = field.split('-').map((n) => parseInt(n, 10));
    return value >= a && value <= b;
  }
  return parseInt(field, 10) === value;
}
