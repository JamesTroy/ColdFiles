/**
 * useCaseDetail — slug-keyed case detail query for the case-detail screen.
 *
 * Three reads in parallel: the case row (with the primary agency joined),
 * the per-source provenance rows (with each source joined), and the case_media
 * rows. The screen renders progressively as each settles.
 *
 * Falls back to sample data when Supabase is not configured.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  SAMPLE_CASE_FULL_BY_SLUG,
  SAMPLE_CASE_MEDIA_BY_CASE_ID,
  SAMPLE_CASE_SOURCES_BY_CASE_ID,
} from '../sample-data';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type {
  CaseMediaRow,
  CaseRowFull,
  CaseSourceRow,
} from '../types/database';

import type { QueryResult } from './use-cases-near';

export interface CaseDetailBundle {
  case: CaseRowFull | null;
  sources: CaseSourceRow[];
  media: CaseMediaRow[];
}

const EMPTY: CaseDetailBundle = { case: null, sources: [], media: [] };

export function useCaseDetail(slug: string | undefined): QueryResult<CaseDetailBundle> {
  const [data, setData] = useState<CaseDetailBundle>(() =>
    sampleBundle(slug),
  );
  const [loading, setLoading] = useState<boolean>(
    isSupabaseConfigured() && Boolean(slug),
  );
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!slug) {
      setData(EMPTY);
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured()) {
      setData(sampleBundle(slug));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();

    // Fan all three reads out from `slug` simultaneously. case_sources and
    // case_media reference cases(id), but PostgREST's nested-resource filter
    // lets us drive the join from the parent's slug — saves the case-row RTT
    // that previously serialized in front of the parallel fan-out.
    const caseQuery = supabase
      .from('cases')
      .select(
        '*, primary_agency:agencies!cases_primary_agency_id_fkey ( id, slug, name, short_name, agency_type, state, county, city, phone_tip, tip_url, tip_route_kind, cold_case_url )',
      )
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle();

    const sourcesQuery = supabase
      .from('case_sources')
      .select(
        'id, case_id, source_id, source_external_id, source_url, trust_weight, last_ingested_at, source:sources ( id, slug, name, kind, base_url, attribution_html ), case:cases!inner ( slug )',
      )
      .eq('case.slug', slug)
      // Trust-weight ordering — leftmost chip is the most authoritative source.
      // Tiebreak on last_ingested_at desc per docs/04_DESIGN_SYSTEM.md.
      .order('trust_weight', { ascending: false })
      .order('last_ingested_at', { ascending: false });

    const mediaQuery = supabase
      .from('case_media')
      .select(
        'id, case_id, kind, url, source_url, caption, is_primary, display_warning, source_id, case:cases!inner ( slug )',
      )
      .eq('case.slug', slug)
      .order('is_primary', { ascending: false });

    Promise.all([caseQuery, sourcesQuery, mediaQuery]).then(
      ([caseResult, sourcesResult, mediaResult]) => {
        if (cancelled) return;

        if (caseResult.error) {
          setError(new Error(caseResult.error.message));
          setData(EMPTY);
          setLoading(false);
          return;
        }
        if (!caseResult.data) {
          // Case not found — discard sources/media even if they resolved
          // (they shouldn't have, since the inner join would have produced
          // an empty set, but being explicit is cheap insurance).
          setData(EMPTY);
          setLoading(false);
          return;
        }

        // Sources/media partial-failure: keep the case row, blank the side
        // data, surface the error. Same behavior as the prior sequential
        // implementation, just inline.
        if (sourcesResult.error || mediaResult.error) {
          const err = sourcesResult.error ?? mediaResult.error;
          setError(new Error(err!.message));
          setData({
            case: caseResult.data as unknown as CaseRowFull,
            sources: [],
            media: [],
          });
          setLoading(false);
          return;
        }

        setData({
          case: caseResult.data as unknown as CaseRowFull,
          sources: ((sourcesResult.data as unknown as CaseSourceRow[]) ?? []),
          media: ((mediaResult.data as unknown as CaseMediaRow[]) ?? []),
        });
        setLoading(false);
      },
      (err: unknown) => {
        // Network-level rejection on any of the three; treat as full failure.
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setData(EMPTY);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [slug, refreshKey]);

  return {
    data,
    loading,
    error,
    source: isSupabaseConfigured() ? 'live' : 'sample',
    refetch,
  };
}

function sampleBundle(slug: string | undefined): CaseDetailBundle {
  if (!slug) return EMPTY;
  const caseRow = SAMPLE_CASE_FULL_BY_SLUG[slug] ?? null;
  if (!caseRow) return EMPTY;
  return {
    case: caseRow,
    sources: SAMPLE_CASE_SOURCES_BY_CASE_ID[caseRow.id] ?? [],
    media: SAMPLE_CASE_MEDIA_BY_CASE_ID[caseRow.id] ?? [],
  };
}
