-- Migration 41 — location_cache + city_polygons scaffolding.
--
-- Two new tables, both empty on initial apply. Sets up the slot for
-- the multi-provider geocoding architecture and the city-polygon
-- rendering work the press-sprint week defers. Existing geocode_cache
-- table stays — it does the single-provider Mapbox cache-aside job
-- correctly today; the new location_cache is for when the recovery
-- pipeline grows a second resolver (Foursquare / Yelp / OSM Overpass).
--
-- Why TWO cache tables side-by-side rather than evolving geocode_
-- cache: the existing table is keyed on a normalized text query and
-- carries no provider attribution, no TTL-per-row, no raw query
-- preservation. Adding those columns + backfilling the existing rows
-- + carrying a provider='mapbox' default for legacy rows is more
-- migration friction than running both tables in parallel until the
-- multi-stage pipeline lands. When that lands, location_cache
-- becomes the canonical cache; geocode_cache gets dropped in a
-- follow-up.
--
-- city_polygons stays empty until the Cold-File-unpaused session
-- ingests US Census TIGER incorporated-place polygons. The renderer
-- will branch on (polygon present → polygon shading; polygon absent
-- → fallback fuzzy pin) when that work lands. The schema is sized
-- for ~30k US incorporated places; geometry(Polygon, 4326) supports
-- spatial-join queries from cases_in_bbox without postprocessing.
--
-- Idempotent via CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS.

-- ─── 1. location_cache: per-query multi-provider cache ──────────

create table if not exists location_cache (
  -- sha256 of the normalized query string. Hash rather than the raw
  -- string so we can index efficiently regardless of how long the
  -- LLM-extracted candidates are; the raw string is preserved in
  -- query_raw for debugging.
  query_hash text primary key,
  query_raw text not null,
  -- 'mapbox' | 'foursquare' | 'yelp' | 'osm' | 'manual' — open enum,
  -- intentionally not CHECK-constrained until we know the final set.
  provider text not null,
  -- null lat/lng = negative cache (this query returned no result
  -- against this provider). The orchestrator can decide whether to
  -- retry against a different provider before falling through to
  -- 'rejected_geocode_failed'.
  resolved_lat double precision,
  resolved_lng double precision,
  -- Tiered precision per the architectural sketch. Strings rather
  -- than enum so future tiers (e.g. 'parcel', 'plus_code') can be
  -- added without ALTER TYPE.
  precision text,
  resolved_at timestamptz not null default now(),
  -- Optional per-row expiry. Useful for businesses that close,
  -- POI listings that update. NULL = use the global TTL set by the
  -- caller (e.g. 90d positive / 30d negative — see geocode-resolver.ts
  -- for the existing convention).
  ttl_until timestamptz,
  -- Provider response payload, kept for audit / future re-mapping
  -- if we change the precision-tier mapping.
  raw jsonb
);

create index if not exists location_cache_provider_idx
  on location_cache(provider);
create index if not exists location_cache_resolved_at_idx
  on location_cache(resolved_at desc);

comment on table location_cache is
  'Multi-provider geocoding cache. Keyed by sha256 of the normalized query so rows are uniform-width regardless of input verbosity. Negative results stored with null lat/lng. Coexists with geocode_cache (single-provider Mapbox); becomes canonical once the multi-stage pipeline lands.';

-- ─── 2. city_polygons: city-level boundary data for shading ─────

create table if not exists city_polygons (
  -- (city, state) is the natural key — case rows store these as
  -- text, and the renderer's join is on these columns. lower-cased
  -- on insert for case-insensitive lookup against potentially-mixed-
  -- case source data.
  city text not null,
  state text not null,
  geom geography(Polygon, 4326) not null,
  -- 'tiger' | 'osm' | 'manual' — origin attribution. Drives the
  -- "stale boundary" detection later when we want to pick which
  -- source to trust per-city.
  source text not null,
  -- Population estimate for picking which polygon dominates when
  -- multiple sources disagree. Optional — manual entries can leave
  -- it null.
  population integer,
  ingested_at timestamptz not null default now(),
  primary key (city, state)
);

create index if not exists city_polygons_geom_idx
  on city_polygons using gist(geom);

comment on table city_polygons is
  'US incorporated-place boundary polygons for the precision-tier rendering work. Empty on initial apply; populated from US Census TIGER data in a follow-up session. Renderer falls back to fuzzy-pin rendering when (city, state) does not match.';
