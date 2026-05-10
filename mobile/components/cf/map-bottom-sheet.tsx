/**
 * Map bottom sheet — peek/mid/full snap points over the home map.
 *
 * The peek shows "{N} CASES IN VIEW" plus an optional "+ WATCH" chip; drag
 * up for the cases list. List rows are sorted by recency. Tapping a pin
 * highlights the matching row in the list; the in-map popup carries the
 * single-case affordance, so this sheet is purely the list browser. No
 * mode-swapping, no selection-aware header — selection is just a row
 * highlight.
 *
 * The map sits underneath, always partially visible. Map state is preserved
 * across all snap transitions; this is the design contract that makes "tap a
 * pin → check details → close → tap next pin" feel continuous.
 */

import BottomSheet, {
  BottomSheetFlatList,
  type BottomSheetFlatListMethods,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { Pressable, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { tokens } from '@/constants/theme';
import { interleaveByKind } from '@/lib/interleave-by-kind';
import type { CaseRowMapBbox } from '@/lib/types/database';

import { CaseRow } from './case-row';
import { MonoLabel } from './text';

export interface MapBottomSheetHandle {
  /** Snap to minimized (0), peek (1), mid (2), or full (3). */
  snapToIndex: (index: 0 | 1 | 2 | 3) => void;
  /** Scroll the list to a case's slug at the current snap point. */
  scrollToSlug: (slug: string) => void;
}

interface MapBottomSheetProps {
  cases: CaseRowMapBbox[];
  /**
   * Total undeleted cases across the corpus (not just in the current
   * viewport). Drives the "X TRACKED" headline. Null while the count is
   * loading on first paint.
   */
  totalCount: number | null;
  /** Currently selected case (from a pin tap). Highlights the matching row. */
  selectedSlug: string | null;
  /** Slug-to-days helper for fresh dot rendering. */
  daysFor: (row: CaseRowMapBbox) => number;
  /**
   * When true, round-robin interleave the rows by kind so the top of
   * the list shows variety. Set true when no kind filter is active —
   * a recency-driven sort (which is what the bottom-sheet uses) would
   * otherwise let whichever kind was most-recently rescraped dominate
   * the visible window. False when a specific kind chip is active —
   * pure recency is what the user asked for in that case.
   */
  mixByKind?: boolean;
  /**
   * Optional shared value the parent reads to drive header collapse, etc.
   * gorhom writes the current snap progress (0=peek, 1=mid, 2=full,
   * fractional during drag) into this on each frame.
   */
  animatedIndex?: SharedValue<number>;
  /**
   * When set, renders the contextual "+ Watch" chip in the peek header next
   * to the count. Tap → enters Draw Mode for the area the user is looking at.
   * Hidden when undefined (e.g. on screens where the map verb isn't
   * applicable). The parent decides visibility — usually based on zone-count
   * cap and zoom level.
   */
  onWatchHere?: () => void;
  /**
   * "Zone limit" disabled-state override. Renders a non-pressable variant of
   * the chip so the user understands the verb is reachable but currently
   * exhausted, rather than just disappearing.
   */
  watchHereDisabled?: boolean;
  /**
   * When true, the sheet is in grid-mode: low zoom, server-side
   * tile-grid badges on the map (cases_grid_in_bbox). The list of
   * individual cases doesn't apply at this scale (~tens of cells
   * aggregating thousands of cases). Header shows a zoom-in CTA +
   * region-level summary; list is replaced with an empty-state row.
   * The WATCH chip stays (drawing a watch zone over a region is
   * still a coherent verb at this zoom).
   */
  inGridMode?: boolean;
  /**
   * Aggregate summary for the grid-mode header. Required when
   * inGridMode is true; ignored otherwise.
   */
  gridSummary?: { cellCount: number; totalCases: number };
}

// Four snap points:
//   0: 28px — minimized; just the handle bar visible. User dragged the
//      sheet down to "hide" the cases list and reclaim map real estate.
//      Swipe up from the handle returns to peek.
//   1: 96px — peek; count + WATCH chip visible. Default starting state.
//   2: 45%   — mid; cases list visible at half-screen.
//   3: 92%   — full; list expanded over the map.
const SNAP_POINTS = [28, 96, '45%', '92%'] as const;

export const MapBottomSheet = forwardRef<MapBottomSheetHandle, MapBottomSheetProps>(
  function MapBottomSheet(
    {
      cases,
      totalCount,
      selectedSlug,
      daysFor,
      mixByKind = false,
      animatedIndex,
      onWatchHere,
      watchHereDisabled = false,
      inGridMode = false,
      gridSummary,
    },
    ref,
  ) {
    const sheetRef = useRef<BottomSheet>(null);
    const listRef = useRef<BottomSheetFlatListMethods>(null);

    useImperativeHandle(ref, () => ({
      snapToIndex: (i) => sheetRef.current?.snapToIndex(i),
      scrollToSlug: (slug) => {
        const idx = ordered.findIndex((r) => r.slug === slug);
        if (idx >= 0) {
          listRef.current?.scrollToIndex({ index: idx, viewPosition: 0, animated: true });
        }
      },
    }));

    // List always renders, sorted by recency. Selection just highlights
    // the matching row — the in-map popup is the single-case affordance,
    // so the sheet doesn't need a "selection mode" anymore.
    //
    // When mixByKind is true (no kind filter), round-robin interleave
    // by kind AFTER recency-sorting. Within-kind ordering is preserved,
    // so the top of the list shows variety while item N of kind K still
    // appears in monotonically-N order. Without this, a Doe rescrape
    // that pegs ~1500 unidentified cases' recency in the last few hours
    // makes the entire visible window read as unidentified-only — the
    // user-facing trap that motivated this fix. See lib/interleave-by-kind.
    const ordered = useMemo(() => {
      if (cases.length === 0) return cases;
      const byRecency = [...cases].sort((a, b) => daysFor(a) - daysFor(b));
      return mixByKind ? interleaveByKind(byRecency) : byRecency;
    }, [cases, daysFor, mixByKind]);

    const renderItem = useCallback(
      ({ item }: { item: CaseRowMapBbox }) => {
        return (
          <CaseRow
            row={item}
            daysSinceUpdate={daysFor(item)}
            highlighted={item.slug === selectedSlug}
            withThumbnail
            onPress={() =>
              router.push({
                pathname: '/case/[slug]',
                params: { slug: item.slug },
              })
            }
          />
        );
      },
      [daysFor, selectedSlug],
    );

    const keyExtractor = useCallback((item: CaseRowMapBbox) => item.slug, []);

    const ListHeader = useMemo(
      () => (
        <ListHeaderInner
          count={cases.length}
          totalCount={totalCount}
          onWatchHere={onWatchHere}
          watchHereDisabled={watchHereDisabled}
          inGridMode={inGridMode}
          gridSummary={gridSummary}
        />
      ),
      [
        cases.length,
        totalCount,
        onWatchHere,
        watchHereDisabled,
        inGridMode,
        gridSummary,
      ],
    );

    return (
      <BottomSheet
        ref={sheetRef}
        // Default to peek (index 1) so the user lands on the cases-in-view
        // count + WATCH chip on first paint. Index 0 is the minimized
        // (handle-only) snap, used when the user drags down to hide.
        index={1}
        animatedIndex={animatedIndex}
        snapPoints={SNAP_POINTS as unknown as (string | number)[]}
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
        // enableContentPanningGesture lets gorhom coordinate list-scroll vs
        // sheet-drag at the top of the list. BottomSheetFlatList handles the
        // handoff: drag the sheet when the list is scrolled to top, scroll
        // the list otherwise. This is the standard gorhom default.
        enableContentPanningGesture
      >
        <BottomSheetFlatList
          ref={listRef}
          // In grid mode, the per-case list doesn't apply — the map
          // is showing ~tens of cells aggregating thousands of cases.
          // Swap data to [] and let ListEmptyComponent surface the
          // zoom-in CTA. Keep `ordered` referenced via the prop so
          // the list state isn't blown away on mode flips back to
          // point — gorhom's FlatList preserves scroll position
          // across data identity changes when keys are stable.
          data={inGridMode ? [] : ordered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={inGridMode ? <GridModeEmptyState /> : null}
          contentContainerStyle={{ paddingBottom: 96 }}
          showsVerticalScrollIndicator={false}
        />
      </BottomSheet>
    );
  },
);

/**
 * Sheet header — two rows.
 *   Row 1: "{count} IN VIEW · {totalCount} TRACKED" + optional WATCH chip.
 *   Row 2: legend caption explaining the orange fresh-dot prefix that
 *          appears next to recently-updated case names. The dot itself
 *          is set on individual rows from `recency_alpha` (last_changed_at
 *          driven, see migration 22). The legend makes the otherwise-mute
 *          signal legible — without it, end users see a colored mark with
 *          no key.
 *
 * The "{totalCount} TRACKED" half leads with corpus size as the headline
 * metric, intentionally NOT a per-day delta. Cold-case ingest is mostly
 * merge-into-existing on steady-state days; a velocity headline would
 * read zero on a healthy day. See the feedback_ingest_metric_axis
 * memory note for context.
 */
function ListHeaderInner({
  count,
  totalCount,
  onWatchHere,
  watchHereDisabled,
  inGridMode,
  gridSummary,
}: {
  count: number;
  totalCount: number | null;
  onWatchHere?: () => void;
  watchHereDisabled: boolean;
  inGridMode: boolean;
  gridSummary?: { cellCount: number; totalCases: number };
}) {
  // Headline + sub-line vary by mode.
  //   point mode (default):
  //     "{N} IN VIEW · {totalCount} TRACKED"
  //     orange-dot legend "UPDATED < 10 DAYS"
  //   grid mode:
  //     "ZOOM IN TO BROWSE CASES"
  //     "{totalCases} CASES · {cellCount} REGIONS"
  // The WATCH chip stays in both modes — drawing a watch zone over a
  // region is a coherent verb at any zoom.
  let headline: string;
  let subLine: { text: string; color: string; withDot: boolean };
  if (inGridMode) {
    headline = 'ZOOM IN TO BROWSE CASES';
    const total = gridSummary?.totalCases ?? 0;
    const cellCount = gridSummary?.cellCount ?? 0;
    subLine = {
      text: `${total.toLocaleString()} CASES · ${cellCount.toLocaleString()} REGIONS`,
      color: tokens.color.text.disabled,
      withDot: false,
    };
  } else {
    const inView = `${count.toLocaleString()} IN VIEW`;
    const tracked =
      totalCount != null ? `${totalCount.toLocaleString()} TRACKED` : null;
    headline = tracked ? `${inView} · ${tracked}` : inView;
    subLine = {
      text: 'UPDATED < 10 DAYS',
      color: tokens.color.text.disabled,
      withDot: true,
    };
  }

  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: tokens.color.border.subtle,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <MonoLabel
          size={tokens.size.monoLabel}
          tracking={tokens.tracking.label}
          color={tokens.color.text.secondary}
        >
          {headline}
        </MonoLabel>
        {onWatchHere ? (
          <WatchChip onPress={onWatchHere} disabled={watchHereDisabled} />
        ) : null}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          marginTop: 6,
        }}
      >
        {subLine.withDot ? (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: tokens.color.accent.amberHot,
            }}
          />
        ) : null}
        {/* flexShrink:1 lets RN compress this Text to the available width
            so it wraps gracefully on narrow viewports instead of clipping
            mid-word — RN's default for an un-shrinkable Text in a flex
            row is to take intrinsic width + overflow-clip past the parent
            edge. */}
        <MonoLabel
          size={11}
          tracking={tokens.tracking.label}
          color={subLine.color}
          style={{ flexShrink: 1 }}
        >
          {subLine.text}
        </MonoLabel>
      </View>
    </View>
  );
}

/**
 * Empty-state row for the grid-mode FlatList. Shows when the sheet's
 * data is [] because the map is in grid mode (low zoom, server-side
 * tile-grid badges). The header already carries the headline + region
 * summary; this row is a quiet "you can drill in" affordance.
 *
 * Filter chips on the home screen stay interactive in grid mode but
 * don't refilter cells (cells are pre-aggregated server-side at
 * status='open'); the sub-text here flags that.
 */
function GridModeEmptyState() {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 24 }}>
      <MonoLabel
        size={11}
        tracking={tokens.tracking.label}
        color={tokens.color.text.disabled}
      >
        TAP A REGION OR PINCH IN TO SEE INDIVIDUAL CASES.
      </MonoLabel>
      <MonoLabel
        size={11}
        tracking={tokens.tracking.label}
        color={tokens.color.text.disabled}
        style={{ marginTop: 6 }}
      >
        FILTER CHIPS APPLY ONCE PINS ARE VISIBLE.
      </MonoLabel>
    </View>
  );
}

function WatchChip({
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled: boolean;
}) {
  if (disabled) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 5,
          paddingHorizontal: 10,
          borderRadius: 14,
          borderWidth: 0.5,
          borderColor: tokens.color.border.hairline,
          backgroundColor: 'transparent',
          gap: 6,
        }}
      >
        <MonoLabel
          size={tokens.size.monoChip}
          tracking={tokens.tracking.chip}
          color={tokens.color.text.disabled}
        >
          ZONE LIMIT
        </MonoLabel>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Watch this area"
      hitSlop={8}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 5,
          paddingHorizontal: 10,
          borderRadius: 14,
          borderWidth: 0.5,
          borderColor: tokens.color.accent.amber,
          backgroundColor: pressed ? tokens.color.accent.amber : 'transparent',
          gap: 6,
        },
      ]}
    >
      {({ pressed }: { pressed: boolean }) => (
        <>
          <Ionicons
            name="add"
            size={12}
            color={pressed ? tokens.color.bg.base : tokens.color.accent.amber}
          />
          <MonoLabel
            size={tokens.size.monoChip}
            tracking={tokens.tracking.chip}
            color={pressed ? tokens.color.bg.base : tokens.color.accent.amber}
          >
            WATCH
          </MonoLabel>
        </>
      )}
    </Pressable>
  );
}

