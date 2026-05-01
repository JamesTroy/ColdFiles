-- 12_push_token_registry.sql
--
-- push_tokens — stores Expo push tokens for fan-out from Edge Functions.
--
-- Authed users: user_id populated, install_id may also be set (multi-install).
-- Unauthed users: install_id only. install_id is a client-generated UUID
-- stored in AsyncStorage so the same install reuses the same row.
--
-- Privacy posture: tokens are strictly for delivery (watch-zone alerts,
-- saved-case updates, tip-status changes). No content is logged in the
-- token row beyond delivery metadata. Row deletes on user delete cascade
-- (when user_id is set); install-only rows are pruned by the orphan job
-- (TODO: add to v1.0.2).
--
-- NOT AUTO-APPLIED. The SQL editor doesn't track migration state — this file
-- exists so the change is reviewable + numbered when the time comes. The user
-- runs it manually in the Supabase SQL editor after reviewing.

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  install_id text,                                  -- AsyncStorage UUID
  expo_push_token text not null unique,
  platform text check (platform in ('ios','android','web')) not null,
  prefs jsonb not null default '{}'::jsonb,         -- snapshot of cf:notif_prefs:v1
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx
  on public.push_tokens(user_id) where user_id is not null;
create index if not exists push_tokens_install_idx
  on public.push_tokens(install_id) where install_id is not null;

alter table public.push_tokens enable row level security;

-- Self-read for authed users so the client can list/manage its own tokens.
-- Drop-then-create so the migration is idempotent if re-run accidentally.
drop policy if exists push_tokens_self_read on public.push_tokens;
create policy push_tokens_self_read on public.push_tokens
  for select using (auth.uid() = user_id);

-- Service role does all writes; clients call register_push_token RPC instead
-- of inserting directly (no INSERT/UPDATE policies — the security-definer
-- function below is the single ingress).

-- ──────────────────────────────────────────────────────────────────────────
-- register_push_token — register-or-update RPC. Idempotent on (expo_push_token).
--
-- Why security definer: anon callers must be able to insert their own row
-- without an INSERT policy on push_tokens. The function constrains writes
-- to the (token, install, prefs) columns + reads auth.uid() server-side so
-- a hostile client can't impersonate another user_id.
-- ──────────────────────────────────────────────────────────────────────────
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
    set user_id    = coalesce(excluded.user_id, push_tokens.user_id),
        install_id = excluded.install_id,
        prefs      = excluded.prefs,
        last_seen_at = now()
  returning id into v_id;
  return v_id;
end
$$;

grant execute on function public.register_push_token(text, text, text, jsonb)
  to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- update_push_token_prefs — lightweight pref sync RPC.
--
-- Called when the user flips a toggle in mobile/app/notifications.tsx after
-- they've already registered. Keyed on the unique expo_push_token (NOT the
-- registration row id) so it works for both authed and anon paths without
-- the client having to remember the row UUID.
-- ──────────────────────────────────────────────────────────────────────────
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
     set prefs = coalesce(p_prefs, '{}'::jsonb),
         last_seen_at = now()
   where expo_push_token = p_expo_push_token;
end
$$;

grant execute on function public.update_push_token_prefs(text, jsonb)
  to anon, authenticated;
