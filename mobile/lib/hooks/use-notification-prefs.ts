/**
 * useNotificationPrefs — device-local toggle store for push categories.
 *
 * Push delivery doesn't ship in v1.0.0 — but the toggles do, so users can
 * dial in their preferences now and have them apply automatically when
 * watch-zone alerts go live in v1.0.1. Persisted to AsyncStorage at a
 * versioned key so a future shape change can migrate cleanly.
 *
 * `ready` is gated on the initial AsyncStorage read. The screen waits for
 * `ready === true` before painting the toggles so we don't flash defaults
 * over the user's actual settings on a warm reload.
 *
 * Per CLAUDE.md: hooks before early returns. The `ready` flag exists so
 * the screen can render the same hook tree on every render and only
 * branch on a state value, never skip the hook.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'cf:notif_prefs:v1';

export interface NotificationPrefs {
  savedCaseUpdates: boolean;
  watchZoneAlerts: boolean;
  tipStatusUpdates: boolean;
}

const DEFAULTS: NotificationPrefs = {
  savedCaseUpdates: true,
  watchZoneAlerts: true,
  tipStatusUpdates: true,
};

let cache: NotificationPrefs | null = null;
const subscribers = new Set<(p: NotificationPrefs) => void>();

async function loadPrefs(): Promise<NotificationPrefs> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = { ...DEFAULTS };
      return cache;
    }
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    cache = {
      savedCaseUpdates: typeof parsed.savedCaseUpdates === 'boolean' ? parsed.savedCaseUpdates : DEFAULTS.savedCaseUpdates,
      watchZoneAlerts: typeof parsed.watchZoneAlerts === 'boolean' ? parsed.watchZoneAlerts : DEFAULTS.watchZoneAlerts,
      tipStatusUpdates: typeof parsed.tipStatusUpdates === 'boolean' ? parsed.tipStatusUpdates : DEFAULTS.tipStatusUpdates,
    };
    return cache;
  } catch {
    cache = { ...DEFAULTS };
    return cache;
  }
}

async function persistPrefs(next: NotificationPrefs): Promise<void> {
  cache = next;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* AsyncStorage write failures aren't fatal — in-memory cache + subscribers
       still reflect the toggle until next cold launch. */
  }
  for (const sub of subscribers) sub(next);
}

export interface UseNotificationPrefsResult {
  prefs: NotificationPrefs;
  setPref: <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => Promise<void>;
  ready: boolean;
}

export function useNotificationPrefs(): UseNotificationPrefsResult {
  // Hooks always run, regardless of cache state — see CLAUDE.md.
  const [prefs, setPrefs] = useState<NotificationPrefs>(cache ?? DEFAULTS);
  const [ready, setReady] = useState<boolean>(cache !== null);

  useEffect(() => {
    let cancelled = false;
    if (!cache) {
      loadPrefs().then((p) => {
        if (cancelled) return;
        setPrefs(p);
        setReady(true);
      });
    } else {
      setReady(true);
    }

    const sub = (p: NotificationPrefs) => setPrefs(p);
    subscribers.add(sub);
    return () => {
      cancelled = true;
      subscribers.delete(sub);
    };
  }, []);

  const setPref = useCallback(
    async <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => {
      const current = await loadPrefs();
      const next = { ...current, [key]: value };
      await persistPrefs(next);
    },
    [],
  );

  return { prefs, setPref, ready };
}
