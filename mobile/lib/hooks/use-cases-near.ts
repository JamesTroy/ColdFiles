/**
 * useCasesNear — radius query against the cases_within_radius() RPC.
 *
 * The home-screen map query: "what's near me?". Maps directly to the spatial
 * RPC defined in migrations/01_schema.sql; respects the kind/status filters
 * the user has applied via filter chips.
 *
 * Falls back to sample data when Supabase is not configured (designer mode).
 */

import { useCallback, useEffect, useState } from 'react';

import { SAMPLE_CASES_MAP } from '../sample-data';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { CaseKind, CaseRowMapNear, CaseStatus } from '../types/database';
import type { QueryResult } from '../types/hooks';

// Re-export so consumers that already import { QueryResult } from this file
// keep compiling. Canonical home is lib/types/hooks.ts.
export type { QueryResult } from '../types/hooks';

interface UseCasesNearOptions {
  lat: number;
  lng: number;
  radiusMiles?: number;
  kinds?: CaseKind[] | null;
  status?: CaseStatus[] | null;
  limit?: number;
}

export function useCasesNear({
  lat,
  lng,
  radiusMiles = 25,
  kinds = null,
  status = null,
  limit = 100,
}: UseCasesNearOptions): QueryResult<CaseRowMapNear[]> {
  const [data, setData] = useState<CaseRowMapNear[]>(() =>
    isSupabaseConfigured() ? [] : applySampleFilters(SAMPLE_CASES_MAP, kinds, status),
  );
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured());
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setData(applySampleFilters(SAMPLE_CASES_MAP, kinds, status));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    supabase
      .rpc('cases_within_radius', {
        search_lat: lat,
        search_lng: lng,
        radius_miles: radiusMiles,
        filter_kinds: kinds,
        filter_status: status ?? ['open'],
        result_limit: limit,
      })
      .then(({ data: rows, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) {
          setError(new Error(rpcError.message));
          setData([]);
        } else {
          setData((rows ?? []) as CaseRowMapNear[]);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lat, lng, radiusMiles, JSON.stringify(kinds), JSON.stringify(status), limit, refreshKey]);

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
