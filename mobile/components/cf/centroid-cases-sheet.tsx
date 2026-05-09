/**
 * CentroidCasesSheet — stacked bottom sheet for the centroid badge
 * tap-drill.
 *
 * When the user taps a centroid badge on the home map (e.g., the "211"
 * at the LA city centroid), MapScreen sets {lat, lng, label, count}
 * state and renders this component over the persistent MapBottomSheet.
 * Closing the sheet (X button or pan-down) calls onClose, which clears
 * MapScreen's state and unmounts this component — leaving the cases
 * list browser sheet underneath untouched.
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
 *   - Header: serif locale label (or "N cases at this point" fallback)
 *     + mono count subtitle + close button.
 *   - List of CaseRow items, scrollable, taps route to /case/[slug].
 *
 * Reuses CaseRow from map-bottom-sheet for visual parity — same
 * stripe / thumbnail / fresh-dot grammar the rest of the app uses for
 * case lists. No bespoke row design.
 */

import BottomSheet, {
  BottomSheetFlatList,
  type BottomSheetFlatListMethods,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { tokens } from '@/constants/theme';
import { useCasesAtCoordinate } from '@/lib/hooks/use-cases-at-coordinate';
import { alphaToDays } from '@/lib/format';
import { SAMPLE_LAST_CHANGED_DAYS } from '@/lib/sample-data';
import type { CaseKind, CaseRowMapBbox } from '@/lib/types/database';

import { CaseRow } from './case-row';
import { ErrorState } from './error-state';
import { MonoLabel, SerifTitle } from './text';

export interface CentroidContext {
  lat: number;
  lng: number;
  /** Optional "City, ST" label resolved server-side (migration 35). */
  label: string | null;
  /** Total cases at this point — drives the header subtitle. */
  count: number;
}

interface CentroidCasesSheetProps {
  /**
   * The centroid being drilled into. Null = sheet is closed; the
   * parent unmounts this component when state clears, so this
   * shouldn't be reached with null in practice. Typed as nullable
   * to make the parent's conditional-render contract explicit.
   */
  centroid: CentroidContext | null;
  /** Active map kind filter. Forwarded to the RPC so the side-list
   *  shows the same subset the badge's count was derived from. */
  filterKinds?: CaseKind[] | null;
  onClose: () => void;
}

// Single snap point. 70% leaves the top of the map peeking through
// so the user keeps spatial context (the badge they tapped is still
// visible underneath when they look up). Below 70% the list is too
// short to be useful at 211 cases; above 80% the map disappears and
// the sheet might as well be a full-screen route.
const SNAP_POINTS = ['70%'] as const;

export function CentroidCasesSheet({
  centroid,
  filterKinds = null,
  onClose,
}: CentroidCasesSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const listRef = useRef<BottomSheetFlatListMethods>(null);

  // ─── Hooks declared first per the project rule (CLAUDE.md → "Hooks
  //     before early returns. No exceptions."). The optional-chain
  //     inside each hook lets centroid be null without skipping the
  //     hook on first render.

  const { data, loading, error, refetch } = useCasesAtCoordinate({
    lat: centroid?.lat ?? null,
    lng: centroid?.lng ?? null,
    kinds: filterKinds,
  });

  // Reset scroll on coord change so opening a new badge starts at
  // row 0 even if the previous tap-drill was scrolled deep.
  useEffect(() => {
    if (centroid && data.length > 0) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [centroid?.lat, centroid?.lng, data.length]);

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

  const headerLabel = useMemo(() => {
    if (!centroid) return '';
    if (centroid.label && centroid.label.trim().length > 0) {
      return centroid.label;
    }
    // Fallback when the cases at this coord don't share a clean
    // city/state (rare — cases_centroids_in_bbox returns null
    // locale_label only when cases mix locales). Mirrors the spec
    // copy in the task brief.
    return `${centroid.count} ${centroid.count === 1 ? 'case' : 'cases'} at this point`;
  }, [centroid]);

  // Sheet dismisses on pan-down (gorhom's enablePanDownToClose).
  // gorhom fires onClose via the `onChange` callback when the sheet
  // closes itself; we forward that to the parent so MapScreen can
  // clear its centroid state and unmount us.
  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  // ─── Hooks complete. Conditional render below is safe.

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
        actualCount={data.length}
        loading={loading}
        onClose={() => sheetRef.current?.close()}
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
          data={data}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 96 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            loading ? (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <ActivityIndicator
                  size="small"
                  color={tokens.color.accent.amber}
                />
              </View>
            ) : null
          }
        />
      )}
    </BottomSheet>
  );
}

/**
 * Header — serif locale label + mono count caption + close button.
 * `count` is the badge-derived total (server-derived). `actualCount`
 * is the side-list's own length post-fetch; we show "N of M" only
 * if a kind filter is reducing the visible count below the badge
 * total, otherwise the single number reads cleanly as the headline.
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
        hitSlop={12}
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
