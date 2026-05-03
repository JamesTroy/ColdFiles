-- Migration 32 — backfill cleanup for Doe Network "No Image Available"
-- placeholder rows in case_media.
--
-- Audit finding (2026-05-03): 1,154 cases (29.6% of has_photo=true cases)
-- were displaying a Doe Network "No Image Available" placeholder JPG as
-- their primary victim photo. Three placeholder variants:
--
--   No_Image_Available_male.jpg     994 case_media rows  (910 is_primary)
--   No_Image_Available_female.jpg   198 case_media rows  (189 is_primary)
--   No_Image_Available_infant.jpg    56 case_media rows  ( 55 is_primary)
--
-- The extractor-side filter shipped in the previous commit (sources/
-- doe_network.ts + sources/doe_network_uid.ts) stops new placeholder
-- rows from landing. This migration cleans up the rows already in
-- case_media + recomputes cases.has_photo from the remaining real
-- photo_victim media.
--
-- Why URL pattern, not content_hash: the user's audit identified the
-- placeholder by filename pattern (URL ends in No_Image_Available_*.jpg).
-- A content_hash predicate would be more robust against URL renames but
-- requires knowing the three SHA-256 hashes — not currently captured
-- here. The bytes-level defense-in-depth (cacheMediaForCase rejecting
-- known-bad hashes) is queued as a separate PR; that's where the hash
-- predicate belongs.
--
-- Safety: predicate is constrained to source_url ILIKE the specific
-- placeholder pattern AND to media rows whose source matches Doe Network.
-- A real photo URL would not contain "No_Image_Available" (the string is
-- specific enough that no false positive is plausible), but the source
-- constraint is belt-and-suspenders so even a mis-matched URL pattern
-- can't reach beyond the two Doe Network sources.
--
-- has_photo recomputation: the user-facing flag is recomputed AFTER the
-- delete, exists()-style. Cases that lose their only photo flip to
-- has_photo=false; cases that have other real photo_victim rows stay at
-- has_photo=true. The mobile photo-policy + effectivePhotoUri utility
-- already handle has_photo=false cleanly (em-dash placeholder).
--
-- Idempotent: re-running this migration after the rows are already
-- deleted is a no-op (DELETE matches zero rows; UPDATE recomputes the
-- same boolean from the same data).

begin;

-- 1. Capture the row count being deleted, for the post-migration log.
do $$
declare
  v_target_count integer;
begin
  select count(*) into v_target_count
  from public.case_media cm
  where cm.source_url ilike '%No_Image_Available%'
    and cm.source_id in (
      select id from public.sources where slug in ('doe_network', 'doe_network_uid')
    );
  raise notice 'migration 32: removing % case_media rows (Doe Network No_Image_Available placeholders)', v_target_count;
end $$;

-- 2. Delete the placeholder case_media rows.
--    Constrained to Doe Network sources so a future source happening to
--    have a similarly-named file can't be swept up by accident.
delete from public.case_media cm
where cm.source_url ilike '%No_Image_Available%'
  and cm.source_id in (
    select id from public.sources where slug in ('doe_network', 'doe_network_uid')
  );

-- 3. Recompute cases.has_photo from the remaining photo_victim media.
--    Touches every row in cases since exists() is per-case; bounded
--    by the corpus size (~5k rows today). Single UPDATE pass.
update public.cases c
set has_photo = exists(
  select 1
  from public.case_media cm
  where cm.case_id = c.id
    and cm.kind = 'photo_victim'
);

-- 4. Same recompute for has_sketch and has_reconstruction so they
--    stay consistent. Sketches and reconstructions weren't touched by
--    the placeholder delete, but doing a full recompute under the same
--    transaction guarantees the three flags are in sync afterwards.
update public.cases c
set
  has_sketch = exists(
    select 1
    from public.case_media cm
    where cm.case_id = c.id
      and cm.kind in ('sketch_victim', 'sketch_poi')
  ),
  has_reconstruction = exists(
    select 1
    from public.case_media cm
    where cm.case_id = c.id
      and cm.kind = 'reconstruction'
  );

-- 5. Verify post-state. Should report 0 placeholder rows remaining.
do $$
declare
  v_remaining integer;
begin
  select count(*) into v_remaining
  from public.case_media cm
  where cm.source_url ilike '%No_Image_Available%';
  if v_remaining > 0 then
    raise warning 'migration 32: % placeholder rows remain after delete (expected 0)', v_remaining;
  else
    raise notice 'migration 32: cleanup complete — 0 placeholder rows remaining';
  end if;
end $$;

commit;
