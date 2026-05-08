-- DIAGNOSTIC (NOT a migration — paste into Supabase SQL editor).
--
-- Probe for Tier 2(a) of the reward-extraction plan: figure out whether
-- a narrative-regex backfill on Charley Project cases is worth doing,
-- and which candidate patterns hit real reward language vs. historical /
-- expired / unrelated mentions.
--
-- Run each query in sequence. Read the counts in queries 1-5 first to
-- decide whether to look at the samples in 6-9. If query 2's count is
-- under ~50, the entire effort is probably not worth a migration; the
-- rows are easier to hand-curate via Tier 3.
--
-- Read-only. Nothing in this script writes to the database.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Universe — Charley cases with a non-null narrative.
--    Denominator for everything below.
-- ─────────────────────────────────────────────────────────────────────
select
  count(distinct c.id) as charley_cases_with_narrative
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s       on s.id = cs.source_id
where s.slug = 'charley_project'
  and c.narrative is not null
  and c.deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Coarse filter — narratives mentioning "reward" at all.
--    Upper bound on what regex extraction could ever yield.
-- ─────────────────────────────────────────────────────────────────────
select
  count(distinct c.id) as charley_with_reward_word
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s       on s.id = cs.source_id
where s.slug = 'charley_project'
  and c.narrative ~* '\yreward\y'
  and c.deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Candidate pattern hit-counts.
--    Each row = one regex; counts are the rows it would touch.
--    Patterns overlap, so summing is meaningless — read them as
--    "this many rows have this shape of reward language."
-- ─────────────────────────────────────────────────────────────────────
with charley as (
  select c.id, c.slug, c.narrative
  from public.cases c
  join public.case_sources cs on cs.case_id = c.id
  join public.sources s       on s.id = cs.source_id
  where s.slug = 'charley_project'
    and c.narrative is not null
    and c.deleted_at is null
)
select
  'A: $N reward'             as pattern_label,
  count(*) filter (where narrative ~* '\$\s*[\d,]+\s+(?:cash\s+)?reward\b') as hits
from charley
union all
select
  'B: reward of [up to] $N',
  count(*) filter (where narrative ~* '\yreward\s+of\s+(?:up\s+to\s+)?\$\s*[\d,]+')
from charley
union all
select
  'C: $N is/has/was offered',
  count(*) filter (where narrative ~* '\$\s*[\d,]+[^.]{0,40}\b(?:is|has|was|will\s+be|being)\s+(?:being\s+)?offered')
from charley
union all
select
  'D: $N (any reward window, ±60 chars)',
  count(*) filter (where narrative ~* '\$\s*[\d,]+[^.]{0,80}\yreward\y|\yreward\y[^.]{0,80}\$\s*[\d,]+')
from charley
union all
-- Negative — historical reward language we'd want to EXCLUDE.
select
  'NEG-1: was/were offered ... reward (likely historical)',
  count(*) filter (where narrative ~* '\y(?:was|were|formerly|previously)\s+(?:offered|offering|posted)[^.]{0,80}\yreward\y')
from charley
union all
select
  'NEG-2: reward ... expired/withdrawn/no longer',
  count(*) filter (where narrative ~* '\yreward\y[^.]{0,80}\y(?:expired|withdrawn|no\s+longer|rescinded)\y')
from charley
;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Pattern A samples — "$N reward" / "$N cash reward".
--    The most precise pattern. If samples here look clean, this is
--    the keep-it-simple migration target.
-- ─────────────────────────────────────────────────────────────────────
select
  c.slug,
  substring(c.narrative from '\$\s*[\d,]+\s+(?:cash\s+)?reward\b')           as match,
  -- Window of context around the first "reward" occurrence.
  substring(
    c.narrative
    from greatest(1, position('reward' in lower(c.narrative)) - 60)
    for 200
  ) as context
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s       on s.id = cs.source_id
where s.slug = 'charley_project'
  and c.deleted_at is null
  and c.narrative ~* '\$\s*[\d,]+\s+(?:cash\s+)?reward\b'
order by c.last_changed_at desc
limit 50;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Pattern B samples — "reward of $N" / "reward of up to $N".
-- ─────────────────────────────────────────────────────────────────────
select
  c.slug,
  substring(c.narrative from '\yreward\s+of\s+(?:up\s+to\s+)?\$\s*[\d,]+')   as match,
  substring(
    c.narrative
    from greatest(1, position('reward' in lower(c.narrative)) - 60)
    for 200
  ) as context
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s       on s.id = cs.source_id
where s.slug = 'charley_project'
  and c.deleted_at is null
  and c.narrative ~* '\yreward\s+of\s+(?:up\s+to\s+)?\$\s*[\d,]+'
order by c.last_changed_at desc
limit 50;

-- ─────────────────────────────────────────────────────────────────────
-- 6. NEG-1 samples — historical reward language.
--    These are the rows we want to NOT touch with the backfill.
--    Look here if the precision of A/B looks good but you're worried
--    about overlap — these should ideally be a small set distinct
--    from the matches in 4 + 5.
-- ─────────────────────────────────────────────────────────────────────
select
  c.slug,
  substring(
    c.narrative
    from greatest(1, position('reward' in lower(c.narrative)) - 80)
    for 240
  ) as context
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s       on s.id = cs.source_id
where s.slug = 'charley_project'
  and c.deleted_at is null
  and c.narrative ~* '\y(?:was|were|formerly|previously)\s+(?:offered|offering|posted)[^.]{0,80}\yreward\y'
order by c.last_changed_at desc
limit 30;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Wide-net sample — anything with "reward" + a "$" within 80 chars,
--    that did NOT match A or B. Surface near-misses we should add a
--    pattern for, or noise we should ignore.
-- ─────────────────────────────────────────────────────────────────────
select
  c.slug,
  substring(
    c.narrative
    from greatest(1, position('reward' in lower(c.narrative)) - 60)
    for 200
  ) as context
from public.cases c
join public.case_sources cs on cs.case_id = c.id
join public.sources s       on s.id = cs.source_id
where s.slug = 'charley_project'
  and c.deleted_at is null
  and c.narrative ~* '\$\s*[\d,]+[^.]{0,80}\yreward\y|\yreward\y[^.]{0,80}\$\s*[\d,]+'
  and not (c.narrative ~* '\$\s*[\d,]+\s+(?:cash\s+)?reward\b')
  and not (c.narrative ~* '\yreward\s+of\s+(?:up\s+to\s+)?\$\s*[\d,]+')
order by c.last_changed_at desc
limit 30;
