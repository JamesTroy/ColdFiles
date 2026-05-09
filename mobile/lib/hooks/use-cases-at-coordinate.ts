/**
 * useCasesAtCoordinate — exact-coordinate case query against the
 * cases_at_coordinate() RPC (migration 38).
 *
 * Powers the centroid badge tap-drill. When the user taps a centroid
 * on the home map, MapScreen sets {lat, lng} state and the side-list
 * sheet calls this hook to fetch the cases sharing that exact
 * coordinate. The badge's count is derived server-side from the same
 * group-by — the side-list returns one row per case in that group.
 *
 * Mirrors the shape of useCasesInBbox: same QueryResult contract,
 * same null-skip semantics (lat/lng null → no query fires, hold
 * previous data), same kindsKey/statusKey stable-deps pattern.
 *
 * Returns CaseRowMapBbox so the existing CaseRow component renders
 * the side-list rows without a per-row adapter — the cases_at_
 * coordinate RPC is shape-compatible by design (migration 38
 * returns the same column set cases_in_bbox does, plus
 * location_precision per migration 34's pattern).
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
   * Max rows returned. Default 500 — comfortably above the largest
   * known centroid (LA pile-up at 211) so a full tap-drill never
   * silently clips. Lower values are safe for callers that know the
   * group is small.
   */
  limit?: number;
}

export function useCasesAtCoordinate({
  lat,
  lng,
  kinds = null,
  status = null,
  limit = 500,
}: UseCasesAtCoordinateOptions): QueryResult<CaseRowMapBbox[]> {
  const [data, setData] = useState<CaseRowMapBbox[]>([]);
  const [loading, setLoading] = useState<boolean>(
    isSupabaseConfigured() && lat != null && lng != null,
  );
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Stable string keys for the deps array — same pattern as
  // useCasesInBbox. Avoids JSON.stringify(kinds/status) running on
  // every render of every consumer.
  const kindsKey = useMemo(() => (kinds ? kinds.join(',') : ''), [kinds]);
  const statusKey = useMemo(() => (status ? status.join(',') : ''), [status]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // Sample-data path: the centroid layer doesn't render in
      // designer-mode-without-supabase (see useCentroidsInBbox), so
      // this hook should never be reached without live data. Keep
      // the empty-array fallback as a safety net.
      setData([]);
      setLoading(false);
      return;
    }
    // No coordinate yet — sheet is closed. Hold previous data (no
    // flicker if the sheet was just open) and skip the RPC.
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
            // Hold previous data on error — same rationale as
            // useCasesInBbox. The most likely failure mode is a
            // stale PostgREST schema cache before the migration
            // 38 reload (the RPC will 404 with PGRST202 until
            // PostgREST reloads). User-facing recovery is a sheet
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
