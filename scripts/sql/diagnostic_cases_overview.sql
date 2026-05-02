-- DIAGNOSTIC (NOT a migration — paste into Supabase SQL editor).
--
-- One-shot snapshot of the cases corpus as of right now. Six small
-- queries; each fits in a glance.

-- 1. Totals + kind breakdown.
select
  count(*) as total_cases,
  count(*) filter (where status = 'open') as open_cases,
  count(*) filter (where deleted_at is not null) as soft_deleted,
  count(*) filter (where kind in ('homicide', 'suspicious_death')) as homicide,
  count(*) filter (where kind = 'missing') as missing,
  count(*) filter (where kind in ('unidentified', 'unclaimed')) as doe
from public.cases;

-- 2. Cases per source (a case can attach to multiple sources).
select
  s.slug as source,
  s.name as source_name,
  s.active,
  count(distinct cs.case_id) as cases_attributed,
  count(*) filter (where c.kind in ('homicide','suspicious_death')) as homicide,
  count(*) filter (where c.kind = 'missing') as missing,
  count(*) filter (where c.kind in ('unidentified','unclaimed')) as doe
from public.case_sources cs
join public.sources s on s.id = cs.source_id
join public.cases c on c.id = cs.case_id
where c.deleted_at is null
group by s.slug, s.name, s.active
order by cases_attributed desc;

-- 3. Data quality — which fields are actually populated.
select
  count(*) as total,
  count(*) filter (where incident_date is not null) as with_incident_date,
  count(*) filter (where last_seen_date is not null) as with_last_seen_date,
  count(*) filter (where location_state is not null) as with_state,
  count(*) filter (where location_point is not null) as with_geocode,
  count(*) filter (where has_photo) as with_photo,
  count(*) filter (where has_reconstruction) as with_reconstruction,
  count(*) filter (where narrative is not null) as with_narrative
from public.cases
where deleted_at is null;

-- 4. Geographic spread — top 12 states.
select
  location_state,
  count(*) as total,
  count(*) filter (where kind in ('homicide','suspicious_death')) as homicide,
  count(*) filter (where kind = 'missing') as missing,
  count(*) filter (where kind in ('unidentified','unclaimed')) as doe
from public.cases
where deleted_at is null and location_state is not null
group by location_state
order by total desc
limit 12;

-- 5. Date-range buckets — how cold are these cases?
select
  case
    when incident_date is null then 'unknown'
    when incident_date >= current_date - interval '5 years' then 'under 5y'
    when incident_date >= current_date - interval '10 years' then '5–10y'
    when incident_date >= current_date - interval '25 years' then '10–25y'
    when incident_date >= current_date - interval '50 years' then '25–50y'
    else '50y+'
  end as age_bucket,
  count(*) as cases
from public.cases
where deleted_at is null
group by age_bucket
order by min(incident_date) nulls last;

-- 6. Recent ingest activity — last 7 days.
select
  date_trunc('day', last_changed_at)::date as day,
  count(*) as cases_touched
from public.cases
where deleted_at is null
  and last_changed_at >= current_date - interval '7 days'
group by day
order by day desc;
