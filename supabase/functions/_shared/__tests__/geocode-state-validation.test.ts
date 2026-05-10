import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  validateGeocodeAgainstState,
} from '../geocode-state-validation.ts';
import { STATE_CENTROID } from '../state-bbox.ts';
import type { GeocodeResult } from '../geocode.ts';

// Stub global fetch so the retry path is exercised without a real
// Mapbox call. Each test that needs the retry sets `mockFetch` to
// the response shape the test expects.
let mockFetch: ((url: string) => Promise<Response>) | undefined;

beforeEach(() => {
  mockFetch = undefined;
  vi.stubGlobal(
    'fetch',
    async (url: string | URL): Promise<Response> => {
      if (!mockFetch) {
        throw new Error(`unexpected fetch in test: ${url}`);
      }
      return mockFetch(typeof url === 'string' ? url : url.toString());
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function mapboxFeatureResponse(lat: number, lng: number, placeType = 'place'): Response {
  return new Response(
    JSON.stringify({
      features: [
        {
          center: [lng, lat],
          place_type: [placeType],
          place_name: 'mocked',
          text: 'mocked',
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('validateGeocodeAgainstState', () => {
  it('passes through when initial result is in source state', async () => {
    const initial: GeocodeResult = {
      lat: 28.54, lng: -81.38, precision: 'city', raw: {}, // Orlando, FL
    };
    const out = await validateGeocodeAgainstState(initial, 'orlando fl', 'FL', 'tok');
    expect(out.outcome).toBe('passed');
    expect(out.result).toBe(initial);
  });

  it('triggers retry with state bias when initial misses, accepts retry if it matches', async () => {
    // Initial result: Monroe County FL → Mapbox returns central MO
    // (unbiased deterministic failure).
    const initial: GeocodeResult = {
      lat: 39.493, lng: -91.787, precision: 'city', raw: { unbiased: true },
    };
    // Retry mock: returns a point in FL (Monroe County FL is at ~24.7, -81.0)
    mockFetch = async (url: string) => {
      expect(url).toContain('proximity=');
      return mapboxFeatureResponse(24.75, -81.0, 'district');
    };
    const out = await validateGeocodeAgainstState(
      initial,
      'monroe county fl',
      'FL',
      'tok',
    );
    expect(out.outcome).toBe('retried');
    expect(out.result.lat).toBeCloseTo(24.75, 1);
    expect(out.result.lng).toBeCloseTo(-81.0, 1);
  });

  it('falls back to state centroid + precision=state when retry also misses', async () => {
    // Initial result lands in MO (wrong)
    const initial: GeocodeResult = {
      lat: 39.493, lng: -91.787, precision: 'city', raw: {},
    };
    // Retry STILL returns a point outside FL — simulating Mapbox having no
    // FL match for the query at all.
    mockFetch = async () => mapboxFeatureResponse(40.0, -90.0, 'place');
    const out = await validateGeocodeAgainstState(
      initial,
      'unresolvable fl',
      'FL',
      'tok',
    );
    expect(out.outcome).toBe('fallback');
    expect(out.result.precision).toBe('state');
    expect(out.result.lat).toBeCloseTo(STATE_CENTROID.FL.lat, 2);
    expect(out.result.lng).toBeCloseTo(STATE_CENTROID.FL.lng, 2);
    // Forensic raw shape: original result preserved under fallback wrapper
    const raw = out.result.raw as { fallback: string; sourceState: string; original: GeocodeResult };
    expect(raw.fallback).toBe('state-validation-failed');
    expect(raw.sourceState).toBe('FL');
    expect(raw.original).toBe(initial);
  });

  it('falls back when mapboxToken is absent (no retry possible)', async () => {
    const initial: GeocodeResult = {
      lat: 39.493, lng: -91.787, precision: 'city', raw: {},
    };
    const out = await validateGeocodeAgainstState(initial, 'q', 'FL', undefined);
    expect(out.outcome).toBe('fallback');
    expect(out.result.precision).toBe('state');
  });

  it('falls back when retry throws (network error)', async () => {
    const initial: GeocodeResult = {
      lat: 39.493, lng: -91.787, precision: 'city', raw: {},
    };
    mockFetch = async () => { throw new Error('network'); };
    const out = await validateGeocodeAgainstState(initial, 'q', 'FL', 'tok');
    expect(out.outcome).toBe('fallback');
  });

  it('returns untouched when source state is missing or unknown', async () => {
    const initial: GeocodeResult = {
      lat: 0, lng: 0, precision: 'city', raw: {},
    };
    expect(
      (await validateGeocodeAgainstState(initial, 'q', null, 'tok')).outcome,
    ).toBe('untouched');
    expect(
      (await validateGeocodeAgainstState(initial, 'q', undefined, 'tok')).outcome,
    ).toBe('untouched');
    expect(
      (await validateGeocodeAgainstState(initial, 'q', 'XX', 'tok')).outcome,
    ).toBe('untouched');
  });

  it('skips retry on Mapbox HTTP error (non-200)', async () => {
    const initial: GeocodeResult = {
      lat: 39.493, lng: -91.787, precision: 'city', raw: {},
    };
    mockFetch = async () => new Response('rate limited', { status: 429 });
    const out = await validateGeocodeAgainstState(initial, 'q', 'FL', 'tok');
    // mapboxGeocodeWithStateBias returns undefined on non-200, so retry
    // is treated as "no result" and we fall back.
    expect(out.outcome).toBe('fallback');
  });
});
