/**
 * Custom tab bar for app/(tabs)/_layout.tsx.
 *
 * Two intentional design moves over the Expo Router default:
 *
 *   1. Active indicator is a shape, not just a color — a 4px amber dot
 *      sits above the active tab's icon. Carries the pin-shape-first
 *      grammar of the map down into the chrome. Inactive tabs reserve
 *      the same 4px gap so layout doesn't shift on tab change.
 *
 *   2. Slightly taller bar + 11px mono label (up from 10px) so labels
 *      scan cleanly on a Pixel without losing the typewriter signal.
 *
 * Haptics matches the previous HapticTab — selectionAsync() on press in.
 */

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import type { ReactElement } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { tokens } from '@/constants/theme';

const TAB_CONFIG: Record<string, { icon: 'map.fill' | 'list.bullet' | 'bookmark.fill' | 'person.fill'; label: string }> = {
  index: { icon: 'map.fill', label: 'MAP' },
  list: { icon: 'list.bullet', label: 'LIST' },
  saved: { icon: 'bookmark.fill', label: 'SAVED' },
  me: { icon: 'person.fill', label: 'ME' },
};

const INDICATOR_SIZE = 4;
const INDICATOR_GAP = 6;

export function CFTabBar({ state, navigation }: BottomTabBarProps): ReactElement {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: tokens.color.bg.base,
        borderTopWidth: 0.5,
        borderTopColor: tokens.color.border.subtle,
        paddingTop: 8,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
      }}
    >
      {state.routes.map((route, index) => {
        const config = TAB_CONFIG[route.name];
        if (!config) return null;
        const isFocused = state.index === index;

        const onPressIn = () => {
          // Haptic on press-in (not press) so the tactile cue lands the same
          // moment the visual press state engages — feels snappier than
          // waiting for the press-up event. Gate on isFocused so tapping
          // the already-active tab doesn't fake a navigation event.
          if (isFocused) return;
          Haptics.selectionAsync().catch(() => {
            /* no haptics on this device — silent */
          });
        };

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const tint = isFocused
          ? tokens.color.accent.amber
          : tokens.color.text.secondary;

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onPressIn={onPressIn}
            accessibilityRole="button"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={config.label}
            android_ripple={{
              color: tokens.color.border.subtle,
              borderless: true,
              radius: 28,
            }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              justifyContent: 'flex-start',
              // Android shows the ripple effect from android_ripple; layering
              // an opacity dim on top double-cues the press and reads as
              // visual noise. iOS has no ripple, so dim is the press signal.
              opacity: Platform.OS === 'ios' && pressed ? 0.6 : 1,
              gap: INDICATOR_GAP,
            })}
          >
            {/* Indicator slot — always reserves height so layout doesn't shift */}
            <View
              style={{
                width: INDICATOR_SIZE,
                height: INDICATOR_SIZE,
                borderRadius: INDICATOR_SIZE / 2,
                backgroundColor: isFocused
                  ? tokens.color.accent.amber
                  : 'transparent',
              }}
            />

            <IconSymbol size={22} name={config.icon} color={tint} />

            <Text
              numberOfLines={1}
              style={{
                color: tint,
                fontFamily: tokens.font.mono,
                fontSize: 11,
                letterSpacing: 11 * tokens.tracking.chip,
                textAlign: 'center',
                marginTop: 2,
              }}
            >
              {config.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
