/**
 * useSourceMix — total cases + per-source row counts for the Me-tab
 * "DATA · SOURCES" card.
 *
 * Trust posture: the card visualizes that the app is wired to real data.
 * Don't editorialize — just numbers + names sorted by count desc.
 *
 * Cache: module-level, 1h freshness window. Source counts change slowly
 * between scrapes so re-fetching on every Me-tab focus is wasteful.
 *
 * Implementation: one SELECT joining `case_sources → sources` and grouping
 * client-side. Avoids an RPC / migration; the row volume is bounded by
 * source count × case-source-fanout, which for v1.0.x is ~10k rows max.
 * If that grows, swap to migrations/11_source_mix_counts_rpc.sql (file
 * shipped, not applied).
 *
 * Per CLAUDE.md: hooks before early returns.
 */

import { useEffect, useState } from 'react';

import { isSupabaseConfigured } from '../supabase';

export interface SourceMixRow {
  slug: string;
  name: string;
  count: number;
}

export interface UseSourceMixResult {
  total: number;
  bySource: SourceMixRow[];
  loading: boolean;
  error: string | null;
}

interface CacheEntry {
  fetchedAt: number;
  total: number;
  bySource: SourceMixRow[];
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

function isFresh(entry: CacheEntry | null): entry is CacheEntry {
  return !!entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function fetchSourceMix(): Promise<CacheEntry> {
  if (isFresh(cache)) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const { getSupabase } = await import('../supabase');
    const supabase = getSupabase();

    // Total — head:true returns no rows, just the count. Fastest path.
    const totalRes = await supabase
      .from('cases')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null);

    const total = totalRes.count ?? 0;

    // Per-source counts. We pull (case_id, source:slug,name) and reduce client-side.
    // Bounded by case_sources row count; for v1.0.x this is small. Swap to RPC
    // if it grows past ~50k.
    const csRes = await supabase
      .from('case_sources')
      .select('case_id, source:sources ( slug, name )');

    if (csRes.error) {
      throw new Error(csRes.error.message);
    }

    const tally = new Map<string, { name: string; count: number }>();
    type Row = { case_id: string; source: { slug: string; name: string } | { slug: string; name: string }[] | null };
    for (const raw of (csRes.data as Row[] | null) ?? []) {
      // Supabase may shape relation as object or array depending on FK config.
      const src = Array.isArray(raw.source) ? raw.source[0] : raw.source;
      if (!src) continue;
      const existing = tally.get(src.slug);
      if (existing) {
        existing.count += 1;
      } else {
        tally.set(src.slug, { name: src.name, count: 1 });
      }
    }

    const bySource: SourceMixRow[] = Array.from(tally.entries())
      .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count);

    const next: CacheEntry = { fetchedAt: Date.now(), total, bySource };
    cache = next;
    return next;
  })();

  try {
    const result = await inflight;
    return result;
  } finally {
    inflight = null;
  }
}

export function useSourceMix(): UseSourceMixResult {
  // Hooks always run — see CLAUDE.md.
  const [state, setState] = useState<UseSourceMixResult>(() =>
    isFresh(cache)
      ? { total: cache.total, bySource: cache.bySource, loading: false, error: null }
      : { total: 0, bySource: [], loading: true, error: null },
  );

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setState({ total: 0, bySource: [], loading: false, error: null });
      return;
    }

    let cancelled = false;

    if (isFresh(cache)) {
      setState({ total: cache.total, bySource: cache.bySource, loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchSourceMix()
      .then((entry) => {
        if (cancelled) return;
        setState({ total: entry.total, bySource: entry.bySource, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load source mix';
        setState({ total: 0, bySource: [], loading: false, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
