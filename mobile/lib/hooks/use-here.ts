/**
 * useHere — current device location, with permission state and freshness.
 *
 * Two distinct paths drive `here.lat` / `here.lng`. The `fresh` flag
 * separates "the user just asked for their location" from passive
 * background updates — the map's pulse halo gates on `fresh`, so the
 * pulse only fires on the former (per feedback_design_pulse_only_when_fresh
 * — pulse implies live tracking; passive lat/lng updates must not lie).
 *
 * Behavior:
 *
 *   1. Default state: { lat, lng } from tokens.map.defaultCenter,
 *      fresh: false. Static placeholder dot, no pulse.
 *
 *   2. Passive watch (auto, on permission grant + foreground):
 *      Installs a Location.watchPositionAsync subscription with
 *      accuracy=Balanced, distanceInterval=10m, timeInterval=5s. Updates
 *      `lat`/`lng` as the user moves; LEAVES `fresh` UNTOUCHED. The
 *      watch pauses when the app backgrounds and re-arms on foreground.
 *      An immediate `getCurrentPositionAsync` fires on watch-start so
 *      the dot snaps to current position without waiting for a 10m
 *      movement.
 *
 *   3. Explicit acquire (`requestAndAcquire()`): prompts for permission
 *      if undetermined, gets a single Balanced-accuracy fix, sets
 *      `fresh: true` for 30 seconds, then flips back to false. The
 *      map's pulse follows. Safe to call multiple times — re-arms the
 *      30s window.
 *
 *   permissionStatus exposes granted/denied/undetermined so
 *   onboarding / settings can prompt.
 *
 *   Callers decide when to invoke requestAndAcquire(). We don't fire it
 *   on mount — that would trigger the system dialog without rationale.
 */

import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { tokens } from '@/constants/theme';

const FRESH_TTL_MS = 30_000;

export type HerePermissionStatus = 'undetermined' | 'granted' | 'denied';

export interface HerePoint {
  lat: number;
  lng: number;
  fresh: boolean;
}

export interface UseHereResult {
  here: HerePoint;
  permissionStatus: HerePermissionStatus;
  /** True while a fix is being acquired. */
  acquiring: boolean;
  /**
   * Prompt for permission (if undetermined) and acquire one fresh fix.
   * Safe to call multiple times — re-acquires a fresh fix and resets the
   * 30s freshness window. Returns the granted state.
   */
  requestAndAcquire: () => Promise<HerePermissionStatus>;
}

const DEFAULT_HERE: HerePoint = {
  lat: tokens.map.defaultCenter.lat,
  lng: tokens.map.defaultCenter.lng,
  fresh: false,
};

export function useHere(): UseHereResult {
  const [here, setHere] = useState<HerePoint>(DEFAULT_HERE);
  const [permissionStatus, setPermissionStatus] =
    useState<HerePermissionStatus>('undetermined');
  const [acquiring, setAcquiring] = useState(false);
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read existing permission state on mount so the UI reflects reality
  // (e.g., user previously granted, app remembered it). Doesn't prompt.
  useEffect(() => {
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => {
        if (cancelled) return;
        setPermissionStatus(toStatus(status));
      })
      .catch(() => {
        /* expo-location may not be linked in older dev clients — silent */
      });
    return () => {
      cancelled = true;
      if (staleTimer.current) clearTimeout(staleTimer.current);
    };
  }, []);

  // Track app state to pause location updates when backgrounded
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      setAppState(nextAppState);
    });
    return () => {
      subscription.remove();
    };
  }, []);

  // When permission is granted, actively watch the user's location so the
  // dot updates when they move. Pauses when app goes to background.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    if (permissionStatus === 'granted' && appState === 'active') {
      // First get an immediate fix so we don't wait for the user to move
      // 10 meters just to see where they currently are.
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }).then((loc) => {
        if (cancelled) return;
        setHere((prev) => ({
          ...prev,
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
        }));
      }).catch(() => { /* silent */ });

      Location.watchPositionAsync(
        { 
          accuracy: Location.Accuracy.Balanced, 
          distanceInterval: 10,
          timeInterval: 5000 // Ensure we don't spam updates more than once every 5s
        },
        (loc) => {
          if (cancelled) return;
          setHere((prev) => ({
            ...prev,
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          }));
        }
      ).then((s) => {
        if (cancelled) {
          s.remove();
        } else {
          sub = s;
        }
      }).catch(() => {
        // silent fail for watch
      });
    }

    return () => {
      cancelled = true;
      if (sub) {
        sub.remove();
      }
    };
  }, [permissionStatus, appState]);

  const requestAndAcquire = useCallback(async (): Promise<HerePermissionStatus> => {
    setAcquiring(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const next = toStatus(status);
      setPermissionStatus(next);
      if (next !== 'granted') {
        return next;
      }
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setHere({
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
        fresh: true,
      });
      // Flip back to stale after the TTL — pulse stops, dot stays put.
      if (staleTimer.current) clearTimeout(staleTimer.current);
      staleTimer.current = setTimeout(() => {
        setHere((prev) => ({ ...prev, fresh: false }));
      }, FRESH_TTL_MS);
      return next;
    } catch {
      // Network / hardware error — fall back to placeholder, surface as denied
      // so the UI offers a retry rather than implying ongoing acquisition.
      setPermissionStatus('denied');
      return 'denied';
    } finally {
      setAcquiring(false);
    }
  }, []);

  return { here, permissionStatus, acquiring, requestAndAcquire };
}

function toStatus(status: Location.PermissionStatus): HerePermissionStatus {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}
