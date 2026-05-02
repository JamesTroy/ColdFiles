-- Migration 18 — backfill last_seen_date from incident_date for missing cases.
--
-- Background:
--   The cases schema has both incident_date (generic case date) and
--   last_seen_date (specifically the missing-persons "last seen"
--   timestamp). Historically every active extractor mapped the
--   source's primary date to incident_date — Charley's "Missing
--   Since," Doe MP's missing_since, PCC's incident dates all went to
--   incident_date. Nothing wrote last_seen_date.
--
--   The 2026-05-02 corpus snapshot showed 0 / 4548 rows had
--   last_seen_date populated. The case-detail LastSeenBlock now has a
--   UI fallback (commit 4e6e01c) but the data layer should also be
--   correct so any future RPC/query that joins on last_seen_date
--   specifically returns the right rows.
--
--   The 2026-05-02 persist-layer change (the dual-write block at the
--   top of persistRecord) handles future ingests. This migration
--   handles the existing rows.
--
-- Scope:
--   Only kind = 'missing' rows. For homicide and unidentified cases,
--   incident_date and last_seen_date mean different things (date of
--   murder vs. when the person was last seen alive; date of body
--   discovery vs. when the unidentified person was last seen). Don't
--   touch those.
--
-- Idempotent: re-running after the rows are populated is a no-op
-- because of the IS NULL guard.

update public.cases
set last_seen_date = incident_date
where kind = 'missing'
  and incident_date is not null
  and last_seen_date is null;
