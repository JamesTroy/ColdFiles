-- Migration 46 — takedown_requests email-confirmation gate columns.
--
-- Audit finding H3 (BOLA / API1): the takedown-submit endpoint accepted any
-- email and immediately notified the operator. There was no proof the
-- submitter controlled the email — anyone could file unlimited takedowns
-- under any address, filling the operator's review queue with garbage.
--
-- Fix: insert the row with `confirmed_at = NULL` and email a confirmation
-- link to the claimed address. The operator review queue filters on
-- `confirmed_at IS NOT NULL`. Operator-driven `cases.takedown_requested_at`
-- (the case-hide gate) stays unchanged — the operator still decides what
-- gets honored. This migration only adds the gate on what enters the queue.
--
-- Idempotent: safe to re-run.

alter table public.takedown_requests
  add column if not exists confirmation_token_hash text,
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmation_expires_at timestamptz;

comment on column public.takedown_requests.confirmation_token_hash is
  'SHA-256 hex of the raw confirmation token. Raw token never persists; '
  'we store only the hash so a DB read does not yield clickable URLs.';
comment on column public.takedown_requests.confirmation_sent_at is
  'When the confirmation email was dispatched. NULL = never sent.';
comment on column public.takedown_requests.confirmed_at is
  'When the user clicked the confirmation link. NULL = pending. '
  'Operator review queue filters on this being non-NULL.';
comment on column public.takedown_requests.confirmation_expires_at is
  '7 days post-submit. Click after this returns 410 Gone.';

-- O(1) lookup on click — the confirm endpoint hashes the URL token and
-- looks up by this column.
create index if not exists takedown_requests_confirmation_token_hash_idx
  on public.takedown_requests (confirmation_token_hash)
  where confirmation_token_hash is not null;

-- Per-IP rate-limit table for the public takedown-confirm endpoint.
-- Mirrors reverse_geocode_rate_limit (migration 45). Token entropy is
-- 256 bits so brute-force is computationally infeasible — this table
-- is defense in depth against link-scanner storms and click noise.
create table if not exists takedown_confirm_rate_limit (
  id          bigserial primary key,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists takedown_confirm_rate_limit_iphash_created_idx
  on public.takedown_confirm_rate_limit (ip_hash, created_at desc);

alter table public.takedown_confirm_rate_limit enable row level security;
-- Default deny — only service_role bypass needed.

comment on table public.takedown_confirm_rate_limit is
  'Per-IP rate-limit log for takedown-confirm clicks. Audit H3.';
