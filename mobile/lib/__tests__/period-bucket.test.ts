import { describe, expect, it } from 'vitest';
import {
  bucketByPeriod,
  effectiveRange,
  expandRange,
  rangesOverlap,
  SAME_PERIOD_MONTHS,
  type PeriodRow,
} from '../period-bucket';

// These tests pin the contract a code reviewer asked us to be explicit
// about: inclusive boundaries, calendar-month math, year_only ranges
// rather than Jan 1 anchors, and graceful degradation when the RPC
// hasn't been migrated to return incident_date_quality yet.

describe('effectiveRange — quality-aware date ranges', () => {
  it('exact quality → point range (start === end)', () => {
    const r = effectiveRange('1985-06-15', 'exact');
    expect(r).not.toBeNull();
    expect(r!.startMs).toBe(r!.endMs);
    expect(r!.startMs).toBe(Date.parse('1985-06-15'));
  });

  it('year_only quality → full-year range [Jan 1, Dec 31]', () => {
    const r = effectiveRange('1985-01-01', 'year_only');
    expect(r).not.toBeNull();
    expect(r!.startMs).toBe(Date.UTC(1985, 0, 1));
    expect(r!.endMs).toBe(Date.UTC(1985, 11, 31, 23, 59, 59, 999));
  });

  it('approximate quality → full-year range (conservative; month-of-iso may be a Jan 1 anchor)', () => {
    // parseDate stores both "June 1985" and "summer 1985" as
    // 1985-06-01 / 1985-01-01 respectively, with quality='approximate'.
    // We can't tell from the iso alone, so the range trusts only the
    // year. Documented in period-bucket.ts.
    const r = effectiveRange('1985-06-01', 'approximate');
    expect(r).not.toBeNull();
    expect(r!.startMs).toBe(Date.UTC(1985, 0, 1));
    expect(r!.endMs).toBe(Date.UTC(1985, 11, 31, 23, 59, 59, 999));
  });

  it('suspect quality → null (no temporal claim)', () => {
    expect(effectiveRange('1985-06-15', 'suspect')).toBeNull();
  });

  it('unknown quality → null (no temporal claim)', () => {
    expect(effectiveRange('1985-06-15', 'unknown')).toBeNull();
  });

  it('null/undefined quality → falls back to exact (rollout-tolerant)', () => {
    // Pre-migration-36 RPC rows arrive without quality. We default to
    // exact so the section renders rather than dropping every row to
    // "Other Nearby." Once migration 36 is applied this branch is
    // exercised only by genuinely-bad data; both cases want the same
    // graceful behavior.
    const fromUndef = effectiveRange('1985-06-15', undefined);
    const fromNull = effectiveRange('1985-06-15', null);
    expect(fromUndef).not.toBeNull();
    expect(fromNull).not.toBeNull();
    expect(fromUndef!.startMs).toBe(fromUndef!.endMs);
    expect(fromUndef!.startMs).toBe(Date.parse('1985-06-15'));
  });

  it('missing isoDate → null regardless of quality', () => {
    expect(effectiveRange(null, 'exact')).toBeNull();
    expect(effectiveRange('', 'year_only')).toBeNull();
    expect(effectiveRange(undefined, 'approximate')).toBeNull();
  });

  it('unparseable isoDate → null', () => {
    expect(effectiveRange('not-a-date', 'exact')).toBeNull();
  });
});

describe('expandRange — calendar-month math', () => {
  it('±6 months from June 15 1985 lands on Dec 15 1985 / Dec 15 1984', () => {
    const point = effectiveRange('1985-06-15', 'exact')!;
    const window = expandRange(point, 6);
    // setUTCMonth handles the calendar month flip (Jun→Dec on +6,
    // Jun→Dec-prior-year on -6). Day stays at 15 because June and
    // December both have 15.
    expect(new Date(window.startMs).toISOString().slice(0, 10)).toBe('1984-12-15');
    expect(new Date(window.endMs).toISOString().slice(0, 10)).toBe('1985-12-15');
  });

  it('±6 months on a year_only range expands the WHOLE year by 6mo on each side', () => {
    const yearRange = effectiveRange('1985-01-01', 'year_only')!;
    const window = expandRange(yearRange, 6);
    // Year-start - 6mo = July 1 1984. Year-end + 6mo = June 30 1986.
    expect(new Date(window.startMs).toISOString().slice(0, 10)).toBe('1984-07-01');
    // The endMs ms-precision means the date is .999ms before midnight
    // on the boundary — we want it to be Jun 30 1986 (last instant).
    expect(new Date(window.endMs).toISOString().slice(0, 10)).toBe('1986-06-30');
  });
});

describe('rangesOverlap — inclusive boundary', () => {
  it('touching ranges count as overlap', () => {
    const a = { startMs: 0, endMs: 100 };
    const b = { startMs: 100, endMs: 200 };
    expect(rangesOverlap(a, b)).toBe(true);
  });

  it('disjoint ranges by even 1ms do NOT overlap', () => {
    const a = { startMs: 0, endMs: 100 };
    const b = { startMs: 101, endMs: 200 };
    expect(rangesOverlap(a, b)).toBe(false);
  });

  it('one fully contains the other → overlap', () => {
    const outer = { startMs: 0, endMs: 1000 };
    const inner = { startMs: 100, endMs: 200 };
    expect(rangesOverlap(outer, inner)).toBe(true);
    expect(rangesOverlap(inner, outer)).toBe(true);
  });
});

describe('bucketByPeriod — explicit boundary cases from the design review', () => {
  // Subject anchor used across multiple tests: exact 1985-06-15.
  // ±6mo window: [1984-12-15, 1985-12-15].
  function bucket(subjectIso: string, subjectQuality: any, candidates: PeriodRow[]) {
    const subjectRange = effectiveRange(subjectIso, subjectQuality);
    return bucketByPeriod(candidates, subjectRange);
  }

  it('candidate exactly 6 months FORWARD of an exact subject → IN (inclusive boundary)', () => {
    // Subject Jun 15 1985, candidate Dec 15 1985 → exactly 6 months
    // forward. Window's outer edge is Dec 15 1985 inclusive, so the
    // candidate point falls on the edge.
    const out = bucket('1985-06-15', 'exact', [
      { incident_date: '1985-12-15', incident_date_quality: 'exact' },
    ]);
    expect(out.samePeriod).toHaveLength(1);
    expect(out.otherNearby).toHaveLength(0);
  });

  it('candidate exactly 6 months BACKWARD of an exact subject → IN (inclusive boundary)', () => {
    const out = bucket('1985-06-15', 'exact', [
      { incident_date: '1984-12-15', incident_date_quality: 'exact' },
    ]);
    expect(out.samePeriod).toHaveLength(1);
    expect(out.otherNearby).toHaveLength(0);
  });

  it('candidate 1 day past the boundary → OUT', () => {
    // Dec 16 1985 is 1 day past the Dec 15 boundary.
    const out = bucket('1985-06-15', 'exact', [
      { incident_date: '1985-12-16', incident_date_quality: 'exact' },
    ]);
    expect(out.samePeriod).toHaveLength(0);
    expect(out.otherNearby).toHaveLength(1);
  });

  it('year_only 1984 vs year_only 1985 → IN (year ranges overlap window)', () => {
    // Subject = year_only 1984 → range [1984-01-01, 1984-12-31].
    // Window = ±6mo expansion → [1983-07-01, 1985-06-30].
    // Candidate = year_only 1985 → range [1985-01-01, 1985-12-31].
    // Overlap [1985-01-01, 1985-06-30] → IN.
    const out = bucket('1984-01-01', 'year_only', [
      { incident_date: '1985-01-01', incident_date_quality: 'year_only' },
    ]);
    expect(out.samePeriod).toHaveLength(1);
    expect(out.otherNearby).toHaveLength(0);
  });

  it('year_only 1984 vs year_only 1986 → OUT (no overlap with expanded window)', () => {
    // Window from year_only 1984 = [1983-07-01, 1985-06-30].
    // Candidate year_only 1986 = [1986-01-01, 1986-12-31].
    // No overlap.
    const out = bucket('1984-01-01', 'year_only', [
      { incident_date: '1986-01-01', incident_date_quality: 'year_only' },
    ]);
    expect(out.samePeriod).toHaveLength(0);
    expect(out.otherNearby).toHaveLength(1);
  });

  it('mixed precision crossing year boundary: year_only 1985 subject vs exact Jan 1 1986 → IN', () => {
    // Subject year_only 1985 → range [1985-01-01, 1985-12-31].
    // Window = [1984-07-01, 1986-06-30].
    // Candidate exact 1986-01-01 → point. Overlap. IN.
    const out = bucket('1985-01-01', 'year_only', [
      { incident_date: '1986-01-01', incident_date_quality: 'exact' },
    ]);
    expect(out.samePeriod).toHaveLength(1);
    expect(out.otherNearby).toHaveLength(0);
  });

  it('exact subject Oct 15 1985 vs year_only 1985 candidate → IN (was a regression in pre-quality math)', () => {
    // The Jan 1 anchoring problem the redesign fixes. Window from
    // Oct 15 1985 = [1985-04-15, 1986-04-15]. Candidate year_only
    // 1985 range covers all of 1985. Overlap. IN.
    const out = bucket('1985-10-15', 'exact', [
      { incident_date: '1985-01-01', incident_date_quality: 'year_only' },
    ]);
    expect(out.samePeriod).toHaveLength(1);
    expect(out.otherNearby).toHaveLength(0);
  });

  it('candidate with quality=suspect or unknown → ALWAYS otherNearby', () => {
    const out = bucket('1985-06-15', 'exact', [
      { incident_date: '1985-06-15', incident_date_quality: 'suspect' },
      { incident_date: '1985-06-15', incident_date_quality: 'unknown' },
    ]);
    expect(out.samePeriod).toHaveLength(0);
    expect(out.otherNearby).toHaveLength(2);
  });

  it('subject with quality=suspect/unknown → all candidates land in otherNearby', () => {
    const out = bucket('1985-06-15', 'unknown', [
      { incident_date: '1985-06-15', incident_date_quality: 'exact' },
      { incident_date: '1986-01-01', incident_date_quality: 'year_only' },
    ]);
    expect(out.samePeriod).toHaveLength(0);
    expect(out.otherNearby).toHaveLength(2);
  });

  it('rollout safety: pre-migration-36 candidates without quality → treated as exact, no throw', () => {
    // The graceful-degradation contract from the design review.
    // Old RPC shape returns rows with incident_date but no
    // incident_date_quality field. The bucket logic falls back to
    // exact-style point comparison so the section keeps rendering.
    const out = bucket('1985-06-15', 'exact', [
      { incident_date: '1985-08-15' }, // no quality field at all
      { incident_date: '1985-08-15', incident_date_quality: null },
    ]);
    expect(out.samePeriod).toHaveLength(2);
    expect(out.otherNearby).toHaveLength(0);
  });
});
