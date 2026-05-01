-- Migration 13 — slug-conflict orphan cleanup.
--
-- Background:
--   Earlier today (2026-05-01) a Doe Network MP scrape was killed mid-run
--   to swap in a new --concurrency=8 build of scrape-cli. The killed run
--   had ingested ~322 cases by the time it was stopped, but at least two
--   of those cases were left in an orphan state: the `cases` row exists
--   with a properly-derived slug, but the `case_dedupe_keys` rows weren't
--   fully written before the kill.
--
--   Result: subsequent scrape passes can't dedupe-match the same
--   underlying records (no case_dedupe_keys to look up by) and try to
--   INSERT them as new cases, which trips the cases_slug_key unique
--   constraint. The current dedupe path then logs a persist error and
--   skips the URL — the case never gets its case_sources or case_media
--   rows backfilled.
--
--   The slug constraint is doing its job here: it's protecting us from
--   true duplicates. But the orphan rows themselves block re-ingestion,
--   so we delete them, freeing the next scrape to re-create the case
--   cleanly with its full keys + sources + media.
--
-- Affected slugs (collected from persist-error logs across the four
-- 2026-05-01 Doe Network MP scrape runs):
--
--   - angel-a-garcia-montero-1992-291dmpr   (Puerto Rico DMPR-prefix)
--   - jonathan-b-jackson-1987-3564dmgu      (Guam DMGU-prefix)
--
-- The list is explicit on purpose — heuristics ("delete cases created
-- after timestamp X without dedupe keys") risk catching legitimate rows
-- from healthy runs.
--
-- Cascade behavior:
--   The cases table's foreign-key relationships (case_sources,
--   case_dedupe_keys, case_media, dedupe_review_queue) all use
--   ON DELETE CASCADE per migration 01, so a single DELETE on cases
--   handles cleanup of every related row.
--
-- After applying:
--   Run a fresh `npm run scrape -- --source=doe_network --limit=500
--   --concurrency=8` (the retry envelope from PoliteFetcher will
--   handle any transient fetch failures during the re-ingest). Expect
--   each affected case to land as new=N+1 with all its rows rebuilt.
--
-- Idempotent: re-running this migration after the rows are already
-- gone is a no-op (DELETE on missing rows returns 0).

delete from public.cases
where slug in (
  'angel-a-garcia-montero-1992-291dmpr',
  'jonathan-b-jackson-1987-3564dmgu'
);
