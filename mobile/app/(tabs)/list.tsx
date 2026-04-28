/**
 * List tab — recent + all-cases-near-you.
 *
 * Layout (matches prototype):
 *   - Header: "Cases" (serif) + "{N} within 25 mi · sorted by recency" (mono)
 *   - RECENTLY UPDATED section — top 4 sorted by last_changed_days asc
 *   - ALL CASES NEAR YOU section — the rest
 *   - Each row: 56px thumbnail (photo silhouette or serif em-dash), serif name
 *     with optional pulsing recency dot, mono kindline below, meta line with
 *     cold pill + occupation/circumstance, distance and update-age line
 */

import { router } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Ellipse, Rect } from 'react-native-svg';

import { ErrorState } from '@/components/cf/error-state';
import { MonoLabel, SansBody, SansMedium, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { kindLine } from '@/lib/format';
import { useCaseList } from '@/lib/hooks/use-case-list';
import { SAMPLE_LAST_CHANGED_DAYS } from '@/lib/sample-data';
import type { CaseRowMapNear } from '@/lib/types/database';

const FRESH_DAY_LIMIT = 10;

export default function ListScreen() {
  const insets = useSafeAreaInsets();
  const { data: rows, loading, error, source, refetch } = useCaseList({ limit: 100 });

  const { recent, rest } = useMemo(() => {
    const enriched = rows.map((r) => ({
      row: r,
      days: SAMPLE_LAST_CHANGED_DAYS[r.slug] ?? 999,
    }));
    enriched.sort((a, b) => a.days - b.days);
    return {
      recent: enriched.slice(0, 4),
      rest: enriched.slice(4),
    };
  }, [rows]);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SerifTitle size="h2" style={{ fontSize: 22 }}>
            Cases
          </SerifTitle>
          {source === 'sample' ? <SampleTag /> : null}
        </View>
        <MonoLabel
          size={tokens.size.monoLabel}
          color={tokens.color.evidence.chrome}
          style={{ marginTop: 4 }}
        >
          {`${rows.length} WITHIN 25 MI · SORTED BY RECENCY`}
        </MonoLabel>
      </View>

      {loading && rows.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={tokens.color.accent.amber} />
        </View>
      ) : error ? (
        <ErrorState
          title="Couldn't load cases."
          detail={error.message}
          onRetry={refetch}
        />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {recent.length > 0 ? (
            <SectionLabel>RECENTLY UPDATED</SectionLabel>
          ) : null}
          {recent.map(({ row, days }) => (
            <CaseListRow key={row.slug} row={row} daysSinceUpdate={days} showFreshDot />
          ))}

          {rest.length > 0 ? (
            <SectionLabel style={{ paddingTop: 22 }}>ALL CASES NEAR YOU</SectionLabel>
          ) : null}
          {rest.map(({ row, days }) => (
            <CaseListRow key={row.slug} row={row} daysSinceUpdate={days} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function SectionLabel({
  children,
  style,
}: {
  children: string;
  style?: object;
}) {
  return (
    <MonoLabel
      size={tokens.size.monoLabel}
      tracking={tokens.tracking.label}
      color={tokens.color.evidence.chrome}
      style={[{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8 }, style]}
    >
      {children}
    </MonoLabel>
  );
}

function CaseListRow({
  row,
  daysSinceUpdate,
  showFreshDot,
}: {
  row: CaseRowMapNear;
  daysSinceUpdate: number;
  showFreshDot?: boolean;
}) {
  const display = displayName(row);
  const isFresh = daysSinceUpdate <= FRESH_DAY_LIMIT;
  const updateText =
    daysSinceUpdate <= 3
      ? 'updated today'
      : daysSinceUpdate <= 10
        ? 'updated this week'
        : agencyShortName(row);
  const distance = row.distance_miles?.toFixed(1) ?? '—';

  return (
    <Pressable
      onPress={() => router.push(`/case/${row.slug}`)}
      style={({ pressed }) => [
        {
          paddingHorizontal: 18,
          paddingVertical: 14,
          borderBottomWidth: 0.5,
          borderBottomColor: tokens.color.border.subtle,
          opacity: pressed ? 0.7 : 1,
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 14,
        },
      ]}
    >
      <Thumbnail hasPhoto={row.has_photo} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {showFreshDot && isFresh ? <FreshDot /> : null}
          <SansMedium style={{ flexShrink: 1 }}>{display}</SansMedium>
        </View>
        <MonoLabel
          size={tokens.size.monoLabel}
          tracking={tokens.tracking.label}
          color={tokens.color.evidence.chrome}
          style={{ marginTop: 4 }}
        >
          {kindLine(row)}
        </MonoLabel>
        <MonoLabel
          size={11}
          color={tokens.color.text.disabled}
          tracking={0}
          style={{ marginTop: 6 }}
        >
          {`${distance} mi · ${updateText}`}
        </MonoLabel>
      </View>
    </Pressable>
  );
}

function Thumbnail({ hasPhoto }: { hasPhoto: boolean }) {
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: 4,
        backgroundColor: tokens.color.bg.elev1,
        borderWidth: 0.5,
        borderColor: tokens.color.border.strong,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {hasPhoto ? (
        <Svg width="56" height="56" viewBox="0 0 56 56">
          <Rect width="56" height="56" fill={tokens.color.silhouette.bg} />
          <Ellipse cx="28" cy="22" rx="10" ry="12" fill={tokens.color.silhouette.figure} />
          <Ellipse cx="28" cy="46" rx="14" ry="11" fill={tokens.color.silhouette.figure} />
        </Svg>
      ) : (
        <SerifTitle
          size="h1"
          style={{ fontSize: 28, color: tokens.color.evidence.chrome, lineHeight: 28 }}
        >
          —
        </SerifTitle>
      )}
    </View>
  );
}

function FreshDot() {
  return (
    <View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: tokens.color.accent.amberHot,
        marginRight: 8,
      }}
    />
  );
}

function agencyShortName(row: CaseRowMapNear): string {
  if (!row.primary_agency_name) return '';
  const m = row.primary_agency_name.match(/^[A-Z]{2,5}\b/);
  if (m) return m[0];
  // Fallback: take everything before a "·" or just truncate
  return row.primary_agency_name.split('·')[0]?.trim().slice(0, 24) ?? '';
}

function displayName(row: CaseRowMapNear): string {
  if (row.victim_name) return row.victim_name;
  if (row.kind === 'unidentified' || row.kind === 'unclaimed') {
    return 'Unidentified person';
  }
  return 'Name not released';
}

function SampleTag() {
  return (
    <View
      style={{
        marginLeft: 8,
        paddingVertical: 2,
        paddingHorizontal: 6,
        borderRadius: 3,
        borderWidth: 0.5,
        borderColor: tokens.color.evidence.chrome,
      }}
    >
      <MonoLabel size={9} tracking={0.12} color={tokens.color.evidence.chrome}>
        SAMPLE
      </MonoLabel>
    </View>
  );
}

function EmptyState() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        gap: 14,
      }}
    >
      <SerifTitle
        size="h1"
        style={{ fontSize: 48, color: tokens.color.text.secondary }}
      >
        —
      </SerifTitle>
      <SansBody style={{ color: tokens.color.text.secondary, textAlign: 'center' }}>
        No cases match the current filters.
      </SansBody>
    </View>
  );
}
