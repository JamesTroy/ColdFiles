/**
 * Push preferences — rebuilt from scratch.
 *
 * Lives at /push-prefs (the prior /notifications path was burnt — stale OTA
 * cache or route-name collision symptoms we couldn't pin down). Self-contained:
 * no shared usePushToken / useNotificationPrefs hook, no screen-shell, no
 * cf/text. Every primitive is react-native or expo-notifications, and every
 * piece of state lives in this one file. If it crashes, the cause is in
 * something you can read on this page.
 *
 * Three states:
 *   - permission undetermined / loading → "Enable notifications" CTA
 *   - permission granted + token registered → "Notifications on" + token tail
 *   - permission denied → "Notifications blocked — open Settings"
 *
 * Wire this up to the existing register_push_token RPC + push_tokens table
 * once the screen renders cleanly. Today's goal is just: render + register +
 * persist token. The toggle UI ships in a follow-up.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';

const STORAGE_KEY = 'cf:push_token:v1';
const INSTALL_ID_KEY = 'cf:install_id:v1';

type Status = 'loading' | 'undetermined' | 'granted' | 'denied' | 'error';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export default function PushPrefsScreen() {
  const [status, setStatus] = useState<Status>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Initial read: status + cached token. Defer the expo-notifications import
  // to runtime via a dynamic import so a module-load throw can't poison
  // module evaluation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Notifications = await import('expo-notifications');
        const perms = await Notifications.getPermissionsAsync();
        const cached = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        setToken(cached);
        if (perms.status === 'granted') setStatus('granted');
        else if (perms.status === 'denied') setStatus('denied');
        else setStatus('undetermined');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onEnable = async () => {
    setBusy(true);
    setError(null);
    try {
      const Notifications = await import('expo-notifications');
      const Constants = await import('expo-constants');

      const { status: perm } = await Notifications.requestPermissionsAsync();
      if (perm !== 'granted') {
        setStatus(perm === 'denied' ? 'denied' : 'undetermined');
        setBusy(false);
        return;
      }
      setStatus('granted');

      const projectId =
        (Constants.default.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
          ?.eas?.projectId;
      if (!projectId) {
        setError('Missing EAS projectId');
        setBusy(false);
        return;
      }

      const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
      const expoPushToken = tokenResult.data;
      setToken(expoPushToken);
      try {
        await AsyncStorage.setItem(STORAGE_KEY, expoPushToken);
      } catch {
        /* non-fatal */
      }

      // Register with Supabase via raw fetch — no @supabase/supabase-js
      // import here so this screen stays minimal. The RPC accepts an anon key
      // and reads auth.uid() from the JWT (null when not signed in, which is
      // fine — the row keys to install_id).
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        const installId = await loadOrCreateInstallId();
        const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
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
            p_platform: platform,
            p_prefs: {
              savedCaseUpdates: true,
              watchZoneAlerts: true,
              tipStatusUpdates: true,
            },
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          setError(`Register failed: ${res.status} ${body.slice(0, 200)}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingTop: 80, paddingBottom: 48 }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{ marginBottom: 24 }}
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={12}
        >
          <Text style={{ color: '#c5a572', fontSize: 14 }}>← Back</Text>
        </Pressable>

        <Text
          style={{
            color: '#f5f1ea',
            fontSize: 24,
            marginBottom: 6,
          }}
        >
          Notifications
        </Text>
        <Text style={{ color: '#a09b95', fontSize: 13, marginBottom: 24 }}>
          Push delivery for saved-case updates and watch-zone alerts.
        </Text>

        {status === 'loading' ? (
          <Text style={{ color: '#a09b95', fontSize: 14 }}>Checking permission…</Text>
        ) : null}

        {status === 'undetermined' ? (
          <Pressable
            onPress={() => void onEnable()}
            disabled={busy}
            style={{
              backgroundColor: '#c5a572',
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderRadius: 8,
              alignItems: 'center',
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: '#1a1408', fontSize: 14 }}>
              {busy ? 'Working…' : 'Enable notifications'}
            </Text>
          </Pressable>
        ) : null}

        {status === 'granted' ? (
          <View
            style={{
              padding: 14,
              borderRadius: 8,
              backgroundColor: '#15120f',
              borderWidth: 0.5,
              borderColor: '#2a2725',
            }}
          >
            <Text style={{ color: '#6a8b6e', fontSize: 13, marginBottom: 6 }}>
              ● Notifications on
            </Text>
            <Text style={{ color: '#a09b95', fontSize: 11 }}>
              Token: {token ? `…${token.slice(-12)}` : 'registering…'}
            </Text>
          </View>
        ) : null}

        {status === 'denied' ? (
          <View>
            <Text style={{ color: '#f5f1ea', fontSize: 14, marginBottom: 8 }}>
              Notifications are blocked at the OS level.
            </Text>
            <Pressable
              onPress={() => {
                void Linking.openSettings();
              }}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 8,
                borderWidth: 0.5,
                borderColor: '#c5a572',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#c5a572', fontSize: 13 }}>Open Settings</Text>
            </Pressable>
          </View>
        ) : null}

        {error ? (
          <Text
            style={{
              color: '#e58383',
              fontSize: 12,
              marginTop: 16,
              fontFamily: 'monospace',
            }}
          >
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

async function loadOrCreateInstallId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
  } catch {
    /* fallthrough */
  }
  const id =
    typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `cf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await AsyncStorage.setItem(INSTALL_ID_KEY, id);
  } catch {
    /* non-fatal */
  }
  return id;
}
