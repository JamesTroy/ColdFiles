/**
 * Supabase client for the mobile app.
 *
 * Architecture rule (docs/00_DECISIONS.md, "Two thin frontends, one Supabase backend"):
 * read paths from a bare @supabase/supabase-js client. Postgres functions
 * (cases_within_radius, cases_in_bbox) and RLS-gated table reads — never a
 * Next.js route handler.
 *
 * Auth uses AsyncStorage for session persistence so users stay signed in
 * across app launches. Email magic-link is the primary flow; OAuth (Apple /
 * Google) is wired through the same client when available.
 *
 * Env vars (Expo's EXPO_PUBLIC_ prefix exposes them to the client bundle):
 *   EXPO_PUBLIC_SUPABASE_URL
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY
 *
 * If either is missing, isSupabaseConfigured() returns false and every hook
 * falls back to sample data — keeps the UI iteration loop tight for designers
 * who don't need a backend hooked up.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile/.env. See mobile/.env.example.',
    );
  }
  if (!cached) {
    cached = createClient(url as string, anonKey as string, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        // Mobile platforms (RN) don't have a window.location to anchor URL detection on.
        detectSessionInUrl: false,
        // PKCE binds the auth exchange to the originating device — closes
        // the Android intent-hijack vector where an attacker could deliver
        // implicit-flow tokens via the deep-link scheme. Verified by the
        // auth callback handler at lib/hooks/use-auth-callback.ts which
        // only handles ?code= and ignores any URL-fragment tokens.
        flowType: 'pkce',
      },
      global: {
        headers: {
          // Identifies the client in Postgres logs — useful when debugging which
          // surface ran a query (mobile vs web vs scraper).
          'x-cold-file-client': 'mobile',
        },
      },
    });
  }
  return cached;
}
