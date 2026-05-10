// Edge Function: geocode-pending
//   Backfill worker. Picks up cases that ingested without a location_point
//   (Mapbox down, no token at ingest time, etc.) and resolves them through
//   the cached geocoder. Idempotent — re-running on a fully-geocoded table
//   is a no-op.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { resolveGeocode, makePointWkt } from '../_shared/geocode-resolver.ts';
import { validateGeocodeAgainstState } from '../_shared/geocode-state-validation.ts';

Deno.serve(async (req) => {
  const secret = req.headers.get('x-ingest-tick-secret');
  if (!secret || secret !== Deno.env.get('INGEST_TICK_SECRET')) {
    return json({ error: 'unauthorized' }, 401);
  }

  const mapboxToken = Deno.env.get('MAPBOX_ACCESS_TOKEN');
  if (!mapboxToken) return json({ error: 'MAPBOX_ACCESS_TOKEN missing' }, 500);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') ?? '200', 10);

  const { data: pending } = await supabase
    .from('cases')
    .select('id, location_text, location_city, location_county, location_state')
    .is('location_point', null)
    .is('deleted_at', null)
    .order('first_seen_at', { ascending: false })
    .limit(limit);

  if (!pending || pending.length === 0) return json({ ok: true, scanned: 0, geocoded: 0 });

  let geocoded = 0;
  for (const row of pending) {
    const query =
      row.location_text ??
      [row.location_city, row.location_county, row.location_state].filter(Boolean).join(', ');
    if (!query) continue;

    const result = await resolveGeocode({ supabase, mapboxToken }, query);
    if (!result) continue;

    // State-validation guard. Same shape as persist.ts (PR #97). The
    // backfill query is unstructured ("city, county, state" join);
    // Mapbox can return wrong-state results for ambiguous components.
    // Validator retries with state-centroid bias on mismatch; on
    // retry-fail, falls back to state centroid + precision='state'
    // (which the map filters off — better off-map than wrong-place).
    const validated = await validateGeocodeAgainstState(
      result,
      query,
      row.location_state,
      mapboxToken,
    );
    const final = validated.result;

    await supabase
      .from('cases')
      .update({
        location_point: makePointWkt(final.lng, final.lat),
        location_precision: final.precision,
      })
      .eq('id', row.id);
    geocoded += 1;
  }

  return json({ ok: true, scanned: pending.length, geocoded });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
