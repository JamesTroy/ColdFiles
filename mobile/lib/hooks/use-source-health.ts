/**
 * useSourceHealth — per-source ingest-activity timestamps for the About
 * screen's "Source status" block.
 *
 * The "right axis" for ingest health is `last_ingested_at` (or
 * `last_changed_at` on cases) — bumps on every successful merge, not just
 * inserts. See feedback_ingest_metric_axis memory note for the
 * metric-design context that drove this surface.
 *
 * Per-source rather than corpus-wide: a corpus-wide max collapses sources
 * into one number and hides the "one stalls while others stay green"
 * failure mode the signal is meant to catch.
 *
 * Aggressive caching: the underlying data only changes once per scrape
 * run (sub-hourly at most). Cache at module scope with a 1-hour TTL so
 * About-screen visits don't re-hit the RPC on every navigation.
 */

import { useEffect, useState } from 'react';

import { isSupabaseConfigured } from '../supabase';

export interface SourceHealth {
  source_slug: string;
  source_name: string;
  /** ISO timestamp of the most recent ingest activity for this source. */
  last_checked: string | null;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
let cachedAt = 0;
let cached: SourceHealth[] | null = null;

const SAMPLE_SOURCES: SourceHealth[] = [
  { source_slug: 'charley_project', source_name: 'The Charley Project', last_checked: null },
  { source_slug: 'doe_network', source_name: 'The Doe Network', last_checked: null },
  { source_slug: 'doe_network_uid', source_name: 'The Doe Network — Unidentified', last_checked: null },
  { source_slug: 'project_cold_case', source_name: 'Project: Cold Case', last_checked: null },
];

async function fetchSourceHealth(): Promise<SourceHealth[] | null> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/source_health`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as SourceHealth[];
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

export function useSourceHealth(): {
  sources: SourceHealth[] | null;
  loading: boolean;
} {
  const [sources, setSources] = useState<SourceHealth[] | null>(() =>
    isSupabaseConfigured() ? cached : SAMPLE_SOURCES,
  );
  const [loading, setLoading] = useState<boolean>(
    isSupabaseConfigured() && cached === null,
  );

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setSources(SAMPLE_SOURCES);
      setLoading(false);
      return;
    }
    const fresh = Date.now() - cachedAt < CACHE_TTL_MS;
    if (fresh && cached !== null) {
      setSources(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchSourceHealth().then((rows) => {
      if (cancelled) return;
      if (rows !== null) {
        cached = rows;
        cachedAt = Date.now();
        setSources(rows);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { sources, loading };
}

/**
 * Map a `last_checked` ISO timestamp to a discrete health state. The
 * thresholds are deliberately user-readable (24h / 3d) rather than
 * tuned to scrape-run cadence — users don't know what counts as normal,
 * so the labels need to own the state explicitly. See the architectural
 * conversation that drove this surface for the reasoning.
 */
export type SourceState = 'healthy' | 'slow' | 'stalled' | 'unknown';

export function classifySourceState(lastChecked: string | null): SourceState {
  if (!lastChecked) return 'unknown';
  const t = Date.parse(lastChecked);
  if (Number.isNaN(t)) return 'unknown';
  const ageMs = Date.now() - t;
  if (ageMs < 24 * 60 * 60 * 1000) return 'healthy';
  if (ageMs < 3 * 24 * 60 * 60 * 1000) return 'slow';
  return 'stalled';
}

/** "12h ago", "3d 4h ago", "—" for null. */
export function formatTimeAgo(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const ageSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const days = Math.floor(ageSec / 86400);
  const hours = Math.floor((ageSec % 86400) / 3600);
  const minutes = Math.floor((ageSec % 3600) / 60);
  if (days >= 1 && hours > 0) return `${days}d ${hours}h ago`;
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  if (minutes >= 1) return `${minutes}m ago`;
  return 'just now';
}
