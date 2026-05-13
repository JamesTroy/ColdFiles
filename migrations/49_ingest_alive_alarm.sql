-- Migration 49 — synthetic ingest-alive alarm.
--
-- The corpus must keep moving. When `last_changed_at` ∪ `created_at` stops
-- advancing for longer than the configured threshold, the scrapers are
-- silently stalled (Vault-secret bug, scrape-cli runner down, source-side
-- outage, etc.). The signal exists in the data — we just need a check that
-- runs without being told.
--
-- Why a hourly cron, not a manual smoke test:
-- The watch_zone_hit smoke test (scripts/smoke-test-watch-zone-hit.sh) is
-- the canonical end-to-end check, but it's operator-triggered. The silent-
-- whitespace memory's whole point is "test the prod codepath" — and the
-- only way to do that without a human in the loop is a synthetic check
-- that runs on a schedule and pages the operator when something's wrong.
-- See feedback_silent_whitespace_in_config + feedback_ingest_metric_axis.
--
-- Architecture:
--   pg_cron (hourly)
--     ↓
--   check_ingest_alive()
--     ↓ greatest(max(last_changed_at), max(created_at)) > threshold?
--     ↓ yes:
--   pg_net.http_post → notify-fanout (kind='ingest_alive_alarm',
--                                      user_ids=[operator_user_id])
--     ↓
--   operator receives a push notification on their device
--
-- Thresholds + identities live in Supabase Vault — same pattern as
-- migration 19's service_role_key. Three secrets total:
--   - service_role_key             (already exists, mig 19)
--   - operator_user_id             (NEW — the user_id that receives the alarm)
--   - ingest_alive_threshold_hours (NEW — defaults to 24 if unset)
--
-- Idempotent: drops and recreates the function + cron job.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.check_ingest_alive() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endpoint constant text := 'https://gzfndxabaispgcotklni.supabase.co/functions/v1/notify-fanout';
  v_secret              text;
  v_operator_user_id    text;
  v_threshold_hours_txt text;
  v_threshold_hours     int;
  v_max_ts              timestamptz;
  v_hours_quiet         numeric;
  v_request_id          bigint;
begin
  -- Load all three secrets up front so a missing one surfaces a single,
  -- clear log line rather than a partial-success state.
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where trim(name) = 'service_role_key'
    limit 1;
  exception when others then
    raise warning 'check_ingest_alive: vault read failed (extension installed?)';
    return;
  end;

  select decrypted_secret into v_operator_user_id
  from vault.decrypted_secrets
  where trim(name) = 'operator_user_id'
  limit 1;

  select decrypted_secret into v_threshold_hours_txt
  from vault.decrypted_secrets
  where trim(name) = 'ingest_alive_threshold_hours'
  limit 1;

  -- A missing operator_user_id is fatal — there's no recipient. Log + bail
  -- so the cron doesn't loop firing nowhere. Whitespace-trim defends
  -- against the silent-whitespace failure mode that already bit
  -- watch_zone_hit (see feedback_silent_whitespace_in_config).
  v_operator_user_id := nullif(trim(coalesce(v_operator_user_id, '')), '');
  if v_operator_user_id is null then
    raise warning 'check_ingest_alive: vault secret "operator_user_id" not set — alarm has no recipient';
    return;
  end if;

  if v_secret is null or trim(v_secret) = '' then
    raise warning 'check_ingest_alive: vault secret "service_role_key" not set';
    return;
  end if;

  -- Threshold defaults to 24h. A bad value (non-numeric) reads as default
  -- rather than blowing up — operator-side typo shouldn't kill the alarm.
  v_threshold_hours := coalesce(
    nullif(trim(coalesce(v_threshold_hours_txt, '')), '')::int,
    24
  );

  -- Quiet-time metric: greatest of (last_changed_at, created_at) per
  -- feedback_ingest_metric_axis. Either column moving counts as "alive";
  -- new inserts populate created_at and existing-row updates advance
  -- last_changed_at. ORDER BY id-style indexes don't help here — this is
  -- a one-row aggregate, runs in milliseconds even on a large cases table.
  select greatest(
    coalesce(max(last_changed_at), '-infinity'::timestamptz),
    coalesce(max(created_at), '-infinity'::timestamptz)
  )
  into v_max_ts
  from public.cases
  where deleted_at is null;

  v_hours_quiet := extract(epoch from (now() - v_max_ts)) / 3600.0;

  if v_hours_quiet < v_threshold_hours then
    -- All good. Don't spam the operator with "everything is fine" pings —
    -- absence of alarm IS the success signal. The cron itself logs to
    -- cron.job_run_details so "did the check run?" is independently
    -- observable from "did anything fire?".
    return;
  end if;

  -- Fire the alarm.
  select net.http_post(
    url     := v_endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || trim(v_secret)
    ),
    body    := jsonb_build_object(
      'kind', 'ingest_alive_alarm',
      'user_ids', jsonb_build_array(v_operator_user_id),
      'hours_quiet', round(v_hours_quiet, 1),
      'threshold_hours', v_threshold_hours
    ),
    timeout_milliseconds := 5000
  ) into v_request_id;

  raise notice 'check_ingest_alive: fired alarm (quiet=%h threshold=%h request_id=%)',
    round(v_hours_quiet, 1), v_threshold_hours, v_request_id;
end $$;

-- Schedule hourly. Cadence chosen as a compromise: too-frequent burns
-- cron budget; too-rare delays the page. A 24h-threshold + 1h-cadence
-- means the operator hears about a stall within an hour of crossing
-- the threshold, never sooner-than-warranted.
do $$
declare jids bigint[]; jid bigint;
begin
  select array_agg(jobid) into jids from cron.job where jobname = 'ingest-alive-check';
  if jids is not null then
    foreach jid in array jids loop
      perform cron.unschedule(jid);
    end loop;
  end if;
end $$;

select cron.schedule(
  'ingest-alive-check',
  '7 * * * *',  -- every hour at HH:07 (offset from retention sweeps at HH:23/29/34/41)
  $$ select public.check_ingest_alive() $$
);

-- ─────────────────────────────────────────────────────────────────────────
-- One-time admin setup (run separately AFTER applying this migration):
--
-- Step 1. Create the operator_user_id Vault secret.
--   First find your user_id:
--     select id from auth.users where email = '<your-email>';
--
--   Then:
--     select vault.create_secret(
--       '<your_user_uuid>',
--       'operator_user_id',
--       'recipient for synthetic ingest-alive alarms (mig 49)'
--     );
--
-- Step 2 (optional). Override the default 24h threshold:
--     select vault.create_secret(
--       '12',
--       'ingest_alive_threshold_hours',
--       'how many hours of corpus quiet before the alarm fires'
--     );
--   Leaving this unset uses the 24h default.
--
-- Step 3. Make sure your device has a push_tokens row matching the
-- operator_user_id and that prefs.systemAlarms is true (default).
--
-- Step 4. Validate end-to-end via the smoke script:
--     bash scripts/smoke-test-ingest-alive.sh
--
-- Rotation: if the operator user_id changes (rare — would mean a fresh
-- auth signup), update the secret:
--     select vault.update_secret(
--       (select id from vault.decrypted_secrets where trim(name) = 'operator_user_id'),
--       '<new_user_uuid>'
--     );
-- ─────────────────────────────────────────────────────────────────────────
