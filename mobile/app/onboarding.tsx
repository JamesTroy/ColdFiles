/**
 * Onboarding — three-screen first-launch flow.
 *
 *   1. Purpose: what The Cold File is, what it's not.
 *   2. Content warning: photos and narratives include depictions of
 *      deceased and missing persons. Mature 17+ rating disclosed up
 *      front so users opt in with eyes open.
 *   3. Location rationale: explain WHY we want location before the
 *      system permission dialog fires (Play Store auditors flag cold
 *      permission prompts).
 *
 * Skip-able from any screen. The flag is set in AsyncStorage on
 * either Continue (final) or Skip — we don't re-show.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/cf/brand-mark';
import { AmberCTA } from '@/components/cf/cta-button';
import {
  MonoLabel,
  NarrativeText,
  SansBody,
  SerifTitle,
} from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { useHere } from '@/lib/hooks/use-here';
import { useOnboarding } from '@/lib/hooks/use-onboarding';

interface Step {
  eyebrow: string;
  title: string;
  body: string[];
  primaryLabel: string;
  /** Step 3 has a "Maybe later" path that completes onboarding without prompting. */
  secondaryLabel?: string;
}

const STEPS: Step[] = [
  {
    eyebrow: 'WELCOME',
    title: 'The Cold File',
    body: [
      'Discover unsolved cases — homicides, missing persons, unidentified-person investigations — in your area.',
      'When you have information, the app routes you to the agency that owns the case. We never read or store your tip.',
    ],
    primaryLabel: 'Continue',
  },
  {
    eyebrow: 'CONTENT NOTICE',
    title: 'A few things to know',
    body: [
      'The Cold File contains depictions of deceased and missing persons, including photos sourced from public agency releases.',
      'Sensitive imagery (forensic reconstruction, post-mortem material) is hidden behind a tap. Tap to view, or scroll past.',
      'This app is rated 17+ and is not directed at children.',
    ],
    primaryLabel: 'I understand',
  },
  {
    eyebrow: 'LOCATION',
    title: 'Where are you?',
    body: [
      'The app uses your location only to show cases near you. Your location stays on this device — we don\'t store it on our servers and we don\'t share it with anyone.',
      'You can grant location now, or skip and grant later from Settings.',
    ],
    primaryLabel: 'Use my location',
    secondaryLabel: 'Maybe later',
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const { complete } = useOnboarding();
  const { requestAndAcquire } = useHere();
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const finish = async () => {
    await complete();
    router.replace('/');
  };

  const handlePrimary = async () => {
    if (!isLast) {
      setStepIndex((i) => i + 1);
      return;
    }
    // Final step: prompt for location, then finish.
    await requestAndAcquire();
    await finish();
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.bg.base,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 16,
        paddingHorizontal: 16,
      }}
    >
      {/* Top: skip + progress dots */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 32,
        }}
      >
        <ProgressDots count={STEPS.length} active={stepIndex} />
        <Pressable
          onPress={() => void finish()}
          accessibilityLabel="Skip onboarding"
          accessibilityRole="button"
          hitSlop={12}
        >
          <MonoLabel
            size={tokens.size.monoChip}
            tracking={tokens.tracking.chip}
            color={tokens.color.text.secondary}
          >
            SKIP
          </MonoLabel>
        </Pressable>
      </View>

      {/* Body */}
      <View style={{ flex: 1 }}>
        {/* Step 0 anchors with the BrandMark — the same blue pulsing dot the
            user will later see on the map as YouAreHere. The visual
            continuity is the brand: brand mark = wayfinding mark = you. */}
        {stepIndex === 0 ? (
          <View style={{ alignItems: 'center', marginBottom: 28, marginTop: 8 }}>
            <BrandMark size={20} />
          </View>
        ) : null}
        <MonoLabel
          size={tokens.size.monoChip}
          tracking={tokens.tracking.chip}
          color={tokens.color.evidence.chrome}
          style={{ marginBottom: 12 }}
        >
          {step.eyebrow}
        </MonoLabel>
        <SerifTitle size="h1" style={{ marginBottom: 18 }}>
          {step.title}
        </SerifTitle>
        {step.body.map((paragraph, i) => (
          <NarrativeText
            key={i}
            style={{ marginBottom: i < step.body.length - 1 ? 14 : 0 }}
          >
            {paragraph}
          </NarrativeText>
        ))}
      </View>

      {/* CTAs */}
      <View style={{ gap: 12 }}>
        <AmberCTA label={step.primaryLabel} onPress={() => void handlePrimary()} />
        {step.secondaryLabel ? (
          <Pressable
            onPress={() => void finish()}
            accessibilityRole="button"
            accessibilityLabel={step.secondaryLabel}
            hitSlop={12}
            style={{ alignItems: 'center', paddingVertical: 14 }}
          >
            <SansBody style={{ color: tokens.color.text.secondary }}>
              {step.secondaryLabel}
            </SansBody>
          </Pressable>
        ) : null}
      </View>

      {/* Back chevron — only shows after step 1 */}
      {stepIndex > 0 ? (
        <Pressable
          onPress={() => setStepIndex((i) => i - 1)}
          accessibilityLabel="Previous step"
          accessibilityRole="button"
          hitSlop={12}
          style={{ position: 'absolute', top: insets.top + 8, left: 0, padding: 16 }}
        >
          <Ionicons name="chevron-back" size={20} color={tokens.color.text.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ProgressDots({ count, active }: { count: number; active: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i === active ? 18 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor:
              i === active ? tokens.color.accent.amber : tokens.color.border.strong,
          }}
        />
      ))}
    </View>
  );
}
