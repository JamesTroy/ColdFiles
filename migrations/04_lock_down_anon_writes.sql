-- Migration 04 — close direct-anon write paths and enable RLS on internal tables.
--
-- Audit finding (docs/audit/security/04-api-surface.md, items 1.1, 1.2, 1.3):
-- The original RLS policies on tip_routings and takedown_requests used
-- `with check (true)`, which let any anon JWT POST directly to PostgREST
-- (e.g. /rest/v1/tip_routings) and forge audit fields (ip_hash, user_id,
-- routed_to_*). The Edge Functions are the intended only entry point;
-- service_role bypasses RLS by default in Supabase, so locking the
-- policies down to `false` keeps the Edge-Function path working while
-- closing the direct-anon door.
--
-- A separate finding: four internal tables (source_runs, robots_cache,
-- geocode_cache, dedupe_review_queue) had RLS disabled entirely, so anon
-- could read scrape internals + every geocoded location string and pollute
-- the tables with INSERTs. With RLS on and no policy, all non-service
-- access is denied.
--
-- Idempotent: safe to re-run.


-- ─────────────────────────────────────────────────────────────────────────
-- (a) tip_routings — replace permissive insert with explicit deny.
-- ─────────────────────────────────────────────────────────────────────────
--
-- The Edge Function tip-route-submit uses SUPABASE_SERVICE_ROLE_KEY which
-- bypasses RLS entirely. Anon and authenticated roles can no longer write
-- via PostgREST. The select policy elsewhere in 01_schema.sql still gates
-- reads on auth.uid() = user_id (write-only audit from the user's
-- perspective).

drop policy if exists tip_routings_insert on public.tip_routings;
drop policy if exists tip_routings_no_direct_insert on public.tip_routings;
create policy tip_routings_no_direct_insert on public.tip_routings
  for insert with check (false);


-- ─────────────────────────────────────────────────────────────────────────
-- (b) takedown_requests — same pattern.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Takedowns currently arrive over email (per privacy policy).  When we
-- ship a request-takedown Edge Function in v1.0.1+, it will use the
-- service-role and write through this policy unchanged.

drop policy if exists takedown_requests_insert on public.takedown_requests;
drop policy if exists takedown_requests_no_direct_insert on public.takedown_requests;
create policy takedown_requests_no_direct_insert on public.takedown_requests
  for insert with check (false);


-- ─────────────────────────────────────────────────────────────────────────
-- (c) Enable RLS on internal scraper / cache tables.
-- ─────────────────────────────────────────────────────────────────────────
--
-- These tables hold scrape state, robots.txt cache, geocode cache, and
-- the dedupe-review queue. None of it is user-facing; all access happens
-- via the service-role from Edge Functions and CLI scripts. With RLS
-- enabled and no policies declared, anon and authenticated have zero
-- access; service-role continues to bypass.

alter table public.source_runs enable row level security;
alter table public.robots_cache enable row level security;
alter table public.geocode_cache enable row level security;
alter table public.dedupe_review_queue enable row level security;
