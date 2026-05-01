-- 11_source_mix_counts_rpc.sql
--
-- Optional: server-side aggregate for the Me-tab "DATA · SOURCES" card.
--
-- The mobile client currently does this client-side (group case_sources by
-- sources.slug after a single SELECT). For v1.0.x case_sources volume that's
-- fine — the row count is bounded by source count × case-source-fanout, which
-- is small. If/when that grows past ~50k rows or roundtrip latency becomes
-- noticeable on cold loads, swap mobile/lib/hooks/use-source-mix.ts to call
-- this RPC instead.
--
-- NOT AUTO-APPLIED. The SQL editor doesn't track migration state — this file
-- exists so the change is reviewable + numbered when the time comes. The user
-- runs it manually after reviewing.

create or replace function public.source_mix_counts()
returns table (
  slug text,
  name text,
  count bigint
)
language sql
stable
security invoker
as $$
  select
    s.slug,
    s.name,
    count(cs.case_id)::bigint as count
  from case_sources cs
  join sources s on s.id = cs.source_id
  join cases c on c.id = cs.case_id and c.deleted_at is null
  group by s.slug, s.name
  order by count desc;
$$;

grant execute on function public.source_mix_counts() to anon, authenticated;

-- The total is already cheap via PostgREST's `count: 'exact', head: true` on
-- the `cases` table; no RPC needed for that.
