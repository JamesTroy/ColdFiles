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

    // 1) The case row + primary agency (single join).
    const caseQuery = supabase
      .from('cases')
      .select(
        '*, primary_agency:agencies!cases_primary_agency_id_fkey ( id, slug, name, short_name, agency_type, state, county, city, phone_tip, tip_url, tip_route_kind, cold_case_url )',
      )
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle();

    caseQuery.then(
      async ({ data: caseRow, error: caseError }) => {
        if (cancelled) return;
        if (caseError) {
          setError(new Error(caseError.message));
          setData(EMPTY);
          setLoading(false);
          return;
        }
        if (!caseRow) {
          setData(EMPTY);
          setLoading(false);
          return;
        }

        const caseId = (caseRow as { id: string }).id;

        try {
          // 2) Sources + 3) Media in parallel.
          const [sourcesResult, mediaResult] = await Promise.all([
            supabase
              .from('case_sources')
              .select(
                'id, case_id, source_id, source_external_id, source_url, trust_weight, last_ingested_at, source:sources ( id, slug, name, kind, base_url, attribution_html )',
              )
              .eq('case_id', caseId)
              // Trust-weight ordering — leftmost chip is the most authoritative source.
              // Tiebreak on last_ingested_at desc per docs/04_DESIGN_SYSTEM.md.
              .order('trust_weight', { ascending: false })
              .order('last_ingested_at', { ascending: false }),
            supabase
              .from('case_media')
              .select(
                'id, case_id, kind, url, source_url, caption, is_primary, display_warning, source_id',
              )
              .eq('case_id', caseId)
              .order('is_primary', { ascending: false }),
          ]);

          if (cancelled) return;
          setData({
            case: caseRow as unknown as CaseRowFull,
            sources: ((sourcesResult.data as unknown as CaseSourceRow[]) ?? []),
            media: ((mediaResult.data as unknown as CaseMediaRow[]) ?? []),
          });
        } catch (err) {
          // Sources/media parallel fetch rejected — keep the case row
          // but surface the partial-load state. Without this catch,
          // loading sticks at true and the screen shows a permanent
          // spinner over the case the user already successfully loaded.
          if (cancelled) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setData({
            case: caseRow as unknown as CaseRowFull,
            sources: [],
            media: [],
          });
        }
        setLoading(false);
      },
      (err: unknown) => {
        // Outer rejection — case lookup itself failed at the network layer.
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
