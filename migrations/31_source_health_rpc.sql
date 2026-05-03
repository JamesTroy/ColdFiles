-- Migration 31 — per-source health surface for the About screen.
--
-- Returns one row per active source with the most recent ingest activity
-- timestamp. Drives the "Source status" block on the About screen — the
-- user-facing slice of the same metric the architecture review flagged
-- as the right ingest-health axis (last_changed_at / last_ingested_at,
-- not created_at).
--
-- Design context (memory: feedback_ingest_metric_axis):
--   Per-source, NOT corpus-wide max. A corpus-wide MAX(last_ingested_at)
--   collapses four sources into one number and hides exactly the failure
--   mode the signal is meant to catch — one source stalls while others
--   stay healthy, the global max stays fresh, the dashboard reads green.
--   Per-source breaks the failure into something visible.
--
--   Wording on the consuming side names "checks" not "refreshes" — a
--   re-scrape that touches stale records sets the timestamp without
--   anything meaningfully changing per-case. "Sources last checked" is
--   mechanically accurate and doesn't imply per-case freshness.
--
-- Public-readable: SECURITY DEFINER + grant to anon + authenticated.
-- About screen is unauthenticated; anon needs to read this. The function
-- exposes only aggregate data (source name + timestamp), no per-case
-- information that would leak through cases_public_read's filters.
--
-- Idempotent via CREATE OR REPLACE.

create or replace function public.source_health()
returns table (
  source_slug text,
  source_name text,
  last_checked timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.slug,
    s.name,
    max(cs.last_ingested_at) as last_checked
  from public.case_sources cs
  join public.sources s on s.id = cs.source_id
  where s.active = true
  group by s.slug, s.name
  order by s.name;
$$;

revoke all on function public.source_health() from public;
grant execute on function public.source_health() to anon, authenticated;
