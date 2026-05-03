import { describe, expect, it } from 'vitest';
import {
  resolveTipRoute,
  FBI_FALLBACK,
  type TipRouteAgency,
  type TipRouteCase,
} from '../tip-route.ts';

// The tip-handoff resolution chain is the user-visible payoff of routing:
// case-level override → agency default → state clearinghouse → FBI fallback.
// A bug here silently sends LA homicides to the FBI or rural unidentifieds
// to a wrong-state phone number. Pin the contract.

const baseCase = (over: Partial<TipRouteCase> = {}): TipRouteCase => ({
  tip_route_kind: null,
  tip_url: null,
  tip_phone: null,
  location_state: null,
  ...over,
});

const baseAgency = (over: Partial<TipRouteAgency> = {}): TipRouteAgency => ({
  id: 'agency-uuid',
  name: 'Test Sheriff',
  short_name: null,
  tip_route_kind: null,
  tip_url: null,
  phone_tip: null,
  ...over,
});

describe('resolveTipRoute — Tier 1 (case override)', () => {
  it('case tip_url wins over agency tip_url', () => {
    const r = resolveTipRoute(
      baseCase({
        tip_route_kind: 'crime_stoppers_p3',
        tip_url: 'https://lacrimestoppers.org/p3-form',
      }),
      baseAgency({ tip_route_kind: 'agency_form', tip_url: 'https://lasd.org/tips' }),
    );
    expect(r.route_kind).toBe('crime_stoppers_p3');
    expect(r.tip_url).toBe('https://lacrimestoppers.org/p3-form');
    expect(r.agency_id).toBe('agency-uuid');
    expect(r.agency_name).toBe('Test Sheriff');
  });

  it('case tip_phone (no url) still wins as Tier 1', () => {
    const r = resolveTipRoute(
      baseCase({ tip_route_kind: 'agency_phone', tip_phone: '+1-555-0100' }),
      null,
    );
    expect(r.route_kind).toBe('agency_phone');
    expect(r.tip_phone).toBe('+1-555-0100');
    expect(r.tip_url).toBeNull();
    expect(r.agency_name).toBe('the investigating agency');
  });

  it('case route_kind without url OR phone does NOT win Tier 1', () => {
    // A row with route_kind populated but no destination is incomplete —
    // must fall through to the next tier.
    const r = resolveTipRoute(
      baseCase({ tip_route_kind: 'crime_stoppers_p3', location_state: 'CA' }),
      baseAgency({ tip_route_kind: 'agency_form', tip_url: 'https://lasd.org/tips' }),
    );
    expect(r.route_kind).toBe('agency_form');
    expect(r.tip_url).toBe('https://lasd.org/tips');
  });
});

describe('resolveTipRoute — Tier 2 (agency default)', () => {
  it('agency tip_url + route_kind wins when case has no override', () => {
    const r = resolveTipRoute(
      baseCase({ location_state: 'CA' }),
      baseAgency({
        tip_route_kind: 'agency_form',
        tip_url: 'https://lasd.org/tips',
      }),
    );
    expect(r.route_kind).toBe('agency_form');
    expect(r.tip_url).toBe('https://lasd.org/tips');
    expect(r.agency_id).toBe('agency-uuid');
  });

  it('agency phone_tip alone is enough for Tier 2', () => {
    const r = resolveTipRoute(
      baseCase({ location_state: 'CA' }),
      baseAgency({ tip_route_kind: 'agency_phone', phone_tip: '+1-555-0200' }),
    );
    expect(r.route_kind).toBe('agency_phone');
    expect(r.tip_phone).toBe('+1-555-0200');
  });

  it('agency without route_kind falls through to state', () => {
    const r = resolveTipRoute(
      baseCase({ location_state: 'AL' }),
      baseAgency({ tip_url: 'https://stale.example.com/' }), // url but no kind
    );
    // AL has a clearinghouse — should land there.
    expect(r.agency_name).toContain('Alabama');
  });
});

describe('resolveTipRoute — Tier 2.5 (state clearinghouse)', () => {
  it('routes to AL clearinghouse when no case/agency override', () => {
    const r = resolveTipRoute(baseCase({ location_state: 'AL' }), null);
    expect(r.agency_name).toContain('Alabama');
    expect(r.tip_phone).toBe('1-800-228-7688');
    expect(r.agency_id).toBeNull();
  });

  it('handles lowercase state codes', () => {
    const r = resolveTipRoute(baseCase({ location_state: 'al' }), null);
    expect(r.agency_name).toContain('Alabama');
  });

  it('null state → FBI fallback', () => {
    const r = resolveTipRoute(baseCase(), null);
    expect(r).toEqual(FBI_FALLBACK);
  });

  it('unknown state code → FBI fallback', () => {
    const r = resolveTipRoute(baseCase({ location_state: 'ZZ' }), null);
    expect(r).toEqual(FBI_FALLBACK);
  });
});

describe('resolveTipRoute — FBI fallback', () => {
  it('no case override + no agency + no clearinghouse → FBI', () => {
    // AZ is explicitly null in state-routes.ts (deferred verification).
    const r = resolveTipRoute(baseCase({ location_state: 'AZ' }), null);
    expect(r).toEqual(FBI_FALLBACK);
  });

  it('case has location_state but agency.tip_url is missing kind → state still wins', () => {
    // Tier 2 fails (no route_kind), so we fall to Tier 2.5.
    const r = resolveTipRoute(
      baseCase({ location_state: 'AL' }),
      baseAgency({ tip_url: 'https://orphaned.example.com' }), // no route_kind
    );
    expect(r.agency_name).toContain('Alabama');
  });
});
