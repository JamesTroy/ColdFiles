/**
 * SuccessFlash — the agency-name color flash on tip-routing success.
 *
 * The ONLY sanctioned use of tip.success (#b04545) in the entire app, fenced
 * inside one component file by construction. See docs/04_DESIGN_SYSTEM.md
 * "Tip-flow choreography":
 *
 *   T+0     color flips to tip.success
 *   200ms   ease-out to baseColor
 *   100ms   hold
 *   300ms   (already settled)
 *
 * Total 600ms. Timing locked in tokens.tipFlow.successFlashMs.
 *
 * The trigger is a `flashKey: number`. The component re-runs its animation
 * each time `flashKey` changes (and is > 0). 0 is the "never flashed" state —
 * mounting at 0 does nothing.
 *
 * Why a counter, not a boolean: the user can submit a second tip on the same
 * case via the "Send another tip" path WHILE the case detail is still mounted.
 * Toggling a boolean false→true→false is fragile because React batches; a
 * counter that strictly increments lets us re-fire deterministically without
 * remounting the component.
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
  /**
   * Increment-only counter. Each change to a value > 0 fires one full flash.
   * 0 is the "no flash yet" sentinel.
   */
  flashKey: number;
  /** The text to animate. */
  children: string;
  /** Override the base color the flash settles to. Defaults to text.primary. */
  baseColor?: string;
  style?: TextProps['style'];
}

export function SuccessFlash({
  flashKey,
  children,
  baseColor = tokens.color.text.primary,
  style,
  ...textProps
}: SuccessFlashProps) {
  // 0 → settled (baseColor); 1 → flashed (tip.success).
  const phase = useSharedValue(0);

  useEffect(() => {
    if (flashKey === 0) return;
    const { in: inMs, hold, out } = tokens.tipFlow.successFlashMs;
    phase.value = 0;
    phase.value = withSequence(
      withTiming(1, { duration: inMs, easing: Easing.out(Easing.quad) }),
      withDelay(hold, withTiming(0, { duration: out, easing: Easing.out(Easing.quad) })),
    );
    // phase is a stable shared-value ref across renders — only flashKey drives re-fires.
  }, [flashKey, phase]);

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
