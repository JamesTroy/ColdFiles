-- Migration 40 — narrative-based location extraction audit log.
--
-- Phase 2 of the location-recovery project (see Phase 1 audit results
-- in scripts/sql/diagnostic_narrative_recoverability.sql). The pipeline:
--
--   1. For each city-precision case with a meaty narrative or agency
--      hint, ask Claude to extract the most likely "last known"
--      (or "discovery" for UP cases) location as a geocodable string.
--   2. Feed the LLM candidate through the existing Mapbox geocode
--      resolver (supabase/functions/_shared/geocode-resolver.ts).
--   3. If the geocoder returns precision in (address, street) AND the
--      LLM's confidence ≥ 0.75, write back location_point +
--      location_precision. Otherwise reject; never degrade.
--
-- This table is the audit/debugging trail for that pipeline. Every
-- attempt — success or rejection — gets one row. Lets us:
--   - Monitor upgrade rate per source over time
--   - Skip cases already attempted (idempotency for the backfill CLI)
--   - Debug "why didn't case X get upgraded?"
--   - Roll back specific extractions if quality issues surface
--
-- Outcome enum is text (CHECK-constrained) rather than a Postgres enum
-- because the set is likely to evolve (new failure modes as we learn
-- from real data); text + CHECK is easier to extend than ALTER TYPE.
--
-- Idempotent via CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS.

create table if not exists location_extraction_log (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  attempted_at timestamptz not null default now(),

  -- LLM extraction layer.
  llm_model text,                          -- e.g. 'claude-haiku-4-5-20251001'
  llm_candidate text,                       -- the geocodable string the LLM returned, or null
  llm_confidence numeric,                   -- 0.0-1.0; null when LLM declined to extract
  llm_reasoning text,                       -- one-sentence rationale from the LLM

  -- Geocode layer (only populated when llm_candidate is non-null and
  -- we attempted to geocode it).
  geocode_precision text,                   -- mapbox result precision
  geocode_lat double precision,
  geocode_lng double precision,

  -- Decision.
  outcome text not null check (outcome in (
    'upgraded',
    'rejected_no_narrative',
    'rejected_no_signal',
    'rejected_low_confidence',
    'rejected_geocode_imprecise',
    'rejected_geocode_failed',
    'rejected_already_precise',
    'errored'
  )),
  prior_precision text not null,
  new_precision text,                       -- only set when outcome='upgraded'

  -- Free-form notes for failure modes that don't fit the enum cleanly.
  error_detail text
);

-- Lookup by case_id for "have we tried this case yet" idempotency
-- checks in the backfill CLI. Most cases will have at most a handful
-- of attempts (initial + a few retries on transient errors), so the
-- index is small.
create index if not exists location_extraction_log_case_idx
  on location_extraction_log(case_id);

-- Lookup by outcome for monitoring queries ("how many upgrades?").
create index if not exists location_extraction_log_outcome_idx
  on location_extraction_log(outcome);

-- Lookup by attempted_at for time-window analysis ("upgrade rate
-- this week vs. last week").
create index if not exists location_extraction_log_attempted_at_idx
  on location_extraction_log(attempted_at desc);

comment on table location_extraction_log is
  'Audit trail for narrative-based location extraction attempts (Phase 2 of the location-recovery project). One row per extraction attempt; outcome enum captures upgrade/reject paths. Used by the backfill CLI for idempotency and by quality-monitoring dashboards.';
