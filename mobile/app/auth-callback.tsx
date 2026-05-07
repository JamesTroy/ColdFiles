/**
 * Auth callback — destination for the magic-link deep link.
 *
 * Without this file, Expo Router resolves `coldfile://auth-callback` to a
 * route that doesn't exist and shows "unmatched route" before the
 * useAuthCallback hook in _layout.tsx can fire. With it, the route exists,
 * the screen mounts a spinner, the deep-link tokens get exchanged for a
 * session, and we replace to home.
 *
 * The session-creation logic is duplicated here (rather than relying on
 * the global hook in _layout.tsx) so that a cold-launch landing directly
 * on this route always finalizes auth, even if the layout's useEffect
 * hasn't yet subscribed to Linking events.
 */

import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { tokens } from '@/constants/theme';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export default function AuthCallback() {
  useEffect(() => {
    let cancelled = false;

    const showExpired = () => {
      Alert.alert(
        'Sign-in link expired',
        'This link is too old, or has been used already. Try signing in again.',
        [{ text: 'Back to sign-in', onPress: () => router.replace('/sign-in') }],
      );
    };

    const showGeneric = () => {
      Alert.alert(
        "Sign-in didn't complete",
        'Please try again.',
        [{ text: 'Back to sign-in', onPress: () => router.replace('/sign-in') }],
      );
    };

    const finalize = async (): Promise<void> => {
      if (!isSupabaseConfigured()) {
        if (!cancelled) router.replace('/');
        return;
      }

      const url = await Linking.getInitialURL().catch(() => null);
      const target = url ?? '';

      // PKCE flow only. The implicit-flow fallback (tokens in URL hash)
      // was deliberately removed — without origin validation a malicious
      // Android intent could deliver attacker-controlled tokens through
      // coldfile://auth-callback#access_token=... and sign the victim in
      // as the attacker. PKCE binds the exchange to the device that
      // initiated the auth, closing that vector.
      const codeMatch = target.match(/[?&]code=([^&#]+)/);
      if (!codeMatch) {
        // No ?code= — silent home redirect. Defends against a hostile
        // intent firing the route with no auth payload at all.
        if (!cancelled) router.replace('/');
        return;
      }

      const supabase = getSupabase();
      // If the global useAuthCallback already exchanged the code, this
      // screen would otherwise re-attempt and fail on the now-consumed
      // single-use code — which would surface a misleading "expired"
      // Alert. Skip the exchange when a valid session already exists.
      const { data: existing } = await supabase.auth.getSession();
      if (existing.session) {
        if (!cancelled) router.replace('/');
        return;
      }

      try {
        await supabase.auth.exchangeCodeForSession(
          decodeURIComponent(codeMatch[1]),
        );
        if (!cancelled) router.replace('/');
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message.toLowerCase() : '';
        console.warn('[auth-callback] exchangeCodeForSession failed');
        if (msg.includes('expired') || msg.includes('invalid') || msg.includes('used')) {
          showExpired();
        } else {
          showGeneric();
        }
      }
    };

    void finalize();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tokens.color.bg.base,
      }}
    >
      <ActivityIndicator color={tokens.color.accent.amber} />
    </View>
  );
}
