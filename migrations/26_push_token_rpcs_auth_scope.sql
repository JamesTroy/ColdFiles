-- Migration 26 — auth-scope register_push_token + update_push_token_prefs.
--
-- Audit finding: both RPCs are SECURITY DEFINER and granted to anon. They
-- key off `expo_push_token` only, with no auth check on the pre-existing
-- row's user_id. An attacker who learns or guesses an Expo push token
-- (they leak through analytics, debug screenshots, third-party libs) can
-- overwrite that user's `prefs` and `install_id` — silently flipping
-- which categories of notification they receive, or unbinding their
-- install from their account.
--
-- Token entropy is currently the only defense. That's doing more work
-- than it should be.
--
-- Fix: ON CONFLICT DO UPDATE / UPDATE clauses gated on
-- `(user_id IS NULL OR user_id = auth.uid())`. Translation:
--   - First-time registration: row didn't exist, INSERT lands cleanly.
--   - Anon re-registration of an install-only row (user_id IS NULL):
--     legitimate, allowed.
--   - Authed re-registration of own row: legitimate, allowed.
--   - Anyone trying to overwrite a row owned by a different user:
--     blocked at the WHERE — the UPDATE matches no rows; INSERT path
--     would have already failed via the unique constraint, so the
--     entire RPC becomes a no-op for the attacker (returns NULL or
--     the existing row id).
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

create or replace function public.register_push_token(
  p_expo_push_token text,
  p_install_id text,
  p_platform text,
  p_prefs jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.push_tokens (user_id, install_id, expo_push_token, platform, prefs)
  values (auth.uid(), p_install_id, p_expo_push_token, p_platform, coalesce(p_prefs, '{}'::jsonb))
  on conflict (expo_push_token) do update
    set user_id      = coalesce(excluded.user_id, push_tokens.user_id),
        install_id   = excluded.install_id,
        prefs        = excluded.prefs,
        last_seen_at = now()
    where push_tokens.user_id is null
       or push_tokens.user_id = auth.uid()
  returning id into v_id;
  return v_id;
end
$$;

grant execute on function public.register_push_token(text, text, text, jsonb)
  to anon, authenticated;

-- update_push_token_prefs — same scope predicate. The function is keyed
-- on expo_push_token so an attacker who knows the token could otherwise
-- silently flip the user's pref toggles. Restrict to rows the caller
-- owns (or unbound install rows the caller is the only plausible owner
-- of via install_id continuity).
create or replace function public.update_push_token_prefs(
  p_expo_push_token text,
  p_prefs jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_tokens
     set prefs        = coalesce(p_prefs, '{}'::jsonb),
         last_seen_at = now()
   where expo_push_token = p_expo_push_token
     and (user_id is null or user_id = auth.uid());
end
$$;

grant execute on function public.update_push_token_prefs(text, jsonb)
  to anon, authenticated;
