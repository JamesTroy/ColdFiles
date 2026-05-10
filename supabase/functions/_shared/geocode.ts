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
  // locations.ts). Mapbox POI coverage is sparse — small businesses
  // ("Banana Boat Lounge"), local landmarks, and even some major
  // institutions (Orlando International Airport doesn't resolve as a
  // poi.landmark) fall through to the place/locality match instead. We
  // include the POI types anyway so the cases that DO match resolve
  // correctly; the orchestrator (extract-location.ts) gates on
  // precision='address'|'street' and rejects place-fallback matches.
  //
  // Forward-geocoding v5 valid types (per Mapbox docs):
  //   country, region, postcode, district, place, locality,
  //   neighborhood, address, poi, poi.landmark
  // 'street' is NOT a valid type for v5 forward geocoding (despite
  // appearing in the precision enum) — including it produces a 422.
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${accessToken}&country=us&types=address,place,locality,neighborhood,poi,poi.landmark,region,postcode`;

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
