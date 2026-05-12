-- Migration 47 — tip URL templates for agency-side prefill.
--
-- Phase 1 of P3 prefill. See docs/research/p3-prefill-probe.md for the probe
-- that established P3 affiliates universally honor `?case=...&url=...` query
-- params via the platform's "Additional Form Values" feature; this migration
-- adds the schema to drive that prefill without touching the existing
-- four-tier resolution chain.
--
-- Two additive columns:
--   - agencies.tip_url_template — opt-in template that supersedes tip_url
--     when both are set. Whitelisted placeholders only.
--   - cases.tip_external_ref    — the agency's own case reference string
--     (LASD homicide case number, FBI file number, etc.). Never our UUID.
--
-- Both nullable; no defaults; the constructor falls back to plain tip_url
-- when a template's placeholder lacks a value on the case. Phase 2 in
-- supabase/functions/_shared/tip-route.ts implements the construction
-- logic + tests.
--
-- Idempotent: safe to re-run.

alter table public.agencies
  add column if not exists tip_url_template text;

comment on column public.agencies.tip_url_template is
  'Optional URL template for tip handoffs. When set, supersedes tip_url at '
  'tip-route resolution time. Whitelisted placeholders (rendered into short '
  'query-param names per P3 conventions): '
  '{case_external_ref} -> &case=..., {case_detail_url} -> &url=.... '
  'Falls back to tip_url if the template references a placeholder the case '
  'lacks. See docs/research/p3-prefill-probe.md.';

alter table public.cases
  add column if not exists tip_external_ref text;

comment on column public.cases.tip_external_ref is
  'Agency-side case reference string used in tip-URL prefill (the agency''s '
  'own case number, e.g. LASD homicide case 2003-12345). Never the internal '
  'UUID — operator-side needs the agency''s reference to cross-correlate. '
  'NULL = no prefill available; constructor falls back to plain tip_url.';
