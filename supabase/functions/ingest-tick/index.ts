// Edge Function: ingest-tick
//   Cron entrypoint. Runs hourly. Picks up to N sources whose next_run_at <= now()
//   and dispatches one HTTP call to ingest-source per source.
//   The dispatcher does not await — child functions run independently.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const MAX_CONCURRENT_DISPATCHES = 5;

Deno.serve(async (req) => {
  const tickSecret = req.headers.get('x-ingest-tick-secret');
  const expectedSecret = Deno.env.get('INGEST_TICK_SECRET');
  if (!expectedSecret || tickSecret !== expectedSecret) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: due, error } = await supabase
    .from('sources')
    .select('id, slug, next_run_at')
    .eq('active', true)
    .lte('next_run_at', new Date().toISOString())
    .order('next_run_at', { ascending: true })
    .limit(MAX_CONCURRENT_DISPATCHES);
  if (error) return json({ error: error.message }, 500);

  if (!due || due.length === 0) return json({ ok: true, dispatched: [] });

  const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ingest-source`;
  const dispatched: string[] = [];

  for (const row of due) {
    // Mark as in-flight by bumping next_run_at to "in 1 hour" so a second tick
    // doesn't dispatch the same source. The runner overwrites this with the
    // proper cron-based value on success.
    await supabase
      .from('sources')
      .update({ next_run_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
      .eq('id', row.id);

    // Fire-and-forget dispatch. We intentionally don't await.
    fetch(`${fnUrl}?source=${encodeURIComponent(row.slug)}`, {
      method: 'POST',
      headers: { 'x-ingest-tick-secret': expectedSecret },
    }).catch(() => {/* logged downstream by the runner */});
    dispatched.push(row.slug);
  }

  return json({ ok: true, dispatched });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
