/**
 * Supabase client for the mobile app.
 *
 * Architecture rule (docs/00_DECISIONS.md, "Two thin frontends, one Supabase backend"):
 * read paths from a bare @supabase/supabase-js client. Postgres functions
 * (cases_within_radius, cases_in_bbox) and RLS-gated table reads — never a
 * Next.js route handler.
 *
 * Auth is not wired yet (Week 5c). For now `persistSession: false` keeps the
 * client read-only. When auth lands, swap in @react-native-async-storage/async-storage
 * as the storage adapter and flip `persistSession: true`.
 *
 * Env vars (Expo's EXPO_PUBLIC_ prefix exposes them to the client bundle):
 *   EXPO_PUBLIC_SUPABASE_URL
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY
 *
 * If either is missing, isSupabaseConfigured() returns false and every hook
 * falls back to sample data — keeps the UI iteration loop tight for designers
 * who don't need a backend hooked up.
 */

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
        persistSession: false,
        autoRefreshToken: false,
        // Mobile platforms (RN) don't have a window.location to anchor URL detection on.
        detectSessionInUrl: false,
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
