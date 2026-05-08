/**
 * Transient fresh-receipt flag — drives the "user just routed a tip" success
 * flash on case detail, without using a wall-clock freshness window.
 *
 * Why a flag instead of "submittedAt within last N seconds":
 *
 *   The most common flow has the user routing → spending 90+ seconds on the
 *   agency's tip form → returning to the app. A wall-clock window would expire
 *   before they get back, inverting the design intent: the user who put the
 *   most effort into the tip would get the LEAST confirmation. The transient
 *   flag has no such failure mode — it's set on submit, persists across
 *   backgrounding, and consumes naturally on the next case-detail render that
 *   matches its slug.
 *
 *   Survives:
 *     - User backgrounding the app to fill out the agency form
 *     - Multi-minute detours
 *     - The "Send another tip" same-screen path (modal dismisses, case detail
 *       is still mounted, the subscription fires the consume)
 *
 *   Cleared by:
 *     - Successful consume on case-detail mount or re-render
 *     - App kill (state lives in module scope, not persisted) — which is
 *       correct: a stale flag from a previous app session shouldn't fire a
 *       flash on next launch.
 *
 * The hook returns a count, not a boolean. A second submit on the same case
 * (via "Send another tip" while the case detail is still mounted) increments
 * the count → React re-renders → SuccessFlash sees a new flashKey and replays
 * the animation.
 */

import { useEffect, useState } from 'react';

let pendingSlug: string | null = null;
const subscribers = new Set<() => void>();

/**
 * Mark a case slug as having a fresh tip-receipt event. Call from the tip
 * submit handler immediately after the routing succeeds so the case-detail
 * screen for that slug picks up the flag and re-runs its <SuccessFlash>
 * animation when navigated to next.
 *
 * One-shot: the flag is consumed by the first useFreshReceiptCount() that
 * matches the slug. Subsequent calls overwrite the pending slug.
 */
export function markReceiptFresh(slug: string): void {
  pendingSlug = slug;
  // Notify any mounted case-detail screens so they pick up the flag without
  // waiting for an unrelated re-render.
  for (const sub of subscribers) sub();
}

/**
 * Returns a counter that increments each time a fresh-receipt event matches
 * `slug`. Use the value as a `flashKey` on <SuccessFlash> — the component
 * re-runs its animation on every change.
 */
export function useFreshReceiptCount(slug: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!slug) return;

    const consumeIfMatched = () => {
      if (pendingSlug === slug) {
        pendingSlug = null;
        // Notify other subscribers that the flag is cleared (not strictly
        // necessary today since only case-detail subscribes, but cheap and
        // future-proof).
        for (const sub of subscribers) {
          if (sub !== consumeIfMatched) sub();
        }
        setCount((c) => c + 1);
      }
    };

    // Mount-time check — handles the common case where the user returns from
    // the agency's site and case-detail is the screen on top.
    consumeIfMatched();

    // Subscription for the same-screen "Send another tip" path: the case
    // detail is already mounted when the modal dismisses, so we need the
    // module-state change to drive a re-render here too.
    subscribers.add(consumeIfMatched);
    return () => {
      subscribers.delete(consumeIfMatched);
    };
  }, [slug]);

  return count;
}
