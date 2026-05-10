-- Migration 42 — replace cases_in_bbox ORDER BY last_changed_at with
-- ORDER BY id, so the result_limit cap stops being a state-skew
-- amplifier under bursty single-source ingestion.
--
-- Context (the 2026-05-10 incident):
--   The 2026-05-04 Doe Network UID rescrape touched ~3,123 records
--   over a 24-27h run, concentrated in CA. Diagnostic on 2026-05-10
--   (scripts/sql + /tmp paginated PostgREST aggregations) found:
--     * 6,547 cases meet the visibility predicate
--       (deleted_at IS NULL AND location_point IS NOT NULL AND
--        location_precision IS DISTINCT FROM 'state')
--     * cases_in_bbox(USA bbox) at default result_limit=500 returned
--       500 rows, 368 of them CA (73.6%) — vs CA's true visible
--       share of 503 / 6,547 = 7.7%
--   Mechanism: the ORDER BY last_changed_at DESC NULLS LAST, c.id
--   clause from migrations 22 / 34 / 39 makes the LIMIT cut consume
--   whichever rows the most recent rescrape touched. Single-state
--   rescrape → that state hoards the cap. Symptom: nationwide map
--   shows ~one state's cases, every other state appears empty.
--
--   This is NOT the dense-points filter (mig 16-29 → retired in mig
--   39). The 2026-05-10 diagnostic confirmed mig 39 is live: the
--   LA / SF / Houston coincident-coord clusters (94 + 44 + 24 = 162
--   cases) flow through the RPC. Dense-points is genuinely off the
--   table.
--
-- The change:
--   ORDER BY c.last_changed_at DESC NULLS LAST, c.id
--     →  ORDER BY c.id
--
--   cases.id is `uuid primary key default gen_random_uuid()` (per
--   01_schema.sql:144 + pgcrypto), which is UUIDv4 — uniformly
--   random, not time-ordered. Sorting by id under the cap gives a
--   stable pseudo-random distribution across every state, kind, and
--   source. ~7.6% of each state's visible corpus surfaces at
--   nationwide zoom (500 / 6,547). At any non-nationwide zoom the
--   bbox predicate already restricts the candidate set below the
--   cap, so this change is a no-op there.
--
-- The durable rule (logged to user-memory):
--   A LIMIT'd read RPC ordered by any column correlated with
--   ingestion timing (last_changed_at, last_seen_at) or curator
--   activity (featured, is_curated) is a state-skew amplifier under
--   bursty single-source ingestion. Default to ingestion-independent
--   ordering (e.g. id when the type is uniformly random). Editorial
--   ordering (newest-first, featured-first) belongs at higher zoom
--   levels where the cap doesn't bite — not at continental zoom.
--
-- What this migration does NOT fix:
--   The 500-cap-vs-6,547-visible underlying cardinality mismatch.
--   At nationwide zoom, the user still sees ~7.6% of each state's
--   pins. That ratio only improves with server-side tile-grid
--   aggregation (planned: cases_grid_in_bbox, separate PR) — bucket
--   cases into a viewport grid via ST_SnapToGrid at zoom < threshold,
--   render one badge per cell. The badge layer mig 33-38 prepped
--   (precision_floor, cases_centroids_in_bbox) is in the schema but
--   no longer called by the client; the tile-grid approach reuses
--   the rendering shape without inheriting mig 39's editorial
--   problem (city-centroid stacking looked horrible at low zoom).
--
-- Why CREATE OR REPLACE works:
--   RETURNS TABLE shape is unchanged from mig 39 — same 13 columns,
--   same types. PostgreSQL allows in-place body replacement when the
--   signature is unchanged (no error 42P13).
--
-- Index implications:
--   None. The bbox predicate uses the existing
--   cases_location_point_idx (GiST, mig 01:223). The ORDER BY runs
--   over the post-filter row set — at most ~6,547 rows at nationwide
--   zoom, trivial to sort. The future tile-grid RPC will eliminate
--   this sort path at low zoom entirely; until then no new index is
--   warranted.

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
  -- ↓ mig 42: was `c.last_changed_at desc nulls last, c.id` (mig 22 /
  -- 34 / 39). That ordering made the LIMIT cap state-skewed under
  -- single-source rescrapes (the 2026-05-10 incident). UUIDv4 id
  -- gives a uniform pseudo-random distribution under the cap.
  order by c.id
  limit result_limit;
$$;
