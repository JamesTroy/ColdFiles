-- DIAGNOSTIC (NOT a migration — paste into Supabase SQL editor).
--
-- Coverage check: where does the corpus stand on Doe (unidentified)
-- and homicide cases, post-2026-05-01 batch ingest.

-- 1. Top-level: how many cases by kind?
select
  kind,
  count(*) as total,
  count(*) filter (where status = 'open') as open,
  count(distinct location_state) as states_covered
from public.cases
group by kind
order by total desc;

-- 2. Doe sub-breakdown: missing vs unidentified vs unclaimed.
--    The "Doe" community covers all three but they have different
--    typical source profiles.
select
  kind,
  count(*) as total,
  count(*) filter (where has_photo) as with_photo,
  count(*) filter (where has_reconstruction) as with_reconstruction,
  count(*) filter (where last_seen_date is not null) as with_last_seen
from public.cases
where kind in ('unidentified', 'unclaimed', 'missing')
group by kind
order by total desc;

-- 3. Homicide coverage by source. Per project: homicide cases come
--    from FBI Wanted, occasional Charley/Doe entries, and the v1.x-
--    pending LASD homicide bureau scraper.
select
  s.slug as source,
  s.name as source_name,
  count(distinct cs.case_id) filter (where c.kind in ('homicide', 'suspicious_death')) as homicide_cases
from public.case_sources cs
join public.cases c on c.id = cs.case_id
join public.sources s on s.id = cs.source_id
group by s.slug, s.name
having count(distinct cs.case_id) filter (where c.kind in ('homicide', 'suspicious_death')) > 0
order by homicide_cases desc;

-- 4. Homicide age distribution — how cold are our homicides?
select
  case
    when extract(year from age(current_date, incident_date)) < 5 then 'under 5y'
    when extract(year from age(current_date, incident_date)) < 10 then '5–10y'
    when extract(year from age(current_date, incident_date)) < 25 then '10–25y'
    when extract(year from age(current_date, incident_date)) < 50 then '25–50y'
    else '50y+'
  end as age_bucket,
  count(*) as cases
from public.cases
where kind in ('homicide', 'suspicious_death')
  and incident_date is not null
group by age_bucket
order by min(extract(year from age(current_date, incident_date)));

-- 5. Doe (unidentified + unclaimed) age distribution — same bucketing.
select
  case
    when extract(year from age(current_date, incident_date)) < 5 then 'under 5y'
    when extract(year from age(current_date, incident_date)) < 10 then '5–10y'
    when extract(year from age(current_date, incident_date)) < 25 then '10–25y'
    when extract(year from age(current_date, incident_date)) < 50 then '25–50y'
    else '50y+'
  end as age_bucket,
  count(*) as cases
from public.cases
where kind in ('unidentified', 'unclaimed')
  and incident_date is not null
group by age_bucket
order by min(extract(year from age(current_date, incident_date)));

-- 6. Geographic spread for both types — how many cases per state, top 15.
select
  location_state,
  count(*) filter (where kind in ('homicide', 'suspicious_death')) as homicides,
  count(*) filter (where kind in ('unidentified', 'unclaimed')) as does,
  count(*) filter (where kind = 'missing') as missing
from public.cases
where location_state is not null
group by location_state
order by (count(*) filter (where kind in ('homicide','suspicious_death','unidentified','unclaimed','missing'))) desc
limit 15;
