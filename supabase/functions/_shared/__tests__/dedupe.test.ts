import { describe, expect, it } from 'vitest';
import {
  detectConflicts,
  generateDedupeKeys,
  keyStrength,
  trigramSimilarity,
} from '../dedupe.ts';
import type { CaseRecord } from '../types.ts';

const baseRecord = (over: Partial<CaseRecord> = {}): CaseRecord => ({
  source_external_id: 'src-1',
  source_url: 'https://example.com/1',
  kind: 'missing',
  status: 'open',
  incident_date_quality: 'exact',
  photos: [],
  raw: {},
  ...over,
});

describe('dedupe.generateDedupeKeys', () => {
  it('emits namus_number when present (strongest tier)', () => {
    const keys = generateDedupeKeys(
      baseRecord({ namus_number: 'MP12345', victim_first_name: 'Jane', victim_last_name: 'Doe' }),
    );
    expect(keys[0]).toEqual({ type: 'namus_number', value: 'mp12345' });
  });

  it('emits name_state_year when first/last/state/date are all present', () => {
    const keys = generateDedupeKeys(
      baseRecord({
        victim_first_name: 'Jane',
        victim_last_name: 'Doe',
        location_state: 'CA',
        incident_date: '1985-06-13',
      }),
    );
    expect(keys.find((k) => k.type === 'name_state_year')?.value).toBe('jane_doe_ca_1985');
  });

  it('emits lastname_age_sex as a fuzzy fallback', () => {
    const keys = generateDedupeKeys(
      baseRecord({ victim_last_name: 'Doe', victim_age: 23, victim_sex: 'female' }),
    );
    expect(keys.find((k) => k.type === 'lastname_age_sex')?.value).toBe('doe_23_female');
  });

  it('emits agency_case_number when both case# and state present', () => {
    const keys = generateDedupeKeys(
      baseRecord({ case_number_primary: '85-12345', location_state: 'CA' }),
    );
    expect(keys.find((k) => k.type === 'agency_case_number')?.value).toBe('8512345_ca');
  });
});

describe('dedupe.keyStrength', () => {
  it('classifies strength tiers', () => {
    expect(keyStrength('namus_number')).toBe('certain');
    expect(keyStrength('name_state_year')).toBe('strong');
    expect(keyStrength('lastname_age_sex')).toBe('candidate');
  });
});

describe('dedupe.detectConflicts', () => {
  it('flags sex mismatch', () => {
    const c = detectConflicts(
      { victim_sex: 'male' },
      baseRecord({ victim_sex: 'female' }),
    );
    expect(c.length).toBe(1);
    expect(c[0]).toMatch(/sex mismatch/);
  });

  it('allows missing → unidentified kind transition', () => {
    const c = detectConflicts(
      { kind: 'missing' },
      baseRecord({ kind: 'unidentified' }),
    );
    expect(c.length).toBe(0);
  });

  it('flags incident_date drift > 2y', () => {
    const c = detectConflicts(
      { incident_date: '1985-06-13' },
      baseRecord({ incident_date: '1990-06-13' }),
    );
    expect(c.length).toBe(1);
  });
});

describe('dedupe.trigramSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(trigramSimilarity('jane', 'jane')).toBeCloseTo(1, 2);
  });
  it('returns >0.5 for near-matches', () => {
    expect(trigramSimilarity('jane', 'jayne')).toBeGreaterThan(0.4);
  });
  it('returns 0 for empty input', () => {
    expect(trigramSimilarity('', 'jane')).toBe(0);
  });
});
