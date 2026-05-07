import { describe, expect, it } from 'vitest';
import { kindLine } from '../format';

// kindLine builds the mono-caps subtitle that runs above the victim
// name on case-row + map peek-sheet surfaces.
//
// PR #34 added a leading "~" prefix on the year for non-exact
// precision (year_only / approximate). PR #35 extends that to also
// surface "DATE UNKNOWN" inline when the source flagged the date
// unreliable (suspect / unknown) or when the row carries no
// incident_date at all. The paired user-facing signal for the
// Same-Period bucket routing decision in lib/period-bucket.ts —
// rows that fall to "Other Nearby" because they have no temporal
// claim now visibly say why.

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

  it('suspect quality → "DATE UNKNOWN" (source flagged unreliable)', () => {
    // Even though the row has 1985 stored, suspect quality means the
    // source itself flagged the date as unreliable. Don't show the
    // year as if it were a real signal.
    expect(
      kindLine({ ...baseRow, incident_date_quality: 'suspect' }),
    ).toBe('HOMICIDE · DATE UNKNOWN · CLAREMONT, CA');
  });

  it('unknown quality → "DATE UNKNOWN"', () => {
    expect(
      kindLine({ ...baseRow, incident_date_quality: 'unknown' }),
    ).toBe('HOMICIDE · DATE UNKNOWN · CLAREMONT, CA');
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

  it('no incident_date → "DATE UNKNOWN" segment surfaces the absence', () => {
    // Previously the row silently dropped the year segment when
    // incident_date was null. PR #35 makes the absence explicit
    // because silent dropout could mislead a tipster into reading
    // the row as a recent / well-documented case.
    expect(
      kindLine({
        ...baseRow,
        incident_date: null,
        incident_date_quality: null,
      }),
    ).toBe('HOMICIDE · DATE UNKNOWN · CLAREMONT, CA');
  });

  it('no incident_date AND quality=year_only → "DATE UNKNOWN" wins (no date to format)', () => {
    expect(
      kindLine({
        ...baseRow,
        incident_date: null,
        incident_date_quality: 'year_only',
      }),
    ).toBe('HOMICIDE · DATE UNKNOWN · CLAREMONT, CA');
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
