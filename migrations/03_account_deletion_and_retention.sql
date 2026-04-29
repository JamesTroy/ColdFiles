-- Migration 03 — account deletion RPC + tip_routings 12-month retention.
--
-- Wired together because the privacy policy ties them:
--   (a) delete_my_account() backs the in-app Me → Delete account screen
--       (app/delete-account.tsx). Previously the screen called this RPC
--       but no migration defined it — every deletion attempt threw
--       "function not found." Required by Play Store policy since 2024.
--   (b) Daily pg_cron job that purges tip_routings older than 12 months.
--       Matches the "Tip-routing audit log: retained for 12 months" claim
--       in the privacy policy.
--
-- Idempotent: safe to re-run.


-- ─────────────────────────────────────────────────────────────────────────
-- (a) delete_my_account()
-- ─────────────────────────────────────────────────────────────────────────
--
-- FK inventory at time of writing (see 01_schema.sql):
--   user_watches.user_id       on delete cascade  → free
--   user_subscriptions.user_id on delete cascade  → free
--   tip_routings.user_id       no cascade, nullable
--                              → must null before auth.users delete,
--                                else FK blocks. Nulling preserves
--                                content_hash / ip_hash for abuse
--                                detection while removing the user link.
--   takedown_requests.decided_by  internal admin reference, not user data
--
-- security definer is required to write to auth.users from a client role.
-- The auth.uid() guard makes self-only the only reachable code path:
-- the function runs with definer rights (postgres / god-mode) but reads
-- the JWT claim before doing anything, so it can only act on the calling
-- user's row. DO NOT change to security invoker — that breaks the
-- function (clients lack DELETE on auth.users) without making it safer.

create or replace function public.delete_my_account()
  returns json
  language plpgsql
  security definer
  set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- Anonymize tip-routing rows. The audit log (case_id, content_hash,
  -- ip_hash, timestamp) is retained for abuse detection per the privacy
  -- policy; only the user-identifying linkage is severed here.
  update public.tip_routings
    set user_id = null
    where user_id = uid;

  -- user_watches and user_subscriptions cascade on auth.users delete.
  delete from auth.users where id = uid;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- (b) tip_routings 12-month retention cron
-- ─────────────────────────────────────────────────────────────────────────
--
-- Twelve months gives abuse detection a useful comparison window without
-- indefinite retention of an event the user never opted into long-term.
-- Runs at 03:17 UTC — off-peak and off-the-hour to avoid clustering with
-- other infra cron jobs.

create extension if not exists pg_cron with schema extensions;

-- Drop any prior schedule of the same name so reruns don't accumulate
-- duplicate jobs.
do $$
declare
  existing_jid bigint;
begin
  select jobid into existing_jid
    from cron.job
    where jobname = 'tip-routings-purge-12mo';
  if existing_jid is not null then
    perform cron.unschedule(existing_jid);
  end if;
end $$;

select cron.schedule(
  'tip-routings-purge-12mo',
  '17 3 * * *',
  $$ delete from public.tip_routings where created_at < now() - interval '12 months' $$
);
