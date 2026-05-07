/**
 * Tab navigation: Map / List / Saved / Me.
 *
 * Tab bar visual contract (docs/04_DESIGN_SYSTEM.md):
 *   - Active label color: accent.amber
 *   - Inactive label color: text.secondary, opacity-reduced glyph
 *   - Mono-cap label, 10px, tracking 0.05em — typewriter signal carries down to the chrome
 */

import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { CFTabBar } from '@/components/cf/tab-bar';
import { TermsUpdateBanner } from '@/components/cf/terms-update-banner';

export default function TabLayout() {
  return (
    // Wrap so the TermsUpdateBanner can sit absolute-positioned at
    // the top of the tabs scope. Mounting at the tabs layer (not the
    // root) keeps the banner off modal-presented screens (sign-in,
    // tip, takedown-request, search) where its top-anchored position
    // would collide with their own headers / close buttons.
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <CFTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="index" options={{ title: 'Map' }} />
        <Tabs.Screen name="list" options={{ title: 'List' }} />
        <Tabs.Screen name="saved" options={{ title: 'Saved' }} />
        <Tabs.Screen name="me" options={{ title: 'Me' }} />
      </Tabs>
      <TermsUpdateBanner />
    </View>
  );
}
