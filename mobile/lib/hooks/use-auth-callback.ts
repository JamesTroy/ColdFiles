/**
 * useAuthCallback — handles the magic-link deep-link landing.
 *
 * Why this exists: the Supabase client at lib/supabase.ts has
 * `detectSessionInUrl: false` (correct for RN — there's no window.location
 * to anchor on), which means we have to manually catch the deep link,
 * parse the auth tokens, and call exchangeCodeForSession().
 *
 * Wired in once at the root layout. Listens for both:
 *   - Cold-launch deep link (Linking.getInitialURL on mount)
 *   - Hot deep link while the app is already running (Linking.addEventListener)
 *
 * PKCE-only: coldfile://auth-callback?code=<exchange-code>. Implicit-flow
 * URL fragments are deliberately ignored — see comment block below.
 *
 * The session set fires onAuthStateChange in lib/hooks/use-user.ts, which
 * is what flips the UI from signed-out to signed-in.
 */

import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

const REDIRECT_PREFIX = 'coldfile://auth-callback';

export function useAuthCallback(): void {
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

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

    const handle = async (url: string | null): Promise<void> => {
      if (!url || cancelled) return;
      if (!url.startsWith(REDIRECT_PREFIX)) return;

      // PKCE flow only. The implicit-flow fallback (tokens in the URL
      // hash) was removed — without origin validation a malicious Android
      // intent could deliver attacker-controlled tokens through
      // coldfile://auth-callback#access_token=... and sign the victim in
      // as the attacker. PKCE binds the exchange to the originating device.
      const codeMatch = url.match(/[?&]code=([^&#]+)/);
      if (!codeMatch) return;
      const code = decodeURIComponent(codeMatch[1]);
      try {
        await getSupabase().auth.exchangeCodeForSession(code);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message.toLowerCase() : '';
        console.warn('[use-auth-callback] exchangeCodeForSession failed');
        if (msg.includes('expired') || msg.includes('invalid') || msg.includes('used')) {
          showExpired();
        } else {
          showGeneric();
        }
      }
    };

    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => {
      void handle(url);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
}
