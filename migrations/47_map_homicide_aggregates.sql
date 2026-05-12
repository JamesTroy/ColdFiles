-- Migration 47 — MAP (Murder Accountability Project) SHR aggregate
-- corpus, per docs/integrations/map-ingestion-plan.md §3.
--
-- Why a separate table (not cases):
--   The plan's central finding: SHR is anonymized (no victim name, no
--   address, month-only date, no NCIC/NamUs/agency case number). Every
--   dedupe key in supabase/functions/_shared/dedupe.ts:11 requires at
--   minimum a victim name or an agency case number — fields SHR doesn't
--   carry. Routing MAP through persistRecord into `cases` would either
--   bloat that table with ~800k mostly-null rows (breaking the
--   cases_in_bbox 500-row cap that mig 42 stabilized; see plan §4d for
--   the cost analysis) or require an "anonymized" flag that complicates
--   every existing RPC. The plan's recommendation, codified here:
--   parallel `homicide_aggregates` table, count-shaped RPCs, no UI
--   cross-over with `cases` until the Phase 3 case-detail Context band.
--
-- Why source_release in the primary uniqueness key:
--   MAP releases full-corpus refreshes ad-hoc (annual + off-cycle FOIA
--   drops). Each release is a complete re-download — no incremental
--   deltas. Keeping each release as its own immutable snapshot mirrors
--   the case_sources.payload_hash pattern: 2× storage cost in exchange
--   for a clean diff between releases (which is itself an editorial
--   feature — "what did the new FOIA suit add?"). Re-ingestion of the
--   same source_release is idempotent: the ingest script truncates that
--   release's rows in a transaction, then re-COPYs.
--
-- Why location_point is geography(Point, 4326):
--   Matches cases.location_point so the future homicide_density_for_bbox
--   RPC can use ST_Intersects with the same envelope shape the existing
--   cases_in_bbox uses. The point is an AGENCY CENTROID, not an incident
--   location — see plan §4a for the honesty problem. The
--   location_precision column carries the bad news ('city' for city PDs,
--   'county' for sheriffs, 'state' for failed lookups). The RPCs in
--   migration 48 default to filtering out 'state'-precision points from
--   any map rendering, mirroring cases_in_bbox §42:124.
--
-- No FK to cases:
--   MAP rows are not cases in the ColdFiles sense. They're aggregate
--   evidence. The plan's case-detail Context band (Phase 3, not in
--   scope here) joins by location predicate, not by foreign key.
--
-- Idempotency / re-runnability:
--   `create table if not exists` + `create index if not exists`. Safe
--   to re-apply against a partially-migrated dev DB. There is no
--   destructive change here.

-- ─────────────────────────────────────────────────────────────────────────────
-- agencies_ori — ORI → centroid lookup
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per FBI ORI alphanumeric identifier. Populated by the ingest
-- script from data/map/agencies_ori_*.json. The full nationwide ORI
-- directory is ~20k rows; the MT pilot ships with ~4. Centroids come
-- from one of:
--   1. The FBI Crime Data Explorer's published ORI directory.
--   2. A Mapbox geocode of `<agency_name>, <city>, <state>` with the
--      state-bbox validation pass from
--      supabase/functions/_shared/geocode-state-validation.ts
--      (memory: feedback_geocoder_ambiguous_queries.md).
--   3. The county-seat coordinate when an agency is a county sheriff
--      with no single PD address.
-- `centroid_source` records which path produced the coordinate so a
-- later audit can re-do the geocode tail without re-doing the cleanly
-- geocoded majority.

create table if not exists agencies_ori (
  ori                text primary key,
  agency_name        text not null,
  agency_type        text,          -- 'city_pd' | 'county_sheriff' | 'state_police' | …
  state              char(2)        not null,
  city               text,
  county             text,
  centroid_lat       double precision,
  centroid_lng       double precision,
  -- 'city_hall' | 'county_seat' | 'mapbox_geocode' | 'state_centroid' | 'manual'
  centroid_source    text,
  -- Computed once on insert from (centroid_lng, centroid_lat). Indexes
  -- defined below cover ST_Intersects / ST_DWithin queries.
  centroid_point     geography(Point, 4326)
    generated always as (
      case
        when centroid_lat is null or centroid_lng is null then null
        else ST_SetSRID(ST_MakePoint(centroid_lng, centroid_lat), 4326)::geography
      end
    ) stored,
  created_at         timestamptz    not null default now(),
  updated_at         timestamptz    not null default now()
);

create index if not exists agencies_ori_state_idx       on agencies_ori (state);
create index if not exists agencies_ori_centroid_gix    on agencies_ori using gist (centroid_point);


-- ─────────────────────────────────────────────────────────────────────────────
-- homicide_aggregates — MAP SHR row-per-victim corpus
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists homicide_aggregates (
  id                  uuid          primary key default gen_random_uuid(),
  -- e.g. 'map_shr_2026_03', 'map_shr_fixture_2026_05_11'. Together
  -- with shr_row_key forms the natural composite key — see UNIQUE
  -- constraint at the bottom.
  source_release      text          not null,
  -- Synthetic per-row key within a release. Plan §4f: when the MAP
  -- CSV exposes Incident#, this is ORI||year||month||incident||victim_ord.
  -- If Incident# is missing it falls back to ORI||year||month||row_num,
  -- which is release-dependent (MAP may re-order across releases).
  -- That's fine — re-ingestion of the same release is idempotent and
  -- cross-release tracking is not a goal (each release is its own
  -- snapshot).
  shr_row_key         text          not null,

  -- Agency / geography. ORI is the FBI alphanumeric ID. Other fields
  -- duplicate from agencies_ori at ingest time so the homicide_aggregates
  -- query path doesn't have to JOIN for the common count cases. Trade
  -- 2-3 extra columns for index-locality on the count-shaped RPCs.
  ori                 text          not null,
  agency_name         text,
  state               char(2)       not null,
  county              text,
  city                text,

  -- Time. SHR is month-only; no day, no exact incident_date.
  year                smallint      not null,
  month               smallint      not null check (month between 1 and 12),

  -- Victim demographics. Same enums-as-text shape the plan §2 column-map
  -- documents (text, not the existing sex_kind enum — MAP's value set
  -- doesn't line up 1:1 and we don't want to invite confusion between
  -- a `cases.victim_sex` and a `homicide_aggregates.vic_sex` that look
  -- alike but mean subtly different things).
  vic_age             smallint,        -- null when MAP records 999 (unknown sentinel)
  vic_sex             text,
  vic_race            text,
  vic_ethnicity       text,

  -- Offender demographics (where reported — most rows have all-null
  -- offender columns; that's just what SHR is).
  off_age             smallint,
  off_sex             text,
  off_race            text,
  off_ethnicity       text,

  -- Incident attributes. All free-form text on the table side; the
  -- ingest script normalizes MAP's coded values to readable strings
  -- ('Handgun' instead of '11', etc.) per the data dictionary.
  weapon              text,
  relationship        text,
  circumstance        text,
  subcircumstance     text,
  vic_count           smallint,
  off_count           smallint,

  -- MAP-derived: Y/N flag computed from offender presence. Plan §1.
  solved              boolean,

  -- 'fbi_reported' | 'foia_obtained' — distinguishes vanilla FBI SHR
  -- rows from MAP's FOIA-obtained additions. The latter is the
  -- editorially load-bearing subset (plan §4c).
  source_flag         text,

  -- AGENCY CENTROID — see plan §4a. NOT an incident location. Used
  -- only by the aggregate RPCs in mig 48; never returned alongside
  -- a victim name / case-detail surface.
  location_point      geography(Point, 4326),
  -- 'city' | 'county' | 'state'. Mirrors cases.location_precision
  -- semantics. RPCs filter out 'state'-precision rows from any
  -- map-shaped query, the same rule cases_in_bbox uses.
  location_precision  text,

  ingested_at         timestamptz   not null default now(),

  constraint homicide_aggregates_source_release_row_unq
    unique (source_release, shr_row_key)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes for the count-shaped RPCs in mig 48
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. State + year — backs homicide_counts_in_polygon's typical
--    "this state, last 20 years" filter shape.
create index if not exists homicide_aggregates_state_year_idx
  on homicide_aggregates (state, year);

-- 2. (state, county, year) — backs homicide_context_for_case, which
--    pulls the SHR baseline for a given county + ±5-year window.
create index if not exists homicide_aggregates_state_county_year_idx
  on homicide_aggregates (state, county, year);

-- 3. ORI + year — backs the agency-level breakdown views and lets
--    audits cross-check counts against MAP's web search by agency.
create index if not exists homicide_aggregates_ori_year_idx
  on homicide_aggregates (ori, year);

-- 4. GiST on location_point — backs homicide_density_for_bbox's
--    ST_Intersects predicate. Filtered partial index to drop the
--    state-precision rows that never render on the map (mirrors
--    the cases_location_point_idx pattern from 01_schema.sql:223).
create index if not exists homicide_aggregates_location_gix
  on homicide_aggregates using gist (location_point)
  where location_point is not null and location_precision is distinct from 'state';

-- 5. source_release — for fast per-release operations (idempotent
--    re-ingest, audit "what did the new release add").
create index if not exists homicide_aggregates_source_release_idx
  on homicide_aggregates (source_release);

-- 6. (year, solved) — backs the solved/unsolved split queries.
--    Compact: smallint+boolean. Stored separately from state because
--    the polygon RPCs grade through a state filter first.
create index if not exists homicide_aggregates_year_solved_idx
  on homicide_aggregates (year, solved);


-- ─────────────────────────────────────────────────────────────────────────────
-- RLS posture
-- ─────────────────────────────────────────────────────────────────────────────
-- homicide_aggregates rows carry no PII (SHR is anonymized upstream)
-- and are read-only from the client. We enable RLS with a read-everyone
-- policy to keep the surface uniform with the rest of the schema (every
-- public-readable table in 01_schema.sql has RLS + an explicit select
-- policy). Writes go through the service-role ingest script, which
-- bypasses RLS via the service key.

alter table agencies_ori        enable row level security;
alter table homicide_aggregates enable row level security;

drop policy if exists "agencies_ori_public_read"        on agencies_ori;
drop policy if exists "homicide_aggregates_public_read" on homicide_aggregates;

create policy "agencies_ori_public_read"
  on agencies_ori
  for select
  using (true);

create policy "homicide_aggregates_public_read"
  on homicide_aggregates
  for select
  using (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- Helper view — current_release homicide_aggregates
-- ─────────────────────────────────────────────────────────────────────────────
-- Plan §3 calls for a current_release_id view that selects "the latest
-- snapshot." Without an explicit release-registry table we infer the
-- latest source_release lexicographically — the release naming
-- convention (`map_shr_YYYY_MM`) gives us a working ORDER BY.
-- When the registry table lands (Phase 2 deliverable per plan §5) this
-- view's body changes; the view name stays the public surface so any
-- callers don't churn.

create or replace view homicide_aggregates_current as
  select *
  from homicide_aggregates h
  where h.source_release = (
    select source_release
    from homicide_aggregates
    -- Lexicographic sort works for the `map_shr_YYYY_MM` convention;
    -- swap for an explicit release table in Phase 2.
    order by source_release desc
    limit 1
  );

comment on view homicide_aggregates_current is
  'Latest source_release of homicide_aggregates. RPCs in migration 48 read this view, not the base table directly, so a new ingest atomically swaps the active corpus once the new source_release is the lexicographic max.';

comment on table homicide_aggregates is
  'MAP (Murder Accountability Project) SHR row-per-victim corpus. Anonymized — no victim names, month-only dates, agency-centroid locations. See docs/integrations/map-ingestion-plan.md.';

comment on table agencies_ori is
  'ORI → centroid lookup. ~20k rows at full population (FBI ORI directory). Populated by scripts/ingest-map-shr.ts from data/map/agencies_ori_*.json.';
