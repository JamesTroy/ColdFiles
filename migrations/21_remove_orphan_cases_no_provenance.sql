-- Migration 21 — remove cases with no source provenance.
--
-- Pre-tester corpus audit found 412 cases with zero rows in case_sources,
-- meaning no source attribution, no link-back, no takedown contact path.
-- This violates the privacy-policy contract: "Each case in the app links
-- back to the original source so you can read the full record."
--
-- Sample reveals two classes:
--   1. Mislabeled records the extractor parsed wrong:
--        "Random Shooter", "Unknown Suspect" — clearly garbage
--   2. Real-name cases (Odell Vest, Tracey Kirkpatrick, etc.) that lost
--      their source linkage at some point — most plausibly when
--      migration 15 removed FBI Wanted, the case_sources rows cascaded
--      out, but the cases themselves were not auto-deleted because the
--      cascade deletes case_sources from sources, not cases from
--      case_sources.
--
-- Both classes need to leave the corpus before tester recruitment.
-- Without source attribution we can't display "Source: X" in case
-- detail, the takedown flow doesn't know which agency to contact, and
-- the tip-routing path has no agency_id to resolve.
--
-- *** REVIEW BEFORE APPLYING ***
--
-- Run the SELECT first to see what would be deleted. Confirm the
-- count is in the expected range (~412 as of 2026-05-02). If anything
-- looks off — e.g. a manually-inserted test case you want to keep —
-- annotate it with a synthetic case_sources row before running the
-- DELETE block.
--
-- The defensive guard inside the DO block raises an exception if the
-- match count exceeds 500, which prevents accidental mass-delete if
-- the corpus state shifts unexpectedly.

-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 (review) — preview what will be deleted.
-- ─────────────────────────────────────────────────────────────────────

-- Run this SELECT and review the output. If acceptable, proceed to STEP 2.
--
-- select c.slug, c.kind, c.victim_name, c.created_at
-- from public.cases c
-- left join public.case_sources cs on cs.case_id = c.id
-- where c.deleted_at is null
--   and cs.case_id is null
-- order by c.created_at;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 (apply) — hard-delete orphan cases.
-- ─────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.cases c
  left join public.case_sources cs on cs.case_id = c.id
  where c.deleted_at is null
    and cs.case_id is null;

  if v_count > 500 then
    raise exception 'unexpected count: % orphan cases (expected ~412). Investigate before delete.', v_count;
  end if;

  raise notice 'About to hard-delete % orphan cases (no case_sources)', v_count;
end $$;

delete from public.cases c
where c.deleted_at is null
  and not exists (
    select 1
    from public.case_sources cs
    where cs.case_id = c.id
  );

commit;
