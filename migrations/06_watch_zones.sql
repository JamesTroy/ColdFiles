-- Migration 06 — watch_zone RPCs (create + list).
--
-- The user_watches table already exists (migration 01). Direct INSERT/DELETE
-- through the user_watches_owner RLS policy works, but two friction points
-- make a thin RPC layer worth the indirection:
--
--   (a) Inserting a geography(Polygon) from supabase-js is awkward. Either
--       the client builds WKT and we coerce, or we accept lat/lng arrays and
--       build the polygon in SQL. The SQL-side build keeps the client free
--       of PostGIS knowledge.
--   (b) Reading the polygon back as GeoJSON also wants a server-side
--       conversion (ST_AsGeoJSON). Doing that in an RPC keeps the SELECT
--       projection stable.
--
-- Both functions are SECURITY INVOKER so RLS stays the source of truth.
-- Idempotent: safe to re-run.


-- ─────────────────────────────────────────────────────────────────────────
-- create_watch_zone(label, vertices_lat, vertices_lng, notify_*)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.create_watch_zone(
  p_label text,
  p_vertices_lat double precision[],
  p_vertices_lng double precision[],
  p_notify_new boolean default true,
  p_notify_updates boolean default true,
  p_notify_resolved boolean default true
) returns uuid
language plpgsql
as $$
declare
  i int;
  pts text[] := array[]::text[];
  wkt text;
  inserted_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if array_length(p_vertices_lat, 1) is null
     or array_length(p_vertices_lat, 1) < 3
     or array_length(p_vertices_lat, 1) <> array_length(p_vertices_lng, 1) then
    raise exception 'invalid polygon: need >= 3 matched lat/lng pairs';
  end if;

  -- Build "lng lat" pairs in PostGIS order. Close the ring (first = last).
  for i in 1 .. array_length(p_vertices_lat, 1) loop
    pts := array_append(pts, format('%s %s', p_vertices_lng[i], p_vertices_lat[i]));
  end loop;
  pts := array_append(pts, pts[1]);
  wkt := format('SRID=4326;POLYGON((%s))', array_to_string(pts, ', '));

  insert into public.user_watches (
    user_id,
    watch_zone_geom,
    watch_zone_label,
    notify_new_cases,
    notify_updates,
    notify_arrests
  ) values (
    auth.uid(),
    wkt::geography,
    p_label,
    p_notify_new,
    p_notify_updates,
    p_notify_resolved
  )
  returning id into inserted_id;

  return inserted_id;
end $$;

revoke all on function public.create_watch_zone(text, double precision[], double precision[], boolean, boolean, boolean) from public, anon;
grant execute on function public.create_watch_zone(text, double precision[], double precision[], boolean, boolean, boolean) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- list_my_watch_zones() — returns each zone with its polygon as GeoJSON
-- and a count of cases currently inside.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.list_my_watch_zones()
returns table (
  id uuid,
  label text,
  geojson jsonb,
  notify_new_cases boolean,
  notify_updates boolean,
  notify_arrests boolean,
  cases_inside integer,
  created_at timestamptz
)
language sql
stable
as $$
  select
    w.id,
    w.watch_zone_label as label,
    ST_AsGeoJSON(w.watch_zone_geom)::jsonb as geojson,
    w.notify_new_cases,
    w.notify_updates,
    w.notify_arrests,
    coalesce((
      select count(*)::int from public.cases c
       where c.deleted_at is null
         and c.location_point is not null
         and ST_Intersects(c.location_point::geography, w.watch_zone_geom)
    ), 0) as cases_inside,
    w.created_at
  from public.user_watches w
  where w.user_id = auth.uid()
    and w.watch_zone_geom is not null
  order by w.created_at desc
$$;

revoke all on function public.list_my_watch_zones() from public, anon;
grant execute on function public.list_my_watch_zones() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- delete_watch_zone(id)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.delete_watch_zone(p_id uuid)
returns boolean
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  delete from public.user_watches
   where id = p_id
     and user_id = auth.uid();
  return found;
end $$;

revoke all on function public.delete_watch_zone(uuid) from public, anon;
grant execute on function public.delete_watch_zone(uuid) to authenticated;
