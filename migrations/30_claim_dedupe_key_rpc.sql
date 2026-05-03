-- Migration 30 — atomic dedupe-key claim RPC.
--
-- Audit finding (architecture review, 2026-05-03): the persist pipeline's
-- create-new-case path has a race window. Two concurrent runs of the same
-- record both SELECT case_dedupe_keys, see "no match," both INSERT cases
-- rows, and the loser's keys silently drop via ignoreDuplicates: true.
-- The loser's cases row persists with no dedupe coverage — exactly the
-- failure mode migrations 13/14/17/21 had to retroactively clean up.
--
-- The fix shape (user-greenlit): claim the strongest dedupe key via
-- INSERT ... ON CONFLICT (key_type, key_value) DO NOTHING RETURNING case_id.
-- The unique index on (key_type, key_value) — already present from migration
-- 01 — makes this atomic. Whoever's INSERT lands first owns the case;
-- the loser learns the winner's case_id and pivots to the merge path.
--
-- Why an RPC instead of a JS-level dance: ON CONFLICT DO NOTHING returns
-- nothing when it conflicts, so the JS would need a separate SELECT to
-- find the winner — opening a fresh race between the failed INSERT and
-- the lookup. The RPC does both in one statement-pair under one SQL
-- session, with no JS-side window.
--
-- Idempotent via CREATE OR REPLACE.

create or replace function claim_dedupe_key(
  p_case_id uuid,
  p_key_type text,
  p_key_value text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner_case_id uuid;
begin
  -- Attempt the claim. RETURNING fires only when our row landed, so a
  -- non-null result means we won the race for this (key_type, key_value).
  insert into case_dedupe_keys (case_id, key_type, key_value)
  values (p_case_id, p_key_type, p_key_value)
  on conflict (key_type, key_value) do nothing
  returning case_id into v_winner_case_id;

  if v_winner_case_id is not null then
    return v_winner_case_id;
  end if;

  -- Conflict path: someone else's row already owns this key. Look up
  -- the winner's case_id so the caller can pivot to merge.
  select case_id into v_winner_case_id
  from case_dedupe_keys
  where key_type = p_key_type and key_value = p_key_value;

  return v_winner_case_id;
end $$;

revoke all on function claim_dedupe_key(uuid, text, text) from public, anon;
grant execute on function claim_dedupe_key(uuid, text, text) to service_role, authenticated;
