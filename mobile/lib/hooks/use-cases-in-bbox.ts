/**
 * useCasesInBbox — viewport-bounded case query against the cases_in_bbox()
 * RPC.
 *
 * Replaces the radius-based useCasesNear pattern on the home-screen map.
 * The map's onRegionChange fires after each pan/zoom; we plumb the
 * resulting bounding box (minLng/minLat/maxLng/maxLat) into this hook,
 * which re-queries up to `limit` cases inside the new viewport. The user
 * scrolls the map → the list of cases follows.
 *
 * Returns CaseRowMapBbox — the strict-subset row shape produced by the
 * cases_in_bbox RPC (see migration 29 for the column list, including the
 * incident_date/location_city/location_state additions that drive the
 * bottom-sheet kindLine subtitle).
 *
 * Bounds null → no query fires (first-frame state before the WebView's
 * Leaflet has reported its initial region). The WebView posts an initial
 * `region` message right before `ready` (see leaflet-map.tsx near the
 * bottom of the baked HTML), so bounds populates within the same task
 * tick the WebView mounts in — the null-bounds window is one render long.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { SAMPLE_CASES_MAP } from '../sample-data';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { CaseKind, CaseRowMapBbox, CaseStatus } from '../types/database';
import type { QueryResult } from '../types/hooks';

export interface CaseBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

interface UseCasesInBboxOptions {
  bounds: CaseBounds | null;
  kinds?: CaseKind[] | null;
  status?: CaseStatus[] | null;
  limit?: number;
  /**
   * When false, the hook holds its current data and skips the RPC.
   * Used by the home screen to gate the point-mode fetch off when
   * the map is at a low zoom that should call cases_grid_in_bbox
   * instead. Defaults to true so existing consumers (watch zones,
   * search) are unaffected.
   */
  enabled?: boolean;
}

export function useCasesInBbox({
  bounds,
  kinds = null,
  status = null,
  limit = 100,
  enabled = true,
}: UseCasesInBboxOptions): QueryResult<CaseRowMapBbox[]> {
  const [data, setData] = useState<CaseRowMapBbox[]>(() =>
    isSupabaseConfigured() ? [] : applySampleFilters(SAMPLE_CASES_MAP, kinds, status),
  );
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured() && !!bounds && enabled);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Stable string keys for the deps array — avoids JSON.stringify(kinds/status)
  // running on every render of every consumer of this hook.
  const kindsKey = useMemo(() => (kinds ? kinds.join(',') : ''), [kinds]);
  const statusKey = useMemo(() => (status ? status.join(',') : ''), [status]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setData(applySampleFilters(SAMPLE_CASES_MAP, kinds, status));
      setLoading(false);
      return;
    }
    // Disabled (caller is in the other map mode). Hold previous data
    // so flipping back to this hook shows last-known immediately
    // while the next fetch loads.
    if (!enabled) {
      setLoading(false);
      return;
    }
    // No bounds yet — Leaflet hasn't reported its initial region. Hold the
    // previous data (no flicker on first frame); the next bounds update
    // triggers the actual query.
    if (!bounds) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    supabase
      .rpc('cases_in_bbox', {
        min_lng: bounds.minLng,
        min_lat: bounds.minLat,
        max_lng: bounds.maxLng,
        max_lat: bounds.maxLat,
        filter_kinds: kinds,
        filter_status: status ?? ['open'],
        result_limit: limit,
      })
      .then(
        ({ data: rows, error: rpcError }) => {
          if (cancelled) return;
          if (rpcError) {
            // Hold previous data on error rather than blanking the map.
            // The most common failure mode is statement_timeout on very
            // wide bboxes — user has zoomed out beyond what the server
            // can answer in 8s. Replacing pins with [] empties the map;
            // keeping them lets the user pan/zoom back and recover.
            setError(new Error(rpcError.message));
          } else {
            setData((rows ?? []) as CaseRowMapBbox[]);
            setError(null);
          }
          setLoading(false);
        },
        (err: unknown) => {
          // Network-level rejection (DNS, abort, offline). PostgREST
          // errors resolve with { error } via the success arm above;
          // this rejection arm handles the underlying fetch failing.
          // Without it, loading sticks at true and the spinner never
          // clears.
          if (cancelled) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        },
      );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bounds?.minLng,
    bounds?.minLat,
    bounds?.maxLng,
    bounds?.maxLat,
    kindsKey,
    statusKey,
    limit,
    enabled,
    refreshKey,
  ]);

  return {
    data,
    loading,
    error,
    source: isSupabaseConfigured() ? 'live' : 'sample',
    refetch,
  };
}

function applySampleFilters(
  rows: CaseRowMapBbox[],
  kinds: CaseKind[] | null,
  status: CaseStatus[] | null,
): CaseRowMapBbox[] {
  return rows.filter((r) => {
    if (kinds && kinds.length && !kinds.includes(r.kind)) return false;
    if (status && status.length && !status.includes(r.status)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------
// Tile-grid aggregation hook (mig 44 — cases_grid_in_bbox).
//
// At low zoom levels the map renders one badge per grid cell instead
// of one pin per case. This hook calls the server-side aggregation
// RPC and returns one row per cell with case_count + kind composition
// + precision floor + max-recency + modal locale label.
//
// Mode selection lives client-side via aggregationForZoom() — the
// home screen picks which hook fires (this one for grid mode,
// useCasesInBbox for point mode). Both hooks return the same
// QueryResult shape so the orchestrator can swap between them
// cleanly. Renderer-PR consumes `data` from this hook and draws
// cell badges; until then, the hook fires but the result is unused.
// ---------------------------------------------------------------------

export interface CaseGridCell {
  cell_lat: number;
  cell_lng: number;
  case_count: number;
  kinds_homicide: number;
  kinds_missing: number;
  kinds_doe: number;
  precision_floor: 'address' | 'street' | 'city' | 'county' | 'unknown';
  dominant_kind: 'homicide' | 'missing' | 'doe' | 'mixed';
  recency_max: number;
  mode_city: string | null;
  mode_state: string | null;
}

// Schedule lives in map-aggregation.ts — pure-helper file with no
// React imports so vitest (node-only config) can unit-test it
// directly. Re-exported here so existing consumers
// (`from '@/lib/hooks/use-cases-in-bbox'`) keep working unchanged.
export {
  POINT_ZOOM_THRESHOLD,
  aggregationForZoom,
  type MapAggregation,
} from './map-aggregation';

interface UseCellsGridInBboxOptions {
  bounds: CaseBounds | null;
  cellSizeDeg: number;
  kinds?: CaseKind[] | null;
  status?: CaseStatus[] | null;
  limit?: number;
  enabled?: boolean;
}

// Module-level kill switch. If the RPC is missing on the server (a
// fresh OTA shipped against an older Supabase project that doesn't
// have mig 44 yet, or a transient PGRST202), set this once and stop
// firing for the rest of the session — the home-screen orchestrator
// reads it to fall back to point mode at all zooms.
let gridUnavailable = false;
export function isGridUnavailable(): boolean {
  return gridUnavailable;
}

export function useCellsGridInBbox({
  bounds,
  cellSizeDeg,
  kinds = null,
  status = null,
  limit = 2000,
  enabled = true,
}: UseCellsGridInBboxOptions): QueryResult<CaseGridCell[]> {
  const [data, setData] = useState<CaseGridCell[]>([]);
  const [loading, setLoading] = useState<boolean>(
    isSupabaseConfigured() && !!bounds && enabled && !gridUnavailable,
  );
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  const kindsKey = useMemo(() => (kinds ? kinds.join(',') : ''), [kinds]);
  const statusKey = useMemo(() => (status ? status.join(',') : ''), [status]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // No grid RPC sample data; grid mode shows no cells in dev
      // until a real Supabase env is configured. Acceptable — sample
      // mode is for local UI work, not corpus-scale rendering.
      setData([]);
      setLoading(false);
      return;
    }
    if (gridUnavailable || !enabled) {
      setLoading(false);
      return;
    }
    if (!bounds) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    supabase
      .rpc('cases_grid_in_bbox', {
        min_lng: bounds.minLng,
        min_lat: bounds.minLat,
        max_lng: bounds.maxLng,
        max_lat: bounds.maxLat,
        cell_size_deg: cellSizeDeg,
        filter_kinds: kinds,
        filter_status: status ?? ['open'],
        result_limit: limit,
      })
      .then(
        ({ data: rows, error: rpcError }) => {
          if (cancelled) return;
          if (rpcError) {
            // PGRST202 = function not found. Stale OTA on a server
            // without mig 44 — disable grid mode for the rest of
            // the session and let the home screen fall back to
            // point mode.
            const msg = rpcError.message ?? '';
            const code = (rpcError as { code?: string }).code ?? '';
            if (code === 'PGRST202' || msg.includes('not found')) {
              gridUnavailable = true;
            }
            setError(new Error(rpcError.message));
          } else {
            setData((rows ?? []) as CaseGridCell[]);
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
  }, [
    bounds?.minLng,
    bounds?.minLat,
    bounds?.maxLng,
    bounds?.maxLat,
    cellSizeDeg,
    kindsKey,
    statusKey,
    limit,
    enabled,
    refreshKey,
  ]);

  return {
    data,
    loading,
    error,
    source: isSupabaseConfigured() ? 'live' : 'sample',
    refetch,
  };
}
