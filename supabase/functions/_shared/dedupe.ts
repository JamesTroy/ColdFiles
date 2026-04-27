// Dedupe key generation + match resolution.
// Pure TS — no I/O. The DB lookup is done by the runner.

import type { CaseRecord, DedupeKey } from './types.ts';
import { dedupeNorm } from './normalize.ts';

/**
 * Generate every plausible match key for a CaseRecord. Stronger keys come first.
 * The runner looks these up in `case_dedupe_keys`; the first hit wins.
 */
export function generateDedupeKeys(rec: CaseRecord): DedupeKey[] {
  const keys: DedupeKey[] = [];

  // Tier 1 — explicit cross-system IDs. If these match, it's the same case, full stop.
  if (rec.namus_number) {
    keys.push({ type: 'namus_number', value: dedupeNorm(rec.namus_number) });
  }
  if (rec.ncic_number) {
    keys.push({ type: 'ncic_number', value: dedupeNorm(rec.ncic_number) });
  }

  // Tier 2 — name + state + year. Strong; flag conflicts on sex/age before merging.
  if (
    rec.victim_first_name &&
    rec.victim_last_name &&
    rec.location_state &&
    rec.incident_date
  ) {
    keys.push({
      type: 'name_state_year',
      value: dedupeNorm(
        `${rec.victim_first_name}_${rec.victim_last_name}_${rec.location_state}_${rec.incident_date.slice(0, 4)}`,
      ),
    });
  }

  // Tier 3 — last name + age + sex. Candidate, run extra checks before merging.
  if (rec.victim_last_name && rec.victim_age && rec.victim_sex) {
    keys.push({
      type: 'lastname_age_sex',
      value: dedupeNorm(`${rec.victim_last_name}_${rec.victim_age}_${rec.victim_sex}`),
    });
  }

  // Tier 4 — agency case number scoped to a state. Useful when the same agency
  // appears in two of our sources (e.g. LASD blog + Solve the Case).
  if (rec.case_number_primary && rec.location_state) {
    keys.push({
      type: 'agency_case_number',
      value: dedupeNorm(`${rec.case_number_primary}_${rec.location_state}`),
    });
  }

  return keys;
}

/** Tier strength used by the resolver to decide automatic-merge vs. queue-for-review. */
export type KeyStrength = 'certain' | 'strong' | 'candidate' | 'weak';

export function keyStrength(type: DedupeKey['type']): KeyStrength {
  switch (type) {
    case 'namus_number':
    case 'ncic_number':
      return 'certain';
    case 'name_state_year':
    case 'agency_case_number':
      return 'strong';
    case 'lastname_age_sex':
      return 'candidate';
    default:
      return 'weak';
  }
}

/**
 * Compare two CaseRecords for hard conflicts that would prevent automatic merge
 * even when a key matches. Returns the conflict reasons (empty = safe to merge).
 */
export function detectConflicts(
  existing: Partial<CaseRecord>,
  incoming: CaseRecord,
): string[] {
  const conflicts: string[] = [];

  if (existing.victim_sex && incoming.victim_sex && existing.victim_sex !== incoming.victim_sex) {
    conflicts.push(`sex mismatch: ${existing.victim_sex} vs ${incoming.victim_sex}`);
  }
  if (existing.kind && incoming.kind && existing.kind !== incoming.kind) {
    // Some cross-kind moves are legit (missing → unidentified when remains found).
    // Don't conflict, just note. Resolver decides per-rule.
    if (
      !(existing.kind === 'missing' && incoming.kind === 'unidentified') &&
      !(existing.kind === 'unidentified' && incoming.kind === 'missing')
    ) {
      conflicts.push(`kind mismatch: ${existing.kind} vs ${incoming.kind}`);
    }
  }
  if (
    existing.incident_date &&
    incoming.incident_date &&
    existing.incident_date !== incoming.incident_date
  ) {
    const e = parseInt(existing.incident_date.slice(0, 4), 10);
    const i = parseInt(incoming.incident_date.slice(0, 4), 10);
    if (Math.abs(e - i) > 2) {
      conflicts.push(`incident_date year drift > 2y: ${existing.incident_date} vs ${incoming.incident_date}`);
    }
  }

  return conflicts;
}

/**
 * Trigram-style similarity between two strings, on a 0..1 scale.
 * Used for first-name fuzzy matching when only `lastname_age_sex` matched.
 * Implementation: Jaccard over character trigrams.
 */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let intersect = 0;
  for (const t of A) if (B.has(t)) intersect++;
  return intersect / (A.size + B.size - intersect);
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s.toLowerCase()}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    out.add(padded.slice(i, i + 3));
  }
  return out;
}
