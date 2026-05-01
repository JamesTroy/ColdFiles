/**
 * useCaseList — recent / chronological case list for the List tab.
 *
 * Direct table read against `cases` with the public-read RLS policy. Sorted
 * by incident_date desc by default; chronological view will swap that for
 * incident_date asc.
 *
 * Falls back to sample data when Supabase is not configured.
 */

import { useCallback, useEffect, useState } from 'react';

import { SAMPLE_CASES_MAP } from '../sample-data';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { CaseKind, CaseRowMapNear } from '../types/database';

import type { QueryResult } from './use-cases-near';

/**
 * Stable-partition the rows so cases in pinned states sort to the top
 * while preserving the relative order assigned by the SQL ORDER BY (recency
 * or chronological). When pinnedStates is null/empty, returns the input
 * untouched. Pure function — safe to call with any row array shape that
 * has a `location_state` field.
 */
function applyPinnedBias<T extends { location_state: string | null }>(
  rows: T[],
  pinnedStates: string[] | null,
): T[] {
  if (!pinnedStates || pinnedStates.length === 0) return rows;
  const pinnedSet = new Set(pinnedStates.map((c) => c.toUpperCase()));
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const r of rows) {
    if (r.location_state && pinnedSet.has(r.location_state.toUpperCase())) {
      pinned.push(r);
    } else {
      rest.push(r);
    }
  }
  return [...pinned, ...rest];
}

interface UseCaseListOptions {
  /** Default: recent. 'chronological' walks the dataset oldest-first. */
  order?: 'recent' | 'chronological';
  kinds?: CaseKind[] | null;
  state?: string | null;
  /**
   * Optional list of two-letter state codes from useRegionPrefs(). When
   * provided + non-empty, pinned-state cases sort to the top of the result
   * while preserving the underlying recency / chronological order within
   * each group. Cases outside the pinned set are NOT filtered out — pins
   * are a sort bias, not a hide-the-rest gate. See app/region-prefs.tsx
   * for the user-facing copy that load-bears this contract.
   */
  pinnedStates?: string[] | null;
  limit?: number;
}

export function useCaseList({
  order = 'recent',
  kinds = null,
  state = null,
  pinnedStates = null,
  limit = 100,
}: UseCaseListOptions = {}): QueryResult<CaseRowMapNear[]> {
  const [data, setData] = useState<CaseRowMapNear[]>(() =>
    isSupabaseConfigured() ? [] : SAMPLE_CASES_MAP.slice(0, limit),
  );
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured());
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      let rows = SAMPLE_CASES_MAP;
      if (kinds && kinds.length) rows = rows.filter((r) => kinds.includes(r.kind));
      if (state) rows = rows.filter((r) => r.location_state === state);
      const biased = applyPinnedBias(rows, pinnedStates);
      setData(biased.slice(0, limit));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    let query = supabase
      .from('cases')
      .select(
        'id, slug, kind, status, victim_name, victim_age, incident_date, location_text, location_city, location_state, narrative_short, has_photo',
      )
      .is('deleted_at', null)
      .eq('status', 'open')
      .order('incident_date', { ascending: order === 'chronological' })
      .limit(limit);

    if (kinds && kinds.length) query = query.in('kind', kinds);
    if (state) query = query.eq('location_state', state);

    query.then(({ data: rows, error: queryError }) => {
      if (cancelled) return;
      if (queryError) {
        setError(new Error(queryError.message));
        setData([]);
      } else {
        // Backfill fields cases_within_radius would compute but a direct table
        // read doesn't.
        const enriched: CaseRowMapNear[] = (rows ?? []).map((r) => ({
          ...(r as Omit<
            CaseRowMapNear,
            | 'primary_agency_name'
            | 'primary_photo_url'
            | 'distance_miles'
            | 'recency_alpha'
            | 'lat'
            | 'lng'
          >),
          primary_agency_name: null,
          primary_photo_url: null,
          distance_miles: null,
          recency_alpha: null,
          lat: null,
          lng: null,
        }));
        setData(applyPinnedBias(enriched, pinnedStates));
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [order, JSON.stringify(kinds), state, JSON.stringify(pinnedStates), limit, refreshKey]);

  return {
    data,
    loading,
    error,
    source: isSupabaseConfigured() ? 'live' : 'sample',
    refetch,
  };
}
