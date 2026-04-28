/**
 * useMeCounts — aggregates the device-local counts for the Me tab.
 *
 *   - submittedTips: how many distinct cases the user has tipped on
 *   - savedCases:    how many cases the user has bookmarked
 *
 * Both stores live in AsyncStorage and notify subscribers on change, so the
 * Me tab updates instantly when the user submits a tip or stars a case from
 * elsewhere in the app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const SAVED_KEY = 'cf:saved_cases:v1';
const TIPS_KEY = 'cf:submitted_tips:v1';

interface MeCounts {
  submittedTips: number;
  savedCases: number;
}

const cache: { counts: MeCounts | null } = { counts: null };
const subscribers = new Set<(c: MeCounts) => void>();

async function loadCounts(): Promise<MeCounts> {
  const [savedRaw, tipsRaw] = await Promise.all([
    AsyncStorage.getItem(SAVED_KEY).catch(() => null),
    AsyncStorage.getItem(TIPS_KEY).catch(() => null),
  ]);
  const saved = savedRaw ? safeKeyCount(savedRaw) : 0;
  const tips = tipsRaw ? safeKeyCount(tipsRaw) : 0;
  cache.counts = { submittedTips: tips, savedCases: saved };
  return cache.counts;
}

function safeKeyCount(raw: string): number {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.keys(obj).length;
  } catch {
    return 0;
  }
}

export function useMeCounts(): MeCounts {
  const [counts, setCounts] = useState<MeCounts>(cache.counts ?? { submittedTips: 0, savedCases: 0 });

  useEffect(() => {
    let cancelled = false;

    // Always re-read on mount — the user may have submitted a tip / saved a
    // case in another screen before navigating here.
    loadCounts().then((c) => {
      if (!cancelled) setCounts(c);
    });

    const sub = (c: MeCounts) => setCounts(c);
    subscribers.add(sub);

    return () => {
      cancelled = true;
      subscribers.delete(sub);
    };
  }, []);

  return counts;
}

/**
 * Notify the Me tab to re-read after a tip submission or save toggle. Called
 * from useSubmitTip and the saved-cases store. Cheap broadcast, no fetch on
 * the hot path.
 */
export async function notifyMeCountsChanged(): Promise<void> {
  const fresh = await loadCounts();
  for (const sub of subscribers) sub(fresh);
}
