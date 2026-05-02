/**
 * Pin renderer — case-kind shape encoding plus selected/recent overlays.
 *
 * Shape progression (docs/04_DESIGN_SYSTEM.md "Pin system"):
 *   homicide          → filled circle
 *   missing           → ring + inner dot
 *   unidentified/doe  → open ring
 *
 * Geometry rules:
 *   stroke = max(1.5, round(diameter / 8))     (scales with size)
 *   inner dot = 40% of outer diameter           (ring + dot proportion)
 *
 * Selected state layers an amber halo at 1.6× diameter outside everything.
 * For the open-ring shape we ALSO fill the inner dot solid amber when selected,
 * because halo-on-open-ring alone reads as a loading spinner.
 *
 * Recent state (case updated within last 10 days) layers an amberHot ring at
 * 1.4× diameter, with stepwise alpha decay (full 0–3, half 4–10, gone after).
 *
 * On pure-data layers (a list cell next to a victim name), prefer <PinGlyph>
 * with diameter 12 — small enough to coexist with text, large enough to read.
 * On the map use a larger size (24+).
 */

import type { ReactElement } from 'react';
import Svg, { Circle } from 'react-native-svg';

import { PIN_COLOR_BY_KIND, PIN_SHAPE_BY_KIND, tokens } from '@/constants/theme';

export type PinKind = keyof typeof PIN_SHAPE_BY_KIND;

export interface PinProps {
  kind: PinKind;
  /** Outer diameter in px. Default 14 (map default). */
  diameter?: number;
  /** True when the user has tapped this pin. Adds amber halo. */
  selected?: boolean;
  /**
   * Days since cases.last_changed_at, used for the recently-updated ring.
   * Pass null/undefined when not applicable (most cases).
   */
  recentDays?: number | null;
}

export function Pin({
  kind,
  diameter = 14,
  selected = false,
  recentDays = null,
}: PinProps): ReactElement {
  const shape = PIN_SHAPE_BY_KIND[kind];
  const color = PIN_COLOR_BY_KIND[kind];
  const stroke = tokens.pin.strokeForDiameter(diameter);
  // innerDotRatio is 0.5 in tokens — bumped from 0.4 because at 18px the
  // smaller ratio rendered a pinprick that's hard to distinguish from a
  // tiny filled homicide pin at scroll speed.
  const inner = diameter * tokens.pin.innerDotRatio;

  // Compute halo + recent geometry on the same SVG so layering is correct.
  const haloDiameter = selected ? diameter * tokens.pin.selected.haloScale : 0;
  const recentAlpha = recentDays != null ? tokens.pin.recent.alphaByAge(recentDays) : 0;
  const recentDiameter = recentAlpha > 0 ? diameter * tokens.pin.recent.ringScale : 0;
  // Canvas sizing: pad by the largest stroke half-width so neither the
  // selection halo nor the recency ring clips on the SVG outer edge.
  // Earlier versions used `Math.max(diameter, halo, recent)` without
  // padding — visible as a sliced halo / recency ring on selected or
  // recently-updated pins, since each ring's outer edge sits at half-
  // stroke beyond its nominal radius.
  const haloStroke = selected ? tokens.pin.strokeForDiameter(haloDiameter) : 0;
  const recentStroke =
    recentDiameter > 0
      ? Math.max(1, tokens.pin.strokeForDiameter(recentDiameter) - 0.5)
      : 0;
  const maxStroke = Math.max(stroke, haloStroke, recentStroke);
  const canvas = Math.max(diameter, haloDiameter, recentDiameter) + maxStroke;
  const cx = canvas / 2;
  const cy = canvas / 2;

  return (
    <Svg width={canvas} height={canvas} viewBox={`0 0 ${canvas} ${canvas}`}>
      {/* Selection treatment: soft amber disc + thin amber ring. The disc
          (15% alpha) reads as "this is the answer" with more confidence
          than the previous hairline-only treatment. */}
      {selected && (
        <>
          <Circle cx={cx} cy={cy} r={haloDiameter / 2} fill={tokens.color.accent.amber} fillOpacity={0.15} />
          <Circle
            cx={cx}
            cy={cy}
            r={haloDiameter / 2}
            stroke={tokens.color.accent.amber}
            strokeWidth={haloStroke}
            strokeOpacity={0.6}
            fill="none"
          />
        </>
      )}

      {/* Recent (amberHot) — drawn after halo so the hot tone lands on top of
          the halo's amber wash (per design system spec, hot ring sits inside
          selection halo when both fire). */}
      {recentDiameter > 0 && (
        <Circle
          cx={cx}
          cy={cy}
          r={recentDiameter / 2}
          stroke={tokens.color.accent.amberHot}
          strokeWidth={recentStroke}
          strokeOpacity={recentAlpha}
          fill="none"
        />
      )}

      {/* Base shape */}
      {shape === 'filled' && <Circle cx={cx} cy={cy} r={diameter / 2} fill={color} />}

      {shape === 'open_ring' && (
        <>
          {/* 25% alpha cream fill so the open-ring pin reads as a tinted
              lens rather than a hole on low-contrast tiles. 10% (the
              earlier conservative pass) wasn't enough — the pin still
              disappeared into water + dim-park tiles. 25% lands as "this
              is a cream-tinted pin with an open-ring stroke" while
              keeping the open-ring grammar (the stroke still encodes
              kind; the fill just surfaces the pin's interior). */}
          <Circle
            cx={cx}
            cy={cy}
            r={diameter / 2 - stroke / 2}
            fill={color}
            fillOpacity={0.25}
          />
          <Circle
            cx={cx}
            cy={cy}
            r={diameter / 2 - stroke / 2}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
          />
          {/* Selected open-ring fills the inner dot solid amber so it doesn't read as loading. */}
          {selected && <Circle cx={cx} cy={cy} r={inner / 2} fill={tokens.color.accent.amber} />}
        </>
      )}

      {shape === 'ring_dot' && (
        <>
          <Circle
            cx={cx}
            cy={cy}
            r={diameter / 2 - stroke / 2}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
          />
          <Circle cx={cx} cy={cy} r={inner / 2} fill={color} />
        </>
      )}
    </Svg>
  );
}

/**
 * Smaller convenience renderer for inline use next to text. 12px outer.
 */
export function PinGlyph(props: Omit<PinProps, 'diameter'>): ReactElement {
  return <Pin {...props} diameter={12} />;
}
