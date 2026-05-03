-- Migration 24 — capture extracted agency hints on cases.
--
-- Sources (Charley, Doe Network) already parse the "Investigating Agency"
-- block on each case page into an `agency_hint: { name, phone }` shape on
-- the in-memory CaseRecord, but persist.ts never carries the field through
-- to a column on cases. These two text columns let the data land where
-- a downstream cardinality query can ask the question that gates step 2:
--
--   "Across N thousand cases, how many distinct investigating-agency
--    name strings exist? Does the head of the distribution cover enough
--    to make manual contact-info enrichment feasible end-to-end?"
--
-- Storing as raw text only — no FK to the agencies table yet. The
-- routing path stays on tier-3 fallback (state clearinghouse → FBI)
-- until step 2 lands the matching layer with the confidence threshold.
-- These columns exist purely to inform that step.
--
-- Why _raw suffix: the field is the unprocessed extracted string from
-- the source page. After step 2 lands a real `primary_agency_id` FK and
-- a confidence column, _raw stays as the audit trail of what was
-- extracted before normalization.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

alter table public.cases
  add column if not exists primary_agency_name_raw text,
  add column if not exists primary_agency_phone_raw text;

-- Optional: index on name for the cardinality query. Cheap; the query
-- below benefits from it. Drop later if storage matters.
create index if not exists cases_primary_agency_name_raw_idx
  on public.cases (primary_agency_name_raw)
  where deleted_at is null and primary_agency_name_raw is not null;

-- Cardinality query (run AFTER persist.ts writes the field + a Charley
-- rescrape backfills it):
--
--   select primary_agency_name_raw, count(*) as n
--   from public.cases
--   where deleted_at is null
--     and primary_agency_name_raw is not null
--   group by primary_agency_name_raw
--   order by n desc
--   limit 200;
--
-- Then look at the cumulative coverage of the top-100 vs top-500 to
-- decide whether the spike scales to Doe + PCC + LASD.
