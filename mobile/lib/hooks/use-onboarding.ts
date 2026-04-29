/**
 * useOnboarding — first-launch flag stored in AsyncStorage.
 *
 * Returns the gate state (loading until we've read the flag, then either
 * 'pending' or 'done') and a `complete()` function the onboarding screen
 * calls when the user finishes (or skips).
 *
 * The root layout uses this to redirect to /onboarding on first launch.
 *
 * State is module-level + subscription-based so every consumer (the gate
 * in _layout.tsx and the onboarding screen) stays in sync. Without this,
 * `complete()` in the screen would only update the screen's local state;
 * the gate's stale 'pending' state would then redirect the user right
 * back to /onboarding on `router.replace('/')`. The shared store closes
 * that race.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'cf:onboarding-completed:v1';

export type OnboardingState = 'loading' | 'pending' | 'done';

interface UseOnboardingResult {
  state: OnboardingState;
  complete: () => Promise<void>;
}

let cached: OnboardingState = 'loading';
let inflight: Promise<void> | null = null;
const subscribers = new Set<(s: OnboardingState) => void>();

function publish(next: OnboardingState): void {
  cached = next;
  for (const fn of subscribers) fn(next);
}

function ensureLoaded(): Promise<void> {
  if (inflight) return inflight;
  inflight = AsyncStorage.getItem(KEY)
    .then((value) => {
      publish(value === '1' ? 'done' : 'pending');
    })
    .catch(() => {
      // If storage read fails, treat as done — don't block startup
      // forever on a corner case.
      publish('done');
    });
  return inflight;
}

export function useOnboarding(): UseOnboardingResult {
  const [state, setState] = useState<OnboardingState>(cached);

  useEffect(() => {
    subscribers.add(setState);
    void ensureLoaded();
    return () => {
      subscribers.delete(setState);
    };
  }, []);

  const complete = useCallback(async () => {
    // Publish the new state synchronously so the OnboardingGate (which
    // owns the redirect) sees 'done' before the next router event fires.
    publish('done');
    try {
      await AsyncStorage.setItem(KEY, '1');
    } catch {
      // Worst case: re-show next launch. State is already in memory.
    }
  }, []);

  return { state, complete };
}
