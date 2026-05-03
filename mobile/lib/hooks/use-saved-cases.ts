/**
 * useSavedCases — device-local store of bookmarked case slugs.
 *
 * Drives both the case-detail star button and the Saved tab list. Mirrors the
 * exact pattern in use-submitted-tips: in-memory cache + AsyncStorage persistence
 * + subscriber Set so subscribers re-render in-process when the star is toggled
 * from anywhere in the app (no need to wait for the case-detail to re-mount).
 *
 * When auth lands, a parallel server-side `user_watches` query joins this for
 * cross-device sync. For now device-local is enough — saving a case is a low-
 * stakes per-device action, the same way browser bookmarks live per-browser.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { CaseRowMapNear } from '../types/database';
import { SAMPLE_CASES_MAP } from '../sample-data';
import { isSupabaseConfigured } from '../supabase';

import { notifyMeCountsChanged } from './use-me-counts';

const STORAGE_KEY = 'cf:saved_cases:v1';

interface SavedCase {
  /** The case.slug — also the route parameter. */
  caseSlug: string;
  /** ISO timestamp of when the user saved it. Used to sort the Saved tab. */
  savedAt: string;
}

type Store = Record<string, SavedCase>;

let cache: Store | null = null;
const subscribers = new Set<(store: Store) => void>();

async function loadStore(): Promise<Store> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function persistStore(store: Store): Promise<void> {
  cache = store;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  for (const sub of subscribers) sub(store);
  notifyMeCountsChanged().catch(() => {});
}

/** Hook for the case-detail star button — boolean state for one slug. */
export function useIsSaved(caseSlug: string | undefined): {
  loading: boolean;
  isSaved: boolean;
  toggle: () => Promise<void>;
} {
  const [store, setStore] = useState<Store | null>(cache);

  useEffect(() => {
    let cancelled = false;
    if (!cache) {
      loadStore().then((s) => {
        if (!cancelled) setStore(s);
      });
    }
    const sub = (s: Store) => setStore(s);
    subscribers.add(sub);
    return () => {
      cancelled = true;
      subscribers.delete(sub);
    };
  }, []);

  const isSaved = Boolean(store && caseSlug && store[caseSlug]);

  const toggle = useCallback(async () => {
    if (!caseSlug) return;
    const current = await loadStore();
    if (current[caseSlug]) {
      const { [caseSlug]: _removed, ...rest } = current;
      await persistStore(rest);
    } else {
      await persistStore({
        ...current,
        [caseSlug]: { caseSlug, savedAt: new Date().toISOString() },
      });
    }
  }, [caseSlug]);

  return { loading: store === null, isSaved, toggle };
}

/**
 * Hook for the Saved tab — returns the saved cases hydrated to the same row
 * shape as useCaseList so the Saved tab can render with the existing
 * <CaseListRow>. In live mode, hits Supabase for the row data; in designer
 * mode, looks up sample data.
 */
export function useSavedCases(): {
  loading: boolean;
  rows: CaseRowMapNear[];
  count: number;
} {
  const [store, setStore] = useState<Store | null>(cache);
  const [rows, setRows] = useState<CaseRowMapNear[]>([]);
  const [loading, setLoading] = useState<boolean>(cache === null);

  useEffect(() => {
    let cancelled = false;
    if (!cache) {
      loadStore().then((s) => {
        if (!cancelled) setStore(s);
      });
    }
    const sub = (s: Store) => setStore(s);
    subscribers.add(sub);
    return () => {
      cancelled = true;
      subscribers.delete(sub);
    };
  }, []);

  useEffect(() => {
    if (!store) return;
    const slugs = Object.values(store)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt)) // newest-saved first
      .map((s) => s.caseSlug);

    if (slugs.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured()) {
      // Designer mode — pluck from the sample list. Slugs not in the sample
      // are dropped silently; this is fine because the user can only save
      // cases that exist in the dataset they're looking at.
      const matched = slugs
        .map((slug) => SAMPLE_CASES_MAP.find((c) => c.slug === slug))
        .filter((c): c is CaseRowMapNear => c !== undefined);
      setRows(matched);
      setLoading(false);
      return;
    }

    // Live mode — hydrate from Supabase. Lazy import so the bundle doesn't
    // pull supabase-js for designer-mode-only sessions.
    let cancelled = false;
    setLoading(true);
    import('../supabase').then(
      ({ getSupabase }) => {
        if (cancelled) return;
        const supabase = getSupabase();
        supabase
          .from('cases')
          .select(
            'id, slug, kind, status, victim_name, victim_age, incident_date, location_text, location_city, location_state, narrative_short, has_photo',
          )
          .in('slug', slugs)
          .is('deleted_at', null)
          .then(
            ({ data }) => {
              if (cancelled) return;
              // Preserve the user's saved-order, not the database order.
              const bySlug = new Map(
                (data ?? []).map((r) => [
                  (r as { slug: string }).slug,
                  r as Omit<
                    CaseRowMapNear,
                    | 'primary_agency_name'
                    | 'primary_photo_url'
                    | 'distance_miles'
                    | 'recency_alpha'
                    | 'lat'
                    | 'lng'
                  >,
                ]),
              );
              const ordered = slugs
                .map((slug) => bySlug.get(slug))
                .filter((r) => r != null)
                .map((r) => ({
                  ...r,
                  primary_agency_name: null,
                  primary_photo_url: null,
                  distance_miles: null,
                  recency_alpha: null,
                  lat: null,
                  lng: null,
                })) as CaseRowMapNear[];
              setRows(ordered);
              setLoading(false);
            },
            () => {
              // Inner rejection (network failure on the cases query).
              // Keep prior rows; just clear loading so the spinner doesn't
              // lock the saved-cases screen.
              if (cancelled) return;
              setLoading(false);
            },
          );
      },
      () => {
        // Outer rejection — the dynamic supabase import failed (rare,
        // typically in test or designer-mode lab conditions).
        if (cancelled) return;
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store]);

  return { loading, rows, count: store ? Object.keys(store).length : 0 };
}
