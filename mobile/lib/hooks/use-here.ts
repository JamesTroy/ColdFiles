/**
 * useHere — current device location, with permission state and freshness.
 *
 * Behavior:
 *   - Default state: { lat, lng } from tokens.map.defaultCenter, fresh: false.
 *     The "you are here" pulse is gated on fresh, so the placeholder dot
 *     stays static (per feedback_design_pulse_only_when_fresh — pulse
 *     implies live tracking; placeholders must not lie).
 *   - When permission is granted, we request a single coarse fix. Fresh
 *     flips to true for 30 seconds, then back to false. The map's pulse
 *     halo follows the fresh flag automatically.
 *   - permissionStatus exposes the granted/denied/undetermined state so
 *     onboarding / settings can prompt.
 *
 * Caller decides when to call requestPermission(); we don't fire it on
 * mount because that would trigger the system dialog without rationale.
 */

import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

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
