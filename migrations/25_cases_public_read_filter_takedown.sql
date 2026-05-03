-- Migration 25 — close the takedown read leak in cases_public_read.
--
-- Audit found: `cases_public_read` (migration 01) policy filters only on
-- `deleted_at is null`. A case with `takedown_requested_at IS NOT NULL`
-- (granted takedown not yet processed into a soft-delete) is still
-- publicly readable to anon. CLAUDE.md and the privacy policy both
-- explicitly architect against the takedown-email-becomes-lawsuit
-- failure mode; this is exactly that.
--
-- Two RLS-level guards instead of one:
--   - deleted_at is null  (existing — soft-deleted is gone)
--   - takedown_requested_at is null  (new — takedown granted but not
--     yet soft-deleted is also gone)
--
-- Idempotent via DROP POLICY IF EXISTS + CREATE POLICY. The two-statement
-- form is required because Postgres has no "ALTER POLICY ... USING (...)"
-- that lets us swap the predicate in place.
--
-- The same predicate is propagated to the dependent policies that scope
-- through cases (case_media_public_read, case_updates_public_read) so a
-- granted takedown also hides the case's photos and updates.

drop policy if exists cases_public_read on public.cases;
create policy cases_public_read on public.cases
  for select using (
    deleted_at is null
    and takedown_requested_at is null
  );

drop policy if exists case_media_public_read on public.case_media;
create policy case_media_public_read on public.case_media
  for select using (
    exists (
      select 1
      from public.cases c
      where c.id = case_media.case_id
        and c.deleted_at is null
        and c.takedown_requested_at is null
    )
  );

drop policy if exists case_updates_public_read on public.case_updates;
create policy case_updates_public_read on public.case_updates
  for select using (
    exists (
      select 1
      from public.cases c
      where c.id = case_updates.case_id
        and c.deleted_at is null
        and c.takedown_requested_at is null
    )
  );

-- Note: case_sources is NOT included here. The provenance row stays
-- queryable so the dedupe/orphan tooling can identify a granted-
-- takedown case via its source linkage when triaging operationally.
-- The case row itself is hidden, so the path "case_sources → cases"
-- still produces no anon-visible result. Verify by:
--
--   set role anon;
--   select c.id from public.cases c where c.takedown_requested_at is not null;
--   -- Should return 0 rows.
--   reset role;
