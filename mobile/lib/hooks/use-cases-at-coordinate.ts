/**
 * useCasesAtCoordinate — exact-coordinate case query against the
 * cases_at_coordinate() RPC (migration 38).
 *
 * Revived 2026-05-14 for the centroid badge layer rebuild. The badge
 * tap-drill needs the list of cases at a given centroid; this hook
 * fetches them keyed on (lat, lng) returned in the centroid row.
 *
 * Mirrors useCasesInBbox's QueryResult contract and null-skip
 * semantics. Returns CaseRowMapBbox so the CentroidCasesSheet can
 * reuse the existing CaseRow component without per-row adapters.
 *
 * Note: cases_at_coordinate uses exact-equality on the raw
 * location_point coord (mig 38 rationale: round-trips the
 * cases_centroids_in_bbox group-by). Post-mig-54 the centroid RPC
 * groups state-precision rows the same way it groups city-precision
 * rows (by raw location_point), so the same equality match works for
 * state-precision tap-drills too — each state-precision row has the
 * same state-centroid raw coord as its peers.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { CaseKind, CaseRowMapBbox, CaseStatus } from '../types/database';
import type { QueryResult } from '../types/hooks';

interface UseCasesAtCoordinateOptions {
  lat: number | null | undefined;
  lng: number | null | undefined;
  kinds?: CaseKind[] | null;
  status?: CaseStatus[] | null;
  /**
   * Max rows returned. Default 1500 — comfortably above the largest
   * known centroid (LA city pile-up at ~782, California state-
   * precision pile at ~1,340) so a full tap-drill never silently
   * clips. Lower values are safe for callers that know the group is
   * small.
   */
  limit?: number;
}

export function useCasesAtCoordinate({
  lat,
  lng,
  kinds = null,
  status = null,
  limit = 1500,
}: UseCasesAtCoordinateOptions): QueryResult<CaseRowMapBbox[]> {
  const [data, setData] = useState<CaseRowMapBbox[]>([]);
  const [loading, setLoading] = useState<boolean>(
    isSupabaseConfigured() && lat != null && lng != null,
  );
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  const kindsKey = useMemo(() => (kinds ? kinds.join(',') : ''), [kinds]);
  const statusKey = useMemo(() => (status ? status.join(',') : ''), [status]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setData([]);
      setLoading(false);
      return;
    }
    if (lat == null || lng == null) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    supabase
      .rpc('cases_at_coordinate', {
        query_lat: lat,
        query_lng: lng,
        filter_kinds: kinds,
        filter_status: status ?? ['open'],
        result_limit: limit,
      })
      .then(
        ({ data: rows, error: rpcError }) => {
          if (cancelled) return;
          if (rpcError) {
            // Most likely failure: stale PostgREST schema cache before
            // the migration-38 reload. User-facing recovery is a sheet
            // close + retap once schema reloads.
            setError(new Error(rpcError.message));
          } else {
            setData((rows ?? []) as CaseRowMapBbox[]);
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
  }, [lat, lng, kindsKey, statusKey, limit, refreshKey]);

  return {
    data,
    loading,
    error,
    source: isSupabaseConfigured() ? 'live' : 'sample',
    refetch,
  };
}
