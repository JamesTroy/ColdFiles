// Pure DNA-funding route resolution. Mirrors the tip-route.ts shape so callers
// pattern-match cleanly; the resolution chain is shallower because DNA funding
// has no Tier 2/2.5/3 fallbacks — the per-case URL either exists or the CTA
// is hidden. Org-level donation pages (e.g. seasonofjustice.org/donate) are
// deliberately NOT used as a fallback because they lose the moment of intent
// the case-detail screen creates.
//
// See migrations/48_dna_funding_route.sql for the schema and
// docs/13_DNA_FUNDING.md for the policy doc.

export type DnaFundingKind = 'othram' | 'season_of_justice' | 'other';

export interface DnaFundingCase {
  dna_funding_url: string | null;
  dna_funding_kind: DnaFundingKind | null;
}

export interface ResolvedDnaFundingRoute {
  funding_url: string;
  funding_kind: DnaFundingKind;
}

/**
 * Decide whether this case has a DNA-funding handoff available.
 *
 * Returns null when:
 *   - The case has no dna_funding_url set, OR
 *   - The case has a url but no kind (incomplete data — refuse silently
 *     rather than guess at the kind for analytics).
 *
 * Callers that get null MUST hide the CTA. There is no fallback.
 */
export function resolveDnaFundingRoute(
  caseRow: DnaFundingCase,
): ResolvedDnaFundingRoute | null {
  if (!caseRow.dna_funding_url) return null;
  if (!caseRow.dna_funding_kind) return null;
  return {
    funding_url: caseRow.dna_funding_url,
    funding_kind: caseRow.dna_funding_kind,
  };
}
