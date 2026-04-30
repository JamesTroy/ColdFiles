-- Migration 05 — performance indexes + retention crons.
--
-- Wraps three findings from docs/audit/security/06-data-and-sql.md and 08:
--
--   (a) tip_routings_iphash_created_idx — needed by the tip-route-submit
--       Edge Function rate limiter. Without it, every POST does a seq-scan
--       of tip_routings to count recent ip_hash matches.
--
--   (b) tip_routings_user_idx — delete_my_account() (migration 03) UPDATEs
--       tip_routings WHERE user_id = uid. With no index it seq-scans the
--       table on every account-delete request. Closed-test scale, fine;
--       under load, painful.
--
--   (c) Retention crons for source_runs / robots_cache / geocode_cache /
--       dedupe_review_queue. Migration 03 set up tip_routings retention; the
--       scrape plumbing tables were left to grow unbounded. Right-sized to
--       what each table is actually used for: source_runs is observability
--       (90 days), robots_cache regenerates on access (30 days), geocode_cache
--       is expensive to rebuild (1 year), dedupe_review_queue resolved rows
--       are post-mortem only (90 days).
--
-- Idempotent: safe to re-run.


-- ─────────────────────────────────────────────────────────────────────────
-- (a) tip_routings rate-limit index
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists tip_routings_iphash_created_idx
  on public.tip_routings (ip_hash, created_at desc);


-- ─────────────────────────────────────────────────────────────────────────
-- (b) tip_routings user_id index
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists tip_routings_user_idx
  on public.tip_routings (user_id)
  where user_id is not null;


-- ─────────────────────────────────────────────────────────────────────────
-- (c) Retention crons
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron with schema extensions;

-- Helper to drop a prior schedule of the same name so reruns don't
-- accumulate duplicate jobs.
do $$
declare
  jname text;
  jids bigint[];
  jid bigint;
begin
  foreach jname in array array[
    'source-runs-purge-90d',
    'robots-cache-purge-30d',
    'geocode-cache-purge-1y',
    'dedupe-queue-purge-90d'
  ] loop
    select array_agg(jobid) into jids from cron.job where jobname = jname;
    if jids is not null then
      foreach jid in array jids loop
        perform cron.unschedule(jid);
      end loop;
    end if;
  end loop;
end $$;

-- source_runs: keep 90 days for observability / scrape-failure forensics.
select cron.schedule(
  'source-runs-purge-90d',
  '23 3 * * *',
  $$ delete from public.source_runs where started_at < now() - interval '90 days' $$
);

-- robots_cache: TTL is already encoded in expires_at; sweep stale rows daily.
-- 30-day floor catches rows whose expires_at was never set (bug guard).
select cron.schedule(
  'robots-cache-purge-30d',
  '29 3 * * *',
  $$ delete from public.robots_cache
       where expires_at < now()
          or fetched_at < now() - interval '30 days' $$
);

-- geocode_cache: 1 year. Geocoding is the expensive lookup; we want long TTL
-- but not indefinite (street-name changes, tract redraws).
select cron.schedule(
  'geocode-cache-purge-1y',
  '34 3 * * *',
  $$ delete from public.geocode_cache where cached_at < now() - interval '1 year' $$
);

-- dedupe_review_queue: keep pending rows forever (they're work to do); purge
-- resolved rows after 90 days.
select cron.schedule(
  'dedupe-queue-purge-90d',
  '41 3 * * *',
  $$ delete from public.dedupe_review_queue
       where status in ('merged', 'rejected')
         and resolved_at < now() - interval '90 days' $$
);
