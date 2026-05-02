-- DIAGNOSTIC (NOT a migration — run in Supabase SQL editor as a SELECT).
--
-- Hunts for cases where a date field that should be historical
-- (incident_date / last_seen_date) is set to a value that's suspiciously
-- recent. The Cold File only ingests cold cases, so any case with
-- incident_date >= the most-recent ingest date is almost certainly a
-- bug — the source either didn't provide a date and an extractor
-- defaulted to today, or the extractor mis-parsed an "as of" date as
-- the incident date.
--
-- Run each block; review results. Nothing is mutated.

-- 1. Cases whose incident_date is within the last 30 days.
--    Expected: zero rows. Cold cases by definition aren't recent.
select
  slug,
  victim_first_name || ' ' || victim_last_name as name,
  kind,
  incident_date,
  incident_date_quality,
  incident_date_text,
  last_changed_at::date as ingested_on
from public.cases
where incident_date >= current_date - interval '30 days'
order by incident_date desc, last_changed_at desc;

-- 2. Cases whose last_seen_date is within the last 30 days.
--    Same posture. Missing-persons cases here would be active
--    investigations, not cold cases.
select
  slug,
  victim_first_name || ' ' || victim_last_name as name,
  kind,
  last_seen_date,
  last_seen_text,
  last_changed_at::date as ingested_on
from public.cases
where last_seen_date >= current_date - interval '30 days'
order by last_seen_date desc, last_changed_at desc;

-- 3. Specifically: cases whose incident_date or last_seen_date matches
--    yesterday's date in your timezone (the "May 1" case under
--    investigation).
select
  slug,
  victim_first_name || ' ' || victim_last_name as name,
  kind,
  incident_date,
  last_seen_date,
  last_changed_at::date as ingested_on,
  -- The source row tells us where the bad date came from.
  (select array_agg(s.slug) from public.case_sources cs
   join public.sources s on s.id = cs.source_id
   where cs.case_id = c.id) as sources
from public.cases c
where (
  incident_date::text = '2026-05-01'
  or last_seen_date::text = '2026-05-01'
);

-- 4. Aggregate sanity check: distinct dates among the most-recent 50
--    cases-by-ingest. Useful for spotting "everything ingested today
--    has the same fake date" patterns.
select
  incident_date,
  count(*) as cases_with_this_date,
  max(last_changed_at::date) as most_recently_ingested
from public.cases
where last_changed_at >= current_date - interval '7 days'
group by incident_date
order by cases_with_this_date desc
limit 25;
