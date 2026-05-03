-- Migration 23 — index on cases(last_changed_at DESC NULLS LAST).
--
-- Migration 22 added ORDER BY c.last_changed_at DESC NULLS LAST to
-- cases_in_bbox so the limit deterministically picks the most-recent
-- cases. Without an index on last_changed_at, every bbox query that
-- matches a non-trivial number of rows has to sort all matches before
-- applying LIMIT.
--
-- For wide-bbox queries (the user zooms out to a continental view),
-- the GIST index on location_point matches thousands of rows, then
-- the sort is O(n log n) over those rows. On the larger bboxes this
-- can blow past Supabase's 8s statement timeout. User-visible
-- symptom: "canceling statement due to statement timeout" surfaced
-- in an Alert when the user scrolled out.
--
-- Fix: add a covering index on (last_changed_at DESC NULLS LAST).
-- The planner can then walk the index in already-sorted order and
-- stop after LIMIT rows — O(limit) instead of O(matches).
--
-- The partial index predicate (deleted_at is null) matches the
-- query's where clause and keeps the index small. last_changed_at
-- itself is non-null per schema (migration 01 line 214).

create index if not exists cases_last_changed_at_idx
  on public.cases (last_changed_at desc nulls last)
  where deleted_at is null;
