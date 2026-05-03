/**
 * useCaseCount — total undeleted-case count across the corpus.
 *
 * Drives the headline "X TRACKED" stat in the map bottom-sheet header.
 * The cold-case category is editorially a corpus-size story, not a
 * velocity story — leading with total cases tracked beats leading with
 * "N new today" because most steady-state ingest is merge-into-existing
 * rows, which would false-zero the velocity headline. See the
 * feedback_ingest_metric_axis memory note for the metric-design context.
 *
 * Implementation: HEAD request with `Prefer: count=exact` so PostgREST
 * returns the count in `Content-Range` without paying the body-fetch
 * cost. Cached at module scope for 5 minutes so the header doesn't
 * re-COUNT on every map tab focus — total moves slowly enough that
 * 5-minute staleness is invisible to users.
 *
 * Designer mode returns the sample-data length so the screen is
 * meaningful without a Supabase project.
 */

import { useEffect, useState } from 'react';

import { SAMPLE_CASES_MAP } from '../sample-data';
import { isSupabaseConfigured } from '../supabase';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedAt = 0;
let cachedTotal: number | null = null;

async function fetchTotal(): Promise<number | null> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/cases?select=id&deleted_at=is.null`,
      {
        method: 'HEAD',
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
          Prefer: 'count=exact',
          Range: '0-0',
        },
      },
    );
    const range = res.headers.get('content-range');
    if (!range) return null;
    const total = parseInt(range.split('/')[1] ?? '', 10);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

export function useCaseCount(): { total: number | null } {
  const [total, setTotal] = useState<number | null>(() =>
    isSupabaseConfigured() ? cachedTotal : SAMPLE_CASES_MAP.length,
  );

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setTotal(SAMPLE_CASES_MAP.length);
      return;
    }
    const fresh = Date.now() - cachedAt < CACHE_TTL_MS;
    if (fresh && cachedTotal != null) {
      setTotal(cachedTotal);
      return;
    }
    let cancelled = false;
    fetchTotal().then((t) => {
      if (cancelled) return;
      if (t != null) {
        cachedTotal = t;
        cachedAt = Date.now();
        setTotal(t);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { total };
}
