-- ============================================================================
-- Migration 02 — cases_in_bbox returns recency_alpha for the map's recency ring
-- ============================================================================
--
-- The map renders an amber ring around recently-updated pins with a stepwise
-- alpha decay (full days 0–3, half days 4–10, gone after 10) per
-- docs/04_DESIGN_SYSTEM.md "Recency decay". Computing this client-side would
-- re-walk every pin on every viewport pan; pushing it into the RPC means the
-- alpha lands as a numeric column on each row and the client just renders it.
--
-- Postgres won't change the return-type signature of an existing function in
-- place, so this migration drops and recreates cases_in_bbox. The list of
-- input args stays unchanged; only the OUT columns grow.
-- ============================================================================

drop function if exists cases_in_bbox(
  double precision, double precision, double precision, double precision,
  case_kind[], case_status[], integer
);

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
  /**
   * Stepwise alpha for the recently-updated ring.
   *   0–3 days since last_changed_at  → 1.0
   *   4–10 days                       → 0.5
   *   11+ days                        → 0   (client renders no ring)
   */
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
    and (filter_kinds is null or c.kind = any(filter_kinds))
    and (filter_status is null or c.status = any(filter_status))
    and c.location_point && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
  limit result_limit;
$$;

-- ============================================================================
-- cases_within_radius gets the same column for parity. The home-screen radius
-- query is what populates the user's nearby list; it should also know which
-- cases are "fresh" so the list rows can render the same amber recency dot
-- the map uses.
-- ============================================================================

drop function if exists cases_within_radius(
  double precision, double precision, double precision,
  case_kind[], case_status[], integer
);

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
  distance_miles numeric,
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
    ) as distance_miles,
    case
      when c.last_changed_at is null then 0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 3 then 1.0
      when extract(epoch from (now() - c.last_changed_at)) / 86400.0 <= 10 then 0.5
      else 0
    end::numeric as recency_alpha
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
