-- Migration 08 — expose case location_point as scalar lat/lng columns.
--
-- The case-detail screen (mobile/app/case/[slug].tsx) wants an inline map
-- preview centered on each case. Reading the geography(Point) column over
-- PostgREST is awkward (WKB hex by default; ::text gives WKT we'd have to
-- regex-parse on the client). Generated stored columns are the clean path:
-- one ALTER, computed once at insert/update, indexed if we ever need it,
-- and consumable via a vanilla SELECT.
--
-- Idempotent: safe to re-run.

alter table public.cases
  add column if not exists location_lat double precision
    generated always as (
      case when location_point is null then null
      else ST_Y(location_point::geometry)
      end
    ) stored,
  add column if not exists location_lng double precision
    generated always as (
      case when location_point is null then null
      else ST_X(location_point::geometry)
      end
    ) stored;
