/**
 * Map bottom sheet — peek/mid/full snap points over the home map.
 *
 * Replaces the dismissible PeekSheet (one-shot on pin tap) with a persistent
 * three-snap sheet — Citizen / AllTrails pattern. The user always sees a
 * minimum 96dp peek showing "{N} CASES IN VIEW · most recent: {name}"; drag
 * up to mid for the case list; drag up to full for the list plus secondary
 * filters.
 *
 * Tapping a pin snaps the sheet to mid and brings that case to the top of
 * the list (selectedSlug pinned). Tapping the same pin again — or the X on
 * the selection header — clears the selection without moving the sheet.
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
import { distancePhrase, kindLine } from '@/lib/format';
import type { CaseRowMapNear } from '@/lib/types/database';

import { CaseRow } from './case-row';
import { MonoLabel, SerifTitle } from './text';

export interface MapBottomSheetHandle {
  /** Snap to peek (0), mid (1), or full (2). */
  snapToIndex: (index: 0 | 1 | 2) => void;
  /** Scroll the list to a case's slug at the current snap point. */
  scrollToSlug: (slug: string) => void;
}

interface MapBottomSheetProps {
  cases: CaseRowMapNear[];
  /** Currently selected case (from a pin tap). Pinned to the top of the list. */
  selectedSlug: string | null;
  onClearSelection: () => void;
  /** Slug-to-days helper for fresh dot rendering. */
  daysFor: (row: CaseRowMapNear) => number;
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

const SNAP_POINTS = [96, '45%', '92%'] as const;

export const MapBottomSheet = forwardRef<MapBottomSheetHandle, MapBottomSheetProps>(
  function MapBottomSheet(
    {
      cases,
      selectedSlug,
      onClearSelection,
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

    // Browse-mode list. When the user has selected a pin, the body of the
    // sheet goes empty — only the header renders — so they see exactly one
    // thing about the case they tapped. Tapping the X clears the selection
    // and the full list comes back. This is the "pin tap and browse-the-
    // list are two different modes" contract.
    const ordered = useMemo(() => {
      if (selectedSlug) return [];
      if (cases.length === 0) return cases;
      return [...cases].sort((a, b) => daysFor(a) - daysFor(b));
    }, [cases, selectedSlug, daysFor]);

    const renderItem = useCallback(
      ({ item }: { item: CaseRowMapNear }) => {
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

    const keyExtractor = useCallback((item: CaseRowMapNear) => item.slug, []);

    const ListHeader = useMemo(
      () => (
        <ListHeaderInner
          count={cases.length}
          selectedRow={cases.find((c) => c.slug === selectedSlug) ?? null}
          onClearSelection={onClearSelection}
          onWatchHere={onWatchHere}
          watchHereDisabled={watchHereDisabled}
        />
      ),
      [cases, selectedSlug, onClearSelection, onWatchHere, watchHereDisabled],
    );

    return (
      <BottomSheet
        ref={sheetRef}
        index={0}
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
 * Sheet header. At peek (96dp visible) the user sees just the first row of
 * this — count + most-recent. As the sheet expands the rest of the list
 * scrolls into view; the header stays at the top.
 */
function ListHeaderInner({
  count,
  selectedRow,
  onClearSelection,
  onWatchHere,
  watchHereDisabled,
}: {
  count: number;
  selectedRow: CaseRowMapNear | null;
  onClearSelection: () => void;
  onWatchHere?: () => void;
  watchHereDisabled: boolean;
}) {
  if (selectedRow) {
    return (
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: 12,
          borderBottomWidth: 0.5,
          borderBottomColor: tokens.color.border.subtle,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <MonoLabel
            size={tokens.size.monoLabel}
            tracking={tokens.tracking.label}
            color={tokens.color.text.secondary}
          >
            {distanceLine(selectedRow)}
          </MonoLabel>
          <Pressable
            onPress={onClearSelection}
            accessibilityRole="button"
            accessibilityLabel="Clear selection"
            hitSlop={12}
            style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={16} color={tokens.color.text.secondary} />
          </Pressable>
        </View>
        <SerifTitle size="h2" style={{ fontSize: 18 }}>
          {displayName(selectedRow)}
        </SerifTitle>
        <MonoLabel
          size={tokens.size.monoChip}
          tracking={tokens.tracking.chip}
          color={tokens.color.text.secondary}
          style={{ marginTop: 4 }}
        >
          {kindLine(selectedRow)}
        </MonoLabel>
      </View>
    );
  }

  // Default peek state — count on the left, contextual "+ Watch" chip on the
  // right when the parent supplies one. The chip is the verb "save what I'm
  // looking at"; the (separate) layers stack handles visibility toggles.
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

function displayName(row: CaseRowMapNear): string {
  if (row.victim_name) return row.victim_name;
  if (row.kind === 'unidentified' || row.kind === 'unclaimed') return 'Unidentified person';
  return 'Name not released';
}

function distanceLine(row: CaseRowMapNear): string {
  if (row.distance_miles == null) return 'SELECTED';
  return `SELECTED · ${distancePhrase(row.distance_miles)}`;
}
