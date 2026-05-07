/**
 * CasesNearCaseSection — case-detail geographic-adjacency surface.
 *
 * Editorial framing (per CLAUDE.md amber-palette + design memos):
 * adjacency is supporting context for evaluating the subject case, not
 * an exit point to the next one. NOT "true-crime browsing" — the
 * heading reads "WITHIN N MILES" (neutral, geographic), the bucket
 * labels surface temporal coincidence as a distinct group rather than
 * burying it under distance ranking, and the empty state stays empty
 * (no auto-bump to a wider radius).
 *
 * Layout:
 *   1. Section heading row     — "WITHIN N MILES" + radius chips (10/25/50/100).
 *   2. Stats subhead           — "12 cases · 1972–2024 · 8 unsolved homicide / 4 missing".
 *                                 Below 30 rows: full kind breakdown.
 *                                 30+:           top 2 + "+N more".
 *                                 At 200 cap:    "· capped at 200" appended.
 *                                 Suppressed when rows.length === 0.
 *   3. Two-bucket render:
 *      a. SAME PERIOD: rows whose incident_date is within ±6 months of
 *         the subject case's incident_date. Sorted by distance asc.
 *         If subject has no incident_date OR no rows match the window,
 *         the bucket is suppressed entirely (don't render an empty
 *         "Same period:" header — that would re-narrate absence).
 *      b. OTHER NEARBY: everything else (rows outside the window OR
 *         all rows when subject has no incident_date). Sorted by
 *         distance asc.
 *   4. Empty state             — "NO CASES WITHIN N MILES / Try 50 or 100 miles"
 *                                 — no auto-bump; the chips ARE the affordance.
 *
 * Render gate: if the subject case has no location_point (CaseLocation
 * Preview already handles this), the entire section is suppressed —
 * `cases_near_case` would return zero rows and the empty state would
 * be misleading ("no cases within N miles" when truth is "no origin
 * to measure from").
 */

import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { tokens } from '@/constants/theme';
import { useCasesNearCase } from '@/lib/hooks/use-cases-near-case';
import type { CaseKind, CaseRowMapBbox, DateQuality } from '@/lib/types/database';

import { CaseRow } from './case-row';
import { Mono, MonoLabel } from './text';

interface Props {
  caseId: string;
  /** ISO date (yyyy-mm-dd). Drives the "Same period" bucket. */
  caseIncidentDate: string | null;
  /**
   * Quality of caseIncidentDate. Drives whether the subject is
   * compared as a point-date (exact) or a range (year_only,
   * approximate, suspect, unknown). See bucketByPeriod for the
   * range-overlap math.
   */
  caseIncidentDateQuality?: DateQuality | null;
  /** False when the subject has no location_point — section is suppressed. */
  hasLocation: boolean;
}

const RADIUS_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_RADIUS: (typeof RADIUS_OPTIONS)[number] = 25;
const HIGH_COUNT_THRESHOLD = 30;
const RESULT_CAP = 200;
// "Same period" = a case's effective date range overlaps the subject's
// effective date range expanded by ±6 months on each side. Boundary
// is INCLUSIVE on both sides; calendar-month math (Date.setMonth)
// rather than fixed-day approximation, so months expand to their
// natural lengths (Feb 28/29 etc.).
//
// History:
//   ±2y (original) — too wide; a case two years apart isn't "around
//                    the same time" in any tipster's mental model.
//   ±1y (interim)  — still too loose. Real "same period" intuition is
//                    closer to "same season / same half of the year."
//   ±6m (this)     — captures the spirit of "around the same time"
//                    without overclaiming temporal coincidence.
//
// Quality-aware ranges (this commit) — the previous ±6mo math compared
// each case as a point-date against the subject's point-date. That
// produced asymmetric matching for year_only-quality dates because
// parseDate stores them at YYYY-01-01: a year_only "1985" case landed
// near February-1985 subjects (~1 month apart) but missed October-1985
// subjects (~9 months apart), even though both are by definition in
// the same year as the year_only record. Same problem across year
// boundaries: year_only 1984 (Jan 1, 1984) vs year_only 1985 (Jan 1,
// 1985) is exactly 12 months apart, falling out — but the underlying
// truth could be Dec 1984 vs Jan 1985, days apart in real time.
//
// Fix: treat each case as a date RANGE based on its quality.
//   exact     → range = [date, date] (point)
//   year_only → range = [Jan 1 of year, Dec 31 of year]
//   approximate → range = the parsed-date's month (best signal we have:
//                          parseDate sets day to 01 but month is real)
//   suspect / unknown → no temporal claim; bucket to "Other Nearby"
//
// Then check if the subject's range expanded by ±6 months on each
// side overlaps the candidate's range. Symmetric, intuitive, respects
// upstream date precision.
const SAME_PERIOD_MONTHS = 6;

export function CasesNearCaseSection({
  caseId,
  caseIncidentDate,
  caseIncidentDateQuality,
  hasLocation,
}: Props): ReactElement | null {
  // Hooks-before-returns per CLAUDE.md.
  const [radius, setRadius] = useState<(typeof RADIUS_OPTIONS)[number]>(DEFAULT_RADIUS);
  const { data: rows, loading } = useCasesNearCase({
    caseId,
    miles: radius,
    limit: RESULT_CAP,
  });

  // Subject's effective date range — depends on quality. See
  // effectiveRange + the SAME_PERIOD_MONTHS comment block for the
  // contract.
  const subjectRange = useMemo<DateRange | null>(
    () => effectiveRange(caseIncidentDate, caseIncidentDateQuality),
    [caseIncidentDate, caseIncidentDateQuality],
  );

  const buckets = useMemo(() => bucketByPeriod(rows, subjectRange), [rows, subjectRange]);
  const stats = useMemo(() => buildStats(rows), [rows]);

  if (!hasLocation) return null;

  const hasResults = rows.length > 0;
  const hitCap = rows.length >= RESULT_CAP;

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 22 }}>
      {/* Heading row — heading + radius chips */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <MonoLabel
          size={tokens.size.monoChip}
          tracking={tokens.tracking.chip}
          color={tokens.color.text.secondary}
        >
          {`WITHIN ${radius} MILES`}
        </MonoLabel>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {RADIUS_OPTIONS.map((r) => (
            <RadiusChip
              key={r}
              miles={r}
              active={r === radius}
              onPress={() => setRadius(r)}
            />
          ))}
        </View>
      </View>

      {/* Stats subhead — suppressed when zero rows */}
      {hasResults ? (
        <Mono
          size={tokens.size.meta}
          style={{ color: tokens.color.text.disabled, marginBottom: 12 }}
        >
          {formatStatsLine(stats, hitCap)}
        </Mono>
      ) : null}

      {/* Two-bucket render OR empty state */}
      {loading && !hasResults ? (
        <Mono
          size={tokens.size.meta}
          style={{ color: tokens.color.text.disabled }}
        >
          Loading…
        </Mono>
      ) : !hasResults ? (
        <EmptyState radius={radius} />
      ) : (
        <>
          {buckets.samePeriod.length > 0 ? (
            <BucketHeader label="SAME PERIOD" />
          ) : null}
          {buckets.samePeriod.map((row) => (
            <NearbyRow key={row.slug} row={row} />
          ))}
          {buckets.otherNearby.length > 0 ? (
            <BucketHeader
              label="OTHER NEARBY"
              style={{ marginTop: buckets.samePeriod.length > 0 ? 14 : 0 }}
            />
          ) : null}
          {buckets.otherNearby.map((row) => (
            <NearbyRow key={row.slug} row={row} />
          ))}
        </>
      )}
    </View>
  );
}

function NearbyRow({ row }: { row: CaseRowMapBbox }) {
  return (
    <CaseRow
      row={row}
      withThumbnail
      onPress={() =>
        router.push({ pathname: '/case/[slug]', params: { slug: row.slug } })
      }
    />
  );
}

function BucketHeader({
  label,
  style,
}: {
  label: string;
  style?: { marginTop?: number };
}) {
  return (
    <MonoLabel
      size={9}
      tracking={tokens.tracking.chip}
      color={tokens.color.text.disabled}
      style={{ marginBottom: 6, ...style }}
    >
      {label}
    </MonoLabel>
  );
}

function RadiusChip({
  miles,
  active,
  onPress,
}: {
  miles: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          paddingVertical: 4,
          paddingHorizontal: 8,
          borderRadius: 12,
          borderWidth: 0.5,
          borderColor: active
            ? tokens.color.accent.amber
            : tokens.color.border.hairline,
          backgroundColor: active
            ? tokens.color.bg.amberTintPill
            : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Show cases within ${miles} miles`}
      accessibilityState={{ selected: active }}
    >
      <Mono
        size={tokens.size.monoChip}
        style={{
          color: active
            ? tokens.color.accent.amber
            : tokens.color.text.secondary,
          letterSpacing: tokens.size.monoChip * tokens.tracking.chip,
        }}
      >
        {`${miles} MI`}
      </Mono>
    </Pressable>
  );
}

function EmptyState({ radius }: { radius: number }) {
  // Hint at the next-larger chips. At 100mi (the largest), there's
  // nothing further to suggest; show the bare absence.
  const larger = RADIUS_OPTIONS.filter((r) => r > radius);
  return (
    <View>
      <Mono
        size={tokens.size.meta}
        style={{ color: tokens.color.text.disabled }}
      >
        {`No cases within ${radius} miles.`}
      </Mono>
      {larger.length > 0 ? (
        <Mono
          size={tokens.size.meta}
          style={{ color: tokens.color.text.disabled, marginTop: 4 }}
        >
          {`Try ${larger.join(' or ')} miles.`}
        </Mono>
      ) : null}
    </View>
  );
}

/* ---------- pure helpers ---------- */

/**
 * A case's effective date range, expressed in millisecond timestamps.
 * Inclusive on both ends. Point-dates have startMs === endMs.
 */
interface DateRange {
  startMs: number;
  endMs: number;
}

/**
 * Convert (incident_date, quality) into a DateRange that respects
 * the source's date precision. Returns null when the case can't make
 * a temporal claim — those rows fall through to "Other Nearby"
 * because we don't want to silently include them in "Same Period."
 *
 *   exact        → point [date, date]
 *   year_only    → full year [Jan 1 YYYY, Dec 31 YYYY]
 *   approximate  → full year (parseDate sets day=01 either way and
 *                   we can't tell from the iso string alone whether
 *                   the month is real ("June 1985") or a Jan 1 anchor
 *                   for an embedded year ("summer 1985"). Conservative
 *                   call: trust only the year.)
 *   suspect      → null  (source itself flagged the date as unreliable)
 *   unknown      → null  (no temporal signal)
 *   undefined    → falls back to exact-style point — handles the brief
 *                   pre-migration-36 window where the RPC didn't
 *                   return quality. After migration 36 every row has
 *                   a value; this branch is dead but kept for safety.
 *
 * Uses UTC throughout so the same input produces the same range
 * regardless of the device's local timezone — a 1985-06-15 case
 * shouldn't bucket differently for a user in NY vs Tokyo.
 */
function effectiveRange(
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

  // exact (or undefined fallback)
  const ms = Date.parse(isoDate);
  if (!Number.isFinite(ms)) return null;
  return { startMs: ms, endMs: ms };
}

/**
 * Expand a DateRange by `months` calendar months on each side.
 * Calendar-month math via setUTCMonth (rather than fixed-day
 * approximation) so months keep their natural lengths — Feb's
 * 28/29 is honored; June+6mo lands on December not "180 days
 * later." Boundary is INCLUSIVE on both sides via the rangesOverlap
 * comparison below.
 */
function expandRange(range: DateRange, months: number): DateRange {
  const start = new Date(range.startMs);
  start.setUTCMonth(start.getUTCMonth() - months);
  const end = new Date(range.endMs);
  end.setUTCMonth(end.getUTCMonth() + months);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/** Inclusive-on-both-sides range overlap. */
function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startMs <= b.endMs && a.endMs >= b.startMs;
}

function bucketByPeriod(
  rows: CaseRowMapBbox[],
  subjectRange: DateRange | null,
): { samePeriod: CaseRowMapBbox[]; otherNearby: CaseRowMapBbox[] } {
  // No subject date / unreliable subject quality → no temporal
  // grouping; everything lands in "Other Nearby."
  if (subjectRange == null) {
    return { samePeriod: [], otherNearby: rows };
  }
  // Subject's matching window: subject's range expanded by ±6 months.
  const window = expandRange(subjectRange, SAME_PERIOD_MONTHS);
  const samePeriod: CaseRowMapBbox[] = [];
  const otherNearby: CaseRowMapBbox[] = [];
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

interface Stats {
  total: number;
  yearMin: number | null;
  yearMax: number | null;
  byKind: Array<{ kind: 'homicide' | 'missing' | 'unidentified'; count: number; label: string }>;
}

function buildStats(rows: CaseRowMapBbox[]): Stats {
  // Visual-similarity bucketing per lib/interleave-by-kind: unclaimed
  // → unidentified, suspicious_death → homicide. Same rule the rest of
  // the app uses for kind grouping.
  const counts = { homicide: 0, missing: 0, unidentified: 0 };
  let yearMin: number | null = null;
  let yearMax: number | null = null;
  for (const r of rows) {
    const k = visualKind(r.kind);
    counts[k] += 1;
    if (r.incident_date) {
      const y = parseInt(r.incident_date.slice(0, 4), 10);
      if (Number.isFinite(y)) {
        if (yearMin == null || y < yearMin) yearMin = y;
        if (yearMax == null || y > yearMax) yearMax = y;
      }
    }
  }
  const ordered = (
    [
      { kind: 'homicide' as const, count: counts.homicide, label: 'unsolved homicide' },
      { kind: 'missing' as const, count: counts.missing, label: 'missing' },
      { kind: 'unidentified' as const, count: counts.unidentified, label: 'unidentified' },
    ] as Stats['byKind']
  )
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count);
  return { total: rows.length, yearMin, yearMax, byKind: ordered };
}

function visualKind(k: CaseKind): 'homicide' | 'missing' | 'unidentified' {
  if (k === 'homicide' || k === 'suspicious_death') return 'homicide';
  if (k === 'missing') return 'missing';
  return 'unidentified'; // unidentified, unclaimed
}

function formatStatsLine(stats: Stats, hitCap: boolean): string {
  const parts: string[] = [];
  parts.push(`${stats.total} ${stats.total === 1 ? 'case' : 'cases'}`);
  if (stats.yearMin != null && stats.yearMax != null) {
    parts.push(
      stats.yearMin === stats.yearMax
        ? String(stats.yearMin)
        : `${stats.yearMin}–${stats.yearMax}`,
    );
  }
  if (stats.byKind.length > 0) {
    if (stats.total < HIGH_COUNT_THRESHOLD) {
      // Full breakdown.
      parts.push(stats.byKind.map((b) => `${b.count} ${b.label}`).join(' / '));
    } else {
      // Top 2 + "+N more".
      const top = stats.byKind.slice(0, 2);
      const remainder = stats.byKind
        .slice(2)
        .reduce((sum, b) => sum + b.count, 0);
      const head = top.map((b) => `${b.count} ${b.label}`).join(' / ');
      parts.push(remainder > 0 ? `${head} / +${remainder} more` : head);
    }
  }
  if (hitCap) {
    parts.push(`capped at ${RESULT_CAP}`);
  }
  return parts.join(' · ');
}
