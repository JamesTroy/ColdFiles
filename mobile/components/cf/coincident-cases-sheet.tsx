/**
 * CoincidentCasesSheet — stacked bottom sheet listing the cases at a
 * shared lat/lng on the home map.
 *
 * Trigger surface: when the user taps a markercluster cluster icon
 * whose children all share one lat/lng (e.g., 211 cases at the LA
 * city centroid), or a marker that has stacked siblings at its exact
 * coord at high zoom past clustering. Both routes post the
 * 'coincident-cluster' WebView message; MapScreen receives the coord
 * and renders this sheet over the persistent MapBottomSheet.
 *
 * Stacked-sheet pattern (rather than a modal route):
 *   - The persistent MapBottomSheet (peek/mid/full snaps) stays
 *     mounted underneath; the user can close the side-list and
 *     immediately keep browsing without a navigation pop.
 *   - Map state (zoom, pan, selected pin) is preserved without
 *     marshalling through router params.
 *   - Same @gorhom/bottom-sheet primitive the rest of the app uses
 *     (see map-bottom-sheet.tsx, watch-zone.tsx) — no new sheet lib,
 *     no new modal pattern.
 *
 * Visual contract:
 *   - 70%-height single snap point (above MapBottomSheet's peek/mid,
 *     below its full). Big enough to scan, doesn't fully occlude the
 *     map underneath.
 *   - Header: serif locale label (or "{N} cases at this point"
 *     fallback) + mono count subtitle + close button.
 *   - List of CaseRow items, scrollable, taps route to /case/[slug].
 *
 * Reuses CaseRow for visual parity with the home-map bottom-sheet
 * list. Cases are passed in pre-filtered by the parent — the parent
 * already has all coincident-coord cases in its useCasesInBbox
 * payload, so no separate RPC fetch is needed (and no loading state
 * to surface).
 */

import BottomSheet, {
  BottomSheetFlatList,
  type BottomSheetFlatListMethods,
} from '@gorhom/bottom-sheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';

import { tokens } from '@/constants/theme';
import { alphaToDays } from '@/lib/format';
import { SAMPLE_LAST_CHANGED_DAYS } from '@/lib/sample-data';
import type { CaseRowMapBbox } from '@/lib/types/database';

import { CaseRow } from './case-row';
import { PEEK_SNAP_POINT } from './map-bottom-sheet';
import { MonoLabel, SerifTitle } from './text';

interface CoincidentCasesSheetProps {
  /** Pre-filtered cases at the tapped coord. Parent computes via
   *  casesAll.filter(...) on (lat, lng). When empty, the sheet
   *  shouldn't be rendered — parent's conditional handles that. */
  cases: CaseRowMapBbox[];
  /** "City, ST" label. Null falls back to "{N} cases at this point". */
  label: string | null;
  onClose: () => void;
}

// Single snap point. 70% leaves the top of the map peeking through
// so the user keeps spatial context. Below 70% the list is too
// short to be useful at large counts; above 80% the map disappears
// and the sheet might as well be a full-screen route.
const SNAP_POINTS = ['70%'] as const;

export function CoincidentCasesSheet({
  cases,
  label,
  onClose,
}: CoincidentCasesSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const listRef = useRef<BottomSheetFlatListMethods>(null);

  // ─── Hooks declared first per the project rule (CLAUDE.md → "Hooks
  //     before early returns. No exceptions."). The cases array can
  //     be empty without skipping any hook on first render.

  // Reset scroll on case-set change so opening a new pile-up starts
  // at row 0 even if the previous tap-drill was scrolled deep. Cases
  // identity changes when the parent re-computes for a new coord, so
  // length alone is a sufficient trigger — distinct coords almost
  // always have distinct counts.
  useEffect(() => {
    if (cases.length > 0) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [cases]);

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
          // Close the side-list before navigating so a back-swipe
          // from case-detail returns to the map cleanly (the side
          // sheet would otherwise be on the back stack as a
          // re-entered overlay state).
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

  // Sheet dismisses on pan-down (gorhom's enablePanDownToClose).
  // gorhom fires onChange with index === -1 when the sheet closes
  // itself; forward that to the parent so MapScreen can clear its
  // openCoord state and unmount us.
  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const headerLabel =
    label && label.trim().length > 0
      ? label
      : `${cases.length} ${cases.length === 1 ? 'case' : 'cases'} at this point`;

  // ─── Hooks complete. Conditional render below is safe.

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
        count={cases.length}
        onClose={() => sheetRef.current?.close()}
      />
      <BottomSheetFlatList
        ref={listRef}
        data={cases}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: PEEK_SNAP_POINT }}
        showsVerticalScrollIndicator={false}
      />
    </BottomSheet>
  );
}

/**
 * Header — serif label + mono count caption + close button.
 */
function Header({
  label,
  count,
  onClose,
}: {
  label: string;
  count: number;
  onClose: () => void;
}) {
  const subtitle = `${count.toLocaleString()} ${count === 1 ? 'CASE' : 'CASES'}`;
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
        <Ionicons
          name="close"
          size={18}
          color={tokens.color.text.secondary}
        />
      </Pressable>
    </View>
  );
}
