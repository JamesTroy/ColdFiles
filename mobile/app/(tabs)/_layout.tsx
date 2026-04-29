/**
 * Tab navigation: Map / List / Saved / Me.
 *
 * Tab bar visual contract (docs/04_DESIGN_SYSTEM.md):
 *   - Active label color: accent.amber
 *   - Inactive label color: text.secondary, opacity-reduced glyph
 *   - Mono-cap label, 10px, tracking 0.05em — typewriter signal carries down to the chrome
 */

import { Tabs } from 'expo-router';

import { CFTabBar } from '@/components/cf/tab-bar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CFTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Map' }} />
      <Tabs.Screen name="list" options={{ title: 'List' }} />
      <Tabs.Screen name="saved" options={{ title: 'Saved' }} />
      <Tabs.Screen name="me" options={{ title: 'Me' }} />
    </Tabs>
  );
}
