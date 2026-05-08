-- DIAGNOSTIC (NOT a migration — paste into Supabase SQL editor).
--
-- Companion to migrations/37_curated_reward_overrides.sql.
--
-- Purpose: surface candidate cases for Tier 3 (hand-curated reward
-- overlay). The rule for inclusion is high-confidence + auditable:
--   - case is recent enough that an active reward is plausible
--     (incident in the last ~15 years, OR explicitly re-affirmed in
--     a recent press release the curator can cite),
--   - narrative mentions a dollar amount + reward language, AND
--   - the case is attached to a source / agency that publishes
--     reward bulletins (FBI, LASD, named agency feed).
--
-- The output is a starting list; each row still needs human
-- verification against a primary-source URL before it gets added
-- to the migration. Read-only.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Recent (last 25 yrs) + reward-mentioning cases. Loose net —
--    no agency filter, since Charley cases don't carry one. Curator
--    picks from the rows that read as a CURRENT reward (phrasing
--    like "is offering" beats "was offered"; recent year of incident
--    beats 1980s).
-- ─────────────────────────────────────────────────────────────────────
select
  c.slug,
  c.victim_name,
  extract(year from c.incident_date)::int as year,
  c.location_state,
  a.name as agency_name,
  -- Tight window around the first "reward" mention so the curator
  -- can read the phrasing and decide whether it's current.
  substring(
    c.narrative
    from greatest(1, position('reward' in lower(c.narrative)) - 80)
    for 240
  ) as context,
  cs.source_url
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s       on s.id = cs.source_id
left join public.agencies a on a.id = c.primary_agency_id
where c.deleted_at is null
  and c.status = 'open'
  and c.narrative ~* '\$\s*[\d,]+[^.]{0,80}\yreward\y|\yreward\y[^.]{0,80}\$\s*[\d,]+'
  and c.incident_date >= (current_date - interval '25 years')
order by c.incident_date desc
limit 60;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Cases the user has already saved / starred. If anyone on the
--    team has personally vouched for these, they're better-than-
--    average curation candidates. (Skip if not signed in or no rows.)
-- ─────────────────────────────────────────────────────────────────────
-- (Intentionally not implemented — saved_cases is per-user; the
-- curator should pick from query 1.)

-- ─────────────────────────────────────────────────────────────────────
-- 3. High-publicity flag — cases marked is_high_publicity AND with
--    reward language. Editorial/operator pre-flag is the strongest
--    signal we have for "this case has been triaged."
-- ─────────────────────────────────────────────────────────────────────
select
  c.slug,
  c.victim_name,
  c.incident_date,
  c.location_city,
  c.location_state,
  substring(
    c.narrative
    from greatest(1, position('reward' in lower(c.narrative)) - 80)
    for 240
  ) as context,
  cs.source_url
from public.cases c
join public.case_sources cs on cs.case_id = c.id
where c.deleted_at is null
  and c.status = 'open'
  and c.is_high_publicity = true
  and c.narrative ~* '\$\s*[\d,]+[^.]{0,80}\yreward\y|\yreward\y[^.]{0,80}\$\s*[\d,]+'
order by c.incident_date desc
limit 40;
