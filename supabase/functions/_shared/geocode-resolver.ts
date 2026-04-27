// Cache-aside geocoding: check geocode_cache first, hit Mapbox on miss, write back.
// Used by the persist path to attach a (snapped) location_point + precision
// to a fresh case row at ingest time. Failures degrade gracefully — the case
// still ingests with a null point, and `geocode-pending` picks it up later.

import type { SupabaseClient } from '@supabase/supabase-js';
import { mapboxGeocode, normalizeQuery, type GeocodeResult } from './geocode.ts';

interface ResolverCtx {
  supabase: SupabaseClient;
  mapboxToken: string;
}

export async function resolveGeocode(
  ctx: ResolverCtx,
  rawQuery: string,
): Promise<GeocodeResult | undefined> {
  const q = normalizeQuery(rawQuery);
  if (!q) return undefined;

  // Read-through cache — pull explicit lat/lng so we don't have to decode PostGIS binary.
  const { data: cached } = await ctx.supabase
    .from('geocode_cache')
    .select('lat, lng, precision, raw')
    .eq('query_normalized', q)
    .maybeSingle();

  if (cached) {
    if (cached.lat != null && cached.lng != null) {
      return {
        lat: cached.lat,
        lng: cached.lng,
        precision: (cached.precision ?? 'unknown') as GeocodeResult['precision'],
        raw: cached.raw,
      };
    }
    // Negative cache hit — we tried this query before and Mapbox returned nothing.
    return undefined;
  }

  // Miss → Mapbox.
  let result: GeocodeResult | undefined;
  try {
    result = await mapboxGeocode(q, ctx.mapboxToken);
  } catch {
    return undefined;
  }
  if (!result) {
    // Negative cache as 'unknown' to avoid hammering Mapbox on the same garbage input.
    await ctx.supabase
      .from('geocode_cache')
      .upsert(
        { query_normalized: q, lat: null, lng: null, point: null, precision: 'unknown', raw: null },
        { onConflict: 'query_normalized' },
      );
    return undefined;
  }

  await ctx.supabase
    .from('geocode_cache')
    .upsert(
      {
        query_normalized: q,
        lat: result.lat,
        lng: result.lng,
        point: makePointWkt(result.lng, result.lat),
        precision: result.precision,
        raw: result.raw,
      },
      { onConflict: 'query_normalized' },
    );

  return result;
}

/** Postgres `geography(Point, 4326)` accepts WKT input — cleaner than packing EWKB by hand. */
export function makePointWkt(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}
