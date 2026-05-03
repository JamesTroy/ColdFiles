/**
 * useCasesInBbox — viewport-bounded case query against the cases_in_bbox()
 * RPC.
 *
 * Replaces the radius-based useCasesNear pattern on the home-screen map.
 * The map's onRegionChange fires after each pan/zoom; we plumb the
 * resulting bounding box (minLng/minLat/maxLng/maxLat) into this hook,
 * which re-queries up to `limit` cases inside the new viewport. The user
 * scrolls the map → the list of cases follows.
 *
 * Returns the same row shape as useCasesNear so the existing pin
 * renderer + bottom sheet keep working unchanged.
 *
 * Bounds null → no query fires (first-frame state before the WebView's
 * Leaflet has reported its initial region). The WebView posts an initial
 * `region` message right before `ready` (see leaflet-map.tsx near the
 * bottom of the baked HTML), so bounds populates within the same task
 * tick the WebView mounts in — the null-bounds window is one render long.
 */

import { useCallback, useEffect, useState } from 'react';

import { SAMPLE_CASES_MAP } from '../sample-data';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { CaseKind, CaseRowMapNear, CaseStatus } from '../types/database';
import type { QueryResult } from '../types/hooks';

export interface CaseBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

interface UseCasesInBboxOptions {
  bounds: CaseBounds | null;
  kinds?: CaseKind[] | null;
  status?: CaseStatus[] | null;
  limit?: number;
}

export function useCasesInBbox({
  bounds,
  kinds = null,
  status = null,
  limit = 100,
}: UseCasesInBboxOptions): QueryResult<CaseRowMapNear[]> {
  const [data, setData] = useState<CaseRowMapNear[]>(() =>
    isSupabaseConfigured() ? [] : applySampleFilters(SAMPLE_CASES_MAP, kinds, status),
  );
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured() && !!bounds);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setData(applySampleFilters(SAMPLE_CASES_MAP, kinds, status));
      setLoading(false);
      return;
    }
    // No bounds yet — Leaflet hasn't reported its initial region. Hold the
    // previous data (no flicker on first frame); the next bounds update
    // triggers the actual query.
    if (!bounds) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    supabase
      .rpc('cases_in_bbox', {
        min_lng: bounds.minLng,
        min_lat: bounds.minLat,
        max_lng: bounds.maxLng,
        max_lat: bounds.maxLat,
        filter_kinds: kinds,
        filter_status: status ?? ['open'],
        result_limit: limit,
      })
      .then(({ data: rows, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) {
          // Hold previous data on error rather than blanking the map.
          // The most common failure mode is statement_timeout on very
          // wide bboxes — user has zoomed out beyond what the server
          // can answer in 8s. Replacing pins with [] empties the map;
          // keeping them lets the user pan/zoom back and recover.
          setError(new Error(rpcError.message));
        } else {
          setData((rows ?? []) as CaseRowMapNear[]);
          setError(null);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    bounds?.minLng,
    bounds?.minLat,
    bounds?.maxLng,
    bounds?.maxLat,
    JSON.stringify(kinds),
    JSON.stringify(status),
    limit,
    refreshKey,
  ]);

  return {
    data,
    loading,
    error,
    source: isSupabaseConfigured() ? 'live' : 'sample',
    refetch,
  };
}

function applySampleFilters(
  rows: CaseRowMapNear[],
  kinds: CaseKind[] | null,
  status: CaseStatus[] | null,
): CaseRowMapNear[] {
  return rows.filter((r) => {
    if (kinds && kinds.length && !kinds.includes(r.kind)) return false;
    if (status && status.length && !status.includes(r.status)) return false;
    return true;
  });
}
