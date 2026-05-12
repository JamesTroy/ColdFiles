import { describe, expect, it } from 'vitest';
import {
  constructTipUrl,
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
  tip_external_ref: null,
  ...over,
});

const baseAgency = (over: Partial<TipRouteAgency> = {}): TipRouteAgency => ({
  id: 'agency-uuid',
  name: 'Test Sheriff',
  short_name: null,
  tip_route_kind: null,
  tip_url: null,
  tip_url_template: null,
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

describe('constructTipUrl — P3 prefill template rendering', () => {
  // The constructor's contract: replace whitelisted {placeholder} tokens,
  // URL-encode each value, return null when the template is invalid or
  // the context lacks required data. A null return signals the caller to
  // fall back to plain tip_url — there is no "partial render" mode.

  it('substitutes case_external_ref and URL-encodes the value', () => {
    const url = constructTipUrl(
      'https://www.p3tips.com/tipform.aspx?ID=107&case={case_external_ref}',
      baseCase({ tip_external_ref: '2003/12345' }),
      {},
    );
    // %2F = URL-encoded slash; verifies special chars survive the constructor
    // so P3's hidden form input receives the operator-clean value.
    expect(url).toBe('https://www.p3tips.com/tipform.aspx?ID=107&case=2003%2F12345');
  });

  it('substitutes case_detail_url from context', () => {
    const url = constructTipUrl(
      'https://www.p3tips.com/tipform.aspx?ID=107&case={case_external_ref}&url={case_detail_url}',
      baseCase({ tip_external_ref: 'ABC-1' }),
      { case_detail_url: 'https://thecoldfile.app/c/jane-doe-2003' },
    );
    expect(url).toBe(
      'https://www.p3tips.com/tipform.aspx?ID=107&case=ABC-1&url=https%3A%2F%2Fthecoldfile.app%2Fc%2Fjane-doe-2003',
    );
  });

  it('returns null when a referenced placeholder lacks data (case_external_ref absent)', () => {
    const url = constructTipUrl(
      'https://www.p3tips.com/tipform.aspx?ID=107&case={case_external_ref}',
      baseCase({ tip_external_ref: null }),
      {},
    );
    expect(url).toBeNull();
  });

  it('returns null when case_detail_url placeholder is referenced but context omits it', () => {
    const url = constructTipUrl(
      'https://www.p3tips.com/tipform.aspx?ID=107&case={case_external_ref}&url={case_detail_url}',
      baseCase({ tip_external_ref: 'ABC-1' }),
      {}, // no case_detail_url
    );
    expect(url).toBeNull();
  });

  it('returns null when the template references an unknown placeholder', () => {
    // Whitelist guards against operator-side surprise: a typo or rogue
    // template can't smuggle case fields into the URL.
    const url = constructTipUrl(
      'https://www.p3tips.com/tipform.aspx?ID=107&v={victim_name}',
      baseCase({ tip_external_ref: 'ABC-1' }),
      {},
    );
    expect(url).toBeNull();
  });

  it('returns null when case_external_ref is the empty string', () => {
    // Empty string is operationally a missing value — empty case= sends a
    // blank to the operator, which is worse than no prefill at all.
    const url = constructTipUrl(
      'https://www.p3tips.com/tipform.aspx?ID=107&case={case_external_ref}',
      baseCase({ tip_external_ref: '' }),
      {},
    );
    expect(url).toBeNull();
  });

  it('templates with no placeholders render verbatim', () => {
    // A legitimate use case: the agency has a template that doesn't need
    // case-specific substitution (rare but valid). Should round-trip.
    const url = constructTipUrl(
      'https://www.p3tips.com/tipform.aspx?ID=107',
      baseCase(),
      {},
    );
    expect(url).toBe('https://www.p3tips.com/tipform.aspx?ID=107');
  });
});

describe('resolveTipRoute — Tier 2 with P3 prefill (template wired in)', () => {
  it('agency template renders when case has tip_external_ref', () => {
    const r = resolveTipRoute(
      baseCase({ tip_external_ref: 'LASD-2003-12345' }),
      baseAgency({
        tip_route_kind: 'crime_stoppers_p3',
        tip_url: 'https://www.p3tips.com/tipform.aspx?ID=107',
        tip_url_template: 'https://www.p3tips.com/tipform.aspx?ID=107&case={case_external_ref}',
      }),
    );
    expect(r.route_kind).toBe('crime_stoppers_p3');
    expect(r.tip_url).toBe(
      'https://www.p3tips.com/tipform.aspx?ID=107&case=LASD-2003-12345',
    );
  });

  it('agency template falls back to plain tip_url when case has no external_ref', () => {
    // The audit fence: missing data on the case is silent, never an error.
    // Operators get the plain URL and the user composes their tip normally.
    const r = resolveTipRoute(
      baseCase({ tip_external_ref: null }),
      baseAgency({
        tip_route_kind: 'crime_stoppers_p3',
        tip_url: 'https://www.p3tips.com/tipform.aspx?ID=107',
        tip_url_template: 'https://www.p3tips.com/tipform.aspx?ID=107&case={case_external_ref}',
      }),
    );
    expect(r.tip_url).toBe('https://www.p3tips.com/tipform.aspx?ID=107');
  });

  it('agency without template uses plain tip_url (no behavior change for non-templated agencies)', () => {
    const r = resolveTipRoute(
      baseCase({ tip_external_ref: 'IGNORED-1' }),
      baseAgency({
        tip_route_kind: 'agency_form',
        tip_url: 'https://lasd.org/tips',
        tip_url_template: null,
      }),
    );
    expect(r.tip_url).toBe('https://lasd.org/tips');
  });

  it('case_detail_url from context flows into the template', () => {
    const r = resolveTipRoute(
      baseCase({ tip_external_ref: 'ABC-1' }),
      baseAgency({
        tip_route_kind: 'crime_stoppers_p3',
        tip_url: 'https://www.p3tips.com/tipform.aspx?ID=107',
        tip_url_template: 'https://www.p3tips.com/tipform.aspx?ID=107&case={case_external_ref}&url={case_detail_url}',
      }),
      { case_detail_url: 'https://thecoldfile.app/c/jane-doe-2003' },
    );
    expect(r.tip_url).toContain('case=ABC-1');
    expect(r.tip_url).toContain('url=https%3A%2F%2Fthecoldfile.app%2Fc%2Fjane-doe-2003');
  });

  it('Tier 1 (case override) bypasses template construction entirely', () => {
    // Case-level overrides are reserved for "FBI field office took over"
    // scenarios — the case row carries the specific URL and that wins
    // before the agency tier even runs. Template stays unused.
    const r = resolveTipRoute(
      baseCase({
        tip_route_kind: 'fbi_tip',
        tip_url: 'https://tips.fbi.gov',
        tip_external_ref: 'AGENCY-REF-IGNORED',
      }),
      baseAgency({
        tip_route_kind: 'crime_stoppers_p3',
        tip_url: 'https://www.p3tips.com/tipform.aspx?ID=107',
        tip_url_template: 'https://www.p3tips.com/tipform.aspx?ID=107&case={case_external_ref}',
      }),
    );
    expect(r.tip_url).toBe('https://tips.fbi.gov');
  });
});
