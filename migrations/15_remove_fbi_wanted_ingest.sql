-- Migration 15 — remove FBI Wanted ingest from the corpus.
--
-- Background:
--   FBI Wanted (`sources.slug = 'fbi_wanted'`) was built into the source
--   registry as the homicide-track candidate for v1.0.0. After actually
--   running it and inspecting the data, two compounding problems
--   emerged:
--
--   1. Editorial mismatch. The FBI's "ViCAP Homicides and Sexual
--      Assaults" subjects bucket is broader than victim-centered cold
--      cases. It includes FBI tip-line alerts for ongoing
--      investigations ("Civil Disorder 1", "Building Damage",
--      "Allegiant Airlines", "Stolen Andy Warhol Prints",
--      "Pregnancy Resource Center Arson", "Mass Shooting"). The Cold
--      File is editorially a victim-memorial, not an FBI tip-line
--      mirror. These records read as off-brand on the case detail and
--      degrade the listing's story for users + reviewers.
--
--   2. Date-range mismatch. The feed mixes 1950s ViCAP cases with
--      bulletins issued days ago. Even with a 5-year-cold filter
--      added in commit 7eee0f7, pre-filter rows from an earlier
--      unfiltered ingest persist (visible as cases with
--      location_state NULL and incident_date NULL or recent dates).
--
--   The right next investment for genuine homicide coverage is the
--   LASD homicide bureau scraper (sources/index.ts "Week 4"). LASD's
--   bureau publishes cold-case bulletins that are explicitly
--   victim-centered — the source's intake model is the opposite of
--   FBI Wanted's tip-line aggregation, and the data fits this app's
--   editorial frame cleanly.
--
-- This migration:
--   - Deletes every case whose ONLY source is fbi_wanted (pure-FBI
--     records — the safe deletions). These are the 562 cases ingested
--     in the 2026-05-02 session plus all stale pre-filter rows.
--   - Deletes case_sources rows linking surviving multi-sourced cases
--     to fbi_wanted (rare; preserves the case + its other sources).
--   - Leaves the `fbi_wanted` row in `public.sources` intact, with
--     `active = false`, so the source-mix RPC and history don't
--     break. Future re-activation requires explicit decision.
--
-- Cascade behavior:
--   `cases` foreign-key relationships (case_sources, case_dedupe_keys,
--   case_media, dedupe_review_queue) all use ON DELETE CASCADE per
--   migration 01.
--
-- Idempotent: re-running after the rows are gone is a no-op.

-- Step 1 — orphan-purge: delete cases that have NO sources other than
-- fbi_wanted. These are pure-FBI cases that nobody else attests to.
delete from public.cases c
where exists (
  select 1
  from public.case_sources cs
  join public.sources s on s.id = cs.source_id
  where cs.case_id = c.id
    and s.slug = 'fbi_wanted'
)
and not exists (
  select 1
  from public.case_sources cs2
  join public.sources s2 on s2.id = cs2.source_id
  where cs2.case_id = c.id
    and s2.slug != 'fbi_wanted'
);

-- Step 2 — for any surviving multi-sourced cases, drop the fbi_wanted
-- case_sources row so the case is no longer attributed to FBI on the
-- case detail (source chips, photo caption fallback, etc.). The case
-- itself stays because another source independently has it.
delete from public.case_sources cs
using public.sources s
where cs.source_id = s.id
  and s.slug = 'fbi_wanted';

-- Step 3 — deactivate the source so it's not picked up by `tick`-mode
-- runs and doesn't appear in the source-mix card.
update public.sources
set active = false
where slug = 'fbi_wanted';
