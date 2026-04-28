/**
 * useOnboarding — first-launch flag stored in AsyncStorage.
 *
 * Returns the gate state (loading until we've read the flag, then either
 * 'pending' or 'done') and a `complete()` function the onboarding screen
 * calls when the user finishes (or skips).
 *
 * The root layout uses this to redirect to /onboarding on first launch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'cf:onboarding-completed:v1';

export type OnboardingState = 'loading' | 'pending' | 'done';

export interface UseOnboardingResult {
  state: OnboardingState;
  complete: () => Promise<void>;
}

export function useOnboarding(): UseOnboardingResult {
  const [state, setState] = useState<OnboardingState>('loading');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEY)
      .then((value) => {
        if (cancelled) return;
        setState(value === '1' ? 'done' : 'pending');
      })
      .catch(() => {
        // If storage read fails (rare), treat as done — don't block startup
        // forever on a corner case. The user can revisit via Me → About.
        if (!cancelled) setState('done');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const complete = useCallback(async () => {
    setState('done');
    try {
      await AsyncStorage.setItem(KEY, '1');
    } catch {
      // Ignore — state is in memory; worst case we re-show next launch.
    }
  }, []);

  return { state, complete };
}
