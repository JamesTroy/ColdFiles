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
--   - The Edge Function endpoint + service-role key are read from custom
--     GUCs set via `alter database ... set ...`. Setting these is a
--     one-time admin step — see the bottom of this file.
--
-- Idempotent: drops and recreates the function + trigger.

create extension if not exists pg_net;

create or replace function public.notify_watch_zone_hit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid;
  v_endpoint    text;
  v_auth_header text;
  v_request_id  bigint;
begin
  -- Skip cases without a location or those soft-deleted.
  if new.location_point is null or new.deleted_at is not null then
    return new;
  end if;

  -- Read endpoint + service-role key from database settings. Set these
  -- via `alter database postgres set ...` — see bottom of this file.
  -- If they're missing, log once and bail without erroring (don't break
  -- ingest).
  begin
    v_endpoint := current_setting('app.notify_fanout_url', true);
    v_auth_header := 'Bearer ' || current_setting('app.service_role_key', true);
  exception when others then
    raise warning 'notify_watch_zone_hit: missing app.notify_fanout_url or app.service_role_key GUCs';
    return new;
  end;

  if v_endpoint is null or v_endpoint = '' then
    raise warning 'notify_watch_zone_hit: app.notify_fanout_url not set';
    return new;
  end if;

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
-- One-time admin setup (run separately, NOT on every migration apply):
--
--   alter database postgres
--     set "app.notify_fanout_url" = 'https://<project-ref>.supabase.co/functions/v1/notify-fanout';
--   alter database postgres
--     set "app.service_role_key" = '<service_role_jwt>';
--
-- After running these, reload the role's settings so existing connections
-- pick them up:
--   select pg_reload_conf();
--
-- The service-role key is rotation-sensitive — when Supabase rotates it,
-- update both the GUC above AND the Edge Function's SUPABASE_SERVICE_ROLE_KEY
-- env var. Both must agree or trigger calls will start returning 401.
-- ─────────────────────────────────────────────────────────────────────────
