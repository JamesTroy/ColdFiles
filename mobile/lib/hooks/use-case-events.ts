/**
 * useCaseEvents — case_events query for the case-detail Timeline section
 * (migration 35).
 *
 * Fetches the public-record events for a single case, joined with
 * `source` so the section can render source-name meta without a follow-
 * up fetch. RLS does the takedown work — the public-read policy already
 * masks per-event takedowns and inherits the case-level soft-delete +
 * takedown predicate.
 *
 * Designer mode (no Supabase configured) returns sample events keyed
 * by case_id from sample-data so the section renders meaningfully off
 * the network.
 */

import { useCallback, useEffect, useState } from 'react';

import { SAMPLE_CASE_EVENTS_BY_CASE_ID } from '../sample-data';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { CaseEventRow } from '../types/database';
import type { QueryResult } from '../types/hooks';

export function useCaseEvents(caseId: string | null | undefined): QueryResult<CaseEventRow[]> {
  const [data, setData] = useState<CaseEventRow[]>(() => sampleEvents(caseId));
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
      setData(sampleEvents(caseId));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    supabase
      .from('case_events')
      .select(
        'id, case_id, event_kind, headline, body, event_at, event_date, event_date_end, event_date_quality, event_date_text, source_url, source_quote, source_id, source:sources ( id, slug, name, kind, base_url, attribution_html )',
      )
      .eq('case_id', caseId)
      // Section renders chronologically (oldest first reads as a story —
      // last seen → spotlight published → status flip). The case_events
      // index is bidirectional so flipping later is cheap.
      .order('event_date', { ascending: true, nullsFirst: false })
      .order('event_at', { ascending: true, nullsFirst: false })
      .then(
        ({ data: rows, error: err }) => {
          if (cancelled) return;
          if (err) {
            setError(new Error(err.message));
            setData([]);
          } else {
            setData(((rows as unknown as CaseEventRow[]) ?? []));
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
  }, [caseId, refreshKey]);

  return {
    data,
    loading,
    error,
    source: isSupabaseConfigured() ? 'live' : 'sample',
    refetch,
  };
}

function sampleEvents(caseId: string | null | undefined): CaseEventRow[] {
  if (!caseId) return [];
  return SAMPLE_CASE_EVENTS_BY_CASE_ID[caseId] ?? [];
}
