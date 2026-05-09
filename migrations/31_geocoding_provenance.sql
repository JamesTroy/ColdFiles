-- Migration 31 — formalize geocoding provenance on cases.
--
-- Two related changes:
--
-- 1. CHECK constraint on cases.location_precision. The column has been
--    silently populated by persist.ts since migration 01 as untyped
--    text — any source field with a typo or stale value would land in
--    the column with no validation. The 01_schema.sql line comment
--    listed five values ('address' | 'street' | 'city' | 'county' |
--    'unknown') but missed 'state', which the Mapbox resolver in
--    geocode.ts:64-80 emits and persist.ts faithfully writes. As of
--    the audit run before this migration (scripts/sql/diagnostic_
--    geocoding_provenance.sql), 35 prod rows already carry
--    location_precision = 'state'. Audit also confirmed the live set
--    of values is exactly the six-value taxonomy + NULL — no drift,
--    no typos, no normalization pre-step needed.
--
--    The constraint encodes that taxonomy as a hard contract:
--      address | street | city | county | state | unknown | NULL
--    NULL stays valid because cases without a geocoded point (the
--    geocode-pending backlog, ~13% of corpus at write time) have
--    null precision by design. point_without_precision = 0 in the
--    audit, so the integrity invariant the persist path enforces in
--    code now also holds at the schema level.
--
-- 2. Add a geocoding_source column to track HOW each location was
--    derived: Mapbox forward geocode, source-supplied native coords,
--    or manual operator entry. Useful for debugging — "why did this
--    address-precise pin land in the wrong city?" is almost always
--    a geocoder-quality question once you can isolate Mapbox-derived
--    rows from source-native ones. Pairs with location_precision —
--    same persist.ts ingestion code path populates both.
--
--    The four-value enum:
--      mapbox        — resolved via Mapbox forward geocoder
--      source_native — source supplied lat/lng directly (NamUs UP's
--                      publicGeolocation, FBI Wanted GPS embeds)
--      manual        — operator-set via a future admin path; reserved
--      unknown       — rare; reserved for repair scripts
--
-- Backfill of historical rows is intentionally split into migration 32.
-- It's a one-liner (UPDATE ... WHERE location_point IS NOT NULL ->
-- 'mapbox', deterministic because the only source_native producer in
-- prod is NamUs UP and that source has zero rows in the corpus today
-- and FBI Wanted was purged in migration 15). Splitting matches the
-- precedent migration 18 set for backfill-as-its-own-migration; lets
-- the schema change land and get reviewed first, backfill second.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP/ADD CONSTRAINT pattern.

-- 1. Add geocoding_source column.
alter table public.cases
  add column if not exists geocoding_source text;

-- 2. Formalize location_precision taxonomy.
--    Drop-and-add for idempotency: Postgres has no
--    ADD CONSTRAINT IF NOT EXISTS, so we drop first.
alter table public.cases
  drop constraint if exists cases_location_precision_check;
alter table public.cases
  add constraint cases_location_precision_check
    check (
      location_precision is null
      or location_precision in (
        'address', 'street', 'city', 'county', 'state', 'unknown'
      )
    );

-- 3. Formalize geocoding_source taxonomy.
alter table public.cases
  drop constraint if exists cases_geocoding_source_check;
alter table public.cases
  add constraint cases_geocoding_source_check
    check (
      geocoding_source is null
      or geocoding_source in ('mapbox', 'source_native', 'manual', 'unknown')
    );

-- 4. Documentation comments — the 01_schema.sql line comments are
--    not real COMMENT ON COLUMN metadata, so this is net-new and the
--    only place introspection (information_schema, IDE plugins) will
--    find the enum doc.
comment on column public.cases.location_precision is
  'address | street | city | county | state | unknown — Mapbox geocoder precision tier. Renderer flattens address+street to coordinate; state stays off-map (list views only).';
comment on column public.cases.geocoding_source is
  'mapbox | source_native | manual | unknown — how location_point was derived. Pairs with location_precision; same persist.ts code path populates both.';
