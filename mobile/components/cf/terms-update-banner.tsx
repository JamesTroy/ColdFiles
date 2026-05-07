/**
 * TermsUpdateBanner — surfaced at the top of the screen on next launch
 * after a material Terms change.
 *
 * Lifecycle (combines useTosVersion + useOnboarding):
 *
 *   - Onboarding pending: do not render (fresh install; user is about
 *     to see current Terms in the onboarding/sign-in flow anyway).
 *   - TosVersion loading: do not render (avoid flash before the
 *     AsyncStorage read settles).
 *   - TosVersion 'current': do not render (already acked).
 *   - TosVersion 'unacknowledged' AND onboarding 'done': render
 *     (existing user pre-banner; needs notice).
 *   - TosVersion 'outdated' AND onboarding 'done': render.
 *
 * Two CTAs: "Review" navigates to /terms (the act of opening the
 * Terms is recorded as acknowledgement); "Dismiss" stores the new
 * version directly. Either way the banner doesn't fire again.
 *
 * Editorial register: small amber-tint card, mono-caps "TERMS
 * UPDATED" label, single short-sentence summary, two compact CTAs.
 * Sits below the SafeArea inset so it doesn't collide with the
 * status bar; sits above tab bar / map peek so it can't be missed.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '@/constants/theme';
import { useOnboarding } from '@/lib/hooks/use-onboarding';
import { useTosVersion } from '@/lib/hooks/use-tos-version';
import { LATEST_TOS_CHANGE_SUMMARY } from '@/lib/tos-version';

import { Mono, MonoLabel, SansBody } from './text';

export function TermsUpdateBanner() {
  const insets = useSafeAreaInsets();
  const { state: tosState, acceptCurrent } = useTosVersion();
  const { state: onboardingState } = useOnboarding();

  // Don't render until both AsyncStorage reads settle and the user
  // has completed onboarding. Keeps the banner from flashing on
  // cold launch + suppresses for fresh installs.
  const shouldRender =
    onboardingState === 'done' &&
    (tosState === 'outdated' || tosState === 'unacknowledged');

  // For fresh installs that complete onboarding, we want to silently
  // record the current version as acked so the banner never fires
  // for them on the next material change unless that change is
  // actually material to their post-onboarding state.
  //
  // Pattern: if onboarding just flipped to 'done' AND tosState is
  // 'unacknowledged', that's the fresh-install path — silently ack.
  // We don't render the banner in this case because the user just
  // saw the current Terms during sign-in.
  useEffect(() => {
    if (
      onboardingState === 'done' &&
      tosState === 'unacknowledged'
    ) {
      // Hmm — this would silently ack on EVERY existing user too,
      // since they're all 'unacknowledged' before this feature
      // ships. We only want to silently-ack for the fresh-install
      // case. Distinguishing requires another signal we don't have
      // (e.g., "have they ever opened the app before this build").
      //
      // Trade-off: showing the banner once to existing users is the
      // correct legal posture (they DO need notice of the
      // arbitration change). Silently-acking would skip the notice.
      // So we DON'T silently ack here — we render the banner.
      // Auto-ack-on-onboarding-complete should happen INSIDE the
      // onboarding/sign-in flow, not in this gate.
    }
  }, [onboardingState, tosState]);

  if (!shouldRender) return null;

  const onReview = () => {
    // Acknowledge first, then navigate. Acking on review-tap is the
    // correct posture — the user has affirmatively engaged with the
    // notice. The Terms screen itself doesn't need to call
    // acceptCurrent again.
    void acceptCurrent();
    router.push('/terms');
  };

  const onDismiss = () => {
    void acceptCurrent();
  };

  return (
    <View
      style={{
        position: 'absolute',
        top: insets.top + 4,
        left: 12,
        right: 12,
        zIndex: 1000,
        backgroundColor: tokens.color.bg.amberTintCard,
        borderColor: tokens.color.evidence.chrome,
        borderWidth: 0.5,
        borderLeftColor: tokens.color.accent.amber,
        borderLeftWidth: 2,
        borderRadius: 6,
        paddingVertical: 10,
        paddingHorizontal: 12,
        gap: 6,
      }}
      accessibilityRole="alert"
      accessibilityLabel="Terms of Service updated"
    >
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.label}
        color={tokens.color.accent.amber}
      >
        TERMS UPDATED
      </MonoLabel>
      <SansBody
        style={{
          color: tokens.color.text.primary,
          fontSize: tokens.size.meta,
          lineHeight: tokens.size.meta * 1.4,
        }}
      >
        {LATEST_TOS_CHANGE_SUMMARY}
      </SansBody>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
        <Pressable
          onPress={onReview}
          accessibilityRole="button"
          accessibilityLabel="Review updated Terms"
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Mono
            size={tokens.size.meta}
            style={{
              color: tokens.color.accent.amber,
              letterSpacing: tokens.size.meta * 0.02,
            }}
          >
            REVIEW →
          </Mono>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss Terms update notice"
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Mono
            size={tokens.size.meta}
            style={{
              color: tokens.color.text.secondary,
              letterSpacing: tokens.size.meta * 0.02,
            }}
          >
            DISMISS
          </Mono>
        </Pressable>
      </View>
    </View>
  );
}
