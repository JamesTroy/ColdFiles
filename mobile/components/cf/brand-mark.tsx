/**
 * BrandMark — the pulsing blue dot at scale.
 *
 * The same visual signature as the YouAreHere wayfinding marker (you.here
 * blue, solid dot + halo, scale 1→2.5 with opacity 0.4→0 over 2s ease-out).
 * Using the identical mechanic means: when a user opens the app for the
 * first time and sees the brand mark, then later grants location and sees
 * the same dot on the map, the visual continuity reinforces "that's the
 * brand mark, it's also me on the map."
 *
 * Different surface from the wayfinding marker — this surface is brand,
 * not live data. The "pulse implies live tracking" rule (see
 * feedback_design_pulse_only_when_fresh.md) governs the wayfinding marker;
 * this surface is brand identity and the pulse is identity-load, not
 * data-load. Keep the mechanic identical.
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { tokens } from '@/constants/theme';

interface BrandMarkProps {
  /** Solid dot diameter in px. Halo scales relative to this. Default 24. */
  size?: number;
}

export function BrandMark({ size = 24 }: BrandMarkProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    return () => {
      progress.value = 0;
    };
  }, [progress]);

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 1.5 }],
    opacity: 0.4 * (1 - progress.value),
  }));

  // The halo's natural box has to be big enough to accommodate the 2.5×
  // peak without clipping. canvas = size × 2.5.
  const canvas = size * 2.5;

  return (
    <View
      style={{
        width: canvas,
        height: canvas,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: tokens.color.you.here,
          },
          haloStyle,
        ]}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tokens.color.you.here,
          borderWidth: 2,
          borderColor: tokens.color.bg.base,
        }}
      />
    </View>
  );
}
