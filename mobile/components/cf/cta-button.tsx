/**
 * CTA buttons.
 *
 * <AmberCTA>      primary — fills the bar, accent.amber, dark text. The full-width version
 *                 used as "Submit a tip", "Send to {agency}", "Done", etc.
 * <SecondaryCTA>  square outline button beside the primary (the ★ save button).
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';

import { tokens } from '@/constants/theme';

import { SansMedium } from './text';

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
        <SansMedium
          size={tokens.size.body}
          style={{ color: '#1a1408', letterSpacing: 0 }}
        >
          {label}
        </SansMedium>
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
}

export function SecondaryCTA({ children, onPress, active = false }: SecondaryCTAProps) {
  return (
    <Pressable
      onPress={onPress}
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
