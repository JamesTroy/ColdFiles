/**
 * Server-side Supabase client for the Next.js app.
 *
 * Anon-key only — every read this client performs is gated by RLS, same
 * as the mobile client. The web property NEVER uses service-role; that
 * stays inside Edge Functions and scripts/. If a future page needs
 * elevated access, it goes through an Edge Function, not a direct
 * service-role import on the web tier.
 *
 * Cached per-process: Next.js server components run inside a long-lived
 * Node process, so we lazy-init once and reuse the client across requests
 * to avoid Supabase's startup overhead on every render.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'getServerSupabase: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set',
    );
  }

  cached = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return cached;
}
