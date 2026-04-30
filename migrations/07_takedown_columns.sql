-- Migration 07 — takedown_requests column additions for the v1.0.1 form.
--
-- The v1.0.1 takedown form (mobile/app/takedown-request/[slug].tsx) collects
-- a few fields the original schema didn't anticipate:
--   - A short reference code returned to the submitter ("CF-7H4K2") so the
--     request feels like it landed on a desk, not into a void.
--   - Relationship "other" specifier (50 chars, stored separately so the
--     enum-y `requester_relationship` stays clean).
--   - Multi-select resolution preferences (remove_photo, remove_case,
--     correct_info, other).
--   - Hashed phone — same posture as the existing email hash. The raw
--     phone goes only into the operator notify email, never the DB.
--
-- Idempotent: safe to re-run.

alter table public.takedown_requests
  add column if not exists reference_code text unique,
  add column if not exists requester_relationship_other text,
  add column if not exists resolutions text[],
  add column if not exists requester_phone_hash text;

-- 50-char cap matches the form's input maxLength. Defense in depth: the
-- Edge Function already validates + truncates, this catches anything that
-- would slip past via direct service-role inserts in the future.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'takedown_requests_relationship_other_len_chk'
  ) then
    alter table public.takedown_requests
      add constraint takedown_requests_relationship_other_len_chk
        check (
          requester_relationship_other is null
          or char_length(requester_relationship_other) <= 50
        );
  end if;
end $$;

-- Index the reference code for the operator-lookup case (paste the code
-- from a confirmation email, find the row).
create index if not exists takedown_requests_reference_idx
  on public.takedown_requests (reference_code);

-- Compound index for the per-(case, email) rate-limit query. Used by the
-- takedown-submit Edge Function to enforce "1 request per case_id+email
-- per 24h" — the actual spam guard for legitimate abuse paths.
create index if not exists takedown_requests_case_email_recent_idx
  on public.takedown_requests (case_id, requester_email_hash, created_at desc);
