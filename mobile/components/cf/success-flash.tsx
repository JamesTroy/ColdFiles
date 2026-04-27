/**
 * SuccessFlash — the agency-name color flash on tip-routing success.
 *
 * The ONLY sanctioned use of tip.success (#b04545) in the entire app. See
 * docs/04_DESIGN_SYSTEM.md "Tip-flow choreography":
 *
 *   T+0   color flips to tip.success
 *   200ms ease-out to text.primary
 *   100ms hold
 *   300ms (tip.success → text.primary already settled)
 *
 * Total 600ms. Timing locked in tokens.tipFlow.successFlashMs.
 *
 * The component is a render-prop — it animates color, not the layout, so the
 * surrounding success-copy text stays put while the agency name pulses.
 */

import { useEffect } from 'react';
import { Text, type TextProps } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { tokens } from '@/constants/theme';

const AnimatedText = Animated.createAnimatedComponent(Text);

interface SuccessFlashProps extends Omit<TextProps, 'style'> {
  /** Triggers the flash. Set true on mount, then false (or unmount). */
  trigger: boolean;
  /** The agency-name (or other receiver-name) to animate. */
  children: string;
  /** Override the base color the flash settles to. Defaults to text.primary. */
  baseColor?: string;
  style?: TextProps['style'];
}

export function SuccessFlash({
  trigger,
  children,
  baseColor = tokens.color.text.primary,
  style,
  ...textProps
}: SuccessFlashProps) {
  // 0 → settled (baseColor); 1 → flashed (tip.success).
  const phase = useSharedValue(0);

  useEffect(() => {
    if (!trigger) return;
    const { in: inMs, hold, out } = tokens.tipFlow.successFlashMs;
    phase.value = 0;
    phase.value = withSequence(
      withTiming(1, { duration: inMs, easing: Easing.out(Easing.quad) }),
      withDelay(hold, withTiming(0, { duration: out, easing: Easing.out(Easing.quad) })),
    );
  }, [trigger, phase]);

  const animatedStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      phase.value,
      [0, 1],
      [baseColor, tokens.color.tip.success],
    ),
  }));

  return (
    <AnimatedText {...textProps} style={[style, animatedStyle]}>
      {children}
    </AnimatedText>
  );
}
