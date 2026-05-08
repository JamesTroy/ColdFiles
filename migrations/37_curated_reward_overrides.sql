-- Migration 37 -- Curated reward overlay (Tier 3 of reward extraction plan).
--
-- Cases listed here have a verified, current monetary reward published by
-- a primary source. Each entry below pairs a slug with the parsed integer
-- USD amount. The companion text column (reward_text) is left untouched --
-- Charley's verbatim phrasing ("The FBI is offering a reward of up to
-- $50,000...") is the source of truth and a future re-scrape should win.
--
-- This is a hand-curation file, not an extractor. It exists because:
--   - Charley narrative regex backfill failed validation (mixed historical,
--     stale, and unrelated reward language; see scripts/sql/diagnostic_
--     reward_extraction.sql for the probe that caught it).
--   - NamUs is robots-dormant.
--   - No active source extracts the numeric reward column today (FBI Wanted
--     was the only one that did, removed by migration 15).
--
-- Idempotent: gated on `reward_amount_usd is null`, so re-running does
-- nothing once applied, and a future scrape that revises the amount won't
-- be clobbered by this migration.
--
-- Adding rows: append to the VALUES list below. Each entry should have
-- a comment line above it citing the primary-source URL + verification
-- date, so a future operator can re-check whether the reward is still
-- live.

-- Curated rewards as of 2026-05-08, sourced from Charley Project pages:
--   amber-elizabeth-cates       https://charleyproject.org/case/amber-elizabeth-cates
--   rachel-louise-cooke         https://charleyproject.org/case/rachel-louise-cooke         (FBI)
--   tionda-z-bradley            https://charleyproject.org/case/tionda-z-bradley
--   diamond-yvette-bradley      https://charleyproject.org/case/diamond-yvette-bradley
--   asha-jaquilla-degree        https://charleyproject.org/case/asha-jaquilla-degree        (FBI)
--   rosa-marie-camacho          https://charleyproject.org/case/rosa-marie-camacho          (FBI)
--   tara-leigh-calico           https://charleyproject.org/case/tara-leigh-calico           (FBI)
--   andrew-john-amato           https://charleyproject.org/case/andrew-john-amato           (FBI)

update public.cases as c
set reward_amount_usd = v.amount
from (values
  ('amber-elizabeth-cates-tn-2004-amber-elizabeth-cates',     25000),
  ('rachel-louise-cooke-tx-2002-rachel-louise-cooke',         50000),
  ('tionda-z-bradley-il-2001-tionda-z-bradley',               10000),
  ('diamond-yvette-bradley-il-2001-diamond-yvette-bradley',   10000),
  ('asha-jaquilla-degree-nc-2000-asha-jaquilla-degree',       50000),
  ('rosa-marie-camacho-ct-1997-rosa-marie-camacho',           50000),
  ('tara-leigh-calico-nm-1988-tara-leigh-calico',             20000),
  ('andrew-john-amato-ma-1978-andrew-john-amato',             25000)
) as v(slug, amount)
where c.slug = v.slug
  and c.reward_amount_usd is null;

-- Audit -- record total rows updated for sanity-check after apply.
select
  count(*) filter (where reward_amount_usd is not null) as cases_with_reward_amount,
  count(*) filter (where reward_text is not null)       as cases_with_reward_text
from public.cases
where deleted_at is null;
