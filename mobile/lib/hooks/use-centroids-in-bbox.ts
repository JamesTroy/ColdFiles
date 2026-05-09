/**
 * useCentroidsInBbox — viewport-bounded centroid query against the
 * cases_centroids_in_bbox() RPC (migration 33).
 *
 * The complement to useCasesInBbox: where cases_in_bbox returns
 * individual rows for unique-or-low-density coordinates, this hook
 * returns the AGGREGATED centroids (>20 cases sharing one lat/lng)
 * that cases_in_bbox excludes via the dense_points filter. The map
 * pairs both: individual pins for cases_in_bbox rows, centroid badges
 * for cases_centroids_in_bbox rows.
 *
 * Shape mirrors useCasesInBbox — same bounds-driven re-query, same
 * cancel-on-unmount discipline, same stable-key dep pattern. Returns
 * CaseCentroidRow with lat/lng/case_count + kind breakdown for tinting.
 *
 * No filter parameter forwarded to the RPC for now (always passes
 * null for filter_kinds). Client-side filtering is consistent with
 * how useCasesInBbox is called from app/(tabs)/index.tsx — the screen
 * applies kind filters on the rendered set, not at the fetch boundary,
 * so a single bbox change doesn't refetch on every filter toggle.
 */

import { useCallback, useEffect, useState } from 'react';

import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { CaseCentroidRow, CaseStatus } from '../types/database';
import type { QueryResult } from '../types/hooks';

import type { CaseBounds } from './use-cases-in-bbox';

interface UseCentroidsInBboxOptions {
  bounds: CaseBounds | null;
  status?: CaseStatus[] | null;
  /** Threshold for centroid eligibility — RPC default is 20. */
  threshold?: number;
  /** Max number of centroids returned. RPC default is 500; the
   *  realistic count for a continental US bbox is well under 100. */
  limit?: number;
}

export function useCentroidsInBbox({
  bounds,
  status = null,
  threshold,
  limit = 500,
}: UseCentroidsInBboxOptions): QueryResult<CaseCentroidRow[]> {
  const [data, setData] = useState<CaseCentroidRow[]>([]);
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured() && !!bounds);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  const statusKey = status ? status.join(',') : '';

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // Sample data path: no centroids in dev-without-supabase. The
      // map renders only individual pins from SAMPLE_CASES_MAP, which
      // is fine — the centroid layer is editorial/aggregation, not
      // load-bearing for sample-mode UX.
      setData([]);
      setLoading(false);
      return;
    }
    if (!bounds) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    supabase
      .rpc('cases_centroids_in_bbox', {
        min_lng: bounds.minLng,
        min_lat: bounds.minLat,
        max_lng: bounds.maxLng,
        max_lat: bounds.maxLat,
        filter_kinds: null,
        filter_status: status ?? ['open'],
        threshold: threshold ?? 20,
        result_limit: limit,
      })
      .then(
        ({ data: rows, error: rpcError }) => {
          if (cancelled) return;
          if (rpcError) {
            // Hold previous centroids on error — same rationale as
            // useCasesInBbox: blanking on transient timeouts gives a
            // worse experience than stale data the user can recover
            // from with a pan/zoom.
            setError(new Error(rpcError.message));
          } else {
            setData((rows ?? []) as CaseCentroidRow[]);
            setError(null);
          }
          setLoading(false);
        },
        (err: unknown) => {
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
    statusKey,
    threshold,
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
