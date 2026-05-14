/**
 * CentroidCasesSheet — stacked bottom sheet for the centroid badge
 * tap-drill (city / state precision aggregates).
 *
 * Trigger surface: user taps a centroid badge on the home map (e.g.,
 * the "782" at the LA city centroid, or the "1,340" at the TX state
 * centroid). MapScreen sets {lat, lng, label, count} state and
 * renders this component over the persistent MapBottomSheet. Tap
 * does NOT re-center or re-zoom the map — operator decision: the
 * user should be able to scan multiple city/state aggregates in
 * sequence without losing context (the underlying badge they tapped
 * stays under the sheet, swipe down/X to close, tap the next one).
 *
 * Distinct from CoincidentCasesSheet:
 *   • CoincidentCasesSheet handles "cases at the same exact pin
 *     lat/lng" — small piles surfaced via markercluster spiderfy
 *     when N≥2 cases share a single pixel-precise coord. Pre-
 *     filtered cases from the parent's bbox payload.
 *   • CentroidCasesSheet handles "cases at a city/state centroid"
 *     — large piles (LA: 782, CA state-only: 1,340). Fetches via
 *     useCasesAtCoordinate because the parent's bbox payload only
 *     carries address/street precision pins (post-rebuild).
 *
 * Sheet adds two controls vs the retired version:
 *   1. Category filter — tri-color homicide / missing / Doe pills.
 *      Tap a pill to toggle that kind on/off. All-off = show none;
 *      all-on (default) = show every case.
 *   2. Sort selector — "RECENT" (last_changed_at desc, via the
 *      recency_alpha column) or "A→Z" (victim name; unidentified
 *      cases sort to the end of A→Z under "Unidentified" key).
 *
 * Tap a row → router.push('/case/[slug]') and closes the sheet
 * (so the back-swipe from case-detail returns to the map cleanly).
 */

import BottomSheet, {
  BottomSheetFlatList,
  type BottomSheetFlatListMethods,
} from '@gorhom/bottom-sheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { tokens } from '@/constants/theme';
import { alphaToDays } from '@/lib/format';
import { useCasesAtCoordinate } from '@/lib/hooks/use-cases-at-coordinate';
import { SAMPLE_LAST_CHANGED_DAYS } from '@/lib/sample-data';
import type { CaseKind, CaseRowMapBbox } from '@/lib/types/database';

import { CaseRow } from './case-row';
import { ErrorState } from './error-state';
import { PEEK_SNAP_POINT } from './map-bottom-sheet';
import { MonoLabel, SerifTitle } from './text';

export interface CentroidContext {
  /** Centroid coord — passed straight to useCasesAtCoordinate. */
  lat: number;
  lng: number;
  /**
   * "City, ST" or "Texas" — server-built locale_label. Null falls
   * back to "{count} cases at this point" header copy.
   */
  label: string | null;
  /** Server-derived total (from the badge). Drives the count subtitle. */
  count: number;
}

interface CentroidCasesSheetProps {
  centroid: CentroidContext | null;
  onClose: () => void;
}

// Three "case kind families" the filter pills toggle. The CaseKind
// union has finer-grained values (homicide / suspicious_death /
// missing / unidentified / unclaimed); the filter coalesces them by
// family per the established home-map filter convention.
type KindFamily = 'homicide' | 'missing' | 'doe';

const ALL_FAMILIES: KindFamily[] = ['homicide', 'missing', 'doe'];

function familyOf(kind: CaseKind): KindFamily {
  if (kind === 'homicide' || kind === 'suspicious_death') return 'homicide';
  if (kind === 'missing') return 'missing';
  return 'doe'; // 'unidentified' | 'unclaimed'
}

type SortMode = 'recent' | 'name';

const SNAP_POINTS = ['70%'] as const;

export function CentroidCasesSheet({
  centroid,
  onClose,
}: CentroidCasesSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const listRef = useRef<BottomSheetFlatListMethods>(null);

  // ─── Hooks first per CLAUDE.md "Hooks before early returns." The
  //     centroid prop can be null without skipping any hook on first
  //     render. Optional-chain inside hook bodies.

  const [activeFamilies, setActiveFamilies] = useState<Set<KindFamily>>(
    () => new Set(ALL_FAMILIES),
  );
  const [sortMode, setSortMode] = useState<SortMode>('recent');

  // Reset filter + sort when the centroid changes — different city,
  // start fresh. Same coord-change identity trick CoincidentCasesSheet
  // uses for scroll reset.
  useEffect(() => {
    setActiveFamilies(new Set(ALL_FAMILIES));
    setSortMode('recent');
  }, [centroid?.lat, centroid?.lng]);

  const { data, loading, error, refetch } = useCasesAtCoordinate({
    lat: centroid?.lat ?? null,
    lng: centroid?.lng ?? null,
  });

  // Reset scroll on coord change so a new tap-drill starts at row 0.
  useEffect(() => {
    if (centroid && data.length > 0) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [centroid?.lat, centroid?.lng, data.length]);

  // Family counts for pill labels — derived from the unfiltered set
  // so the user sees "all-of" denominators regardless of current
  // filter state.
  const familyCounts = useMemo(() => {
    const counts: Record<KindFamily, number> = {
      homicide: 0,
      missing: 0,
      doe: 0,
    };
    for (const row of data) {
      counts[familyOf(row.kind)] += 1;
    }
    return counts;
  }, [data]);

  // Filtered + sorted view of the data.
  const visible = useMemo(() => {
    const filtered = data.filter((row) => activeFamilies.has(familyOf(row.kind)));
    if (sortMode === 'name') {
      return [...filtered].sort((a, b) => {
        const aName = a.victim_name?.trim() ?? '';
        const bName = b.victim_name?.trim() ?? '';
        // Unidentified cases (empty victim_name) sort to the end.
        if (!aName && !bName) return a.slug.localeCompare(b.slug);
        if (!aName) return 1;
        if (!bName) return -1;
        return aName.localeCompare(bName);
      });
    }
    // Default: by recency_alpha (high = fresh) then by id stability.
    return [...filtered].sort((a, b) => {
      const aAlpha = a.recency_alpha ?? 0;
      const bAlpha = b.recency_alpha ?? 0;
      if (aAlpha !== bAlpha) return bAlpha - aAlpha;
      return a.slug.localeCompare(b.slug);
    });
  }, [data, activeFamilies, sortMode]);

  const daysFor = useCallback((c: CaseRowMapBbox) => {
    return alphaToDays(c.recency_alpha) ?? SAMPLE_LAST_CHANGED_DAYS[c.slug] ?? 999;
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: CaseRowMapBbox }) => (
      <CaseRow
        row={item}
        daysSinceUpdate={daysFor(item)}
        withThumbnail
        onPress={() => {
          onClose();
          router.push({
            pathname: '/case/[slug]',
            params: { slug: item.slug },
          });
        }}
      />
    ),
    [daysFor, onClose],
  );

  const keyExtractor = useCallback((item: CaseRowMapBbox) => item.slug, []);

  const headerLabel = useMemo(() => {
    if (!centroid) return '';
    if (centroid.label && centroid.label.trim().length > 0) return centroid.label;
    return `${centroid.count} ${centroid.count === 1 ? 'case' : 'cases'} at this point`;
  }, [centroid]);

  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const toggleFamily = useCallback((family: KindFamily) => {
    setActiveFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }, []);

  const toggleSort = useCallback(() => {
    setSortMode((s) => (s === 'recent' ? 'name' : 'recent'));
  }, []);

  // ─── Hooks complete; conditional render below is safe.

  if (!centroid) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={SNAP_POINTS as unknown as (string | number)[]}
      enablePanDownToClose
      onChange={handleChange}
      backgroundStyle={{
        backgroundColor: tokens.color.bg.elev1,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
      }}
      handleIndicatorStyle={{
        backgroundColor: tokens.color.border.hairline,
        width: 36,
        height: 4,
      }}
      handleStyle={{ paddingTop: 10, paddingBottom: 8 }}
    >
      <Header
        label={headerLabel}
        count={centroid.count}
        actualCount={visible.length}
        loading={loading}
        onClose={() => sheetRef.current?.close()}
      />
      <ControlBar
        familyCounts={familyCounts}
        activeFamilies={activeFamilies}
        onToggleFamily={toggleFamily}
        sortMode={sortMode}
        onToggleSort={toggleSort}
      />
      {error ? (
        <ErrorState
          title="Couldn't load cases at this point."
          detail={error.message}
          onRetry={refetch}
        />
      ) : (
        <BottomSheetFlatList
          ref={listRef}
          data={visible}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: PEEK_SNAP_POINT }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            loading ? (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={tokens.color.accent.amber} />
              </View>
            ) : null
          }
        />
      )}
    </BottomSheet>
  );
}

/**
 * Header — locale label + count subtitle + close button.
 * "N OF M · FILTERED" subtitle when the active filter is reducing the
 * visible count below the badge total; single number when not.
 */
function Header({
  label,
  count,
  actualCount,
  loading,
  onClose,
}: {
  label: string;
  count: number;
  actualCount: number;
  loading: boolean;
  onClose: () => void;
}) {
  const showFiltered = !loading && actualCount > 0 && actualCount !== count;
  const subtitle = showFiltered
    ? `${actualCount.toLocaleString()} OF ${count.toLocaleString()} · FILTERED`
    : `${count.toLocaleString()} ${count === 1 ? 'CASE' : 'CASES'}`;
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: tokens.color.border.subtle,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <SerifTitle size="h2" style={{ fontSize: 20 }} numberOfLines={2}>
          {label}
        </SerifTitle>
        <MonoLabel
          size={tokens.size.monoLabel}
          tracking={tokens.tracking.label}
          color={tokens.color.text.secondary}
          style={{ marginTop: 4 }}
        >
          {subtitle}
        </MonoLabel>
      </View>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close cases list"
        hitSlop={16}
        style={({ pressed }) => [
          {
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: tokens.color.bg.elev2,
            borderWidth: 0.5,
            borderColor: tokens.color.border.strong,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          },
        ]}
      >
        <Ionicons name="close" size={18} color={tokens.color.text.secondary} />
      </Pressable>
    </View>
  );
}

/**
 * ControlBar — three filter pills (tri-color kind icons) + sort
 * toggle. Pills carry the per-family count so the user knows what's
 * in the pile without scrolling. Active = filled glyph + bright text;
 * inactive = outlined glyph + dimmed text.
 */
function ControlBar({
  familyCounts,
  activeFamilies,
  onToggleFamily,
  sortMode,
  onToggleSort,
}: {
  familyCounts: Record<KindFamily, number>;
  activeFamilies: Set<KindFamily>;
  onToggleFamily: (family: KindFamily) => void;
  sortMode: SortMode;
  onToggleSort: () => void;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: tokens.color.border.subtle,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <FilterPill
        family="homicide"
        label="Homicide"
        count={familyCounts.homicide}
        active={activeFamilies.has('homicide')}
        onPress={() => onToggleFamily('homicide')}
      />
      <FilterPill
        family="missing"
        label="Missing"
        count={familyCounts.missing}
        active={activeFamilies.has('missing')}
        onPress={() => onToggleFamily('missing')}
      />
      <FilterPill
        family="doe"
        label="Doe"
        count={familyCounts.doe}
        active={activeFamilies.has('doe')}
        onPress={() => onToggleFamily('doe')}
      />
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={onToggleSort}
        accessibilityRole="button"
        accessibilityLabel={`Sort: ${sortMode === 'recent' ? 'most recent' : 'A to Z'}`}
        hitSlop={8}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 14,
            borderWidth: 0.5,
            borderColor: tokens.color.border.strong,
            backgroundColor: tokens.color.bg.elev2,
            opacity: pressed ? 0.6 : 1,
          },
        ]}
      >
        <Ionicons name="swap-vertical" size={12} color={tokens.color.text.secondary} />
        <MonoLabel
          size={11}
          tracking={tokens.tracking.label}
          color={tokens.color.text.secondary}
        >
          {sortMode === 'recent' ? 'RECENT' : 'A→Z'}
        </MonoLabel>
      </Pressable>
    </View>
  );
}

function FilterPill({
  family,
  label,
  count,
  active,
  onPress,
}: {
  family: KindFamily;
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  // Tri-color: homicide brown / missing amber / Doe cream — pulls
  // from the same pin tokens the map markers use, so the filter pill
  // and the on-map pin read as the same visual language.
  const glyphColor =
    family === 'homicide'
      ? tokens.color.pin.homicide
      : family === 'missing'
        ? tokens.color.pin.missing
        : tokens.color.pin.doe;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${active ? 'Hide' : 'Show'} ${label}`}
      accessibilityState={{ selected: active }}
      hitSlop={6}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 14,
          borderWidth: 0.5,
          borderColor: active
            ? tokens.color.border.strong
            : tokens.color.border.subtle,
          backgroundColor: active
            ? tokens.color.bg.elev2
            : tokens.color.bg.elev1,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: active ? glyphColor : 'transparent',
          borderWidth: active ? 0 : 1,
          borderColor: glyphColor,
        }}
      />
      <MonoLabel
        size={11}
        tracking={tokens.tracking.label}
        color={active ? tokens.color.text.primary : tokens.color.text.secondary}
      >
        {label.toUpperCase()}
      </MonoLabel>
      {count > 0 && (
        <MonoLabel
          size={11}
          tracking={tokens.tracking.label}
          color={tokens.color.text.disabled}
        >
          {count}
        </MonoLabel>
      )}
    </Pressable>
  );
}
