-- DIAGNOSTIC (NOT a migration — paste into Supabase SQL editor).
--
-- Phase 1 audit for the location-recovery project. Goal: figure out
-- whether narrative-based extraction (LLM → geocode → writeback) is
-- worth building.
--
-- Five queries:
--   1. Per-source coverage — how many city-precision cases per source,
--      and what % carry a meaty narrative or agency-hint.
--   2. Narrative length distribution — are narratives substantive or
--      one-line city stubs.
--   3. Agency-hint coverage — what % of city-precision cases have an
--      extracted investigating-agency name.
--   4-6. Sample 15 narratives per major source to eyeball content for
--      extractable location signals (street names, landmarks, building
--      names, intersections, addresses).
--
-- After running, paste the results back. The signal-to-look-for in the
-- samples: do narratives contain phrases like "last seen at the Belen
-- rail yard" / "near the Mescalero Inn" / "1234 Main St" / "the parking
-- lot of the Westgate Shopping Center"? Or just "missing from Oxnard,
-- CA since 1985"?
--
-- If samples are mostly the latter, extraction is a money-losing
-- exercise (we'd burn LLM calls to recover the same city we already
-- have). If many carry concrete signals, extraction is the right
-- investment.

-- 1. Per-source coverage of city-precision cases.
select
  s.slug as source,
  count(distinct c.id) filter (where c.location_precision = 'city') as city_precision_cases,
  count(distinct c.id) filter (
    where c.location_precision = 'city'
      and c.narrative is not null
      and length(c.narrative) > 100
  ) as with_meaty_narrative,
  count(distinct c.id) filter (
    where c.location_precision = 'city'
      and c.primary_agency_name_raw is not null
  ) as with_agency_hint,
  round(
    100.0 * count(distinct c.id) filter (
      where c.location_precision = 'city'
        and c.narrative is not null
        and length(c.narrative) > 100
    ) / nullif(count(distinct c.id) filter (where c.location_precision = 'city'), 0),
    1
  ) as pct_with_narrative
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s on s.id = cs.source_id
where c.deleted_at is null
group by s.slug
having count(distinct c.id) filter (where c.location_precision = 'city') > 0
order by city_precision_cases desc;

-- 2. Narrative length distribution for all city-precision cases.
--    Buckets: 0 (none), 1-100 (stub), 101-500 (short), 501-2000 (substantive), 2000+ (long-form).
select
  case
    when narrative is null or length(narrative) = 0 then '0_none'
    when length(narrative) <= 100 then '1_stub'
    when length(narrative) <= 500 then '2_short'
    when length(narrative) <= 2000 then '3_substantive'
    else '4_long_form'
  end as narrative_bucket,
  count(*) as cases
from public.cases
where deleted_at is null
  and location_precision = 'city'
group by narrative_bucket
order by narrative_bucket;

-- 3. Agency-hint coverage.
select
  count(*) as total_city_precision,
  count(*) filter (where primary_agency_name_raw is not null) as with_agency_name,
  count(*) filter (where primary_agency_phone_raw is not null) as with_agency_phone,
  round(
    100.0 * count(*) filter (where primary_agency_name_raw is not null) / nullif(count(*), 0),
    1
  ) as pct_with_agency
from public.cases
where deleted_at is null
  and location_precision = 'city';

-- 4. Sample 15 charley_project narratives.
select c.slug, c.location_city, c.location_state, substr(c.narrative, 1, 800) as narrative_preview
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s on s.id = cs.source_id
where c.deleted_at is null
  and c.location_precision = 'city'
  and s.slug = 'charley_project'
  and c.narrative is not null
  and length(c.narrative) > 100
order by random()
limit 15;

-- 5. Sample 15 doe_network_uid narratives.
select c.slug, c.location_city, c.location_state, substr(c.narrative, 1, 800) as narrative_preview
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s on s.id = cs.source_id
where c.deleted_at is null
  and c.location_precision = 'city'
  and s.slug = 'doe_network_uid'
  and c.narrative is not null
  and length(c.narrative) > 100
order by random()
limit 15;

-- 6. Sample 15 doe_network narratives.
select c.slug, c.location_city, c.location_state, substr(c.narrative, 1, 800) as narrative_preview
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s on s.id = cs.source_id
where c.deleted_at is null
  and c.location_precision = 'city'
  and s.slug = 'doe_network'
  and c.narrative is not null
  and length(c.narrative) > 100
order by random()
limit 15;
