-- Migration 48 — per-case DNA funding routing.
--
-- Externalize forensic-genetic-genealogy donations to Othram DNA Solves /
-- Season of Justice the same way tip routing externalizes to P3 (mig 47).
-- See docs/13_DNA_FUNDING.md for the policy doc and feedback_dna_funding_externalize
-- in the auto-memory for the posture: no in-app payments, no held funds,
-- audit-only telemetry.
--
-- Schema:
--   - cases.dna_funding_url   — the destination URL for funding work on this
--                                specific case (Othram crowdfunding page, or a
--                                Season-of-Justice case page). Per-case only;
--                                no org-level "donate to cold cases" fallback,
--                                because the moment of intent is the case
--                                detail screen — losing it to a generic
--                                landing page wastes the donation hook.
--   - cases.dna_funding_kind  — analytics dimension. 'othram', 'season_of_justice',
--                                'other'. CHECK constraint pins the vocabulary.
--   - dna_funding_handoffs    — audit table mirroring tip_routings. Logs which
--                                case was tapped, when, ip_hash, no donor data.
--
-- Idempotent: safe to re-run.

alter table public.cases
  add column if not exists dna_funding_url text;

comment on column public.cases.dna_funding_url is
  'External URL for funding DNA/forensic-genetic-genealogy work on this case '
  '(Othram DNA Solves crowdfunding page, Season of Justice case page, etc.). '
  'When NULL the case-detail screen hides the funding CTA — we never fall '
  'back to a generic org-level donation page because the moment of intent '
  'is the case the user is reading, not a category landing. Population is a '
  'manual operator task: probe Othram + SoJ for the case slug, paste the URL.';

alter table public.cases
  add column if not exists dna_funding_kind text;

alter table public.cases
  drop constraint if exists cases_dna_funding_kind_check;

alter table public.cases
  add constraint cases_dna_funding_kind_check
  check (
    dna_funding_kind is null
    or dna_funding_kind in ('othram', 'season_of_justice', 'other')
  );

comment on column public.cases.dna_funding_kind is
  'Funding-platform dimension for analytics. CHECK-constrained vocabulary; '
  'add new values via a future migration before populating them. NULL when '
  'dna_funding_url is NULL.';

-- Audit table — mirrors tip_routings shape, narrower columns.
create table if not exists public.dna_funding_handoffs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  routed_to_url text not null,
  routed_to_kind text not null,
  ip_hash text not null,
  user_agent_summary text
);

comment on table public.dna_funding_handoffs is
  'Audit log for DNA-funding CTA handoffs. Mirrors tip_routings posture: we '
  'log the click + destination + ip_hash for rate-limiting and aggregate '
  'analytics, but never the donor identity, donation amount, payment '
  'method, or any data the external platform collects after the handoff. '
  'Cold File does not process payments or hold case-tied funds.';

create index if not exists dna_funding_handoffs_case_idx
  on public.dna_funding_handoffs (case_id, created_at desc);

create index if not exists dna_funding_handoffs_iphash_created_idx
  on public.dna_funding_handoffs (ip_hash, created_at desc);

-- RLS: anon cannot select or write directly. The Edge Function uses
-- service-role to insert; aggregate queries run via security-definer RPC or
-- operator-side service-role only.
alter table public.dna_funding_handoffs enable row level security;

drop policy if exists dna_funding_handoffs_no_anon_select on public.dna_funding_handoffs;
drop policy if exists dna_funding_handoffs_no_anon_insert on public.dna_funding_handoffs;
-- Intentionally no permissive policies — only service-role bypasses RLS.
