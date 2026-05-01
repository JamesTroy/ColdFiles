/**
 * useRegionPrefs — device-local store of pinned US state codes.
 *
 * Drives the Region Preferences screen. Pinned states default-filter the
 * list tab and bias "Cases near me" sorting (consumers wire those in). Mirrors
 * the use-saved-cases pattern: in-memory cache + AsyncStorage persistence +
 * subscriber Set so any screen reading prefs re-renders when they change.
 *
 * Codes are two-letter USPS uppercase (see lib/us-states.ts). Default is
 * an empty array — the UI must treat "no pinned states" as "show everything".
 *
 * Per CLAUDE.md: hooks declared before any conditional return.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'cf:region_prefs:v1';

interface RegionPrefs {
  pinnedStates: string[];
}

const DEFAULT_PREFS: RegionPrefs = { pinnedStates: [] };

let cache: RegionPrefs | null = null;
const subscribers = new Set<(prefs: RegionPrefs) => void>();

async function loadPrefs(): Promise<RegionPrefs> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = { ...DEFAULT_PREFS };
    } else {
      const parsed = JSON.parse(raw) as Partial<RegionPrefs>;
      // Defensive normalization — old payloads / malformed JSON shouldn't
      // crash the screen. Coerce to the canonical shape.
      const states = Array.isArray(parsed.pinnedStates)
        ? parsed.pinnedStates
            .filter((c): c is string => typeof c === 'string')
            .map((c) => c.toUpperCase())
        : [];
      cache = { pinnedStates: dedupe(states) };
    }
  } catch {
    cache = { ...DEFAULT_PREFS };
  }
  return cache;
}

async function persistPrefs(next: RegionPrefs): Promise<void> {
  cache = next;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  for (const sub of subscribers) sub(next);
}

function dedupe(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of codes) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

export interface UseRegionPrefsResult {
  pinnedStates: string[];
  /** Add a state code (idempotent — adding an already-pinned code is a no-op). */
  addState: (code: string) => Promise<void>;
  /** Remove a state code (idempotent). */
  removeState: (code: string) => Promise<void>;
  /** Drop all pins. */
  clearStates: () => Promise<void>;
  /**
   * False until the AsyncStorage payload has been read once. Screens should
   * gate render decisions on this so an empty list doesn't flash before the
   * persisted pins land.
   */
  ready: boolean;
}

export function useRegionPrefs(): UseRegionPrefsResult {
  // Hooks first — never gate them on cache state. If the cache is already
  // hot we initialize from it; otherwise the effect below hydrates and
  // subscribes. This is the load-bearing detail per CLAUDE.md hooks-rule.
  const [prefs, setPrefs] = useState<RegionPrefs | null>(cache);

  useEffect(() => {
    let cancelled = false;
    if (!cache) {
      loadPrefs().then((p) => {
        if (!cancelled) setPrefs(p);
      });
    }
    const sub = (p: RegionPrefs) => setPrefs(p);
    subscribers.add(sub);
    return () => {
      cancelled = true;
      subscribers.delete(sub);
    };
  }, []);

  const addState = useCallback(async (code: string) => {
    const upper = code.toUpperCase();
    const current = await loadPrefs();
    if (current.pinnedStates.includes(upper)) return;
    await persistPrefs({ pinnedStates: [...current.pinnedStates, upper] });
  }, []);

  const removeState = useCallback(async (code: string) => {
    const upper = code.toUpperCase();
    const current = await loadPrefs();
    if (!current.pinnedStates.includes(upper)) return;
    await persistPrefs({
      pinnedStates: current.pinnedStates.filter((c) => c !== upper),
    });
  }, []);

  const clearStates = useCallback(async () => {
    const current = await loadPrefs();
    if (current.pinnedStates.length === 0) return;
    await persistPrefs({ pinnedStates: [] });
  }, []);

  return {
    pinnedStates: prefs?.pinnedStates ?? DEFAULT_PREFS.pinnedStates,
    addState,
    removeState,
    clearStates,
    ready: prefs !== null,
  };
}
