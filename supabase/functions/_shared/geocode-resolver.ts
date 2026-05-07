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

/**
 * Cache TTL — how long a geocode_cache row is considered fresh before
 * the resolver re-runs Mapbox to potentially refresh it.
 *
 * Why a TTL exists at all: Mapbox's geocoder evolves. An address that
 * fell back to a city centroid two years ago might resolve to a real
 * street point today as Mapbox's coverage improves. A cache without
 * TTL bakes the worst-case-of-its-time result in forever, which means
 * yesterday's wrong pin stays wrong even after the fix would land.
 *
 * 90 days for positive hits — most addresses don't drift, but the
 * window is short enough that a quarterly cron picks up real
 * geocoder improvements within a quarter or two of when they ship.
 *
 * 30 days for negative hits — when Mapbox returned nothing, that's
 * often a parser/typo issue that gets fixed faster than addresses
 * change, and the cost of a re-attempt is one extra Mapbox call per
 * stale row.
 *
 * Both configurable here without a migration.
 */
const CACHE_TTL_POSITIVE_DAYS = 90;
const CACHE_TTL_NEGATIVE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isCacheFresh(cachedAt: string | null | undefined, ttlDays: number): boolean {
  if (!cachedAt) return false;
  const ts = Date.parse(cachedAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < ttlDays * MS_PER_DAY;
}

export async function resolveGeocode(
  ctx: ResolverCtx,
  rawQuery: string,
): Promise<GeocodeResult | undefined> {
  const q = normalizeQuery(rawQuery);
  if (!q) return undefined;

  // Read-through cache — pull explicit lat/lng + cached_at so we can
  // honor the TTL without decoding PostGIS binary.
  const { data: cached } = await ctx.supabase
    .from('geocode_cache')
    .select('lat, lng, precision, raw, cached_at')
    .eq('query_normalized', q)
    .maybeSingle();

  if (cached) {
    const isPositive = cached.lat != null && cached.lng != null;
    const ttlDays = isPositive ? CACHE_TTL_POSITIVE_DAYS : CACHE_TTL_NEGATIVE_DAYS;
    if (isCacheFresh(cached.cached_at, ttlDays)) {
      if (isPositive) {
        return {
          lat: cached.lat,
          lng: cached.lng,
          precision: (cached.precision ?? 'unknown') as GeocodeResult['precision'],
          raw: cached.raw,
        };
      }
      // Fresh negative hit — Mapbox returned nothing for this query
      // recently, no point re-asking yet.
      return undefined;
    }
    // Stale cache — fall through to the Mapbox path below. The
    // upsert at the bottom overwrites the row (cached_at refreshes
    // via the column default on update? no — default only fires on
    // INSERT. The upsert below explicitly sets the new row, which
    // for upsert-on-conflict does an UPDATE; cached_at will stay
    // stale unless we set it explicitly. Set it on the write so a
    // refreshed lookup correctly resets the TTL clock.
  }

  // Miss → Mapbox.
  let result: GeocodeResult | undefined;
  try {
    result = await mapboxGeocode(q, ctx.mapboxToken);
  } catch {
    return undefined;
  }
  // cached_at is set explicitly on every write because Postgres
  // column defaults only fire on INSERT — on the UPDATE half of an
  // ON CONFLICT, cached_at would otherwise stay at the original
  // INSERT timestamp and the TTL would never refresh.
  const nowIso = new Date().toISOString();

  if (!result) {
    // Negative cache as 'unknown' to avoid hammering Mapbox on the same garbage input.
    await ctx.supabase
      .from('geocode_cache')
      .upsert(
        {
          query_normalized: q,
          lat: null,
          lng: null,
          point: null,
          precision: 'unknown',
          raw: null,
          cached_at: nowIso,
        },
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
        cached_at: nowIso,
      },
      { onConflict: 'query_normalized' },
    );

  return result;
}

/** Postgres `geography(Point, 4326)` accepts WKT input — cleaner than packing EWKB by hand. */
export function makePointWkt(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}
