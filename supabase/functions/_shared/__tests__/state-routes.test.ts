import { describe, expect, it } from 'vitest';
import { STATE_CLEARINGHOUSES, type StateClearinghouse } from '../state-routes.ts';

// Conformance test for the 50-state clearinghouse map. The risk this guards
// against: a pasted entry with route_kind set but no destination would
// silently fail Tier 2.5 in resolveTipRoute and route the case to FBI.
// Worse: a populated entry with garbage URL would surface a dead link in
// the user-facing tip handoff. Both modes are catch-able by shape rules.

const ALL_STATE_CODES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

const ROUTE_KINDS = new Set([
  'crime_stoppers_p3',
  'agency_form',
  'agency_phone',
  'fbi_tip',
  'namus_form',
  'email',
]);

describe('STATE_CLEARINGHOUSES — coverage', () => {
  it('contains every 2-letter state code as a key', () => {
    for (const code of ALL_STATE_CODES) {
      expect(STATE_CLEARINGHOUSES).toHaveProperty(code);
    }
  });

  it('every key is uppercase 2-letter', () => {
    for (const key of Object.keys(STATE_CLEARINGHOUSES)) {
      expect(key).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('STATE_CLEARINGHOUSES — entry shape', () => {
  for (const [code, entry] of Object.entries(STATE_CLEARINGHOUSES)) {
    if (entry === null) {
      it(`${code} is explicit null (will route to FBI)`, () => {
        expect(entry).toBeNull();
      });
      continue;
    }
    const e = entry as StateClearinghouse;

    it(`${code} has populated name`, () => {
      expect(typeof e.name).toBe('string');
      expect(e.name.length).toBeGreaterThan(0);
    });

    it(`${code} has a recognized route_kind`, () => {
      expect(ROUTE_KINDS.has(e.route_kind)).toBe(true);
    });

    it(`${code} has at least one of (tip_url, tip_phone) — otherwise resolveTipRoute drops to FBI`, () => {
      // The whole point of an entry being non-null is that it routes
      // somewhere. A populated entry with both null is worse than null —
      // it short-circuits resolveTipRoute via the route_kind check, then
      // resolveTipRoute falls through anyway, but the operator-facing
      // intent is muddled. Make it impossible.
      expect(e.tip_url !== null || e.tip_phone !== null).toBe(true);
    });

    if (e.tip_url) {
      it(`${code} tip_url parses as https://`, () => {
        // A few entries are agency_phone with a context URL — still must
        // be a valid https URL since the mobile app may render it as a
        // "where this came from" link.
        expect(() => new URL(e.tip_url!)).not.toThrow();
        expect(e.tip_url!.startsWith('https://')).toBe(true);
      });
    }
  }
});
