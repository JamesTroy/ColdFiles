-- Migration 19 — watch_zone_hit producer trigger.
--
-- When a new case lands inside a user's active watch_zone polygon, fire
-- notify-fanout with kind='watch_zone_hit' scoped to that user. This is the
-- first of three producer triggers planned in notify-fanout's TODO comment;
-- saved_case_update needs server-side saved_cases tracking (deferred —
-- saved cases live in device storage today), and tip_status_change needs an
-- agency webhook (deferred — no integration exists yet).
--
-- Architecture:
--   AFTER INSERT on cases (the moment a new case enters the corpus)
--     ↓ ST_Intersects(user_watches.watch_zone_geom, NEW.location_point)
--     ↓ AND user_watches.notify_new_cases = true
--   per matching user:
--     pg_net.http_post → notify-fanout (kind=watch_zone_hit, case_id, user_ids=[uid])
--
-- Why per-user calls instead of one batch: notify-fanout already accepts a
-- user_ids array, so we could batch all matched users in one call. But the
-- trigger fires once per case INSERT — a case can match multiple watch
-- zones across different users. Batching would coalesce them into one
-- "watch_zone_hit" with a list. The downside: if one user's tokens fail,
-- the whole batch reports failed. Per-user calls keep failures isolated
-- and the audit trail clean per recipient. Volume is low (cases insert at
-- ingest speed, not user-action speed) so the extra HTTP overhead is fine.
--
-- Requirements:
--   - extension "pg_net" must be enabled (Supabase enables by default)
--   - extension "postgis" must be enabled (already required by location_point)
--   - extension "supabase_vault" must be enabled (Supabase enables by default
--     — verify under Database → Extensions if vault.* is missing)
--   - One Vault secret named 'service_role_key' must be created — see the
--     one-time admin block at the bottom of this file.
--
-- The endpoint URL is hardcoded since it's tied to the project ref and is
-- not a secret. The service-role key is read from Supabase Vault on each
-- trigger fire — Vault handles encryption at rest.
--
-- Idempotent: drops and recreates the function + trigger.

create extension if not exists pg_net;

create or replace function public.notify_watch_zone_hit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The function endpoint is tied to the project ref and not a secret.
  -- Hardcoded so the trigger has nothing to look up except the secret key.
  v_endpoint constant text := 'https://gzfndxabaispgcotklni.supabase.co/functions/v1/notify-fanout';
  v_user_id     uuid;
  v_secret      text;
  v_auth_header text;
  v_request_id  bigint;
begin
  -- Skip cases without a location or those soft-deleted.
  if new.location_point is null or new.deleted_at is not null then
    return new;
  end if;

  -- Read service-role key from Supabase Vault. If the secret hasn't been
  -- created yet (first-deploy of this trigger before admin step),
  -- raise a warning and bail — don't break ingest.
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'service_role_key'
    limit 1;
  exception when others then
    raise warning 'notify_watch_zone_hit: vault.decrypted_secrets read failed (vault extension installed?)';
    return new;
  end;

  if v_secret is null or v_secret = '' then
    raise warning 'notify_watch_zone_hit: vault secret "service_role_key" not set';
    return new;
  end if;

  v_auth_header := 'Bearer ' || v_secret;

  -- Find every distinct user with a watch_zone polygon containing this
  -- case's location AND with notify_new_cases=true. Distinct because a
  -- single user could in theory have overlapping zones; we send one
  -- notification per case-per-user, not per-zone.
  for v_user_id in
    select distinct uw.user_id
    from public.user_watches uw
    where uw.watch_zone_geom is not null
      and uw.notify_new_cases = true
      and ST_Intersects(uw.watch_zone_geom, new.location_point)
  loop
    select net.http_post(
      url     := v_endpoint,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', v_auth_header
      ),
      body    := jsonb_build_object(
        'kind', 'watch_zone_hit',
        'case_id', new.id,
        'user_ids', jsonb_build_array(v_user_id)
      ),
      timeout_milliseconds := 5000
    ) into v_request_id;
    -- request id is logged so failures can be cross-referenced in
    -- net._http_response if a smoke test misses delivery.
  end loop;

  return new;
end $$;

drop trigger if exists cases_watch_zone_hit_trigger on public.cases;
create trigger cases_watch_zone_hit_trigger
  after insert on public.cases
  for each row
  execute function public.notify_watch_zone_hit();

-- ─────────────────────────────────────────────────────────────────────────
-- One-time admin setup (run separately AFTER applying this migration):
--
-- Step 1. Create the Vault secret with the service-role JWT.
--   In the Supabase Dashboard: Project Settings → Vault → New secret.
--   Name: service_role_key
--   Secret: <paste the service_role JWT from your repo's .env>
--
--   OR via SQL editor:
--     select vault.create_secret(
--       '<service_role_jwt>',  -- the secret value
--       'service_role_key',    -- the name this trigger looks up
--       'notify-fanout caller key for watch_zone_hit triggers'
--     );
--
-- Step 2. Verify the trigger reads it:
--     select decrypted_secret is not null
--     from vault.decrypted_secrets
--     where name = 'service_role_key';
--   → should return true
--
-- Rotation: if Supabase rotates the service-role key (or you rotate it
-- via Settings → API), update the Vault secret AND the Edge Function's
-- SUPABASE_SERVICE_ROLE_KEY env var. Both must agree or trigger calls
-- start returning 401:
--     select vault.update_secret(
--       (select id from vault.decrypted_secrets where name = 'service_role_key'),
--       '<new_service_role_jwt>'
--     );
-- ─────────────────────────────────────────────────────────────────────────
