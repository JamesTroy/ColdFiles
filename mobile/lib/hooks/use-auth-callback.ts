/**
 * useAuthCallback — handles the magic-link deep-link landing.
 *
 * Why this exists: the Supabase client at lib/supabase.ts has
 * `detectSessionInUrl: false` (correct for RN — there's no window.location
 * to anchor on), which means we have to manually catch the deep link,
 * parse the auth tokens, and call setSession() / exchangeCodeForSession().
 *
 * Wired in once at the root layout. Listens for both:
 *   - Cold-launch deep link (Linking.getInitialURL on mount)
 *   - Hot deep link while the app is already running (Linking.addEventListener)
 *
 * Handles both auth flows in case Supabase's project setting changes:
 *   - PKCE: coldfile://auth-callback?code=<exchange-code>
 *   - Implicit: coldfile://auth-callback#access_token=...&refresh_token=...
 *
 * The session set fires onAuthStateChange in lib/hooks/use-user.ts, which
 * is what flips the UI from signed-out to signed-in.
 */

import * as Linking from 'expo-linking';
import { useEffect } from 'react';

import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

const REDIRECT_PREFIX = 'coldfile://auth-callback';

export function useAuthCallback(): void {
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let cancelled = false;

    const handle = async (url: string | null): Promise<void> => {
      if (!url || cancelled) return;
      if (!url.startsWith(REDIRECT_PREFIX)) return;

      // Try PKCE flow first (?code=...)
      const codeMatch = url.match(/[?&]code=([^&#]+)/);
      if (codeMatch) {
        const code = decodeURIComponent(codeMatch[1]);
        try {
          await getSupabase().auth.exchangeCodeForSession(code);
        } catch {
          // Code expired or invalid — UI re-prompts via the sign-in screen.
        }
        return;
      }

      // Fall back to implicit flow (tokens in URL hash)
      const hashIdx = url.indexOf('#');
      if (hashIdx === -1) return;
      const hashParams = new URLSearchParams(url.slice(hashIdx + 1));
      const access_token = hashParams.get('access_token');
      const refresh_token = hashParams.get('refresh_token');
      if (!access_token || !refresh_token) return;

      try {
        await getSupabase().auth.setSession({ access_token, refresh_token });
      } catch {
        // Token expired or invalid — same recovery path.
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
