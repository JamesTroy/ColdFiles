-- Migration 09 — dedupe_review_queue uniqueness on (case_id_a, case_id_b).
--
-- The review queue path lands a row each time persistRecord finds a
-- Tier-3-only match (lastname_age_sex with no stronger key) and routes to
-- review instead of auto-merging. Without uniqueness, repeat ingests of
-- the same record from the same source insert the SAME pair multiple
-- times — duplicates in the reviewer's queue, not a correctness bug, but
-- noisy.
--
-- Idempotent: safe to re-run. Adds a unique index covering the table's
-- existing canonical-ordering check (case_id_a < case_id_b), so a logical
-- pair can only ever appear once.

create unique index if not exists dedupe_review_queue_pair_idx
  on public.dedupe_review_queue (case_id_a, case_id_b);
