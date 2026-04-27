// Edge Function: photo-cache
//   Backfill worker. Scans recent case_sources rows for photo URLs that haven't
//   been mirrored into Supabase Storage yet, fetches each, dedupes by content
//   hash, inserts case_media. Runs on cron and after large ingest batches.
//
//   Auth: shared INGEST_TICK_SECRET so the same cron infra invokes it.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { backfillPendingPhotos } from '../_shared/media.ts';
import { PoliteFetcher } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const secret = req.headers.get('x-ingest-tick-secret');
  if (!secret || secret !== Deno.env.get('INGEST_TICK_SECRET')) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  // Rate-limit conservatively — we may be hammering many origins at once.
  const fetcher = new PoliteFetcher(2000);

  const url = new URL(req.url);
  const caseLimit = parseInt(url.searchParams.get('limit') ?? '100', 10);

  const result = await backfillPendingPhotos(supabase, fetcher, { caseLimit });
  return json({ ok: true, ...result });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
