-- Migration 32 — backfill geocoding_source for historical rows.
--
-- Background:
--   Migration 31 added cases.geocoding_source as a nullable column
--   guarded by a CHECK constraint over four values. Forward writes
--   from persist.ts (added in the same PR) populate the column on
--   every new geocode going forward. This migration handles the
--   pre-existing corpus.
--
-- Why deterministic, not heuristic:
--   The audit run before migration 31 (scripts/sql/diagnostic_
--   geocoding_provenance.sql, query 3) showed only six sources with
--   any cases attached: doe_network_uid, charley_project, doe_network,
--   ca_mups, project_cold_case, nys_dcjs. None of those emit
--   location_lat/location_lng on the CaseRecord — only NamUs UP
--   (sources/namus.ts:377-378) and the now-removed FBI Wanted
--   (sources/fbi_wanted.ts, purged in migration 15) ever did. NamUs
--   UP has zero rows in the live corpus today, and FBI Wanted's rows
--   were deleted by migration 15.
--
--   Therefore: every row currently holding a non-null location_point
--   came through the Mapbox forward-geocoder branch in persist.ts.
--   The backfill is a single deterministic UPDATE — no source-table
--   join, no probabilistic per-source heuristic.
--
-- Side-effect safety:
--   - Does not touch location_point. The watch_zone_hit producer
--     trigger (migrations 19, 27) fires only on location_point
--     transitioning NULL → non-NULL, so this UPDATE doesn't fan out
--     spurious watch-zone notifications.
--   - last_changed_at has no DB-level trigger; it's set by persist.ts
--     in code on real ingests. Raw SQL UPDATE here doesn't bump it,
--     so the ingest-alive metric (memory: feedback_ingest_metric_axis)
--     won't see a fake spike on apply.
--   - Soft-deleted rows (deleted_at IS NOT NULL) are included
--     deliberately; they may un-delete in the future and the source
--     attribution is the same fact regardless of visibility.
--
-- Idempotent: re-running after the rows are populated is a no-op
-- because of the IS NULL guard.

update public.cases
set geocoding_source = 'mapbox'
where location_point is not null
  and geocoding_source is null;
