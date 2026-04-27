/**
 * useSubmittedTips — device-local store of cases this user has tipped.
 *
 * Drives the "you submitted a tip on this case" receipt state on the case
 * detail screen. Until auth lands, this is the only signal we have for that
 * receipt — the schema's tip_routings.user_id is null for anonymous tips so
 * we can't query the table to recover the relationship.
 *
 * When auth lands, mark() still writes locally AND we add a parallel server
 * query (`select 1 from tip_routings where case_id = ? and user_id = auth.uid()`)
 * so a user signed in across devices sees the receipt consistently. The local
 * store stays as the latency-zero source of truth for the bottom-bar paint.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'cf:submitted_tips:v1';

interface SubmittedTip {
  caseSlug: string;
  agencyName: string;
  /** ISO timestamp. */
  submittedAt: string;
}

type Store = Record<string, SubmittedTip>;

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
}

/**
 * Hook for the case detail screen — returns the receipt for one case slug.
 * `null` until the local store has loaded; an object once we know.
 */
export function useSubmittedTip(caseSlug: string | undefined): {
  loading: boolean;
  receipt: SubmittedTip | null;
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

  const receipt = store && caseSlug ? store[caseSlug] ?? null : null;
  return { loading: store === null, receipt };
}

/**
 * Mark a case as tipped. Called from useSubmitTip after a successful handoff.
 * Idempotent — re-submitting refreshes submittedAt and agencyName.
 */
export async function markCaseTipped(
  caseSlug: string,
  agencyName: string,
): Promise<void> {
  const store = await loadStore();
  const next: Store = {
    ...store,
    [caseSlug]: {
      caseSlug,
      agencyName,
      submittedAt: new Date().toISOString(),
    },
  };
  await persistStore(next);
}

/** Public for "Clear my tip history" in a future privacy-controls screen. */
export function useClearSubmittedTips(): () => Promise<void> {
  return useCallback(async () => {
    await persistStore({});
  }, []);
}
