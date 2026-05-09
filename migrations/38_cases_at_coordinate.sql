-- Migration 38 — cases_at_coordinate RPC: tap-drill for centroid badges.
--
-- Background:
--   Migrations 33–35 split the bbox read path into two RPCs: cases_in_
--   bbox returns solo-coord rows (one case per coordinate), cases_
--   centroids_in_bbox returns the AGGREGATED rows for any coincident
--   coordinate (≥2 cases sharing one lat/lng). The centroid renderer
--   draws a single badge at each shared coord with the count printed
--   on it (e.g. "211" at the LA city centroid).
--
--   The badge tap was a stub — onCentroidPress fired postMessage from
--   the WebView but no screen-side handler attached, so users tapped
--   "211" and nothing happened. The 211 cases looked stuck. This
--   migration ships the data-layer half of the tap-drill: a third
--   RPC keyed on (lat, lng) that returns the cases sharing that
--   exact coordinate, so the screen can mount a side-list when a
--   badge is tapped.
--
--   Symmetric to cases_in_bbox / cases_centroids_in_bbox by design:
--   same column shape (id, slug, kind, status, lat, lng,
--   victim_name, has_photo, incident_date, incident_date_quality,
--   location_city, location_state, location_precision, recency_alpha)
--   so the existing CaseRow renderer + CaseRowMapBbox type are reused
--   by the tap-drill list without per-row mapping.
--
-- Why an exact-equality match (no tolerance):
--   The centroid set itself is built from `group by location_point`
--   in cases_centroids_in_bbox, so the cases at a centroid are by
--   definition cases whose location_point compares equal. Equality
--   on st_y/st_x of the underlying geometry round-trips that grouping
--   exactly. A radius-based tap-drill would split groups inconsistent-
--   ly with the badge it was launched from — a 0.0001° tolerance
--   would either omit some members or pull in nearby singletons that
--   the map renders as their own pins.
--
-- Why st_y/st_x equality and not location_point = ST_MakePoint(...):
--   Geography-equality on PostGIS isn't a primary-key style equality —
--   it goes through the geography operator class and can fall through
--   to the b-tree path or the GIST path depending on plan. The
--   centroid grouping uses native group-by-equality on location_point,
--   which lands on the same b-tree path that the (st_y, st_x) coord
--   pair re-derives losslessly. Rounding is not a concern: PostGIS
--   stores points as double precision and st_y/st_x return the exact
--   stored value.
--
-- Why include 'state' precision exclusion (matching cases_in_bbox):
--   For consistency. cases_centroids_in_bbox excludes state-precision
--   rows (migration 33 rationale: a state centroid is meaningfully a
--   non-point), so the tap-drill should never see a coordinate that
--   the badge layer would have hidden. Belt-and-suspenders — in
--   practice no badge can route here for a state-precision coord
--   because none reach cases_centroids_in_bbox in the first place.
--
-- Filter parity:
--   filter_kinds + filter_status mirror cases_in_bbox's filter
--   contract so the tap-drill respects the active chip on the map
--   (when the user has Homicide selected, the side-list shows only
--   the homicide subset of the centroid's cases). Defaults match:
--   filter_kinds null = all kinds, filter_status defaults to ['open'].
--
-- result_limit:
--   Default 100. The largest known centroid (LA county centroid pile-
--   up at 211) sits above this default; callers should pass an
--   explicit limit at or above the badge's case_count when they want
--   the full set guaranteed. The screen-side hook passes 500 as a
--   conservative ceiling per the same headroom logic the bbox hooks
--   use.
--
-- Idempotent:
--   Plain `create function` would fail on re-apply. New signature
--   means no existing function to replace — we still wrap in a
--   defensive `drop function if exists` so the migration is safe to
--   re-run during development. (Production runs apply once; the drop
--   is a no-op there.)

drop function if exists public.cases_at_coordinate(
  double precision, double precision, case_kind[], case_status[], integer
);

create function cases_at_coordinate(
  query_lat double precision,
  query_lng double precision,
  filter_kinds case_kind[] default null,
  filter_status case_status[] default array['open']::case_status[],
  result_limit integer default 100
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
  -- Mirror migration 36's quality column on cases_in_bbox so the
  -- side-list can format dates with the same kindLine helper the
  -- bottom-sheet uses (year-only dates render as "1985" not
  -- "1985-01-01"). Optional per the type — PostgREST omits when null.
  incident_date_quality date_quality,
  location_city text,
  location_state text,
  -- Per migration 34's pattern: surface precision so the side-list
  -- can render an honest "city-level" / "address" / "unknown" label
  -- under each row when the cluster mixes precision tiers. A 211-
  -- case city centroid pile-up will mostly be 'city' precision rows
  -- (the dominant geocoding outcome for cases without a street
  -- address); rare 'address' rows in the same group should be
  -- legible to the user as more-precisely-located.
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
    c.incident_date_quality,
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
  where c.deleted_at is null
    and c.location_point is not null
    and c.location_precision is distinct from 'state'
    and st_y(c.location_point::geometry) = query_lat
    and st_x(c.location_point::geometry) = query_lng
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
  order by c.last_changed_at desc nulls last, c.id
  limit result_limit;
$$;
