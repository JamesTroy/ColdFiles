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
      accessibilityState={{ busy: loading, disabled: loading }}
      style={({ pressed }) => [
        {
          // flex:1 is the row-context default (alongside SecondaryCTA), but
          // many call sites place AmberCTA in a column container with no
          // defined height. flex:1 in that case can resolve to 0 on Android
          // Fabric, which renders the button as an amber slab with the label
          // collapsed into 0px of vertical space — looks like "no text."
          // alignSelf:'stretch' + minHeight:48 keep the row use-case
          // (full-width-of-row) AND guarantee a visible touch target.
          flex: 1,
          alignSelf: 'stretch',
          minHeight: 48,
          backgroundColor: tokens.color.accent.amber,
          paddingVertical: 14,
          paddingHorizontal: 12,
          borderRadius: tokens.radius.card,
          alignItems: 'center',
          justifyContent: 'center',
          // Compose three visual states: pressed (briefly dimmer), loading
          // (longer-running dim cue), and resting (full amber).
          opacity: loading ? 0.6 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#1a1408" />
      ) : (
        // Do not specify fontWeight alongside fontFamily on Android Fabric
        // (Pixel 10 Pro XL repro): Inter_500Medium already encodes weight
        // 500, and asking the renderer to apply weight 500 on top of it
        // fails resolution and renders the glyphs invisible — the button
        // shows as an amber slab with no label. Only set fontFamily.
        <Text
          numberOfLines={1}
          allowFontScaling
          style={{
            color: '#1a1408',
            fontFamily: tokens.font.sansMedium,
            fontSize: tokens.size.body,
            letterSpacing: tokens.size.body * tokens.tracking.label,
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
