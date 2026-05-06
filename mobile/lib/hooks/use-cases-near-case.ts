/**
 * useCasesNearCase — geographic adjacency query for the case-detail
 * "WITHIN N MILES" section. Wraps the cases_near_case RPC (migration 34).
 *
 * Returns CaseRowMapBbox[] — same row shape as cases_in_bbox /
 * cases_in_polygon, with distance_miles populated (undefined elsewhere).
 * The shared shape lets the same <CaseRow> component render rows from
 * any of the three spatial RPCs without conditional branching.
 *
 * Skip-when-null contract: caseId null OR miles null → no query fires,
 * returns empty data. Designer mode falls back to a small filtered slice
 * of SAMPLE_CASES_MAP so the screen renders meaningfully without a
 * Supabase project.
 */

import { useCallback, useEffect, useState } from 'react';

import { SAMPLE_CASES_MAP } from '../sample-data';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { CaseKind, CaseRowMapBbox, CaseStatus } from '../types/database';
import type { QueryResult } from '../types/hooks';

interface UseCasesNearCaseOptions {
  caseId: string | null;
  miles: number;
  kinds?: CaseKind[] | null;
  status?: CaseStatus[] | null;
  limit?: number;
}

export function useCasesNearCase({
  caseId,
  miles,
  kinds = null,
  status = null,
  limit = 200,
}: UseCasesNearCaseOptions): QueryResult<CaseRowMapBbox[]> {
  const [data, setData] = useState<CaseRowMapBbox[]>([]);
  const [loading, setLoading] = useState<boolean>(
    isSupabaseConfigured() && Boolean(caseId),
  );
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!caseId) {
      setData([]);
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured()) {
      // Designer mode — random subset of SAMPLE_CASES_MAP, with a
      // synthetic distance_miles so the bucket-render has something to
      // sort on. Not geographically accurate; just visually populated.
      const matched = SAMPLE_CASES_MAP
        .filter((c) => c.slug !== caseId)
        .slice(0, 8)
        .map((c, i) => ({ ...c, distance_miles: (i + 1) * 2.5 }));
      setData(matched);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    supabase
      .rpc('cases_near_case', {
        subject_case_id: caseId,
        radius_miles: miles,
        filter_kinds: kinds,
        filter_status: status,
        result_limit: limit,
      })
      .then(
        ({ data: rows, error: rpcError }) => {
          if (cancelled) return;
          if (rpcError) {
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
  }, [caseId, miles, JSON.stringify(kinds), JSON.stringify(status), limit, refreshKey]);

  return {
    data,
    loading,
    error,
    source: isSupabaseConfigured() ? 'live' : 'sample',
    refetch,
  };
}
