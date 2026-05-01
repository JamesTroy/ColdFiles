/**
 * List tab — case-file index, browse by recency.
 *
 * Three behaviors that distinguish this from the previous fixed-N "Recently
 * Updated / All Cases" split:
 *
 *   1. Filter chip row at the top, mirroring the Map tab. Same chips, same
 *      data source, client-side filter. Switching between Map and List
 *      preserves the filter mental model.
 *
 *   2. Date buckets — UPDATED TODAY / UPDATED THIS WEEK / UPDATED THIS MONTH
 *      / OLDER. The "UPDATED" prefix is load-bearing; bare "TODAY" would
 *      misframe cold-case data as "things that happened today," which is a
 *      brutally wrong reading of this dataset. Empty buckets render a quiet
 *      "NONE THIS WEEK" strip instead of disappearing — the absence is
 *      information, telling the user the cadence of the dataset rather
 *      than hiding the silence.
 *
 *   3. Pull-to-refresh. The fresh-dot stops feeling magical and starts
 *      feeling controllable. Pairs with the bucketing semantic so the
 *      freshness signal is user-driven from day one.
 *
 * Two design decisions worth naming, since they'll come under pressure later:
 *
 *   - If you're considering adding a bookmark star inline on List rows,
 *     here's why we didn't: saving is a deliberate-attention action, not a
 *     list-skim action. The case-detail page is the site of attention; the
 *     star lives there because it requires the user to have read the case
 *     before deciding to follow it. Inline saving from a list invites
 *     accidental saves and creates the infinite-saved-cases anti-pattern
 *     (Twitter/X follows the same pattern — bookmarks live inside a tweet's
 *     detail view, not on the timeline).
 *
 *   - If you're considering adding a search field on the List tab, here's
 *     why we didn't: global search has one anchor — the Map tab top-right.
 *     Duplicating it on List splits where users go to find things. The
 *     relief valve, if friction shows up in feedback, is making global
 *     search reachable from a stable cross-tab anchor (search field in
 *     the bottom tab bar, swipe gesture, etc.) — not adding a second site.
 */

import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CaseRow } from '@/components/cf/case-row';
import { ErrorState } from '@/components/cf/error-state';
import { FilterChip } from '@/components/cf/pill';
import { MonoLabel, SansBody, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { useCaseList } from '@/lib/hooks/use-case-list';
import { SAMPLE_LAST_CHANGED_DAYS } from '@/lib/sample-data';
import type { CaseKind, CaseRowMapNear } from '@/lib/types/database';

type Filter = 'all' | 'homicide' | 'missing' | 'unidentified';

const KIND_FILTER: Record<Filter, CaseKind[] | null> = {
  all: null,
  homicide: ['homicide', 'suspicious_death'],
  missing: ['missing'],
  unidentified: ['unidentified', 'unclaimed'],
};

type Bucket = 'today' | 'week' | 'month' | 'older';

const BUCKET_ORDER: Bucket[] = ['today', 'week', 'month', 'older'];

const BUCKET_LABEL: Record<Bucket, string> = {
  today: 'UPDATED TODAY',
  week: 'UPDATED THIS WEEK',
  month: 'UPDATED THIS MONTH',
  older: 'OLDER',
};

const BUCKET_EMPTY_LABEL: Record<Bucket, string> = {
  today: 'NONE TODAY',
  week: 'NONE THIS WEEK',
  month: 'NONE THIS MONTH',
  // OLDER never empties in practice — and an empty older bucket means there's
  // no dataset at all, which is the root EmptyState's job. Skip the strip.
  older: '',
};

/** Mirrors the map's stepwise recency_alpha → day-count translation. */
function alphaToDays(alpha: number | null): number | null {
  if (alpha == null) return null;
  if (alpha >= 0.99) return 1;
  if (alpha >= 0.49) return 7;
  return null;
}

function bucketFor(days: number): Bucket {
  if (days <= 1) return 'today';
  if (days <= 7) return 'week';
  if (days <= 31) return 'month';
  return 'older';
}

export default function ListScreen() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);

  // Pulls all cases unfiltered so chip counts can preview selectivity (same
  // pattern as the Map tab). The kind filter is then applied client-side.
  const { data: rows, loading, error, source, refetch } = useCaseList({
    kinds: null,
    limit: 100,
  });

  const counts = useMemo(() => {
    const c = { all: rows.length, homicide: 0, missing: 0, unidentified: 0 };
    for (const r of rows) {
      if (r.kind === 'homicide' || r.kind === 'suspicious_death') c.homicide += 1;
      else if (r.kind === 'missing') c.missing += 1;
      else if (r.kind === 'unidentified' || r.kind === 'unclaimed') c.unidentified += 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const allowed = KIND_FILTER[filter];
    if (!allowed) return rows;
    return rows.filter((r) => allowed.includes(r.kind));
  }, [rows, filter]);

  // If the active filter belongs to a kind that just dropped to zero, snap
  // the filter back to "all" so the user isn't stranded on a hidden chip.
  useEffect(() => {
    if (loading) return;
    if (filter === 'homicide' && counts.homicide === 0) setFilter('all');
    else if (filter === 'missing' && counts.missing === 0) setFilter('all');
    else if (filter === 'unidentified' && counts.unidentified === 0) setFilter('all');
  }, [loading, counts, filter]);

  const buckets = useMemo(() => {
    const grouped: Record<Bucket, { row: CaseRowMapNear; days: number }[]> = {
      today: [],
      week: [],
      month: [],
      older: [],
    };
    for (const row of filtered) {
      const days =
        SAMPLE_LAST_CHANGED_DAYS[row.slug] ??
        alphaToDays(row.recency_alpha) ??
        999;
      grouped[bucketFor(days)].push({ row, days });
    }
    // Within each bucket, sort by days asc so the freshest item leads.
    for (const b of BUCKET_ORDER) grouped[b].sort((a, b) => a.days - b.days);
    return grouped;
  }, [filtered]);

  const onRefresh = async () => {
    setRefreshing(true);
    refetch();
    // useCaseList flips loading=true on refresh; the RefreshControl spinner
    // hides as soon as we drop refreshing back to false. 600ms gives the
    // RPC time to land on a slow connection without the spinner flickering
    // away before the data arrives.
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 8,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SerifTitle size="h2" style={{ fontSize: 22 }}>
            Cases
          </SerifTitle>
          {source === 'sample' ? <SampleTag /> : null}
        </View>
        <MonoLabel
          size={tokens.size.monoLabel}
          color={tokens.color.text.secondary}
          style={{ marginTop: 4 }}
        >
          {filtered.length === rows.length
            ? `${rows.length} ${rows.length === 1 ? 'CASE' : 'CASES'} · SORTED BY RECENCY`
            : `${filtered.length} OF ${rows.length} CASES · SORTED BY RECENCY`}
        </MonoLabel>
      </View>

      {/* Filter chip row.
          flexGrow:0 + flexShrink:0 is load-bearing on Android Fabric — see
          the matching note in (tabs)/index.tsx for the full story.
          Zero-count chips hide once data lands; matches the Map tab. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
      >
        <FilterChip
          label="All"
          count={loading ? undefined : counts.all}
          active={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        {loading || counts.homicide > 0 ? (
          <FilterChip
            label="Homicide"
            count={loading ? undefined : counts.homicide}
            active={filter === 'homicide'}
            onPress={() => setFilter('homicide')}
          />
        ) : null}
        {loading || counts.missing > 0 ? (
          <FilterChip
            label="Missing"
            count={loading ? undefined : counts.missing}
            active={filter === 'missing'}
            onPress={() => setFilter('missing')}
          />
        ) : null}
        {loading || counts.unidentified > 0 ? (
          <FilterChip
            label="Doe"
            count={loading ? undefined : counts.unidentified}
            active={filter === 'unidentified'}
            onPress={() => setFilter('unidentified')}
          />
        ) : null}
      </ScrollView>

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
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          // "handled" keeps inner Pressables responsive when the ScrollView
          // is also handling pull-to-refresh / momentum gestures. Without
          // this, taps near the start of a fling can get eaten by the
          // ScrollView's gesture handler.
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={tokens.color.accent.amber}
              colors={[tokens.color.accent.amber]}
              progressBackgroundColor={tokens.color.bg.elev1}
            />
          }
        >
          {BUCKET_ORDER.map((bucket) => {
            const items = buckets[bucket];
            if (items.length === 0) {
              const emptyLabel = BUCKET_EMPTY_LABEL[bucket];
              if (!emptyLabel) return null;
              return <EmptyBucketStrip key={bucket} label={emptyLabel} />;
            }
            return (
              <View key={bucket}>
                <SectionLabel>{BUCKET_LABEL[bucket]}</SectionLabel>
                {items.map(({ row, days }) => (
                  <CaseRow
                    key={row.slug}
                    row={row}
                    daysSinceUpdate={days}
                    // Template-string format matches the legacy navigation
                    // pattern that worked in this codebase pre-redesign.
                    // Both forms are valid Expo Router APIs; this one is
                    // battle-tested here.
                    onPress={() => router.push(`/case/${row.slug}`)}
                  />
                ))}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <MonoLabel
      size={tokens.size.monoLabel}
      tracking={tokens.tracking.label}
      color={tokens.color.text.secondary}
      style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 }}
    >
      {children}
    </MonoLabel>
  );
}

/**
 * Empty-bucket strip — the absence is information, not a layout problem.
 * A casual user opening the app and seeing TODAY · NONE / THIS WEEK · 2 /
 * THIS MONTH · 18 learns more about how cold-case data moves than they
 * would from any onboarding screen.
 */
function EmptyBucketStrip({ label }: { label: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 6,
      }}
    >
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.label}
        color={tokens.color.text.disabled}
      >
        {label}
      </MonoLabel>
    </View>
  );
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
      <MonoLabel size={9} tracking={0.12} color={tokens.color.text.secondary}>
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
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SerifTitle
          size="h1"
          style={{ fontSize: 28, color: tokens.color.text.secondary, lineHeight: 28 }}
        >
          —
        </SerifTitle>
      </View>
      <SerifTitle size="h2" style={{ fontSize: 20 }}>
        No cases yet
      </SerifTitle>
      <SansBody
        style={{
          color: tokens.color.text.secondary,
          textAlign: 'center',
          lineHeight: tokens.size.body * 1.55,
          maxWidth: 280,
        }}
      >
        The dataset is still building. Pull down to refresh.
      </SansBody>
    </View>
  );
}
