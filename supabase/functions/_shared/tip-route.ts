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
}

export interface TipRouteAgency {
  id: string;
  name: string;
  short_name: string | null;
  tip_route_kind: RouteKind | null;
  tip_url: string | null;
  phone_tip: string | null;
}

export interface ResolvedRoute {
  agency_id: string | null;
  agency_name: string;
  route_kind: RouteKind;
  tip_url: string | null;
  tip_phone: string | null;
}

export const FBI_FALLBACK: ResolvedRoute = {
  agency_id: null,
  agency_name: 'FBI Tip Line',
  route_kind: 'fbi_tip',
  tip_url: 'https://tips.fbi.gov',
  tip_phone: null,
};

/**
 * Decide which route to surface for a tip handoff.
 *
 * Each tier requires BOTH a route_kind AND at least one of (tip_url,
 * tip_phone). A row with route_kind set but neither url nor phone is
 * considered incomplete and falls through to the next tier — that's how a
 * partially-filled agency record can't override a fully-filled state
 * clearinghouse.
 */
export function resolveTipRoute(
  caseRow: TipRouteCase,
  agency: TipRouteAgency | null,
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

  // Tier 2: agency default.
  if (agency?.tip_route_kind && (agency.tip_url || agency.phone_tip)) {
    return {
      agency_id: agency.id,
      agency_name: agency.name,
      route_kind: agency.tip_route_kind,
      tip_url: agency.tip_url,
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
