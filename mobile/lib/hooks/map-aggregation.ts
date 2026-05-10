/**
 * Pure helper module for the map aggregation schedule. Lives outside
 * use-cases-in-bbox.ts (which pulls in React + react-native) so the
 * vitest config — which runs under node-only and rejects react-native
 * imports — can unit-test the schedule without a separate setup
 * file.
 *
 * The schedule decides which RPC fires (cases_in_bbox vs.
 * cases_grid_in_bbox) for a given Leaflet zoom + what cell size to
 * pass to the grid RPC. It's editorial — tunable per-OTA without a
 * SQL migration since the server function (cases_grid_in_bbox)
 * accepts any cell_size_deg in [0.05, 20.0].
 *
 * Cell sizes roughly halve per zoom step so the on-screen cell
 * density stays stable as the user zooms in.
 */

export type MapAggregation =
  | { mode: 'point' }
  | { mode: 'grid'; cellSizeDeg: number };

/**
 * Threshold zoom at which the renderer flips between server-side
 * grid aggregation (low zoom — too many points to ship cleanly) and
 * point mode (zoom ≥ threshold; bbox-result-size rarely exceeds 500
 * and leaflet.markercluster handles within-screen aggregation).
 */
export const POINT_ZOOM_THRESHOLD = 8;

export function aggregationForZoom(zoom: number): MapAggregation {
  const z = Math.floor(zoom);
  if (z >= POINT_ZOOM_THRESHOLD) return { mode: 'point' };
  if (z >= 7) return { mode: 'grid', cellSizeDeg: 0.5 };
  if (z >= 6) return { mode: 'grid', cellSizeDeg: 1.0 };
  if (z >= 5) return { mode: 'grid', cellSizeDeg: 2.0 };
  return { mode: 'grid', cellSizeDeg: 4.0 };
}
