-- Migration 43 — cases.location_point_displayed (generated column)
--
-- Adds a STORED generated column that pre-computes the deterministic-
-- jitter "displayed" point for each case, mirroring the client-side
-- applyImpreciseSpread function in mobile/app/(tabs)/index.tsx:119-135
-- byte-for-byte. This is the data-layer prep for migration 44's
-- cases_grid_in_bbox tile-aggregation RPC, which snaps the displayed
-- point (not the raw point) to the grid so coarse-precision pile-ups
-- at city centroids don't reintroduce mig-39's overlapping-discs
-- failure mode at cell scale.
--
-- Why post-jitter aggregation matters (full discussion in
-- docs/research/b1-cases-grid-rpc-plan.md):
--   The renderer's applyImpreciseSpread distributes the ~5,661 city-
--   precision rows around their city centroids by ~2-5km via FNV-1a
--   on slug. Without the spread, snapping raw location_point to a
--   grid would collapse all of (e.g.) LA's ~94 city-precision cases
--   into one cell — same anti-pattern mig 39 reacted against, just
--   one zoom layer up. Snapping the post-jitter point distributes
--   them across ~2-3 adjacent cells, mirroring the visual spread
--   the user already sees at high zoom.
--
-- Why STORED, not VIRTUAL:
--   A GiST index on location_point_displayed is required for the
--   bbox predicate in cases_grid_in_bbox (mig 44). PostgreSQL only
--   allows indexes on STORED generated columns. VIRTUAL would force
--   the snap-to-grid expression to recompute the displayed point on
--   every read, defeating the DRY argument vs. inline-jitter-in-CTE.
--
-- Byte-identity is required:
--   The renderer-PR (separate beat after mig 44) eventually retires
--   client-side applyImpreciseSpread and treats location_point_
--   displayed as the source of truth at all zooms. If the polynomial
--   diverges, cases will appear to jump 1-3km when crossing the
--   zoom-8 grid/point threshold (server-jittered cell centers below 8,
--   client-jittered points above 8 — same case, different displayed
--   coord). Hard-to-attribute, trust-eroding bug. The parity script
--   at scripts/diagnose-jitter-parity.ts asserts byte-identity
--   post-apply; it MUST pass before mig 44 ships.
--
-- ASCII assumption:
--   applyImpreciseSpread iterates s.charCodeAt(i) — UTF-16 code
--   units. For ASCII strings (the entire current corpus per the
--   parity script's pre-mig audit, 0 non-ASCII slugs), UTF-16
--   code points equal UTF-8 byte values. This SQL implementation
--   reads UTF-8 bytes via convert_to(slug, 'UTF8'). If a non-ASCII
--   slug ever lands in cases.slug, the displayed point WILL diverge
--   from the client's. Two mitigations available:
--     1. Reject non-ASCII slugs at ingest (small persist.ts guard).
--     2. Switch this function to iterate UTF-16 code units (more
--        complex; not worth it pre-emptively).
--   Action item for the implementer of either mig 44 or persist.ts:
--   add a CHECK constraint on cases.slug requiring ASCII-only, or a
--   guard in persist.ts. Tracked in the plan doc.
--
-- Operational notes (for the user applying this):
--   - ALTER on a 7,892-row table with a STORED generated column
--     triggers a full table rewrite. Expected duration <1s on the
--     current corpus — but it IS a brief lock event.
--   - Pause active scrapers (scrape-cli) before applying. Resume
--     after the parity script passes.
--   - Backfill is automatic on ALTER. Post-apply verification:
--       npx tsx scripts/diagnose-jitter-parity.ts --mode=post
--   - If parity fails, revert (ALTER TABLE ... DROP COLUMN) cleanly,
--     fix the polynomial, re-apply.
--
-- Idempotent:
--   The ADD COLUMN uses IF NOT EXISTS. Helper functions use CREATE
--   OR REPLACE. Index uses CREATE INDEX IF NOT EXISTS. Safe to
--   re-run; no data loss path.

-- 1. FNV-1a 32-bit hash on text. Mirrors the JS implementation in
--    mobile/app/(tabs)/index.tsx:86-93. The shift-sum expansion
--    `(h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24) + h`
--    equals `h * 16777619` (the FNV-1a 32-bit prime, 0x01000193);
--    we use the multiplication form here for readability. Both
--    produce identical results modulo 2^32.
create or replace function fnv1a_32(s text)
returns bigint
language plpgsql
immutable
as $$
declare
  h bigint := x'811c9dc5'::bigint;  -- FNV-1a 32-bit offset basis = 2166136261
  bytes bytea;
  i int;
begin
  if s is null or length(s) = 0 then
    return h;
  end if;
  bytes := convert_to(s, 'UTF8');
  for i in 0 .. octet_length(bytes) - 1 loop
    h := (h # get_byte(bytes, i)::bigint) & x'ffffffff'::bigint;
    h := (h * 16777619) & x'ffffffff'::bigint;
  end loop;
  return h;
end;
$$;

comment on function fnv1a_32(text) is
  'FNV-1a 32-bit hash, byte-identical to mobile/app/(tabs)/index.tsx:86-93 fnv1a() for ASCII inputs. Used by cases_displayed_point to deterministically jitter coarse-precision case coordinates.';

-- 2. Displayed-point computation. Branches on precision:
--      address/street → input point unchanged (event-precise coords).
--      anything else  → polar offset of 2-5km around the input point,
--                       seeded by FNV-1a hash of the case's slug.
--    The slug is the per-case stable identifier the client uses
--    (matches applyImpreciseSpread's signature). Hashing the slug,
--    not the id, means the displayed coord is bound to the editorial
--    identity, not the database surrogate key.
create or replace function cases_displayed_point(
  pt            geography,
  loc_precision text,
  slug          text
)
returns geography
language plpgsql
immutable
as $$
declare
  h      bigint;
  angle  double precision;
  radius double precision;
  src    geometry;
begin
  -- Edge cases: no point at all, or precision-precise (no jitter).
  if pt is null then
    return null;
  end if;
  if loc_precision in ('address', 'street') then
    return pt;
  end if;
  -- Coarse precisions (city / county / state / unknown / null) get
  -- deterministic jitter via FNV-1a on slug. Defensive null-slug
  -- branch returns the raw point — should never happen on a real
  -- case row but avoids a function-level exception.
  if slug is null then
    return pt;
  end if;

  h := fnv1a_32(slug);
  -- Angle: low 16 bits / 0xffff * 2π. Range [0, 2π).
  angle  := ((h & 65535)::double precision / 65535.0) * 2.0 * pi();
  -- Radius: high 16 bits / 0xffff * 0.025, plus 0.02 floor.
  -- Range [0.02, 0.045] degrees ≈ 2.2-5.0 km at mid-latitudes.
  radius := 0.02 + ((h >> 16)::double precision / 65535.0) * 0.025;
  src := pt::geometry;

  -- Match applyImpreciseSpread's cos/sin convention exactly:
  --   lat += cos(angle) * radius
  --   lng += sin(angle) * radius
  -- Easy to swap by accident — the parity script catches it.
  return ST_SetSRID(
    ST_MakePoint(
      ST_X(src) + sin(angle) * radius,
      ST_Y(src) + cos(angle) * radius
    ),
    4326
  )::geography;
end;
$$;

comment on function cases_displayed_point(geography, text, text) is
  'Deterministic jitter for coarse-precision cases, mirroring mobile applyImpreciseSpread byte-for-byte. Used by the cases.location_point_displayed generated column.';

-- 3. The generated column. STORED (required for the GiST index in
--    step 4). Auto-populates on ALTER (full table rewrite, expected
--    <1s on the current ~8k-row corpus).
alter table public.cases
  add column if not exists location_point_displayed geography(Point, 4326)
  generated always as (
    cases_displayed_point(location_point, location_precision, slug)
  ) stored;

comment on column public.cases.location_point_displayed is
  'Generated column: post-jitter displayed coordinate. Equals location_point for address/street precision; otherwise deterministically offset 2-5km via FNV-1a on slug. Renderer-PR will eventually retire client-side applyImpreciseSpread and read this directly. Consumed by cases_grid_in_bbox (mig 44).';

-- 4. GiST index on the new column. Mirrors cases_location_point_idx
--    (mig 01:223) for the same access pattern: bbox-restricted reads
--    via ST_Intersects. Required for mig 44's tile-grid RPC to be
--    fast.
create index if not exists cases_location_point_displayed_idx
  on public.cases using gist(location_point_displayed);

-- 5. Parity-test diagnostic RPC. Used by
--    scripts/diagnose-jitter-parity.ts --mode=post to assert byte-
--    identity between server-side cases_displayed_point and client-
--    side applyImpreciseSpread. The leading underscore marks this as
--    diagnostic-only — not part of the public RPC surface; do NOT
--    call from app code. Drop in mig 45 cleanup once the renderer-PR
--    is live and parity has been re-validated.
create or replace function _diag_displayed_point_sample(
  sample_size integer default 200
)
returns table (
  slug                text,
  raw_lat             double precision,
  raw_lng             double precision,
  displayed_lat       double precision,
  displayed_lng       double precision,
  location_precision  text
)
language sql
stable
as $$
  select
    c.slug,
    ST_Y(c.location_point::geometry)           as raw_lat,
    ST_X(c.location_point::geometry)           as raw_lng,
    ST_Y(c.location_point_displayed::geometry) as displayed_lat,
    ST_X(c.location_point_displayed::geometry) as displayed_lng,
    c.location_precision
  from public.cases c
  where c.deleted_at is null
    and c.location_point is not null
    and (c.location_precision is null
         or c.location_precision not in ('address', 'street'))
  order by c.id
  limit sample_size;
$$;

comment on function _diag_displayed_point_sample(integer) is
  'Diagnostic-only RPC. Returns a sample of imprecise cases with raw + displayed coords for parity testing against client-side applyImpreciseSpread. Drop in mig 45 cleanup.';
