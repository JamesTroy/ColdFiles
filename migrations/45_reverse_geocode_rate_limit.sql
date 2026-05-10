-- Migration 45 — reverse_geocode_rate_limit table for per-IP throttle.
--
-- Audit finding M2: reverse-geocode caches lookups but had no per-IP rate
-- limit on cache misses. An anon-key holder could fan thousands of unique
-- coordinates through the function and exhaust our Nominatim budget
-- (Nominatim ToS = 1 req/s). This table backs the per-IP token-bucket the
-- function consults before each upstream call.
--
-- The audit row only lands on cache MISS — cache hits never write here, so
-- the table size stays small even under heavy legitimate use.

create table if not exists reverse_geocode_rate_limit (
  id          bigserial primary key,
  ip_hash     text   not null,
  created_at  timestamptz not null default now()
);

create index if not exists reverse_geocode_rate_limit_iphash_created_idx
  on reverse_geocode_rate_limit(ip_hash, created_at desc);

-- Retention: 24h is plenty since the longest enforcement window is 1h.
-- The function can opportunistically prune on insert (cheap), or a daily
-- cron can sweep. We rely on the function for now.

alter table reverse_geocode_rate_limit enable row level security;
-- Default deny — only service_role bypass needed.

comment on table reverse_geocode_rate_limit is
  'Per-IP rate-limit log for reverse-geocode cache-miss calls. Audit M2.';
