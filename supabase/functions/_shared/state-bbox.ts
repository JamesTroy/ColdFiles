// State bounding boxes + centroids for the geocode state-validation guard.
//
// Used by persist.ts to verify that a Mapbox geocode result lands in the
// source-supplied location_state. The bbox check catches the dominant
// failure mode of the pre-mig-46 ingest (ambiguous county/city names →
// Mapbox picks the wrong state, e.g. "Monroe County, FL" geocoding to
// central Missouri because Monroe County exists in 17 US states).
//
// Bounds are deliberately generous on the edges — this catches "TX case
// showing in CA" not "this point is 5 km outside the official border."
// Source: USGS state extents, rounded outward by ~0.1°.
//
// Centroids are approximate geographic centers — used as the
// proximity= bias for the state-biased Mapbox retry, AND as the
// fallback location_point when retry fails (with location_precision
// set to 'state', which the map renderer filters out).

export type StateCode =
  | 'AL' | 'AK' | 'AZ' | 'AR' | 'CA' | 'CO' | 'CT' | 'DE' | 'DC' | 'FL'
  | 'GA' | 'HI' | 'ID' | 'IL' | 'IN' | 'IA' | 'KS' | 'KY' | 'LA' | 'ME'
  | 'MD' | 'MA' | 'MI' | 'MN' | 'MS' | 'MO' | 'MT' | 'NE' | 'NV' | 'NH'
  | 'NJ' | 'NM' | 'NY' | 'NC' | 'ND' | 'OH' | 'OK' | 'OR' | 'PA' | 'RI'
  | 'SC' | 'SD' | 'TN' | 'TX' | 'UT' | 'VT' | 'VA' | 'WA' | 'WV' | 'WI' | 'WY';

/** [latMin, latMax, lngMin, lngMax]. Generous outward by ~0.1°. */
export const STATE_BBOX: Record<StateCode, [number, number, number, number]> = {
  AL: [30.1, 35.1, -88.6, -84.8], AK: [51.0, 71.5, -180.0, -129.9],
  AZ: [31.2, 37.1, -114.9, -108.9], AR: [33.0, 36.6, -94.7, -89.6],
  CA: [32.4, 42.1, -124.5, -114.0], CO: [36.9, 41.1, -109.1, -101.9],
  CT: [40.9, 42.1, -73.8, -71.7], DE: [38.4, 39.9, -75.8, -74.9],
  DC: [38.7, 39.0, -77.2, -76.8], FL: [24.4, 31.1, -87.7, -79.9],
  GA: [30.3, 35.1, -85.7, -80.7], HI: [18.7, 22.4, -160.4, -154.7],
  ID: [41.9, 49.1, -117.3, -110.9], IL: [36.9, 42.6, -91.6, -87.4],
  IN: [37.7, 41.9, -88.2, -84.7], IA: [40.3, 43.6, -96.7, -90.0],
  KS: [36.9, 40.1, -102.1, -94.5], KY: [36.4, 39.2, -89.7, -81.9],
  LA: [28.8, 33.1, -94.1, -88.7], ME: [42.9, 47.6, -71.2, -66.8],
  MD: [37.8, 39.8, -79.6, -74.9], MA: [41.1, 42.9, -73.6, -69.8],
  MI: [41.6, 48.4, -90.5, -82.3], MN: [43.4, 49.5, -97.3, -89.4],
  MS: [30.1, 35.1, -91.7, -88.0], MO: [35.9, 40.7, -95.9, -89.0],
  MT: [44.3, 49.1, -116.1, -103.9], NE: [39.9, 43.1, -104.1, -95.2],
  NV: [34.9, 42.1, -120.1, -113.9], NH: [42.6, 45.4, -72.7, -70.5],
  NJ: [38.8, 41.4, -75.6, -73.8], NM: [31.2, 37.1, -109.1, -102.9],
  NY: [40.4, 45.1, -79.8, -71.7], NC: [33.7, 36.7, -84.4, -75.3],
  ND: [45.8, 49.1, -104.1, -96.5], OH: [38.3, 42.1, -84.9, -80.4],
  OK: [33.5, 37.1, -103.1, -94.4], OR: [41.9, 46.4, -124.7, -116.4],
  PA: [39.6, 42.4, -80.6, -74.6], RI: [41.0, 42.1, -71.9, -71.0],
  SC: [31.9, 35.3, -83.5, -78.4], SD: [42.4, 46.0, -104.2, -96.4],
  TN: [34.9, 36.7, -90.4, -81.5], TX: [25.7, 36.6, -106.7, -93.4],
  UT: [36.9, 42.1, -114.1, -108.9], VT: [42.6, 45.1, -73.5, -71.4],
  VA: [36.4, 39.5, -83.7, -75.1], WA: [45.4, 49.1, -124.9, -116.8],
  WV: [37.1, 40.7, -82.7, -77.6], WI: [42.4, 47.1, -92.9, -86.7],
  WY: [40.9, 45.1, -111.1, -103.9],
};

/** Approximate geographic centers. Used for proximity= geocode bias and
 *  the state-precision fallback location_point. */
export const STATE_CENTROID: Record<StateCode, { lat: number; lng: number }> = {
  AL: { lat: 32.78, lng: -86.83 }, AK: { lat: 61.37, lng: -152.40 },
  AZ: { lat: 33.73, lng: -111.43 }, AR: { lat: 34.97, lng: -92.37 },
  CA: { lat: 36.78, lng: -119.42 }, CO: { lat: 39.06, lng: -105.31 },
  CT: { lat: 41.60, lng: -72.74 }, DE: { lat: 38.99, lng: -75.51 },
  DC: { lat: 38.91, lng: -77.02 }, FL: { lat: 27.66, lng: -81.52 },
  GA: { lat: 33.04, lng: -83.64 }, HI: { lat: 21.09, lng: -157.50 },
  ID: { lat: 44.24, lng: -114.48 }, IL: { lat: 40.35, lng: -88.99 },
  IN: { lat: 39.85, lng: -86.26 }, IA: { lat: 42.01, lng: -93.21 },
  KS: { lat: 38.50, lng: -98.38 }, KY: { lat: 37.67, lng: -84.67 },
  LA: { lat: 31.17, lng: -91.87 }, ME: { lat: 44.69, lng: -69.38 },
  MD: { lat: 39.06, lng: -76.80 }, MA: { lat: 42.23, lng: -71.53 },
  MI: { lat: 43.33, lng: -84.54 }, MN: { lat: 45.69, lng: -93.90 },
  MS: { lat: 32.74, lng: -89.68 }, MO: { lat: 38.46, lng: -92.29 },
  MT: { lat: 46.92, lng: -110.45 }, NE: { lat: 41.13, lng: -98.27 },
  NV: { lat: 38.31, lng: -117.06 }, NH: { lat: 43.45, lng: -71.56 },
  NJ: { lat: 40.30, lng: -74.52 }, NM: { lat: 34.84, lng: -106.25 },
  NY: { lat: 42.17, lng: -74.95 }, NC: { lat: 35.63, lng: -79.81 },
  ND: { lat: 47.53, lng: -99.78 }, OH: { lat: 40.39, lng: -82.76 },
  OK: { lat: 35.57, lng: -96.93 }, OR: { lat: 44.57, lng: -122.07 },
  PA: { lat: 40.59, lng: -77.21 }, RI: { lat: 41.68, lng: -71.51 },
  SC: { lat: 33.86, lng: -80.95 }, SD: { lat: 44.30, lng: -99.44 },
  TN: { lat: 35.75, lng: -86.69 }, TX: { lat: 31.05, lng: -97.56 },
  UT: { lat: 40.15, lng: -111.86 }, VT: { lat: 44.04, lng: -72.71 },
  VA: { lat: 37.77, lng: -78.17 }, WA: { lat: 47.40, lng: -121.49 },
  WV: { lat: 38.49, lng: -80.95 }, WI: { lat: 44.27, lng: -89.62 },
  WY: { lat: 42.76, lng: -107.30 },
};

/** True if (lat, lng) falls within `state`'s bbox. False if `state` is
 *  not a recognized US state code (defensive — callers pass arbitrary
 *  source-supplied strings). */
export function inStateBbox(lat: number, lng: number, state: string): boolean {
  const bbox = STATE_BBOX[state as StateCode];
  if (!bbox) return false;
  const [latMin, latMax, lngMin, lngMax] = bbox;
  return lat >= latMin && lat <= latMax && lng >= lngMin && lng <= lngMax;
}

/** True if `state` is a recognized US state / DC code. Used to gate
 *  the validation path so unrecognized state codes don't trigger
 *  fallback rewrites. */
export function isKnownState(state: string | null | undefined): state is StateCode {
  return state != null && state in STATE_BBOX;
}
