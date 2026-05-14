/**
 * useCentroidsInBbox — viewport-bounded centroid query against the
 * cases_centroids_in_bbox() RPC (migrations 33 → 35 → 54).
 *
 * Revived for the badge layer rebuild (2026-05-14). Previously
 * retired in commit 4dbd9a5; new design rule per
 * docs/research/centroid-badge-revival-plan.md:
 *
 *   • city-precision case → contributes to a city-centroid badge.
 *   • state-precision case → contributes to a state-centroid badge
 *     (NEW behavior post-mig-54 — state aggregates now flow through).
 *   • address/street → renders as an individual pin (separate hook).
 *
 * Mirrors useCasesInBbox's shape: same QueryResult contract, same
 * bounds-driven re-query + cancel-on-unmount discipline, same
 * stable-key dep pattern. Returns CaseCentroidRow with per-kind
 * breakdown so the badge can tint toward the dominant kind when
 * one is >60% of the total.
 *
 * No filter_kinds parameter forwarded to the RPC: client-side
 * filtering is consistent with how useCasesInBbox is called — the
 * map screen applies kind filters on the rendered set, not at the
 * fetch boundary, so a single bbox change doesn't refetch on every
 * filter toggle.
 */

import { useCallback, useEffect, useState } from 'react';

import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { CaseCentroidRow, CaseStatus } from '../types/database';
import type { QueryResult } from '../types/hooks';

import type { CaseBounds } from './use-cases-in-bbox';

interface UseCentroidsInBboxOptions {
  bounds: CaseBounds | null;
  status?: CaseStatus[] | null;
  /**
   * Threshold for centroid eligibility — RPC default is 1, which
   * surfaces every (city|state) aggregate regardless of count. The
   * badge layer wants this floor: a city with a single city-
   * precision case still earns a badge, because that single case
   * has no more specificity than "this city" — rendering it as an
   * individual pin would imply precision we don't have.
   */
  threshold?: number;
  /**
   * Max number of centroids returned. With state-precision included
   * (mig 54) the upper bound is ~50 states + ~hundreds of cities, so
   * a continental viewport can plausibly hit ~500. Hook default
   * matches the RPC default; callers rendering a full continental
   * view should pass higher headroom.
   */
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
      // Sample-data path: no centroids in dev-without-supabase.
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
        threshold: threshold ?? 1,
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
