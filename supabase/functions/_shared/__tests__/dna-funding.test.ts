import { describe, expect, it } from 'vitest';
import {
  resolveDnaFundingRoute,
  type DnaFundingCase,
} from '../dna-funding.ts';

// DNA funding routing is intentionally narrow: the URL is either present
// per-case (Othram crowdfunding page, Season of Justice case page) or the
// CTA is hidden. There is NO org-level donation fallback — that's a posture
// choice, not an oversight (see migration 48 comment + docs/13_DNA_FUNDING.md).

const baseCase = (over: Partial<DnaFundingCase> = {}): DnaFundingCase => ({
  dna_funding_url: null,
  dna_funding_kind: null,
  ...over,
});

describe('resolveDnaFundingRoute', () => {
  it('returns the URL + kind when both are set', () => {
    const r = resolveDnaFundingRoute(
      baseCase({
        dna_funding_url: 'https://dnasolves.com/cases/jane-doe-1982',
        dna_funding_kind: 'othram',
      }),
    );
    expect(r).not.toBeNull();
    expect(r?.funding_url).toBe('https://dnasolves.com/cases/jane-doe-1982');
    expect(r?.funding_kind).toBe('othram');
  });

  it('returns null when the URL is missing', () => {
    const r = resolveDnaFundingRoute(baseCase({ dna_funding_kind: 'othram' }));
    expect(r).toBeNull();
  });

  it('returns null when the kind is missing — refuses to guess for analytics', () => {
    const r = resolveDnaFundingRoute(
      baseCase({ dna_funding_url: 'https://example.org/case/123' }),
    );
    expect(r).toBeNull();
  });

  it('returns null when both are missing (the default case)', () => {
    const r = resolveDnaFundingRoute(baseCase());
    expect(r).toBeNull();
  });

  it('passes the season_of_justice kind through unchanged', () => {
    const r = resolveDnaFundingRoute(
      baseCase({
        dna_funding_url: 'https://seasonofjustice.org/cases/some-case',
        dna_funding_kind: 'season_of_justice',
      }),
    );
    expect(r?.funding_kind).toBe('season_of_justice');
  });
});
