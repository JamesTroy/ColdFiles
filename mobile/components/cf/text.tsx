/**
 * Cold File typography primitives.
 *
 * Use these instead of bare <Text>. Each component encodes a single role from
 * the typography hard-rules in docs/04_DESIGN_SYSTEM.md so the rules can't be
 * accidentally violated:
 *
 *   - <SerifTitle>     reserved for arrival (case detail header, peek-sheet title). Never below 18px.
 *   - <SansBody>       body copy
 *   - <SansMedium>     list-row victim names, default UI labels
 *   - <SansSemibold>   section headings (sans, not serif)
 *   - <Mono>           case numbers, dates, IDs, key-facts values
 *   - <MonoLabel>      mono-cap section labels with letter-spacing (the typewriter signal)
 *   - <NarrativeText>  the case-file body — uses body.reading off-white at 13px / 1.65
 *   - <InfoText>       trust-disclosure callout body — uses text.info (light blue, never you.here)
 */

import type { ComponentProps } from 'react';
import { StyleSheet, Text } from 'react-native';

import { tokens } from '@/constants/theme';

type TextProps = ComponentProps<typeof Text>;

const base: TextProps['style'] = {
  color: tokens.color.text.primary,
  includeFontPadding: false, // RN Android quirk; without this serif/mono cap-line is misaligned
};

export function SerifTitle({ style, size, ...rest }: TextProps & { size?: 'h1' | 'h2' }) {
  const fontSize = size === 'h1' ? tokens.size.serifH1 : tokens.size.serifH2;
  return (
    <Text
      {...rest}
      style={[
        base,
        { fontFamily: tokens.font.serif, fontSize, lineHeight: fontSize * 1.2 },
        style,
      ]}
    />
  );
}

export function SansBody({ style, ...rest }: TextProps) {
  return (
    <Text
      {...rest}
      style={[
        base,
        {
          fontFamily: tokens.font.sans,
          fontSize: tokens.size.body,
          color: tokens.color.text.primary,
        },
        style,
      ]}
    />
  );
}

export function SansMedium({ style, size, ...rest }: TextProps & { size?: number }) {
  return (
    <Text
      {...rest}
      style={[
        base,
        {
          fontFamily: tokens.font.sansMedium,
          fontSize: size ?? tokens.size.rowName,
        },
        style,
      ]}
    />
  );
}

export function SansSemibold({ style, ...rest }: TextProps) {
  return (
    <Text
      {...rest}
      style={[
        base,
        {
          fontFamily: tokens.font.sansSemibold,
          fontSize: tokens.size.h3,
          letterSpacing: tokens.size.h3 * tokens.tracking.heading,
        },
        style,
      ]}
    />
  );
}

export function Mono({ style, size, ...rest }: TextProps & { size?: number }) {
  return (
    <Text
      {...rest}
      style={[
        base,
        {
          fontFamily: tokens.font.mono,
          fontSize: size ?? tokens.size.monoData,
        },
        style,
      ]}
    />
  );
}

/**
 * MonoLabel — uppercase section label with letterspacing. The typewriter signal.
 * Use for: SELECTED · 1.4 mi away, CASE FILE, ROUTE TO, YOUR TIP · OPTIONAL,
 * and the case-kind/year/place line above list-row victim names.
 */
export function MonoLabel({
  style,
  size,
  tracking = tokens.tracking.label,
  color,
  ...rest
}: TextProps & {
  size?: number;
  tracking?: number;
  color?: string;
}) {
  const fontSize = size ?? tokens.size.monoLabel;
  const children = typeof rest.children === 'string' ? rest.children.toUpperCase() : rest.children;
  return (
    <Text
      {...rest}
      style={[
        base,
        {
          fontFamily: tokens.font.mono,
          fontSize,
          letterSpacing: fontSize * tracking,
          color: color ?? tokens.color.text.secondary,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function NarrativeText({ style, ...rest }: TextProps) {
  return (
    <Text
      {...rest}
      style={[
        base,
        {
          fontFamily: tokens.font.sans,
          fontSize: tokens.size.narrative,
          lineHeight: tokens.size.narrative * 1.65,
          color: tokens.color.body.reading,
        },
        style,
      ]}
    />
  );
}

export function InfoText({ style, ...rest }: TextProps) {
  return (
    <Text
      {...rest}
      style={[
        base,
        {
          fontFamily: tokens.font.sans,
          fontSize: 11,
          lineHeight: 11 * 1.6,
          color: tokens.color.text.info,
        },
        style,
      ]}
    />
  );
}

// Internal — used by Mono variants where right-alignment matters in the key-facts table.
export const textStyles = StyleSheet.create({
  rightAlign: { textAlign: 'right' },
});
