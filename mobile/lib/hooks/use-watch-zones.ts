/**
 * useWatchZones — server-side polygon subscriptions.
 *
 * Watch zones are saved polygons the user wants to track. Persisted to the
 * `user_watches` table (migration 01) via the create/list/delete RPCs in
 * migration 06. Live with notifications-disabled in v1: the polygons are
 * stored, the cases-inside count is computed, but no push fires when a new
 * case lands inside. Notification wiring is in v1.1 alongside FCM.
 *
 * Auth-gated. Falls through to an empty state in designer mode and when the
 * user is not signed in.
 */

import { useCallback, useEffect, useState } from 'react';

import { getSupabase, isSupabaseConfigured } from '../supabase';

import { useUser } from './use-user';

export interface WatchZone {
  id: string;
  label: string | null;
  /** GeoJSON Polygon — { type: 'Polygon', coordinates: [[ [lng, lat], ... ]] } */
  geojson: GeoJSONPolygon | null;
  notify_new_cases: boolean;
  notify_updates: boolean;
  notify_arrests: boolean;
  cases_inside: number;
  created_at: string;
}

interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export interface NewWatchZone {
  label: string;
  /** Polygon vertices, in lat/lng order. Min 3 vertices, ring auto-closed. */
  vertices: { lat: number; lng: number }[];
  notifyNew?: boolean;
  notifyUpdates?: boolean;
  notifyResolved?: boolean;
}

interface UseWatchZonesResult {
  zones: WatchZone[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  /** Returns the new zone id on success. */
  create: (input: NewWatchZone) => Promise<string>;
  remove: (id: string) => Promise<void>;
}

export function useWatchZones(): UseWatchZonesResult {
  const { user, authAvailable } = useUser();
  const [zones, setZones] = useState<WatchZone[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!authAvailable || !isSupabaseConfigured() || !user) {
      setZones([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    supabase.rpc('list_my_watch_zones').then(
      ({ data, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) {
          setError(new Error(rpcError.message));
          setZones([]);
        } else {
          setZones((data ?? []) as WatchZone[]);
        }
        setLoading(false);
      },
      (err: unknown) => {
        // Network rejection — PostgREST errors are delivered via the
        // success arm; this rejection arm catches the underlying fetch
        // failing.
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [authAvailable, user, refreshKey]);

  const create = useCallback(
    async (input: NewWatchZone): Promise<string> => {
      if (!isSupabaseConfigured()) {
        throw new Error('Supabase not configured');
      }
      if (!user) {
        throw new Error('Sign in to save a watch zone');
      }
      if (input.vertices.length < 3) {
        throw new Error('Need at least 3 vertices');
      }
      const supabase = getSupabase();
      const { data, error: rpcError } = await supabase.rpc('create_watch_zone', {
        p_label: input.label,
        p_vertices_lat: input.vertices.map((v) => v.lat),
        p_vertices_lng: input.vertices.map((v) => v.lng),
        p_notify_new: input.notifyNew ?? true,
        p_notify_updates: input.notifyUpdates ?? true,
        p_notify_resolved: input.notifyResolved ?? true,
      });
      if (rpcError) throw new Error(rpcError.message);
      refetch();
      return data as string;
    },
    [user, refetch],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!isSupabaseConfigured() || !user) return;
      const supabase = getSupabase();
      const { error: rpcError } = await supabase.rpc('delete_watch_zone', { p_id: id });
      if (rpcError) throw new Error(rpcError.message);
      refetch();
    },
    [user, refetch],
  );

  return { zones, loading, error, refetch, create, remove };
}
