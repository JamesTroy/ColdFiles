import { describe, expect, it } from 'vitest';
import { kindLine } from '../format';

// kindLine builds the mono-caps subtitle that runs above the victim
// name on case-row + map peek-sheet surfaces. PR #34 added a leading
// "~" prefix on the year when the source's incident-date precision
// is non-exact, so a year_only "1985" reads as "~1985" while an
// exact-precision 1985-06-13 reads as "1985." This file pins that
// rendering contract.

describe('kindLine — precision marker', () => {
  const baseRow = {
    kind: 'homicide' as const,
    incident_date: '1985-06-15',
    location_city: 'Claremont',
    location_state: 'CA',
  };

  it('exact quality → year shown without marker', () => {
    expect(
      kindLine({ ...baseRow, incident_date_quality: 'exact' }),
    ).toBe('HOMICIDE · 1985 · CLAREMONT, CA');
  });

  it('year_only quality → year shown with ~ marker', () => {
    expect(
      kindLine({ ...baseRow, incident_date_quality: 'year_only' }),
    ).toBe('HOMICIDE · ~1985 · CLAREMONT, CA');
  });

  it('approximate quality → year shown with ~ marker', () => {
    expect(
      kindLine({ ...baseRow, incident_date_quality: 'approximate' }),
    ).toBe('HOMICIDE · ~1985 · CLAREMONT, CA');
  });

  it('suspect quality → year shown with ~ marker', () => {
    expect(
      kindLine({ ...baseRow, incident_date_quality: 'suspect' }),
    ).toBe('HOMICIDE · ~1985 · CLAREMONT, CA');
  });

  it('unknown quality → year shown with ~ marker (defensive)', () => {
    // Defensive case: parseDate normally returns no incident_date when
    // quality is 'unknown', so this branch rarely fires in practice.
    // When it does, ~ is the right signal.
    expect(
      kindLine({ ...baseRow, incident_date_quality: 'unknown' }),
    ).toBe('HOMICIDE · ~1985 · CLAREMONT, CA');
  });

  it('quality=undefined (pre-migration-36 row) → no marker, legacy shape preserved', () => {
    // Rollout safety: rows from cases_in_bbox before migration 36 has
    // applied won't carry quality. They render the same way they did
    // before this feature shipped — no surprise visual change.
    expect(kindLine(baseRow)).toBe('HOMICIDE · 1985 · CLAREMONT, CA');
  });

  it('quality=null → no marker (same posture as undefined)', () => {
    expect(
      kindLine({ ...baseRow, incident_date_quality: null }),
    ).toBe('HOMICIDE · 1985 · CLAREMONT, CA');
  });

  it('no incident_date → no year segment regardless of quality', () => {
    expect(
      kindLine({
        ...baseRow,
        incident_date: null,
        incident_date_quality: 'year_only',
      }),
    ).toBe('HOMICIDE · CLAREMONT, CA');
  });

  it('missing location → year still rendered with marker', () => {
    expect(
      kindLine({
        kind: 'unidentified',
        incident_date: '1985-06-15',
        incident_date_quality: 'year_only',
        location_city: null,
        location_state: null,
      }),
    ).toBe('UNIDENTIFIED · ~1985');
  });
});
