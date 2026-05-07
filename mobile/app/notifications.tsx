/**
 * Notifications screen — preference toggle shell.
 *
 * Push delivery doesn't ship in v1.0.0; the toggles persist now so they
 * apply automatically when watch-zone alerts go live in v1.0.1. The trust
 * callout up top makes that contract explicit.
 *
 * Per CLAUDE.md: hooks before early returns. The `ready` flag from
 * useNotificationPrefs lets us render the same hook tree on every render
 * and only branch on a state value, never skip the hook.
 */

import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { Alert, Linking, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import { Card, PushScreenHeader } from '@/components/cf/screen-shell';
import { InfoText, Mono, SansBody } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import {
  useNotificationPrefs,
  type NotificationPrefs,
} from '@/lib/hooks/use-notification-prefs';
import { usePushToken } from '@/lib/hooks/use-push-token';

interface ToggleRowDef {
  key: keyof NotificationPrefs;
  label: string;
  subtitle: string;
}

const TOGGLES: ToggleRowDef[] = [
  {
    key: 'savedCaseUpdates',
    label: 'Updates on saved cases',
    subtitle: "When cases you've saved get new info.",
  },
  {
    key: 'watchZoneAlerts',
    label: 'New cases in watch zones',
    subtitle: "Cases ingested inside a zone you've drawn.",
  },
  {
    key: 'tipStatusUpdates',
    label: 'Tip status changes',
    subtitle: 'When an agency acknowledges a tip you submitted.',
  },
];

export default function NotificationsScreen() {
  // Hooks before early returns — see CLAUDE.md. All four hooks fire on every
  // render regardless of permission/registration state; the conditional UI
  // below branches on state values, never on hook count.
  const insets = useSafeAreaInsets();
  const { prefs, setPref, ready } = useNotificationPrefs();
  const { permissionStatus, token, loading: pushLoading, error: pushError, requestAndRegister, unregister } =
    usePushToken();

  const handleRegister = async () => {
    try {
      const result = await requestAndRegister();
      if (!result.ok) {
        if (result.error) {
          console.warn('[notifications] registration not completed', result.error);
        }
        Alert.alert(
          'Notifications not turned on',
          result.status === 'denied'
            ? 'Notifications are blocked at the system level. Open Settings to grant permission, then come back and try again.'
            : "We couldn't finish registering this device for notifications. Check your connection and try again.",
        );
      } else {
        Alert.alert(
          'Notifications on',
          "You'll start getting alerts for the categories you've turned on below.",
        );
      }
    } catch (err) {
      console.warn(
        '[notifications] registration threw',
        err instanceof Error ? err.message : String(err),
      );
      Alert.alert(
        "Couldn't turn on notifications",
        "Something went wrong while turning on notifications. Check your connection and try again.",
      );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <Stack.Screen options={{ headerShown: false }} />
      <PushScreenHeader title="Notifications" subtitle="PREFERENCES" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}>

        {/* Trust callout — same primitive shape as TrustDisclosureCallout. */}
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
            Tap below to register this device for push alerts. Per-category toggles let you opt in
            and out of each kind independently.
          </InfoText>
        </View>

        {/* Permission / registration block — appears before the toggles so the
            user grants OS permission first, then dials in categories.
            UI tree intentionally renders one of three branches based on
            permissionStatus; all hooks above run on every render so the
            count stays stable. */}
        <PermissionBlock
          status={permissionStatus}
          token={token}
          loading={pushLoading}
          onRequest={() => {
            void handleRegister();
          }}
          onDisable={() => {
            void unregister();
          }}
        />

        {pushError ? (
          <View
            style={{
              marginHorizontal: 16,
              marginBottom: 12,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderLeftWidth: 2,
              borderLeftColor: tokens.color.accent.amber,
              backgroundColor: tokens.color.bg.elev1,
            }}
          >
            <SansBody style={{ fontSize: 12, color: tokens.color.text.secondary, marginBottom: 4 }}>
              Last error
            </SansBody>
            <SansBody style={{ fontSize: 12 }}>{pushError}</SansBody>
          </View>
        ) : null}

        <Card>
          {TOGGLES.map((t, idx) => (
            <ToggleRow
              key={t.key}
              label={t.label}
              subtitle={t.subtitle}
              value={prefs[t.key]}
              disabled={!ready}
              onChange={(v) => {
                void setPref(t.key, v);
              }}
              isFirst={idx === 0}
            />
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

interface PermissionBlockProps {
  status: 'undetermined' | 'granted' | 'denied';
  token: string | null;
  loading: boolean;
  onRequest: () => void;
  onDisable: () => void;
}

function PermissionBlock({ status, token, loading, onRequest, onDisable }: PermissionBlockProps) {
  // Single component, three branches. Renders nothing during the initial
  // permission read so the screen doesn't flash a CTA that's about to swap
  // to "Notifications on" two ticks later.
  if (loading && status === 'undetermined' && !token) {
    return null;
  }

  if (status === 'undetermined') {
    return (
      <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
        <AmberCTA
          label="Turn on notifications"
          onPress={onRequest}
          loading={loading}
        />
        <SansBody
          style={{ fontSize: 11.5, color: tokens.color.text.secondary, marginTop: 8 }}
        >
          Required for watch-zone alerts and saved-case updates. You can change this later in
          system Settings.
        </SansBody>
      </View>
    );
  }

  if (status === 'granted') {
    // When permission is already granted at OS level but our local state
    // doesn't have a token yet (cold launch after permission was granted),
    // show a "Refresh token" CTA that calls requestAndRegister — that path
    // is idempotent and re-issues the Expo token + re-runs the backend
    // registration without re-prompting the OS.
    if (!token) {
      return (
        <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
          <AmberCTA
            label="Register push token"
            onPress={onRequest}
            loading={loading}
          />
          <SansBody
            style={{ fontSize: 11.5, color: tokens.color.text.secondary, marginTop: 8 }}
          >
            OS permission is granted. Tap to (re-)issue the Expo push token and register
            this device with the server.
          </SansBody>
        </View>
      );
    }
    return (
      <View
        style={{
          marginHorizontal: 16,
          marginBottom: 12,
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderColor: tokens.color.border.subtle,
          borderWidth: 0.5,
          borderRadius: 6,
          backgroundColor: tokens.color.bg.elev1,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: tokens.color.status.resolved,
              }}
            />
            <SansBody style={{ fontSize: 13.5 }}>Notifications on</SansBody>
          </View>
          <Pressable
            onPress={onDisable}
            accessibilityRole="button"
            accessibilityLabel="Disable notifications"
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <SansBody style={{ fontSize: 12.5, color: tokens.color.text.secondary }}>
              Disable
            </SansBody>
          </Pressable>
        </View>
        <Pressable
          onPress={() => {
            void Clipboard.setStringAsync(token);
          }}
          accessibilityRole="button"
          accessibilityLabel="Tap to copy push token"
          hitSlop={4}
          style={({ pressed }) => ({
            paddingVertical: 8,
            paddingHorizontal: 10,
            borderRadius: 4,
            backgroundColor: pressed ? tokens.color.bg.base : 'transparent',
            borderWidth: 0.5,
            borderColor: tokens.color.border.subtle,
          })}
        >
          <Mono size={10} style={{ color: tokens.color.text.secondary }}>
            TAP TO COPY TOKEN
          </Mono>
          <Mono size={11} style={{ color: tokens.color.text.primary, marginTop: 4 }}>
            {token}
          </Mono>
        </Pressable>
      </View>
    );
  }

  // status === 'denied' — the OS-level permission prompt is one-shot. Only
  // way back is system Settings; Linking.openSettings opens the app entry
  // there directly.
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderLeftWidth: 2,
        borderLeftColor: tokens.color.accent.amber,
        backgroundColor: tokens.color.bg.elev1,
      }}
    >
      <SansBody style={{ fontSize: 13 }}>Notifications are blocked.</SansBody>
      <Pressable
        onPress={() => {
          void Linking.openSettings();
        }}
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        hitSlop={6}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginTop: 6 })}
      >
        <SansBody style={{ fontSize: 12.5, color: tokens.color.accent.amber }}>
          Open Settings →
        </SansBody>
      </Pressable>
    </View>
  );
}

interface ToggleRowProps {
  label: string;
  subtitle: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  isFirst?: boolean;
}

function ToggleRow({ label, subtitle, value, disabled, onChange, isFirst }: ToggleRowProps) {
  return (
    <View
      style={{
        paddingHorizontal: 13,
        paddingVertical: 13,
        borderTopWidth: isFirst ? 0 : 0.5,
        borderTopColor: tokens.color.border.subtle,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <SansBody style={{ fontSize: 13.5 }}>{label}</SansBody>
        <SansBody style={{ fontSize: 12, color: tokens.color.text.secondary, marginTop: 2 }}>
          {subtitle}
        </SansBody>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: tokens.color.bg.elev3, true: tokens.color.accent.amber }}
        thumbColor={tokens.color.text.primary}
      />
    </View>
  );
}
