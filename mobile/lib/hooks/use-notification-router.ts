/**
 * useNotificationRouter — routes a tapped push notification to the case
 * detail screen.
 *
 * Two entry points the OS uses to deliver a tapped notification's payload:
 *
 *   1. Warm-resume: app is in memory (foreground OR background). The user
 *      taps the notification banner; expo-notifications fires
 *      `addNotificationResponseReceivedListener`. The listener has no
 *      timing constraints — JS is already running.
 *
 *   2. Cold-launch: app was killed. The OS launches the app TO open the
 *      notification. The response IS the launch trigger, so the listener
 *      cannot fire (it's registered after launch, but the launch event
 *      already happened). Instead, expo-notifications stashes the response
 *      and exposes it via `getLastNotificationResponseAsync()`.
 *
 * Cold-launch race-with-mount: on cold-launch, `_layout.tsx`'s root render
 * happens before the (tabs) navigator is fully mounted. Calling
 * `router.push` from a synchronous module-level eval would race the
 * navigator and either no-op or land on a broken stack. Defer the
 * cold-launch replay to a useEffect that fires after root mount — by the
 * time React commits the Stack, the navigator is ready. Do NOT inline
 * the call at module load. The warm-resume listener is already deferred
 * inside React lifecycle so it has no race.
 *
 * Wire from `_layout.tsx` next to `useAuthCallback()`.
 *
 * Out of scope for v1.0.2: tip_status_change + saved_case_update kinds
 * also push case_slug payloads, so the same handler covers them once
 * those producer triggers ship. zone_id navigation (deep-link to a zone
 * detail screen) lands when /zone/[id] becomes the canonical destination
 * for "your watch zone matched."
 */

import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

interface NotificationData {
  kind?: string;
  case_slug?: string;
  zone_id?: string;
  tip_id?: string;
}

function routeFromData(data: NotificationData | null | undefined): void {
  if (!data) return;
  const slug = typeof data.case_slug === 'string' ? data.case_slug : null;
  if (!slug) return;
  router.push({ pathname: '/case/[slug]', params: { slug } });
}

export function useNotificationRouter(): void {
  // Cold-launch replay must fire ONCE per session — guard against the
  // useEffect re-running (StrictMode in dev double-invokes). The warm
  // listener handles all subsequent taps.
  const coldLaunchReplayed = useRef(false);

  useEffect(() => {
    // Warm-resume listener — fires whenever the app receives a tap while
    // already in memory.
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content
          .data as NotificationData | null | undefined;
        routeFromData(data);
      },
    );

    // Cold-launch replay — guarded so it only fires the first time this
    // hook mounts. getLastNotificationResponseAsync returns null when the
    // app was launched via the home-screen icon (not a notification tap).
    if (!coldLaunchReplayed.current) {
      coldLaunchReplayed.current = true;
      Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (!response) return;
          const data = response.notification.request.content
            .data as NotificationData | null | undefined;
          routeFromData(data);
        })
        .catch(() => {
          // No-op: a missing/unreadable launch response just means we
          // routed nowhere, which is the correct outcome for a normal
          // home-icon launch.
        });
    }

    return () => {
      sub.remove();
    };
  }, []);
}
