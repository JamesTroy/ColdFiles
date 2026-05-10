// State-validation guard for Mapbox geocode results.
//
// Background: pre-mig-46 ingest, the audit (2026-05-10) found ~2.46% of
// city-precision rows had location_point coordinates outside their
// claimed location_state bbox. Class: Mapbox returns a deterministic
// answer for ambiguous queries ("Monroe County" exists in 17 US states;
// without state context Mapbox picks one — often Missouri).
//
// This module wraps a geocode result and verifies that the lat/lng
// falls in the source state's bbox. If not, it triggers ONE retry with
// state-centroid proximity bias. If that retry still misses, it falls
// back to the state centroid with precision='state' (which the map
// renderer filters out — the row is honestly off-map until manual
// review fixes it, rather than displayed in the wrong place).
//
// Failure modes intentionally NOT handled here:
//   - Source-data conflicts where location_state and location_city
//     genuinely disagree (e.g. a case filed under WA with city=
//     "Washington D.C."). The geocoder is correct; the source data is
//     internally inconsistent. The validator drops the row to 'state'
//     precision, which is the best safe outcome given the conflict.
//   - Cases at state borders where the geocoder lands a few hundred
//     meters across the line. The bbox is generous (~0.1° outward) so
//     legitimate edge cases stay valid.

import { mapboxGeocodeWithStateBias, type GeocodeResult } from './geocode.ts';
import {
  STATE_CENTROID,
  inStateBbox,
  isKnownState,
  type StateCode,
} from './state-bbox.ts';

export interface ValidatedGeocode {
  result: GeocodeResult;
  /** Path the validator took to produce `result`:
   *   'passed'    — initial geocode landed in the source state, no retry.
   *   'retried'   — initial mismatch, state-biased retry succeeded.
   *   'fallback'  — both initial and retry mismatched; result is the
   *                 state centroid with precision='state'. Map renderer
   *                 filters these out.
   *   'untouched' — source state is unknown / unrecognized (rare),
   *                 so validation skipped; result is the input as-is. */
  outcome: 'passed' | 'retried' | 'fallback' | 'untouched';
}

/**
 * Validate a geocode result against a source-supplied state. See the
 * module-level header for failure modes.
 *
 * `query` is the same query string that produced `initial`; the
 * retry uses it verbatim with proximity bias added.
 *
 * `mapboxToken` is required for the retry path. If absent and the
 * initial result fails validation, the validator falls back to the
 * state centroid without attempting retry.
 */
export async function validateGeocodeAgainstState(
  initial: GeocodeResult,
  query: string,
  sourceState: string | null | undefined,
  mapboxToken: string | undefined,
): Promise<ValidatedGeocode> {
  // Unknown / missing source state → can't validate. Return as-is.
  if (!isKnownState(sourceState)) {
    return { result: initial, outcome: 'untouched' };
  }

  // Initial result lands in the source state — common case, fast path.
  if (inStateBbox(initial.lat, initial.lng, sourceState)) {
    return { result: initial, outcome: 'passed' };
  }

  // Mismatch. Try a state-biased retry if we have a token.
  if (mapboxToken) {
    let retry: GeocodeResult | undefined;
    try {
      retry = await mapboxGeocodeWithStateBias(query, mapboxToken, sourceState);
    } catch {
      retry = undefined;
    }
    if (retry && inStateBbox(retry.lat, retry.lng, sourceState)) {
      return { result: retry, outcome: 'retried' };
    }
  }

  // Retry failed (no result, errored, or still mismatched). Drop to
  // state-centroid + 'state' precision so the row is off-map rather
  // than displayed in the wrong place.
  return {
    result: stateCentroidFallback(sourceState, initial),
    outcome: 'fallback',
  };
}

function stateCentroidFallback(
  state: StateCode,
  original: GeocodeResult,
): GeocodeResult {
  const centroid = STATE_CENTROID[state];
  return {
    lat: centroid.lat,
    lng: centroid.lng,
    precision: 'state',
    // Preserve the original Mapbox response under a wrapper so future
    // forensics can see what went wrong without a separate log table.
    // location_point ends up at the state centroid; raw says why.
    raw: {
      fallback: 'state-validation-failed',
      sourceState: state,
      original,
    },
  };
}
