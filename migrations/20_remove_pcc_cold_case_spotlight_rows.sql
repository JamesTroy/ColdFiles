-- Migration 20 — remove PCC "Cold Case Spotlight" summary posts.
--
-- The Project: Cold Case site publishes two distinct WordPress post types
-- under the homicide-track category we ingest:
--   1. Individual case posts (the data we want — one victim per post)
--   2. "Cold Case Spotlight" summary posts (editorial roundups linking to
--      multiple cases)
--
-- The PCC source extractor (sources/project_cold_case.ts) doesn't currently
-- distinguish between them. Spotlight posts get ingested as if they were
-- individual cases, with degraded results:
--   - title parses to victim_first_name='Cold', victim_last_name=<word3>
--     (because the title format is "Cold Case Spotlight – <FirstName> <LastName>")
--   - slug doubles ("cold-case-spotlight-X-cold-case-spotlight-X") because
--     deriveExternalId concatenates the URL slug into the case slug
--   - narrative captures CSS leakage from PCC's Avada theme styling
--     (`.flex_column.av-...{...}` blocks render in the case-detail screen)
--
-- 70 rows match this pattern as of 2026-05-02. The extractor fix lands in
-- a parallel commit (skip Spotlight posts during discovery + warn on
-- title heuristic match as a belt-and-suspenders).
--
-- Identification — both conditions must match (defensive AND, not OR):
--   victim_first_name = 'Cold' (literal, never legitimate)
--   slug LIKE 'cold-case-spotlight-%' (URL pattern from the WP route)
--
-- Hard delete (not soft) because these aren't real cases. Soft-deletes
-- still appear via certain RPC paths and preserve the bad slug, which
-- complicates the Tier-3 re-ingest path. The case_sources cascade FK
-- handles the join-table cleanup.

begin;

-- Confirm the count matches our manual count before deleting. If this
-- assertion fires, stop — the extractor may have created a different
-- pattern we haven't catalogued.
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.cases
  where deleted_at is null
    and victim_first_name = 'Cold'
    and slug like 'cold-case-spotlight-%';
  if v_count > 100 then
    raise exception 'unexpected count: % rows match Spotlight pattern (expected ~70). Investigate before delete.', v_count;
  end if;
  raise notice 'About to hard-delete % Cold Case Spotlight rows', v_count;
end $$;

-- case_sources rows for these cases drop via FK cascade (see migration 01).
delete from public.cases
where victim_first_name = 'Cold'
  and slug like 'cold-case-spotlight-%';

commit;
