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
 * Returns CaseRowMapBbox — the strict-subset row shape produced by the
 * cases_in_bbox RPC (see migration 29 for the column list, including the
 * incident_date/location_city/location_state additions that drive the
 * bottom-sheet kindLine subtitle).
 *
 * Bounds null → no query fires (first-frame state before the WebView's
 * Leaflet has reported its initial region). The WebView posts an initial
 * `region` message right before `ready` (see leaflet-map.tsx near the
 * bottom of the baked HTML), so bounds populates within the same task
 * tick the WebView mounts in — the null-bounds window is one render long.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { SAMPLE_CASES_MAP } from '../sample-data';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { CaseKind, CaseRowMapBbox, CaseStatus } from '../types/database';
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
}: UseCasesInBboxOptions): QueryResult<CaseRowMapBbox[]> {
  const [data, setData] = useState<CaseRowMapBbox[]>(() =>
    isSupabaseConfigured() ? [] : applySampleFilters(SAMPLE_CASES_MAP, kinds, status),
  );
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured() && !!bounds);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Stable string keys for the deps array — avoids JSON.stringify(kinds/status)
  // running on every render of every consumer of this hook.
  const kindsKey = useMemo(() => (kinds ? kinds.join(',') : ''), [kinds]);
  const statusKey = useMemo(() => (status ? status.join(',') : ''), [status]);

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
      .then(
        ({ data: rows, error: rpcError }) => {
          if (cancelled) return;
          if (rpcError) {
            // Hold previous data on error rather than blanking the map.
            // The most common failure mode is statement_timeout on very
            // wide bboxes — user has zoomed out beyond what the server
            // can answer in 8s. Replacing pins with [] empties the map;
            // keeping them lets the user pan/zoom back and recover.
            setError(new Error(rpcError.message));
          } else {
            setData((rows ?? []) as CaseRowMapBbox[]);
            setError(null);
          }
          setLoading(false);
        },
        (err: unknown) => {
          // Network-level rejection (DNS, abort, offline). PostgREST
          // errors resolve with { error } via the success arm above;
          // this rejection arm handles the underlying fetch failing.
          // Without it, loading sticks at true and the spinner never
          // clears.
          if (cancelled) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        },
      );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bounds?.minLng,
    bounds?.minLat,
    bounds?.maxLng,
    bounds?.maxLat,
    kindsKey,
    statusKey,
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
  rows: CaseRowMapBbox[],
  kinds: CaseKind[] | null,
  status: CaseStatus[] | null,
): CaseRowMapBbox[] {
  return rows.filter((r) => {
    if (kinds && kinds.length && !kinds.includes(r.kind)) return false;
    if (status && status.length && !status.includes(r.status)) return false;
    return true;
  });
}
