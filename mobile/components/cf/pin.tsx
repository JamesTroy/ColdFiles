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
  const inner = diameter * tokens.pin.innerDotRatio;

  // Compute halo + recent geometry on the same SVG so layering is correct.
  const haloDiameter = selected ? diameter * tokens.pin.selected.haloScale : 0;
  const recentAlpha = recentDays != null ? tokens.pin.recent.alphaByAge(recentDays) : 0;
  const recentDiameter = recentAlpha > 0 ? diameter * tokens.pin.recent.ringScale : 0;
  // Pin itself is at center; the SVG canvas accommodates the largest of the three.
  const canvas = Math.max(diameter, haloDiameter, recentDiameter);
  const cx = canvas / 2;
  const cy = canvas / 2;

  return (
    <Svg width={canvas} height={canvas} viewBox={`0 0 ${canvas} ${canvas}`}>
      {/* Recent (amberHot) — outermost so the halo can render outside it on selection */}
      {recentDiameter > 0 && (
        <Circle
          cx={cx}
          cy={cy}
          r={recentDiameter / 2}
          stroke={tokens.color.accent.amberHot}
          strokeWidth={Math.max(1, tokens.pin.strokeForDiameter(recentDiameter) - 0.5)}
          strokeOpacity={recentAlpha}
          fill="none"
        />
      )}

      {/* Halo (amber) — outside the base shape when selected */}
      {selected && (
        <Circle
          cx={cx}
          cy={cy}
          r={haloDiameter / 2}
          stroke={tokens.color.accent.amber}
          strokeWidth={tokens.pin.strokeForDiameter(haloDiameter)}
          strokeOpacity={tokens.pin.selected.haloAlpha}
          fill="none"
        />
      )}

      {/* Base shape */}
      {shape === 'filled' && <Circle cx={cx} cy={cy} r={diameter / 2} fill={color} />}

      {shape === 'open_ring' && (
        <>
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
