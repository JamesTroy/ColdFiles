/**
 * useUser — current Supabase auth state for the mobile app.
 *
 * Returns the active session's user (null when not signed in OR when
 * Supabase isn't configured — designer mode = guest). Subscribes to auth
 * state changes so sign-in, sign-out, and session refreshes all flow
 * through one hook.
 *
 * Saved cases work without auth (device-local AsyncStorage). Watch Zones
 * require auth because they hit the server. The Me tab + Watch Zone
 * screen check `user` from this hook to decide what to show.
 */

import type { Session, User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { getSupabase, isSupabaseConfigured } from '../supabase';

export interface UseUserResult {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** True when Supabase is configured at build time. */
  authAvailable: boolean;
}

export function useUser(): UseUserResult {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured());

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const supabase = getSupabase();
    let cancelled = false;

    supabase.auth.getSession().then(
      ({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setLoading(false);
      },
      (err: unknown) => {
        // Network failure (offline, captive portal, supabase outage) on cold
        // launch must not freeze `loading: true` — that hangs Me + Saved
        // panes indefinitely. Resolve to no-session and let onAuthStateChange
        // fill in once the network recovers.
        if (cancelled) return;
        console.warn(
          '[use-user] getSession rejected',
          err instanceof Error ? err.message : String(err),
        );
        setSession(null);
        setLoading(false);
      },
    );

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return {
    user: session?.user ?? null,
    session,
    loading,
    authAvailable: isSupabaseConfigured(),
  };
}

/**
 * Send a magic-link email to start a PKCE sign-in. Resolves once Supabase
 * has accepted the request — the actual session lands later when the user
 * taps the email and `useAuthCallback` exchanges the code.
 *
 * In designer mode (Supabase env unset) returns an error explaining that
 * auth requires a configured Supabase project; never silently succeeds.
 */
export async function signInWithEmail(email: string): Promise<{ error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return {
      error: new Error('Sign-in is unavailable in designer mode. Configure Supabase to enable.'),
    };
  }
  const supabase = getSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // The deep link the magic-link email lands on. Configured in Supabase
      // Auth → URL Configuration → Redirect URLs. The app's `scheme` is
      // 'coldfile' (see app.config.ts), so coldfile://auth-callback opens
      // the app and Supabase finishes the session.
      emailRedirectTo: 'coldfile://auth-callback',
    },
  });
  return { error: error ? new Error(error.message) : null };
}

/**
 * Sign the current user out. No-op in designer mode (returns success).
 * `useUser`'s onAuthStateChange listener picks up the SIGNED_OUT event
 * and clears local state; `use-push-token` clears the device's push
 * registration in the same listener.
 */
export async function signOut(): Promise<{ error: Error | null }> {
  if (!isSupabaseConfigured()) return { error: null };
  const supabase = getSupabase();
  const { error } = await supabase.auth.signOut();
  return { error: error ? new Error(error.message) : null };
}
