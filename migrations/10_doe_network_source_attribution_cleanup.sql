-- Migration 10 — clean up orphan Doe Network case_sources overwrite-rows.
--
-- Background:
--   The pre-fix `deriveExternalId` returned the URL's last path segment,
--   which for Doe Network's `database.php?id=...` and `mpdatabase.php?id=...`
--   URLs collapsed to the script name. case_sources has a unique constraint
--   on (source_id, source_external_id), so every Doe Network ingest UPSERT
--   hit the same single row and overwrote it. Result: each Doe Network
--   source ended up with exactly ONE case_sources row, pointing at the
--   most-recently-ingested case_id.
--
-- Why delete vs. preserve:
--   The orphan rows aren't useful provenance — they point at random
--   case_ids (whichever was last ingested) and have stale raw_payloads.
--   The next ingest after the deriveExternalId fix will create proper
--   case_sources rows for each case with its real ID. Deleting the
--   orphans now prevents (a) future case-detail screens from rendering
--   a stale "source / database.php" chip on the wrong case, and (b)
--   double source chips on the case that was last-ingested (one from
--   the orphan, one from the corrected re-ingest).
--
-- Impact:
--   Affects 2 rows total (one per Doe Network source). The cases those
--   orphans pointed at temporarily lose their source-chip on the case-
--   detail screen, recovered on next ingest of that source. All other
--   Doe Network cases currently have ZERO case_sources rows pointing at
--   them anyway (because the orphan was the single overwrite-row), so
--   they're unaffected by the delete.
--
-- Run BEFORE the next Doe Network scrape under the deriveExternalId fix.
-- Idempotent: safe to re-run.

delete from public.case_sources cs
using public.sources s
where cs.source_id = s.id
  and s.slug in ('doe_network', 'doe_network_uid')
  and cs.source_external_id in ('mpdatabase.php', 'database.php');
