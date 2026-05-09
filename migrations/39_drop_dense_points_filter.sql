-- Migration 39 — drop the dense_points filter from cases_in_bbox.
--
-- Background:
--   The centroid-badge layer (migrations 33–38) was an editorial
--   experiment: aggregate any coincident-coord cluster into a single
--   amber disc with a count + locale label, so the map never lies
--   about position. In practice the dashed badges + locale labels
--   created an overwhelming visual at low zoom — every small-town
--   city centroid carries a "2" / "3" / "7" badge, and dense metros
--   stack 8+ overlapping discs (LA / Hollywood / Long Beach / etc.).
--   User feedback: "they look horrible and clutter up the map way
--   too much."
--
--   This migration retires the layer. cases_in_bbox now returns ALL
--   non-state-precision cases — solo and coincident — so they all
--   flow through the marker layer + markercluster. markercluster's
--   existing clusterIconFor (the small ringed amber circles in the
--   pre-rebuild UI) handles the "many cases at this point" visual
--   in the standard pattern this app already uses for spatial
--   adjacency. No bespoke badge layer, no dashed discs.
--
--   The cases_centroids_in_bbox + cases_at_coordinate RPCs from
--   migrations 33/35/36/38 stay registered in the schema but are
--   no longer called by the client. Idle SQL functions are
--   harmless; dropping them would require either coordinating with
--   client deploys (PostgREST schema cache + OTA timing) or
--   accepting a brief window where the active OTA still calls them
--   and gets PGRST201 errors. Keeping them is the safer path; a
--   future cleanup migration can drop them once we're certain no
--   client revision references the symbols.
--
-- Two changes:
--   1. cases_in_bbox: drop the dense_points CTE and its NOT IN clause.
--      Body keeps the precision-state filter, the bbox intersect, the
--      kind / status filters, the limit, and the location_precision
--      column added by migration 34. Everything else is unchanged.
--
--   2. RETURNS TABLE shape unchanged from migration 34 → CREATE OR
--      REPLACE works in-place (no DROP needed).
--
-- After this migration applies, the home map sees solo + coincident
-- cases as one stream. The 211 cases at the LA centroid become a
-- single markercluster cluster icon at low zoom (cluster.getChild
-- Count() = 211 → "211" in the standard cluster visual). Tap behavior
-- inherits the marker layer's existing spiderfy config.

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
  has_photo boolean,
  incident_date date,
  location_city text,
  location_state text,
  location_precision text,
  recency_alpha numeric
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
    c.has_photo,
    c.incident_date,
    c.location_city,
    c.location_state,
    c.location_precision,
    case
      when c.last_changed_at is null then 0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 3 then 1.0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 10 then 0.5
      else 0
    end::numeric as recency_alpha
  from cases c
  where
    c.deleted_at is null
    and c.location_point is not null
    and c.location_precision is distinct from 'state'
    and ST_Intersects(
      c.location_point,
      ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    )
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
  order by c.last_changed_at desc nulls last, c.id
  limit result_limit;
$$;
