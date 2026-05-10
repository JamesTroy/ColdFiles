// Mapbox geocoding with cache-aside through the geocode_cache table.
// The runner is responsible for the DB read/write — this file just normalizes
// the query and returns typed results.

import { snapToBlock } from './normalize.ts';

export interface GeocodeResult {
  lat: number;
  lng: number;
  precision: 'address' | 'street' | 'city' | 'county' | 'state' | 'unknown';
  raw: unknown;
}

/** Produce a stable, normalized cache key from free-text location input. */
export function normalizeQuery(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9, ]/g, '')
    .replace(/\bblock of\b/g, '')
    .replace(/\bnear\b/g, '')
    .trim();
}

/** Hit Mapbox Forward Geocoding API. Caller handles caching + retry. */
export async function mapboxGeocode(
  query: string,
  accessToken: string,
): Promise<GeocodeResult | undefined> {
  if (!accessToken) throw new Error('MAPBOX_ACCESS_TOKEN is required for geocoding');

  // types=poi,poi.landmark were added 2026-05-09 to support LLM-extracted
  // candidates from the location-recovery pipeline (scripts/enrich-
  // locations.ts). Without poi types, "Orlando International Airport,
  // Orlando, FL" returned no features even though Mapbox indexes it as
  // a poi.landmark. The added types are inclusive — sources passing
  // city-only strings ("Belen, NM") still match place/locality as
  // before; the new types only kick in when the query happens to be a
  // landmark name. Risk to existing persist.ts callers: a source-text
  // that happens to match a POI gets address-tier precision instead of
  // 'unknown' — strictly an upgrade, never a degrade.
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${accessToken}&country=us&types=address,street,place,locality,neighborhood,poi,poi.landmark,region,postcode`;

  const res = await fetch(url);
  if (!res.ok) return undefined;
  const json = (await res.json()) as MapboxResponse;

  const top = json.features?.[0];
  if (!top) return undefined;

  const [lng, lat] = top.center;
  const snapped = snapToBlock(lat, lng);

  return {
    lat: snapped.lat,
    lng: snapped.lng,
    precision: mapPrecision(top.place_type?.[0]),
    raw: top,
  };
}

interface MapboxResponse {
  features?: {
    center: [number, number];
    place_type?: string[];
    place_name?: string;
    text?: string;
    properties?: Record<string, unknown>;
  }[];
}

function mapPrecision(placeType?: string): GeocodeResult['precision'] {
  switch (placeType) {
    case 'address':
      return 'address';
    case 'street':
      return 'street';
    // POIs (Orlando International Airport, Walmart, etc.) and named
    // landmarks (Yellowstone National Park, Brooklyn Bridge) are point
    // locations — treat as 'address' precision so the renderer puts
    // them on the map at the precise lat/lng Mapbox returned.
    case 'poi':
    case 'poi.landmark':
      return 'address';
    case 'place':
    case 'locality':
    case 'neighborhood':
      return 'city';
    case 'district':
      return 'county';
    case 'region':
      return 'state';
    default:
      return 'unknown';
  }
}
