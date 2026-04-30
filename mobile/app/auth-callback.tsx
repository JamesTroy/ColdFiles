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
import { ActivityIndicator, View } from 'react-native';

import { tokens } from '@/constants/theme';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export default function AuthCallback() {
  useEffect(() => {
    let cancelled = false;

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
      if (codeMatch) {
        try {
          await getSupabase().auth.exchangeCodeForSession(
            decodeURIComponent(codeMatch[1]),
          );
        } catch {
          // Code expired or invalid — sign-in screen re-prompts.
        }
      }

      if (!cancelled) router.replace('/');
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
