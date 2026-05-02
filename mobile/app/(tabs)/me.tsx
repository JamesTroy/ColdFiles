/**
 * Me tab — profile, subscription, counts, source credits, about.
 *
 * Layout (matches prototype):
 *   - Five cards stacked
 *     0. Account (sign-in / sign-out / delete / diagnostics)
 *     1. Subscription
 *     2. Tips submitted · Cases saved (real counts from useMeCounts) — Cases-saved row is tappable
 *     3. Data · Sources (mix transparency)
 *     4. Help / contact · Notifications · About / legal
 *   - Footer: app version + LLC line in mono evidence-chrome
 *
 * The Premium row routes to /watch-zone (the new screen below).
 *
 * Card / Row / NavRow are imported from components/cf/screen-shell — same
 * primitives are shared with diagnostics, notifications, tip-history,
 * region-prefs. Keep them centralized.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Alert, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, NavRow, Row } from '@/components/cf/screen-shell';
import { Mono, MonoLabel, SansBody, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { assembleDiagnosticsText } from '@/lib/diagnostics';
import { useMeCounts } from '@/lib/hooks/use-me-counts';
import { useSourceMix, type SourceMixRow } from '@/lib/hooks/use-source-mix';
import { signOut, useUser } from '@/lib/hooks/use-user';

const SUPPORT_EMAIL = 'support@coldfile.app';

const PUSH_TOKEN_STORAGE_KEY = 'cf:push_token:v1';
const INSTALL_ID_STORAGE_KEY = 'cf:install_id:v1';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Inline push-token registration. The dedicated /push-prefs screen crashes
 * on Pixel 10 Pro XL v1.0.1 — JS-only OTAs aren't reaching the root cause,
 * and a native rebuild is the v1.0.2 path. Until then, this handler runs
 * the entire registration flow without navigating: permission prompt →
 * Expo push token → register_push_token RPC → Alert with the result. The
 * smoke-test path (token in push_tokens) works without ever opening a
 * separate screen.
 *
 * Dynamic imports for expo-notifications + expo-constants so a module-load
 * error surfaces in the catch block, not as a hard crash.
 */
async function handleEnableNotifications() {
  try {
    const Notifications = await import('expo-notifications');
    const Constants = await import('expo-constants');

    const { status: perm } = await Notifications.requestPermissionsAsync();
    if (perm !== 'granted') {
      Alert.alert(
        'Notifications not enabled',
        perm === 'denied'
          ? 'Enable notifications in system Settings to receive alerts.'
          : 'Permission was not granted.',
      );
      return;
    }

    const projectId =
      (Constants.default.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
        ?.eas?.projectId;
    if (!projectId) {
      Alert.alert('Setup error', 'Missing EAS projectId — push token cannot be issued.');
      return;
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenResult.data;
    try {
      await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, expoPushToken);
    } catch {
      /* non-fatal */
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      Alert.alert('Notifications enabled (local)', 'Backend not configured. Token saved on device.');
      return;
    }

    const installId = await loadOrCreateInstallId();
    const platformLabel = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/register_push_token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        p_expo_push_token: expoPushToken,
        p_install_id: installId,
        p_platform: platformLabel,
        p_prefs: {
          savedCaseUpdates: true,
          watchZoneAlerts: true,
          tipStatusUpdates: true,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      Alert.alert('Register failed', `${res.status} ${body.slice(0, 240)}`);
      return;
    }

    Alert.alert(
      'Notifications enabled',
      `Token registered.\n…${expoPushToken.slice(-12)}`,
    );
  } catch (err) {
    Alert.alert(
      'Could not enable notifications',
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function loadOrCreateInstallId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(INSTALL_ID_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    /* fallthrough */
  }
  const id =
    typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `cf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await AsyncStorage.setItem(INSTALL_ID_STORAGE_KEY, id);
  } catch {
    /* non-fatal */
  }
  return id;
}

export default function MeScreen() {
  const insets = useSafeAreaInsets();
  const counts = useMeCounts();
  const { user, authAvailable } = useUser();
  const sourceMix = useSourceMix();

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'Saved cases on this device stay where they are. Watch zones and synced data go away until you sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
          },
        },
      ],
    );
  };

  const handleSupportEmail = async () => {
    const subject = 'The Cold File — Support request';
    const body = `\n\n— diagnostics —\n${assembleDiagnosticsText()}\n`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Email unavailable', `Reach us at ${SUPPORT_EMAIL}.`);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <SerifTitle size="h2" style={{ fontSize: 22 }}>
            Me
          </SerifTitle>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ marginTop: 4 }}
          >
            ACCOUNT · SUBSCRIPTION · PRIVACY
          </MonoLabel>
        </View>

        {/* Card 0 — Account */}
        <Card>
          {user ? (
            <>
              <Row
                label="Signed in"
                value={user.email ?? '—'}
                valueColor={tokens.color.text.secondary}
              />
              <NavRow label="Download my data" onPress={() => router.push('/data-export')} />
              <NavRow label="Diagnostics" onPress={() => router.push('/diagnostics')} />
              <NavRow label="Sign out" onPress={handleSignOut} />
              <NavRow label="Delete account" onPress={() => router.push('/delete-account')} />
            </>
          ) : (
            <>
              <NavRow
                label={authAvailable ? 'Continue with email' : 'Continue with email (designer mode)'}
                onPress={() => router.push('/sign-in')}
              />
              <NavRow label="Download my data" onPress={() => router.push('/data-export')} />
              <NavRow label="Diagnostics" onPress={() => router.push('/diagnostics')} />
            </>
          )}
        </Card>

        {/* Card 1 — Subscription */}
        <Card>
          <Row label="Subscription" value="FREE" valueMono />
          {/* Watch zones row deferred to v1.0.1 — drawing UI is not interactive
              yet, so the entry point would promise something we don't ship. */}
        </Card>

        {/* Card 2 — User counts */}
        <Card>
          <Row
            label="Tips submitted"
            value={String(counts.submittedTips)}
            valueMono
            onPress={() => router.push('/tip-history')}
          />
          <NavRow label="Cases saved" onPress={() => router.push('/(tabs)/saved')} />
        </Card>

        {/* Card 3 — Data · Sources (mix transparency) */}
        <Card>
          <View
            style={{
              paddingHorizontal: 13,
              paddingVertical: 11,
              borderTopWidth: 0,
            }}
          >
            <MonoLabel size={tokens.size.monoLabel} color={tokens.color.text.secondary}>
              DATA · SOURCES
            </MonoLabel>
            <SansBody style={{ fontSize: 13, color: tokens.color.text.secondary, marginTop: 4 }}>
              {sourceMixSummary(sourceMix)}
            </SansBody>
          </View>
          {sourceMix.loading ? (
            <Row label="—" value="—" valueMono />
          ) : sourceMix.error ? (
            <Row
              label="Couldn't load sources"
              value="—"
              valueColor={tokens.color.text.secondary}
            />
          ) : sourceMix.bySource.length === 0 ? (
            <Row
              label="No sources yet"
              value="—"
              valueColor={tokens.color.text.secondary}
            />
          ) : (
            sourceMix.bySource.map((row) => (
              <SourceRow key={row.slug} row={row} />
            ))
          )}
        </Card>

        {/* Card 4 — Help / Notifications / About */}
        <Card>
          <NavRow label="Help / contact" onPress={handleSupportEmail} />
          <NavRow label="Enable notifications" onPress={() => void handleEnableNotifications()} />
          <NavRow label="Pinned regions" onPress={() => router.push('/region-prefs')} />
          <NavRow label="About · mission" onPress={() => router.push('/about')} />
          <NavRow label="Privacy policy" onPress={() => router.push('/privacy')} />
          <NavRow label="Terms of service" onPress={() => router.push('/terms')} />
          <NavRow label="Takedown request" onPress={() => router.push('/takedown')} />
        </Card>

        {/* Footer */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ lineHeight: 18 }}
          >
            THE COLD FILE · v1.0.0{'\n'}MATTE BLACK DEV LLC · VENTURA, CA
          </MonoLabel>
        </View>
      </ScrollView>
    </View>
  );
}

function sourceMixSummary(mix: ReturnType<typeof useSourceMix>): string {
  if (mix.loading) return 'Loading…';
  if (mix.error) return '—';
  return `${mix.total.toLocaleString()} cases · ${mix.bySource.length} ${mix.bySource.length === 1 ? 'source' : 'sources'}`;
}

function SourceRow({ row }: { row: SourceMixRow }) {
  return (
    <View
      style={{
        paddingHorizontal: 13,
        paddingVertical: 11,
        borderTopWidth: 0.5,
        borderTopColor: tokens.color.border.subtle,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <SansBody style={{ fontSize: 13.5, flex: 1 }} numberOfLines={1}>
        {row.name}
      </SansBody>
      <Mono size={12} style={{ color: tokens.color.text.secondary }}>
        {row.count.toLocaleString()}
      </Mono>
    </View>
  );
}
