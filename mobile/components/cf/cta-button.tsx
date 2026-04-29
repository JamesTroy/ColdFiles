/**
 * CTA buttons.
 *
 * <AmberCTA>      primary — fills the bar, accent.amber, dark text. The full-width version
 *                 used as "Submit a tip", "Send to {agency}", "Done", etc.
 * <SecondaryCTA>  square outline button beside the primary (the ★ save button).
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from 'react-native';

import { tokens } from '@/constants/theme';

interface AmberCTAProps {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  /** Override default flex: 1. */
  style?: ViewStyle;
}

export function AmberCTA({ label, onPress, loading, style }: AmberCTAProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: tokens.color.accent.amber,
          paddingVertical: 14,
          borderRadius: tokens.radius.card,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#1a1408" />
      ) : (
        // Inlined Text instead of <SansMedium> to bypass cf/text's
        // `includeFontPadding: false` (Android Fabric mishandles it inside
        // Pressable, occasionally collapsing text height to 0). fontFamily
        // remains the design intent; fontWeight: '500' is the fallback hint
        // so the system font still draws the label if Inter_500Medium fails
        // to register on a particular device build.
        <Text
          numberOfLines={1}
          style={{
            color: '#1a1408',
            fontFamily: tokens.font.sansMedium,
            fontWeight: '500',
            fontSize: tokens.size.body,
            lineHeight: tokens.size.body * 1.4,
            letterSpacing: 0.1,
            textAlign: 'center',
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

interface SecondaryCTAProps {
  /** Glyph node (use ★, ⛌, etc. or an Ionicon). */
  children: ReactNode;
  onPress?: () => void;
  /** When true, the glyph color goes amber (e.g. saved star). */
  active?: boolean;
  accessibilityLabel?: string;
}

export function SecondaryCTA({
  children,
  onPress,
  active = false,
  accessibilityLabel,
}: SecondaryCTAProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        {
          width: 48,
          height: 48,
          backgroundColor: 'transparent',
          borderRadius: tokens.radius.card,
          borderWidth: 0.5,
          borderColor: tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View
        style={{
          opacity: active ? 1 : 0.85,
        }}
      >
        {children}
      </View>
    </Pressable>
  );
}
