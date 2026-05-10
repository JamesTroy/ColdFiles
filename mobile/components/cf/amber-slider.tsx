/**
 * AmberSlider — pure-JS horizontal slider built on PanResponder.
 *
 * Shipped because @react-native-community/slider has native code that wasn't
 * linked into the existing AAB; an OTA push importing it would land the
 * Draw Mode screen with a non-functional slider. The pure-JS replacement
 * keeps Draw Mode fully working over OTA forever.
 *
 * API surface intentionally narrow — only what watch-zone.tsx uses. Add
 * props (e.g. disabled, accessibilityLabel) as new callers want them rather
 * than pre-shipping a full slider library.
 *
 * Behavior:
 *   - Tap anywhere on the track to jump the thumb to that position.
 *   - Drag the thumb to scrub. PanResponder gates the gesture; parent
 *     gestures (sheet drag, etc.) lose to the slider while a finger is on
 *     it, which matches native-slider behavior.
 *   - Step-quantized; emits onValueChange only when the quantized value
 *     actually changes.
 *   - onSlidingComplete fires once on release with the final value, useful
 *     for parents that want to defer expensive side-effects to release.
 */

import { useRef, useState } from 'react';
import {
  PanResponder,
  View,
  type LayoutChangeEvent,
  type View as ViewType,
} from 'react-native';

import { tokens } from '@/constants/theme';

const THUMB_SIZE = 22;
const TRACK_HEIGHT = 4;

interface AmberSliderProps {
  value: number;
  onValueChange: (v: number) => void;
  onSlidingComplete?: (v: number) => void;
  minimumValue: number;
  maximumValue: number;
  /** Defaults to 1. Set finer (e.g. 0.1) for fractional scrubbing. */
  step?: number;
  /** Defaults to 36 — same vertical footprint as native slider. */
  height?: number;
}

export function AmberSlider({
  value,
  onValueChange,
  onSlidingComplete,
  minimumValue,
  maximumValue,
  step = 1,
  height = 36,
}: AmberSliderProps) {
  const wrapperRef = useRef<ViewType>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const wrapperPageXRef = useRef(0);
  // Tracks the latest value across PanResponder events so onSlidingComplete
  // gets the final number even when React's value prop hasn't yet round-tripped
  // back through the parent's setState.
  const lastValueRef = useRef(value);
  lastValueRef.current = value;

  const range = maximumValue - minimumValue;
  const usableWidth = Math.max(0, trackWidth - THUMB_SIZE);
  const ratio = range > 0 ? Math.max(0, Math.min(1, (value - minimumValue) / range)) : 0;
  const thumbLeft = ratio * usableWidth;

  const onLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
    // Capture the wrapper's pageX so PanResponder's pageX events translate
    // cleanly to "x along the track" regardless of where the slider sits.
    wrapperRef.current?.measure((_fx, _fy, _w, _h, px) => {
      wrapperPageXRef.current = px;
    });
  };

  const valueFromPageX = (pageX: number): number => {
    if (usableWidth <= 0) return lastValueRef.current;
    const localX = pageX - wrapperPageXRef.current - THUMB_SIZE / 2;
    const r = Math.max(0, Math.min(1, localX / usableWidth));
    let raw = minimumValue + r * range;
    // Quantize to step. Round-then-clamp avoids drift at the endpoints.
    raw = Math.round(raw / step) * step;
    raw = Math.max(minimumValue, Math.min(maximumValue, raw));
    // Normalize to step's decimal precision so floating-point fuzz doesn't
    // surface as 4.999999 instead of 5.0.
    const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
    return Number(raw.toFixed(decimals));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const next = valueFromPageX(e.nativeEvent.pageX);
        if (next !== lastValueRef.current) {
          lastValueRef.current = next;
          onValueChange(next);
        }
      },
      onPanResponderMove: (e) => {
        const next = valueFromPageX(e.nativeEvent.pageX);
        if (next !== lastValueRef.current) {
          lastValueRef.current = next;
          onValueChange(next);
        }
      },
      onPanResponderRelease: () => {
        onSlidingComplete?.(lastValueRef.current);
      },
      onPanResponderTerminate: () => {
        onSlidingComplete?.(lastValueRef.current);
      },
    }),
  ).current;

  return (
    <View
      ref={wrapperRef}
      onLayout={onLayout}
      {...panResponder.panHandlers}
      // 12dp vertical hit-slop equivalent — the wrapper's height makes the
      // thumb easy to grab even though the track itself is 4dp tall.
      style={{ height, justifyContent: 'center' }}
      accessibilityRole="adjustable"
      accessibilityValue={{
        min: minimumValue,
        max: maximumValue,
        now: value,
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const delta = e.nativeEvent.actionName === 'increment' ? step : -step;
        const next = Math.max(
          minimumValue,
          Math.min(maximumValue, lastValueRef.current + delta),
        );
        if (next !== lastValueRef.current) {
          lastValueRef.current = next;
          onValueChange(next);
          onSlidingComplete?.(next);
        }
      }}
    >
      {/* Background track */}
      <View
        style={{
          height: TRACK_HEIGHT,
          borderRadius: TRACK_HEIGHT / 2,
          backgroundColor: tokens.color.border.hairline,
        }}
      />
      {/* Active fill — extends from left edge to thumb center. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: (height - TRACK_HEIGHT) / 2,
          width: thumbLeft + THUMB_SIZE / 2,
          height: TRACK_HEIGHT,
          borderRadius: TRACK_HEIGHT / 2,
          backgroundColor: tokens.color.accent.amber,
        }}
      />
      {/* Thumb */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: thumbLeft,
          top: (height - THUMB_SIZE) / 2,
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          borderRadius: THUMB_SIZE / 2,
          backgroundColor: tokens.color.accent.amber,
          borderWidth: 1.5,
          borderColor: tokens.color.bg.base,
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
          elevation: 3,
        }}
      />
    </View>
  );
}
