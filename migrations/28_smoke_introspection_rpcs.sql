-- Migration 28 — smoke-test introspection RPCs.
--
-- Three SECURITY DEFINER functions used exclusively by
-- scripts/smoke-test-watch-zone-hit.sh to assert the watch_zone_hit
-- trigger chain end-to-end. Each is harmless to leave in place but only
-- granted to service_role — the smoke test runs with the service-role
-- key, no anon/authenticated exposure.
--
-- Why these RPCs exist instead of querying pg_net + PostGIS directly:
--   • The `net.*` schema isn't exposed via PostgREST.
--   • PostgREST can't run ad-hoc ST_Intersects calls without an RPC.
-- A handful of named functions is cleaner than one big "run-anything"
-- escape hatch, and the smoke script is the only caller.
--
-- Idempotent via CREATE OR REPLACE.

-- ─────────────────────────────────────────────────────────────────────
-- Gate 1: did the case actually land inside the watch zone?
-- Reads the case's location_point and the zone's polygon, returns the
-- ST_Intersects boolean. If false, the trigger had no reason to fire and
-- the rest of the chain is meaningless — fail fast.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.smoke_check_zone_intersect(
  p_case_id uuid,
  p_zone_id uuid
) returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select ST_Intersects(uw.watch_zone_geom, c.location_point)
      from public.cases c, public.user_watches uw
      where c.id = p_case_id
        and uw.id = p_zone_id
        and c.location_point is not null
        and uw.watch_zone_geom is not null
      limit 1
    ),
    false
  );
$$;

revoke all on function public.smoke_check_zone_intersect(uuid, uuid) from public, anon, authenticated;
grant execute on function public.smoke_check_zone_intersect(uuid, uuid) to service_role;


-- ─────────────────────────────────────────────────────────────────────
-- Gates 2 + 3: pg_net recent activity.
-- Returns rows from net._http_response created since the supplied
-- timestamp. The smoke script captures `now()` before triggering and
-- polls this RPC until at least one row appears — confirming the
-- trigger called pg_net (Gate 2). The status_code on that row confirms
-- notify-fanout responded (Gate 3).
--
-- Returns the response body too so the smoke can sanity-check that
-- notify-fanout reported back something sensible (e.g.
-- {"sent":0,"note":"no recipients"} when the test user has no tokens).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.smoke_pgnet_recent(p_since timestamptz)
returns table (
  id bigint,
  status_code integer,
  content text,
  created timestamptz,
  timed_out boolean,
  error_msg text
)
language sql
security definer
set search_path = public, net
as $$
  select
    r.id,
    r.status_code,
    r.content,
    r.created,
    r.timed_out,
    r.error_msg
  from net._http_response r
  where r.created >= p_since
  order by r.created desc;
$$;

revoke all on function public.smoke_pgnet_recent(timestamptz) from public, anon, authenticated;
grant execute on function public.smoke_pgnet_recent(timestamptz) to service_role;


-- ─────────────────────────────────────────────────────────────────────
-- Bulk artifact cleanup, by ID list.
-- The script captures every UUID it created into a manifest. On EXIT
-- (including SIGINT mid-run) it calls this RPC to delete those rows.
-- Defensive: only deletes by exact id match — never by pattern — so a
-- bug in the manifest can't cascade beyond what the script created.
--
-- order matters: cases first (FKs from case_sources, case_dedupe_keys),
-- then user_watches, then sources. Idempotent — DELETE on a non-existent
-- id is a no-op.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.smoke_cleanup(
  p_case_ids uuid[],
  p_zone_ids uuid[],
  p_source_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if array_length(p_case_ids, 1) is not null then
    delete from public.cases where id = any(p_case_ids);
  end if;
  if array_length(p_zone_ids, 1) is not null then
    delete from public.user_watches where id = any(p_zone_ids);
  end if;
  if array_length(p_source_ids, 1) is not null then
    delete from public.sources where id = any(p_source_ids);
  end if;
end $$;

revoke all on function public.smoke_cleanup(uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.smoke_cleanup(uuid[], uuid[], uuid[]) to service_role;
