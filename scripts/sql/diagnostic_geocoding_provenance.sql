-- DIAGNOSTIC (NOT a migration — paste into Supabase SQL editor).
--
-- Audits the live state of cases.location_precision before migration 31
-- formalizes a CHECK constraint, and sizes the optional geocoding_source
-- backfill. Three queries; results inform whether the constraint as drafted
-- will accept all existing rows or needs a normalization pre-step.

-- 1. Precision value distribution. Expected set per persist.ts + geocode.ts:
--    'address' | 'street' | 'city' | 'county' | 'state' | 'unknown' | NULL.
--    Anything outside that set ('address_street', 'precise', '', etc.) means
--    historical drift — flag for normalization before applying the CHECK.
select
  location_precision,
  count(*) as cases
from public.cases
group by 1
order by count(*) desc nulls last;

-- 2. Integrity check: rows with a point but no precision.
--    persist.ts populates precision on both branches when it writes a point,
--    so this should be ~0. Non-zero = manual insert, pre-persist.ts data, or
--    a code path bypassing the resolver. Doesn't block the migration (CHECK
--    allows NULL) — informs whether to schedule a separate cleanup.
select count(*) as point_without_precision
from public.cases
where location_point is not null
  and location_precision is null
  and deleted_at is null;

-- 3. Source distribution for sizing geocoding_source backfill.
--    If one source dominates with_point, the heuristic backfill (NamUs/FBI =
--    source_native, everything else = mapbox) is basically free. If evenly
--    distributed, leave historical rows NULL and only populate forward.
select
  s.slug as source,
  count(distinct cs.case_id) filter (where c.location_point is not null) as with_point,
  count(distinct cs.case_id) filter (where c.location_point is null)     as without_point
from public.cases c
left join public.case_sources cs on cs.case_id = c.id
left join public.sources s       on s.id = cs.source_id
where c.deleted_at is null
group by s.slug
order by with_point desc nulls last;
