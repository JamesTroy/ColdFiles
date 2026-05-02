/**
 * Notifications screen — TEMPORARILY REPLACED with a minimal diagnostic.
 *
 * v1.0.1 on Pixel 10 Pro XL renders this route to a blank dark surface.
 * An ErrorBoundary wrapped around the prior body did not fire, which means
 * the failure is at module-load time — almost certainly the transitive
 * `import * as Notifications from 'expo-notifications'` inside usePushToken.
 *
 * This stub strips every expo-notifications coupling so we can confirm:
 *   - If THIS renders normally → root cause is the expo-notifications
 *     module-load on Android 16. Fix by deferring the import (dynamic import
 *     inside the registration callback, not at top-level).
 *   - If THIS still greys out → cause is upstream of the screen file
 *     (route registration, layout, native init). Different fix path.
 *
 * Restore the toggle UI once the diagnosis lands.
 */

import { Stack } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, PushScreenHeader } from '@/components/cf/screen-shell';
import { InfoText, SansBody } from '@/components/cf/text';
import { tokens } from '@/constants/theme';

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <Stack.Screen options={{ headerShown: false }} />
      <PushScreenHeader title="Notifications" subtitle="DIAGNOSTIC" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}>
        <View
          style={{
            marginHorizontal: 16,
            marginBottom: 12,
            backgroundColor: tokens.color.bg.infoTint,
            borderLeftWidth: 2,
            borderLeftColor: tokens.color.you.here,
            paddingVertical: 10,
            paddingHorizontal: 12,
          }}
        >
          <InfoText>
            Diagnostic build. The full notifications screen is temporarily
            disabled while we root-cause a v1.0.1 render issue on Android 16.
          </InfoText>
        </View>

        <Card>
          <View style={{ paddingHorizontal: 13, paddingVertical: 13 }}>
            <SansBody style={{ fontSize: 13.5, marginBottom: 4 }}>
              Push notifications
            </SansBody>
            <SansBody
              style={{ fontSize: 12, color: tokens.color.text.secondary }}
            >
              Coming back online shortly. If you can read this, the screen
              shell renders fine — the issue is isolated to the push-token
              hook&apos;s import path.
            </SansBody>
          </View>
        </Card>

        <Pressable
          onPress={() => {}}
          accessibilityRole="button"
          accessibilityLabel="No-op diagnostic button"
          style={{
            marginHorizontal: 16,
            paddingVertical: 14,
            paddingHorizontal: 12,
            borderRadius: 8,
            backgroundColor: tokens.color.bg.elev1,
            borderWidth: 0.5,
            borderColor: tokens.color.border.subtle,
            alignItems: 'center',
          }}
        >
          <SansBody style={{ fontSize: 13 }}>OK</SansBody>
        </Pressable>
      </ScrollView>
    </View>
  );
}
