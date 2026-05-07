/**
 * Quality-aware date-range math for the case-detail "Same Period"
 * adjacency bucket. Pure helpers — no React, no I/O — so they can
 * live in a vitest-reachable file and the contract gets pinned by
 * tests at mobile/lib/__tests__/period-bucket.test.ts.
 *
 * Contract summary (full rationale in cases-near-case-section.tsx):
 *
 *   "Same Period" = a candidate's effective date range overlaps the
 *   subject's range expanded by ±SAME_PERIOD_MONTHS on each side.
 *   Boundary INCLUSIVE on both sides, calendar-month math via
 *   setUTCMonth so months keep their natural lengths and the bucket
 *   is timezone-invariant.
 *
 * Quality → range:
 *   exact        → point [date, date]
 *   year_only    → full year [Jan 1 YYYY, Dec 31 YYYY]
 *   approximate  → full year (parseDate sets day=01 either way; we
 *                   can't tell from the iso string alone whether the
 *                   month is real ("June 1985") or just an anchor
 *                   for an embedded year ("summer 1985"))
 *   suspect      → null  (source flagged unreliable)
 *   unknown      → null  (no temporal signal)
 *   null/undefined → falls back to exact-style point — this is the
 *                   pre-migration-36 / RPC-shape-tolerance branch.
 *                   Keeps the section rendering rather than throwing
 *                   when the column hasn't been backfilled yet.
 */

import type { DateQuality } from './types/database';

/**
 * A case's effective date range, expressed in millisecond timestamps.
 * Inclusive on both ends. Point-dates have startMs === endMs.
 */
export interface DateRange {
  startMs: number;
  endMs: number;
}

export const SAME_PERIOD_MONTHS = 6;

/**
 * Convert (incident_date, quality) into a DateRange that respects
 * the source's date precision. Returns null when the case can't make
 * a temporal claim — those rows fall through to "Other Nearby"
 * because we don't want to silently include them in "Same Period."
 */
export function effectiveRange(
  isoDate: string | null | undefined,
  quality: DateQuality | null | undefined,
): DateRange | null {
  if (!isoDate) return null;
  if (quality === 'suspect' || quality === 'unknown') return null;

  if (quality === 'year_only' || quality === 'approximate') {
    const year = parseInt(isoDate.slice(0, 4), 10);
    if (!Number.isFinite(year)) return null;
    return {
      startMs: Date.UTC(year, 0, 1, 0, 0, 0, 0),
      endMs: Date.UTC(year, 11, 31, 23, 59, 59, 999),
    };
  }

  // exact (or null/undefined fallback during the rollout window)
  const ms = Date.parse(isoDate);
  if (!Number.isFinite(ms)) return null;
  return { startMs: ms, endMs: ms };
}

/**
 * Expand a DateRange by `months` calendar months on each side.
 * Calendar-month math (rather than fixed-day approximation) so
 * months keep their natural lengths — Feb's 28/29 is honored,
 * June+6mo lands on December not "180 days later." Boundary is
 * INCLUSIVE on both sides via rangesOverlap.
 *
 * Uses an explicit day-of-month clamp because raw setUTCMonth
 * rolls over when the target month has fewer days than the
 * source date (e.g., Dec 31 + 6 months would otherwise become
 * July 1 because June has 30 days, not 31). Clamping pins to
 * end-of-target-month, which is the correct mental model for
 * "6 months after Dec 31" → "end of June."
 */
export function expandRange(range: DateRange, months: number): DateRange {
  return {
    startMs: shiftMonths(range.startMs, -months),
    endMs: shiftMonths(range.endMs, months),
  };
}

function shiftMonths(ms: number, delta: number): number {
  const d = new Date(ms);
  const targetYear = d.getUTCFullYear() + Math.floor((d.getUTCMonth() + delta) / 12);
  const targetMonthRaw = d.getUTCMonth() + delta;
  const targetMonth = ((targetMonthRaw % 12) + 12) % 12;
  const dayInTargetMonth = Math.min(d.getUTCDate(), daysInMonth(targetYear, targetMonth));
  return Date.UTC(
    targetYear,
    targetMonth,
    dayInTargetMonth,
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

function daysInMonth(year: number, month: number): number {
  // month is 0-indexed; "day 0 of next month" === last day of this month.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Inclusive-on-both-sides range overlap. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startMs <= b.endMs && a.endMs >= b.startMs;
}

/**
 * Row shape consumed by bucketByPeriod — only the temporal columns
 * are touched, so the function is generic over any row that carries
 * incident_date + incident_date_quality. Lets tests use plain
 * objects without standing up the full CaseRowMapBbox shape.
 */
export interface PeriodRow {
  incident_date: string | null;
  incident_date_quality?: DateQuality | null;
}

export interface PeriodBuckets<T extends PeriodRow> {
  samePeriod: T[];
  otherNearby: T[];
}

export function bucketByPeriod<T extends PeriodRow>(
  rows: T[],
  subjectRange: DateRange | null,
): PeriodBuckets<T> {
  // No subject date / unreliable subject quality → no temporal
  // grouping; everything lands in "Other Nearby."
  if (subjectRange == null) {
    return { samePeriod: [], otherNearby: rows };
  }
  const window = expandRange(subjectRange, SAME_PERIOD_MONTHS);
  const samePeriod: T[] = [];
  const otherNearby: T[] = [];
  for (const r of rows) {
    const rRange = effectiveRange(r.incident_date, r.incident_date_quality);
    if (rRange == null) {
      otherNearby.push(r);
      continue;
    }
    if (rangesOverlap(window, rRange)) {
      samePeriod.push(r);
    } else {
      otherNearby.push(r);
    }
  }
  return { samePeriod, otherNearby };
}
