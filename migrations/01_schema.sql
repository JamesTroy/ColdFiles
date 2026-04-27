-- ============================================================================
-- The Cold File — Core Schema
-- Stack: Supabase (PostgreSQL 15) + PostGIS
-- Conventions: snake_case, soft-deletes via deleted_at, UTC timestamptz, RLS-aware
-- ============================================================================

create extension if not exists postgis;
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- fuzzy name matching for dedupe
create extension if not exists "unaccent";   -- normalize names for dedupe


-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────────────

create type case_kind as enum (
  'homicide',           -- unsolved murder
  'missing',            -- long-term missing person
  'unidentified',       -- unidentified decedent (Jane/John Doe)
  'unclaimed',          -- known identity, no next of kin claimed
  'suspicious_death'    -- death investigation, manner undetermined
);

create type case_status as enum (
  'open',               -- active unsolved
  'cleared_arrest',     -- suspect identified/arrested but case kept for transparency
  'cleared_other',      -- exceptionally cleared (suspect deceased, etc.)
  'identified',         -- for unidentifieds: identified
  'located',            -- for missing: located
  'withdrawn'           -- removed at family request or agency request
);

create type sex_kind as enum ('male', 'female', 'unknown', 'other');

create type date_quality as enum (
  'exact',              -- known
  'approximate',        -- "around June 1985"
  'year_only',          -- only year known
  'suspect',            -- imported value flagged unreliable (e.g. Project: Cold Case 1970-01-01)
  'unknown'             -- no date available
);

create type media_kind as enum (
  'photo_victim',       -- photo of the victim
  'sketch_victim',      -- forensic sketch of unidentified victim
  'reconstruction',     -- facial reconstruction
  'age_progression',    -- aged-up missing person
  'photo_clothing',     -- clothing/effects
  'photo_jewelry',      -- jewelry/effects
  'photo_evidence',     -- non-graphic evidence
  'photo_location',     -- crime scene exterior
  'sketch_poi',         -- person-of-interest sketch (NEVER labeled "suspect" in UI)
  'document'            -- press release PDF, etc.
);

create type source_kind as enum (
  'federal',
  'state',
  'agency',
  'aggregator',
  'nonprofit',
  'media'
);

create type tip_route_kind as enum (
  'crime_stoppers_p3',
  'agency_form',
  'agency_phone',
  'fbi_tip',
  'namus_form',
  'email'
);


-- ─────────────────────────────────────────────────────────────────────────────
-- AGENCIES (lookup) — investigating bodies
-- ─────────────────────────────────────────────────────────────────────────────

create table agencies (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,                 -- 'lapd', 'lasd-homicide', 'fdle'
  name            text not null,                        -- 'Los Angeles Police Department'
  short_name      text,                                  -- 'LAPD'
  agency_type     text not null,                        -- 'city_pd' | 'county_sheriff' | 'state_police' | 'federal' | 'da_office'
  state           char(2),                              -- 'CA' (null for federal)
  county          text,
  city            text,
  jurisdiction_geom geography(MultiPolygon, 4326),      -- optional, for which-agency-owns-this-point queries
  phone_general   text,
  phone_tip       text,
  tip_url         text,                                 -- agency tip submission form
  tip_route_kind  tip_route_kind,
  website_url     text,
  cold_case_url   text,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index agencies_state_idx on agencies(state);
create index agencies_jurisdiction_geom_idx on agencies using gist(jurisdiction_geom);


-- ─────────────────────────────────────────────────────────────────────────────
-- SOURCES (lookup) — where we ingested data from
-- ─────────────────────────────────────────────────────────────────────────────

create table sources (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,                 -- 'namus', 'charley_project', 'lapd_unsolved'
  name            text not null,                        -- 'NamUs'
  kind            source_kind not null,
  base_url        text not null,
  scrape_strategy text,                                  -- 'html_pagination' | 'sitemap' | 'json_api'
  config          jsonb not null default '{}'::jsonb,   -- per-scraper config (selectors, urls, etc.)
  attribution_html text not null,                       -- shown in case detail UI
  link_back_required boolean not null default true,
  active          boolean not null default true,
  default_rate_limit_ms integer not null default 2000,
  next_run_at     timestamptz default now(),
  last_status     text,
  created_at      timestamptz not null default now()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- CASES (core entity)
-- One row per unique real-world case. Multiple sources may all describe this row.
-- ─────────────────────────────────────────────────────────────────────────────

create table cases (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,                  -- 'jane-doe-1985-claremont-ca'

  -- Classification
  kind                  case_kind not null,
  status                case_status not null default 'open',

  -- Victim/subject identity
  victim_name           text,                                  -- null for John/Jane Doe
  victim_aliases        text[],                                -- known aliases
  victim_first_name     text,                                  -- denormalized for fuzzy dedupe
  victim_last_name      text,                                  -- denormalized for fuzzy dedupe
  victim_age            integer,
  victim_age_min        integer,                               -- for unidentifieds: estimated range
  victim_age_max        integer,
  victim_sex            sex_kind,
  victim_race           text,                                  -- free-form, follow source
  victim_ethnicity      text,
  victim_height_cm      integer,
  victim_weight_kg      integer,
  victim_eye_color      text,
  victim_hair_color     text,
  distinguishing_marks  text,                                  -- scars, tattoos, etc.

  -- Incident location & date
  incident_date         date,
  incident_date_quality date_quality not null default 'unknown',
  incident_date_text    text,                                  -- 'sometime in June 1985'
  location_text         text,                                  -- '15400 block of Temple Ave, La Puente, CA'
  location_city         text,
  location_county       text,
  location_state        char(2),
  location_zip          text,
  location_point        geography(Point, 4326),                -- best-effort geocode
  location_precision    text,                                  -- 'address' | 'street' | 'city' | 'county' | 'unknown'

  -- For missing persons
  last_seen_text        text,
  last_seen_date        date,
  last_seen_clothing    text,
  last_seen_circumstances text,

  -- Narrative
  narrative             text,                                  -- merged best-source narrative
  narrative_short       text,                                  -- 1-2 sentence summary for cards

  -- Investigation
  primary_agency_id     uuid references agencies(id),
  case_number_primary   text,                                  -- agency case number
  ncic_number           text,
  namus_number          text,
  reward_amount_usd     numeric(10, 2),
  reward_text           text,                                  -- '$30,000 from city + family'

  -- Tip routing
  tip_phone             text,
  tip_url               text,
  tip_route_kind        tip_route_kind,

  -- Quality + featured flags
  has_photo             boolean not null default false,
  has_sketch            boolean not null default false,
  has_reconstruction    boolean not null default false,
  has_dna_on_file       boolean,
  is_featured           boolean not null default false,        -- editorial spotlight
  is_high_publicity     boolean not null default false,        -- known to general public

  -- Lifecycle
  first_seen_at         timestamptz not null default now(),    -- when WE first ingested
  last_seen_at          timestamptz not null default now(),    -- when WE last saw it in any source
  last_changed_at       timestamptz not null default now(),    -- when WE last detected changes
  takedown_requested_at timestamptz,
  takedown_reason       text,
  deleted_at            timestamptz,                            -- soft delete
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Spatial index for radius queries (the user's home screen — "cases within 10mi of me")
create index cases_location_point_idx on cases using gist(location_point);

-- Common lookup indexes
create index cases_state_idx on cases(location_state) where deleted_at is null;
create index cases_kind_status_idx on cases(kind, status) where deleted_at is null;
create index cases_primary_agency_idx on cases(primary_agency_id);
create index cases_incident_date_idx on cases(incident_date desc);
create index cases_featured_idx on cases(is_featured) where is_featured = true and deleted_at is null;

-- Trigram indexes for fuzzy dedupe lookups
create index cases_victim_last_name_trgm_idx on cases using gin(victim_last_name gin_trgm_ops);
create index cases_victim_first_name_trgm_idx on cases using gin(victim_first_name gin_trgm_ops);

-- Composite for "what's near me, sorted by recency"
create index cases_loc_kind_status_idx
  on cases using gist(location_point)
  include (kind, status, incident_date)
  where deleted_at is null;


-- ─────────────────────────────────────────────────────────────────────────────
-- CASE_SOURCES (many-to-many between cases and sources)
-- Tracks which sources have a record of this case + raw payload for re-scoring
-- ─────────────────────────────────────────────────────────────────────────────

create table case_sources (
  id                    uuid primary key default gen_random_uuid(),
  case_id               uuid not null references cases(id) on delete cascade,
  source_id             uuid not null references sources(id),
  source_external_id    text not null,                         -- source's own ID (e.g. NamUs MP12345)
  source_url            text not null,                         -- canonical URL on source
  raw_payload           jsonb not null,                        -- full extracted data, for re-scoring
  payload_hash          text not null,                         -- sha256 of normalized payload, for change detection
  trust_weight          smallint not null default 50,          -- 0-100; used in field-conflict resolution
  first_ingested_at     timestamptz not null default now(),
  last_ingested_at      timestamptz not null default now(),
  unique(source_id, source_external_id)
);

create index case_sources_case_id_idx on case_sources(case_id);
create index case_sources_source_external_idx on case_sources(source_id, source_external_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- CASE_DEDUPE_KEYS — multi-key fuzzy match index
-- ─────────────────────────────────────────────────────────────────────────────

create table case_dedupe_keys (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references cases(id) on delete cascade,
  key_type    text not null,                          -- 'namus_number' | 'ncic' | 'name_dob_yyyymmdd' | 'name_state_year' | etc.
  key_value   text not null,                          -- normalized lowercase value
  unique(key_type, key_value)
);

create index case_dedupe_keys_case_idx on case_dedupe_keys(case_id);
create index case_dedupe_keys_lookup_idx on case_dedupe_keys(key_type, key_value);


-- ─────────────────────────────────────────────────────────────────────────────
-- CASE_MEDIA — photos, sketches, reconstructions
-- ─────────────────────────────────────────────────────────────────────────────

create table case_media (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases(id) on delete cascade,
  source_id       uuid references sources(id),
  kind            media_kind not null,
  url             text not null,                          -- our cached copy in Supabase Storage
  source_url      text,                                    -- original URL (for re-fetch)
  caption         text,
  is_primary      boolean not null default false,
  width_px        integer,
  height_px       integer,
  bytes           integer,
  content_hash    text,                                    -- sha256, dedupe identical media across sources
  display_warning text,                                    -- 'graphic' | 'sensitive' (gates UI display)
  fetched_at      timestamptz not null default now(),
  unique(case_id, kind, content_hash)
);

create index case_media_case_idx on case_media(case_id);
create index case_media_primary_idx on case_media(case_id) where is_primary = true;


-- ─────────────────────────────────────────────────────────────────────────────
-- CASE_UPDATES — timeline of changes / press releases / agency announcements
-- ─────────────────────────────────────────────────────────────────────────────

create table case_updates (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases(id) on delete cascade,
  source_id       uuid references sources(id),
  update_type     text not null,                          -- 'press_release' | 'reward_change' | 'identified' | 'arrest' | 'family_appeal' | 'sketch_added'
  title           text not null,
  body            text,
  source_url      text,
  occurred_at     timestamptz not null,                   -- when the update happened (per source)
  created_at      timestamptz not null default now()
);

create index case_updates_case_idx on case_updates(case_id, occurred_at desc);


-- ─────────────────────────────────────────────────────────────────────────────
-- USER FACING — watches, alerts, tips
-- ─────────────────────────────────────────────────────────────────────────────

create table user_watches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  case_id         uuid references cases(id) on delete cascade,        -- null if it's a watch_zone
  watch_zone_geom geography(Polygon, 4326),                            -- watch a polygon, not a case
  watch_zone_label text,
  notify_new_cases boolean not null default true,
  notify_updates  boolean not null default true,
  notify_arrests  boolean not null default true,
  created_at      timestamptz not null default now(),
  check (case_id is not null or watch_zone_geom is not null)
);

create index user_watches_user_idx on user_watches(user_id);
create index user_watches_case_idx on user_watches(case_id);
create index user_watches_zone_idx on user_watches using gist(watch_zone_geom);


-- Tip submissions are routed THROUGH us to agencies, not stored here as evidence.
-- We log only that a tip was submitted, the routing target, and a content hash,
-- never the content itself.

create table tip_routings (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references cases(id),
  user_id             uuid references auth.users(id),                 -- nullable for anonymous tips
  routed_to_agency_id uuid references agencies(id),
  routed_to_url       text,
  routed_to_kind      tip_route_kind not null,
  content_hash        text not null,                                  -- sha256, NOT content itself
  ip_hash             text,                                            -- hashed for abuse detection only
  user_agent_summary  text,
  created_at          timestamptz not null default now()
);

create index tip_routings_case_idx on tip_routings(case_id);
create index tip_routings_created_idx on tip_routings(created_at desc);


-- Premium subscriptions (Stripe-backed)
create table user_subscriptions (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id  text,
  stripe_subscription_id text,
  tier                text not null default 'free',                   -- 'free' | 'premium'
  status              text not null default 'active',                 -- 'active' | 'past_due' | 'canceled'
  current_period_end  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- TAKEDOWN AUDIT — public family takedown requests
-- ─────────────────────────────────────────────────────────────────────────────

create table takedown_requests (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid references cases(id),
  requester_relationship text,                          -- 'family' | 'agency' | 'other'
  requester_email_hash text,                             -- hashed for follow-up only
  reason          text not null,
  status          text not null default 'pending',     -- 'pending' | 'honored' | 'rejected' | 'partial'
  notes           text,                                  -- internal review notes
  decided_at      timestamptz,
  decided_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index takedown_requests_status_idx on takedown_requests(status);


-- ─────────────────────────────────────────────────────────────────────────────
-- SOURCE_RUNS — per-run telemetry for each scraper invocation
-- ─────────────────────────────────────────────────────────────────────────────

create table source_runs (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid not null references sources(id),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running',  -- 'running' | 'success' | 'failed' | 'aborted_robots'
  cases_seen      integer not null default 0,
  cases_new       integer not null default 0,
  cases_updated   integer not null default 0,
  errors          jsonb,
  notes           text
);

create index source_runs_source_idx on source_runs(source_id, started_at desc);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROBOTS_CACHE + GEOCODE_CACHE — small lookup tables for the scraper plumbing
-- ─────────────────────────────────────────────────────────────────────────────

create table robots_cache (
  host            text primary key,
  rules           jsonb not null,
  fetched_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

create table geocode_cache (
  query_normalized  text primary key,
  lat               double precision,                     -- explicit so the resolver doesn't decode WKB on read
  lng               double precision,
  point             geography(Point, 4326),               -- generated from lat/lng for spatial joins
  precision         text,
  raw               jsonb,
  cached_at         timestamptz not null default now()
);

create index geocode_cache_point_idx on geocode_cache using gist(point);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEDUPE_REVIEW_QUEUE — candidates the resolver couldn't auto-merge
-- ─────────────────────────────────────────────────────────────────────────────

create table dedupe_review_queue (
  id                uuid primary key default gen_random_uuid(),
  case_id_a         uuid not null references cases(id) on delete cascade,
  case_id_b         uuid not null references cases(id) on delete cascade,
  match_keys        jsonb not null,                       -- which keys overlapped
  similarity_score  numeric(4, 3),                        -- 0.000-1.000
  status            text not null default 'pending',     -- 'pending' | 'merged' | 'rejected'
  resolved_by       uuid references auth.users(id),
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  check (case_id_a < case_id_b)                           -- canonical ordering, prevents (A,B) and (B,A) duplicates
);

create index dedupe_review_queue_status_idx on dedupe_review_queue(status) where status = 'pending';


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: cases_within_radius
-- The home screen query: "what's near me?"
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function cases_within_radius(
  search_lat double precision,
  search_lng double precision,
  radius_miles double precision default 25,
  filter_kinds case_kind[] default null,
  filter_status case_status[] default array['open']::case_status[],
  result_limit integer default 100
)
returns table (
  id uuid,
  slug text,
  kind case_kind,
  status case_status,
  victim_name text,
  victim_age integer,
  incident_date date,
  location_text text,
  location_city text,
  location_state char(2),
  narrative_short text,
  has_photo boolean,
  primary_agency_name text,
  primary_photo_url text,
  distance_miles numeric
)
language sql
stable
as $$
  select
    c.id,
    c.slug,
    c.kind,
    c.status,
    c.victim_name,
    c.victim_age,
    c.incident_date,
    c.location_text,
    c.location_city,
    c.location_state,
    c.narrative_short,
    c.has_photo,
    a.name as primary_agency_name,
    (
      select cm.url
      from case_media cm
      where cm.case_id = c.id and cm.is_primary = true
      limit 1
    ) as primary_photo_url,
    round(
      (st_distance(
        c.location_point,
        st_setsrid(st_makepoint(search_lng, search_lat), 4326)::geography
      ) / 1609.34)::numeric,
      2
    ) as distance_miles
  from cases c
  left join agencies a on a.id = c.primary_agency_id
  where
    c.deleted_at is null
    and c.location_point is not null
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
    and st_dwithin(
      c.location_point,
      st_setsrid(st_makepoint(search_lng, search_lat), 4326)::geography,
      radius_miles * 1609.34
    )
  order by c.location_point <-> st_setsrid(st_makepoint(search_lng, search_lat), 4326)::geography
  limit result_limit;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: cases_in_bbox
-- The map view query: "what's in this viewport?"
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function cases_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  filter_kinds case_kind[] default null,
  filter_status case_status[] default array['open']::case_status[],
  result_limit integer default 500
)
returns table (
  id uuid,
  slug text,
  kind case_kind,
  status case_status,
  lat double precision,
  lng double precision,
  victim_name text,
  has_photo boolean
)
language sql
stable
as $$
  select
    c.id,
    c.slug,
    c.kind,
    c.status,
    st_y(c.location_point::geometry) as lat,
    st_x(c.location_point::geometry) as lng,
    c.victim_name,
    c.has_photo
  from cases c
  where
    c.deleted_at is null
    and c.location_point is not null
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
    and c.location_point && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
  limit result_limit;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — public read on cases, writes restricted to service role
-- ─────────────────────────────────────────────────────────────────────────────

alter table cases             enable row level security;
alter table case_sources      enable row level security;
alter table case_media        enable row level security;
alter table case_updates      enable row level security;
alter table case_dedupe_keys  enable row level security;
alter table agencies          enable row level security;
alter table sources           enable row level security;
alter table user_watches      enable row level security;
alter table tip_routings      enable row level security;
alter table user_subscriptions enable row level security;
alter table takedown_requests enable row level security;

-- Public read on case data (excluding soft-deleted)
create policy cases_public_read on cases
  for select using (deleted_at is null);

create policy case_media_public_read on case_media
  for select using (
    exists (select 1 from cases c where c.id = case_media.case_id and c.deleted_at is null)
  );

create policy case_updates_public_read on case_updates
  for select using (
    exists (select 1 from cases c where c.id = case_updates.case_id and c.deleted_at is null)
  );

create policy case_sources_public_read on case_sources
  for select using (
    exists (select 1 from cases c where c.id = case_sources.case_id and c.deleted_at is null)
  );

create policy agencies_public_read on agencies
  for select using (true);

create policy sources_public_read on sources
  for select using (true);

-- User-owned data
create policy user_watches_owner on user_watches
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy user_subscriptions_owner on user_subscriptions
  for select using (user_id = auth.uid());

-- Tip routings: insert open, no read (write-only audit log from user perspective)
create policy tip_routings_insert on tip_routings
  for insert with check (true);

-- Takedown requests: insert open, no read
create policy takedown_requests_insert on takedown_requests
  for insert with check (true);

-- All write paths to case data are service_role only (no policy = no access for non-service)


-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger cases_touch_updated_at before update on cases
  for each row execute function touch_updated_at();
create trigger agencies_touch_updated_at before update on agencies
  for each row execute function touch_updated_at();
create trigger user_subscriptions_touch_updated_at before update on user_subscriptions
  for each row execute function touch_updated_at();
