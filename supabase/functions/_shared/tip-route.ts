// Pure tip-route resolution. The supabase fetch is the responsibility of the
// caller (tip-route-submit Edge Function); this file holds only the decision
// logic so it can be unit-tested from Node/Vitest without bringing in
// `jsr:` imports or Deno runtime.
//
// Routing chain (per docs/04_DESIGN_SYSTEM.md "Routing logic"):
//   1. case.tip_*           — case-level override
//   2. agency.tip_*         — primary_agency default
//   2.5. state clearinghouse — when no agency FK is set
//   3. FBI fallback         — honest fall-through
//
// P3 prefill (Phase 2 of feat/p3-prefill) layers on top of Tier 2 only.
// When the resolved agency has a tip_url_template, the constructor renders
// the case's tip_external_ref + the caller-supplied case_detail_url into a
// URL that pre-populates P3's Additional Form Values panel. Falls back to
// plain tip_url silently when context is missing. See
// docs/research/p3-prefill-probe.md for the platform-side mechanics.

import {
  STATE_CLEARINGHOUSES,
  type RouteKind,
  type StateClearinghouse,
} from './state-routes.ts';

export interface TipRouteCase {
  tip_route_kind: RouteKind | null;
  tip_url: string | null;
  tip_phone: string | null;
  location_state: string | null;
  tip_external_ref: string | null;
}

export interface TipRouteAgency {
  id: string;
  name: string;
  short_name: string | null;
  tip_route_kind: RouteKind | null;
  tip_url: string | null;
  tip_url_template: string | null;
  phone_tip: string | null;
}

export interface ResolvedRoute {
  agency_id: string | null;
  agency_name: string;
  route_kind: RouteKind;
  tip_url: string | null;
  tip_phone: string | null;
}

export interface TipRouteContext {
  case_detail_url?: string | null;
}

export const FBI_FALLBACK: ResolvedRoute = {
  agency_id: null,
  agency_name: 'FBI Tip Line',
  route_kind: 'fbi_tip',
  tip_url: 'https://tips.fbi.gov',
  tip_phone: null,
};

// Whitelisted placeholders. The mapping returns the value to substitute, or
// null when the context lacks data for a placeholder the template references.
// A null return triggers fall-through to the plain tip_url.
const PLACEHOLDER_RESOLVERS: Record<
  string,
  (caseRow: TipRouteCase, ctx: TipRouteContext) => string | null
> = {
  case_external_ref: (caseRow) => caseRow.tip_external_ref,
  case_detail_url: (_caseRow, ctx) => ctx.case_detail_url ?? null,
};

const PLACEHOLDER_PATTERN = /\{([a-z_]+)\}/g;

/**
 * Render a tip-URL template by substituting whitelisted `{placeholder}`
 * tokens with values from the case / context.
 *
 * Returns null (caller falls back to plain tip_url) if:
 *   - The template references an unknown placeholder (whitelist violation)
 *   - A referenced placeholder lacks a value in the case or context
 *
 * Values are URL-encoded so special chars in agency case refs (slash,
 * hash, space) round-trip safely. P3's display layer sanitizes the preview
 * to alphanumerics but the hidden form input it submits preserves the
 * original — see docs/research/p3-prefill-probe.md for the verified
 * behavior.
 */
export function constructTipUrl(
  template: string,
  caseRow: TipRouteCase,
  context: TipRouteContext,
): string | null {
  const referenced = [...template.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[1]);
  const substitutions: Record<string, string> = {};

  for (const name of referenced) {
    const resolver = PLACEHOLDER_RESOLVERS[name];
    if (!resolver) return null; // unknown placeholder — whitelist violation
    const value = resolver(caseRow, context);
    if (value == null || value === '') return null; // missing required data
    substitutions[name] = encodeURIComponent(value);
  }

  return template.replaceAll(PLACEHOLDER_PATTERN, (_match, name: string) => {
    return substitutions[name] ?? '';
  });
}

/**
 * Decide which route to surface for a tip handoff.
 *
 * Each tier requires BOTH a route_kind AND at least one of (tip_url,
 * tip_phone). A row with route_kind set but neither url nor phone is
 * considered incomplete and falls through to the next tier — that's how a
 * partially-filled agency record can't override a fully-filled state
 * clearinghouse.
 *
 * `context` carries caller-side data (currently the case-detail URL) used
 * only by the agency-tier template constructor. Omitting it disables
 * template construction for that tier but doesn't change tier selection
 * or the URL returned via the plain tip_url path.
 */
export function resolveTipRoute(
  caseRow: TipRouteCase,
  agency: TipRouteAgency | null,
  context: TipRouteContext = {},
): ResolvedRoute {
  // Tier 1: case-level override.
  if (caseRow.tip_route_kind && (caseRow.tip_url || caseRow.tip_phone)) {
    return {
      agency_id: agency?.id ?? null,
      agency_name: agency?.name ?? 'the investigating agency',
      route_kind: caseRow.tip_route_kind,
      tip_url: caseRow.tip_url ?? null,
      tip_phone: caseRow.tip_phone ?? null,
    };
  }

  // Tier 2: agency default. Applies template construction when present.
  if (agency?.tip_route_kind && (agency.tip_url || agency.phone_tip)) {
    let tip_url = agency.tip_url;
    if (agency.tip_url_template) {
      const constructed = constructTipUrl(agency.tip_url_template, caseRow, context);
      if (constructed) tip_url = constructed;
    }
    return {
      agency_id: agency.id,
      agency_name: agency.name,
      route_kind: agency.tip_route_kind,
      tip_url,
      tip_phone: agency.phone_tip,
    };
  }

  // Tier 2.5: state clearinghouse.
  const ch: StateClearinghouse | null = caseRow.location_state
    ? STATE_CLEARINGHOUSES[caseRow.location_state.toUpperCase()] ?? null
    : null;
  if (ch && (ch.tip_url || ch.tip_phone)) {
    return {
      agency_id: null,
      agency_name: ch.name,
      route_kind: ch.route_kind,
      tip_url: ch.tip_url,
      tip_phone: ch.tip_phone,
    };
  }

  return FBI_FALLBACK;
}
