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
  /** Currently selected case (from a pin tap). Highlights the matching row. */
  selectedSlug: string | null;
  /** Slug-to-days helper for fresh dot rendering. */
  daysFor: (row: CaseRowMapBbox) => number;
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
      selectedSlug,
      daysFor,
      animatedIndex,
      onWatchHere,
      watchHereDisabled = false,
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
    const ordered = useMemo(() => {
      if (cases.length === 0) return cases;
      return [...cases].sort((a, b) => daysFor(a) - daysFor(b));
    }, [cases, daysFor]);

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
          onWatchHere={onWatchHere}
          watchHereDisabled={watchHereDisabled}
        />
      ),
      [cases.length, onWatchHere, watchHereDisabled],
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
        // Don't enable contentPanningGesture for the list — BottomSheetFlatList
        // already coordinates list-scroll vs sheet-drag. We only want the
        // handle + peek-row to be drag affordances.
        enableContentPanningGesture
      >
        <BottomSheetFlatList
          ref={listRef}
          data={ordered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={{ paddingBottom: 96 }}
          showsVerticalScrollIndicator={false}
        />
      </BottomSheet>
    );
  },
);

/**
 * Sheet header — count on the left, optional WATCH chip on the right.
 * Stays mounted at the top of the list; visible at every snap point.
 */
function ListHeaderInner({
  count,
  onWatchHere,
  watchHereDisabled,
}: {
  count: number;
  onWatchHere?: () => void;
  watchHereDisabled: boolean;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 0.5,
        borderBottomColor: tokens.color.border.subtle,
      }}
    >
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.label}
        color={tokens.color.text.secondary}
      >
        {count.toLocaleString()} {count === 1 ? 'CASE' : 'CASES'} IN VIEW
      </MonoLabel>
      {onWatchHere ? (
        <WatchChip onPress={onWatchHere} disabled={watchHereDisabled} />
      ) : null}
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

