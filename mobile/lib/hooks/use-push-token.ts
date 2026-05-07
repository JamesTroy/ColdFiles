/**
 * usePushToken — Expo push token registration + permission state.
 *
 * Why Expo's push service (not raw FCM/APNs)?
 *   Expo's push relay accepts a single ExponentPushToken[...] and fans out
 *   to APNs / FCM under the hood. The mobile client never holds a raw FCM
 *   token, which (a) keeps platform credentials in EAS not in the app bundle,
 *   and (b) lets us write a single fan-out path on the server.
 *
 * Registration flow (called from notifications.tsx, NOT on mount):
 *   1. requestPermissionsAsync() — returns 'granted' | 'denied' | 'undetermined'.
 *   2. If granted: getExpoPushTokenAsync({ projectId }).
 *   3. POST { expo_push_token, install_id, platform, prefs } via the
 *      register_push_token RPC. Server upserts on expo_push_token uniqueness;
 *      the row is keyed to auth.uid() when authed and the install UUID
 *      otherwise (multi-install, anon-tolerant).
 *   4. Persist the registration row id locally so unregister() can target it.
 *
 * install_id is a per-install UUID stored at cf:install_id:v1. Same install
 * keeps the same row even when the user signs in/out — the RPC merges
 * coalesce(excluded.user_id, push_tokens.user_id) so signing in adopts the
 * row, signing out leaves user_id intact for the rest of the session and
 * lets the orphan-prune job handle later (v1.0.2).
 *
 * Per CLAUDE.md (hooks-before-early-returns): all useState / useEffect /
 * useCallback declarations sit at the top of the hook. Conditionals run
 * inside hook bodies, never as a guard before the hook list.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { getSupabase, isSupabaseConfigured } from '../supabase';
import { useNotificationPrefs, type NotificationPrefs } from './use-notification-prefs';
import { useUser } from './use-user';

const INSTALL_ID_KEY = 'cf:install_id:v1';
const REGISTRATION_KEY = 'cf:push_registration:v1';

export type PermissionStatus = 'undetermined' | 'granted' | 'denied';

export interface UsePushTokenResult {
  permissionStatus: PermissionStatus;
  token: string | null;
  registrationId: string | null;
  loading: boolean;
  error: string | null;
  /** Prompts permission then registers the token with the backend. */
  requestAndRegister: () => Promise<{ ok: boolean; status: PermissionStatus; error?: string }>;
  /** Drops the local registration. The server row is kept for orphan-prune. */
  unregister: () => Promise<void>;
  /** Pushes a fresh prefs snapshot to the server when toggles flip. */
  syncPrefs: (prefs: NotificationPrefs) => Promise<void>;
}

function mapNotifStatusToOurs(s: Notifications.PermissionStatus): PermissionStatus {
  // Notifications.PermissionStatus = 'granted' | 'denied' | 'undetermined'.
  // We re-export the same shape so callers don't depend on expo-notifications'
  // enum directly (lets us swap providers later without ripple).
  if (s === 'granted') return 'granted';
  if (s === 'denied') return 'denied';
  return 'undetermined';
}

async function loadOrCreateInstallId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
  } catch {
    /* fallthrough — generate fresh */
  }
  // crypto.randomUUID is available in Hermes. Fallback path uses Math.random
  // because expo-crypto would add an import-graph dependency for a value
  // that's not security-load-bearing (it's a row-keying token, not a secret).
  const id =
    typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `cf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await AsyncStorage.setItem(INSTALL_ID_KEY, id);
  } catch {
    /* AsyncStorage failure isn't fatal — the in-memory id still routes for
       this session, next launch will retry. */
  }
  return id;
}

function detectPlatform(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

export function usePushToken(): UsePushTokenResult {
  // Hooks declared up-front per CLAUDE.md. The conditionals below all live
  // inside hook bodies / callbacks, never as an early-return gate.
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('undetermined');
  const [token, setToken] = useState<string | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useUser();
  const { prefs } = useNotificationPrefs();

  // Boot: read current OS permission + any cached registration id. Does NOT
  // re-fetch the push token; that's only safe inside the user-initiated
  // requestAndRegister() path where permission is freshly granted.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [{ status }, cachedReg] = await Promise.all([
          Notifications.getPermissionsAsync(),
          AsyncStorage.getItem(REGISTRATION_KEY),
        ]);
        if (cancelled) return;
        setPermissionStatus(mapNotifStatusToOurs(status));
        if (cachedReg) setRegistrationId(cachedReg);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const requestAndRegister = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const { status } = await Notifications.requestPermissionsAsync();
      const mapped = mapNotifStatusToOurs(status);
      setPermissionStatus(mapped);

      if (mapped !== 'granted') {
        setLoading(false);
        return { ok: false, status: mapped };
      }

      // The Expo push service binds tokens to the EAS projectId. Reading
      // it from Constants.expoConfig keeps it consistent with whatever the
      // current build was signed against — no hardcoded duplicate.
      const projectId =
        (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
          ?.projectId ??
        (Constants.easConfig as { projectId?: string } | undefined)?.projectId;

      if (!projectId) {
        const msg = 'Missing EAS projectId — cannot fetch Expo push token.';
        setError(msg);
        setLoading(false);
        return { ok: false, status: mapped, error: msg };
      }

      const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
      const expoPushToken = tokenResult.data;
      setToken(expoPushToken);

      // Server registration. If Supabase isn't configured (designer mode)
      // we keep the OS-level permission + token in state so the UI can
      // reflect "notifications on", but skip the RPC — there's no backend
      // to fan out from anyway.
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return { ok: true, status: mapped };
      }

      const installId = await loadOrCreateInstallId();
      const supabase = getSupabase();

      const { data: rowId, error: rpcError } = await supabase.rpc('register_push_token', {
        p_expo_push_token: expoPushToken,
        p_install_id: installId,
        p_platform: detectPlatform(),
        p_prefs: prefs,
      });

      if (rpcError) {
        setError(rpcError.message);
        setLoading(false);
        return { ok: false, status: mapped, error: rpcError.message };
      }

      if (typeof rowId === 'string') {
        setRegistrationId(rowId);
        try {
          await AsyncStorage.setItem(REGISTRATION_KEY, rowId);
        } catch {
          /* non-fatal — server row still owns truth */
        }
      }

      setLoading(false);
      return { ok: true, status: mapped };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setLoading(false);
      return { ok: false, status: permissionStatus, error: msg };
    }
    // user.id is intentionally NOT a dep — the RPC reads auth.uid() from the
    // Supabase JWT directly, so a sign-in mid-session is reflected without
    // re-rendering this hook. prefs IS a dep so the most recent toggles ride
    // along with the registration row at the moment of registration.
  }, [permissionStatus, prefs]);

  const unregister = useCallback(async () => {
    // Drops the local registration only. The server row stays until the
    // orphan-prune job runs (v1.0.2). When the user re-grants permission
    // later, register_push_token's ON CONFLICT branch updates the same row
    // by expo_push_token uniqueness — no duplicate accumulates.
    setRegistrationId(null);
    setToken(null);
    try {
      await AsyncStorage.removeItem(REGISTRATION_KEY);
    } catch {
      /* non-fatal */
    }
  }, []);

  const syncPrefs = useCallback(
    async (next: NotificationPrefs) => {
      // Best-effort: only push if we already have a registration row + token.
      // Pre-registration toggles ride along on the initial register_push_token
      // call (prefs is read from useNotificationPrefs at that moment).
      if (!registrationId || !token || !isSupabaseConfigured()) return;
      try {
        const supabase = getSupabase();
        await supabase.rpc('update_push_token_prefs', {
          p_expo_push_token: token,
          p_prefs: next,
        });
      } catch {
        /* network error / RLS denial — non-fatal. Next requestAndRegister()
           call will reattach prefs on its register_push_token round-trip. */
      }
    },
    [registrationId, token],
  );

  // Keep server-side prefs aligned when toggles flip post-registration. This
  // intentionally fires on every prefs identity change; the RPC is idempotent
  // and the volume is bounded by user toggle frequency.
  useEffect(() => {
    if (!registrationId) return;
    void syncPrefs(prefs);
  }, [prefs, registrationId, syncPrefs]);

  // Latest-state refs so the auth listener can stay subscribed exactly once
  // and still read fresh values. Re-subscribing on every state change would
  // race the listener against in-flight token registration.
  const requestAndRegisterRef = useRef(requestAndRegister);
  const unregisterRef = useRef(unregister);
  const hasRegistrationRef = useRef(false);
  useEffect(() => {
    requestAndRegisterRef.current = requestAndRegister;
    unregisterRef.current = unregister;
  }, [requestAndRegister, unregister]);
  useEffect(() => {
    hasRegistrationRef.current = Boolean(registrationId || token);
  }, [registrationId, token]);

  // React to sign-in/out: rotate the install's push subscription so user A
  // signing out and user B signing in on the same device doesn't carry A's
  // user_id on the push_tokens row. SIGNED_IN re-runs the registration only
  // if the user had previously opted into pushes (otherwise don't
  // surprise-prompt for permission on sign-in). SIGNED_OUT clears local
  // state; the server row's user_id falls off via auth.users cascade on
  // account deletion, and rotates on the next register call.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabase();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        if (hasRegistrationRef.current) {
          void requestAndRegisterRef.current();
        }
      } else if (event === 'SIGNED_OUT') {
        void unregisterRef.current();
      }
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  // Touch user.id so the linter doesn't complain about an unused destructure;
  // it's read for future analytics + is the de-facto "are we authed" signal
  // the registration RPC quietly relies on.
  void user;

  return {
    permissionStatus,
    token,
    registrationId,
    loading,
    error,
    requestAndRegister,
    unregister,
    syncPrefs,
  };
}
