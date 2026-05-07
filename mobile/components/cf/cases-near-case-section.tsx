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
import type { CaseKind, CaseRowMapBbox } from '@/lib/types/database';

import { CaseRow } from './case-row';
import { Mono, MonoLabel } from './text';

interface Props {
  caseId: string;
  /** ISO date (yyyy-mm-dd). Drives the ±2y "Same period" bucket. */
  caseIncidentDate: string | null;
  /** False when the subject has no location_point — section is suppressed. */
  hasLocation: boolean;
}

const RADIUS_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_RADIUS: (typeof RADIUS_OPTIONS)[number] = 25;
const HIGH_COUNT_THRESHOLD = 30;
const RESULT_CAP = 200;
// "Same period" = cases within ±6 months of the subject's incident
// date. Tightened from ±2 years in two steps:
//   step 1 (this commit): ±2y was way too wide — a case two years
//                          apart isn't "around the same time" in any
//                          tipster's mental model.
//   step 2 (this commit): ±1y was still too loose. Real "same period"
//                          intuition is closer to "same season / same
//                          half of the year." 6 months captures that
//                          while staying inclusive of year_only-
//                          quality matches that anchor at YYYY-01-01.
//
// Year_only-quality dates land at YYYY-01-01 by parseDate convention,
// so a year_only "1985" case will match a mid-1985 subject within
// ~5 months and a late-1985 subject just barely (~7 months → out).
// That's a small bias toward early-year matches; acceptable given
// the upstream data quality.
const SAME_PERIOD_MONTHS = 6;

export function CasesNearCaseSection({
  caseId,
  caseIncidentDate,
  hasLocation,
}: Props): ReactElement | null {
  // Hooks-before-returns per CLAUDE.md.
  const [radius, setRadius] = useState<(typeof RADIUS_OPTIONS)[number]>(DEFAULT_RADIUS);
  const { data: rows, loading } = useCasesNearCase({
    caseId,
    miles: radius,
    limit: RESULT_CAP,
  });

  // Subject's incident date as a millisecond timestamp — null if the
  // case has no incident_date or it didn't parse. The bucket logic
  // below compares this against each row's incident_date in months.
  const subjectMs = useMemo<number | null>(() => {
    if (!caseIncidentDate) return null;
    const ms = Date.parse(caseIncidentDate);
    return Number.isFinite(ms) ? ms : null;
  }, [caseIncidentDate]);

  const buckets = useMemo(() => bucketByPeriod(rows, subjectMs), [rows, subjectMs]);
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

function bucketByPeriod(
  rows: CaseRowMapBbox[],
  subjectMs: number | null,
): { samePeriod: CaseRowMapBbox[]; otherNearby: CaseRowMapBbox[] } {
  // No subject date → no temporal grouping; everything lands in "Other".
  if (subjectMs == null) {
    return { samePeriod: [], otherNearby: rows };
  }
  const subjectDate = new Date(subjectMs);
  const samePeriod: CaseRowMapBbox[] = [];
  const otherNearby: CaseRowMapBbox[] = [];
  for (const r of rows) {
    if (!r.incident_date) {
      otherNearby.push(r);
      continue;
    }
    const rMs = Date.parse(r.incident_date);
    if (!Number.isFinite(rMs)) {
      otherNearby.push(r);
      continue;
    }
    const monthsApart = Math.abs(monthsBetween(subjectDate, new Date(rMs)));
    if (monthsApart <= SAME_PERIOD_MONTHS) {
      samePeriod.push(r);
    } else {
      otherNearby.push(r);
    }
  }
  return { samePeriod, otherNearby };
}

/**
 * Whole-month delta between two dates, ignoring day-of-month. Sufficient
 * resolution for a 6-month threshold; no need for day-precision when the
 * upstream data is mostly year_only or approximate quality anyway.
 */
function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
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
