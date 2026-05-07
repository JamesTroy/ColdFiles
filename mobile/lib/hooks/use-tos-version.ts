/**
 * useTosVersion — tracks which Terms version the user has acknowledged.
 *
 * Pattern mirrors useOnboarding: module-level cache, subscription-based
 * publishes so multiple consumers (the banner gate + the Terms screen
 * itself) stay in sync without re-reading AsyncStorage on every mount.
 *
 * State semantics:
 *   - 'loading'   — AsyncStorage read in flight; render nothing
 *   - 'unacknowledged' — user has never acked any version (fresh install
 *                        OR an existing user who installed before this
 *                        feature shipped)
 *   - 'current'    — user acked the current version
 *   - 'outdated'   — user acked an older version; show banner
 *
 * The banner gate combines this with useOnboarding to decide whether
 * to render: existing-user-with-outdated-or-unacked terms gets the
 * banner; fresh-install user does not (their first onboarding flow
 * implicitly acks the current version).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { CURRENT_TOS_VERSION } from '../tos-version';

const KEY = 'cf:tos_accepted_version:v1';

export type TosVersionState = 'loading' | 'unacknowledged' | 'current' | 'outdated';

interface UseTosVersionResult {
  state: TosVersionState;
  /** Acknowledge the current TOS version. Idempotent. */
  acceptCurrent: () => Promise<void>;
}

let cached: TosVersionState = 'loading';
let cachedVersion: string | null = null;
let inflight: Promise<void> | null = null;
const subscribers = new Set<(s: TosVersionState) => void>();

function compute(version: string | null): TosVersionState {
  if (version === null) return 'unacknowledged';
  if (version === CURRENT_TOS_VERSION) return 'current';
  return 'outdated';
}

function publish(next: TosVersionState, version: string | null): void {
  cached = next;
  cachedVersion = version;
  for (const fn of subscribers) fn(next);
}

function ensureLoaded(): Promise<void> {
  if (inflight) return inflight;
  inflight = AsyncStorage.getItem(KEY)
    .then((value) => {
      publish(compute(value), value);
    })
    .catch(() => {
      // Storage unreachable — fall through to 'unacknowledged' so the
      // app doesn't block on a corner case. The banner gate uses
      // useOnboarding to suppress for fresh installs anyway.
      publish('unacknowledged', null);
    });
  return inflight;
}

export function useTosVersion(): UseTosVersionResult {
  const [state, setState] = useState<TosVersionState>(cached);

  useEffect(() => {
    subscribers.add(setState);
    void ensureLoaded();
    return () => {
      subscribers.delete(setState);
    };
  }, []);

  const acceptCurrent = useCallback(async () => {
    // Publish optimistically so the banner can vanish without waiting
    // on the AsyncStorage write.
    publish('current', CURRENT_TOS_VERSION);
    try {
      await AsyncStorage.setItem(KEY, CURRENT_TOS_VERSION);
    } catch {
      // Worst case: banner fires again next launch. Acceptable.
    }
  }, []);

  return { state, acceptCurrent };
}

/** Internal — returns the raw stored version. Useful for diagnostics. */
export function getCachedTosVersion(): string | null {
  return cachedVersion;
}
