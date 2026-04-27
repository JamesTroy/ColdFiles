/**
 * Tab navigation: Map / List / Saved / Me.
 *
 * Tab bar visual contract (docs/04_DESIGN_SYSTEM.md):
 *   - Active label color: accent.amber
 *   - Inactive label color: text.secondary, opacity-reduced glyph
 *   - Mono-cap label, 10px, tracking 0.05em — typewriter signal carries down to the chrome
 */

import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { tokens } from '@/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tokens.color.accent.amber,
        tabBarInactiveTintColor: tokens.color.text.secondary,
        tabBarStyle: {
          backgroundColor: tokens.color.bg.base,
          borderTopColor: tokens.color.border.subtle,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: {
          fontFamily: tokens.font.mono,
          fontSize: tokens.size.monoLabel,
          letterSpacing: tokens.size.monoLabel * tokens.tracking.chip,
        },
        headerShown: false,
        tabBarButton: HapticTab,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={22} name="map.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: 'List',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={22} name="list.bullet" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={22} name="bookmark.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: 'Me',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={22} name="person.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
