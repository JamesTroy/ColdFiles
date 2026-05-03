/**
 * Map tab — the home screen.
 *
 * Renders the real Mapbox basemap when EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is set,
 * falls back to the SVG MapCanvas placeholder when it isn't (designer mode
 * with no Mapbox account). The pin grammar (Pin component) is shared between
 * both renderers so the visual contract is identical.
 *
 * Layout (matches prototype):
 *   - Header: app name (serif) + locality / radius mono-cap line + search btn
 *   - Filter chip row: All · {count}  Homicide  Missing  Doe
 *   - Map canvas — Mapbox or SVG
 *   - Peek sheet — slides up on pin tap
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/cf/empty-state';
import { ErrorState } from '@/components/cf/error-state';
import { LeafletMap, type LeafletMarker } from '@/components/cf/leaflet-map';
import {
  MapBottomSheet,
  type MapBottomSheetHandle,
} from '@/components/cf/map-bottom-sheet';
import {
  MapsView,
  type MapsMarker,
  isNativeMapAvailable,
} from '@/components/cf/maps-view';
import { FilterChip } from '@/components/cf/pill';
import { MonoLabel, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { useCaseCount } from '@/lib/hooks/use-case-count';
import { useCasesInBbox, type CaseBounds } from '@/lib/hooks/use-cases-in-bbox';
import { useHere } from '@/lib/hooks/use-here';
import { useWatchZones } from '@/lib/hooks/use-watch-zones';
import { SAMPLE_LAST_CHANGED_DAYS } from '@/lib/sample-data';
import type { CaseKind, CaseRowMapBbox } from '@/lib/types/database';

const ZONE_SOFT_CAP = 25;
const ZONES_VISIBLE_KEY = 'cf:zones_visible:v1';

type Filter = 'all' | 'homicide' | 'missing' | 'unidentified';

const KIND_FILTER_TO_RPC: Record<Filter, CaseKind[] | null> = {
  all: null,
  homicide: ['homicide', 'suspicious_death'],
  missing: ['missing'],
  unidentified: ['unidentified', 'unclaimed'],
};

/** Stepwise recency_alpha → representative day count for the Pin renderer. */
function alphaToDays(alpha: number): number | null {
  if (alpha >= 0.99) return 1;
  if (alpha >= 0.49) return 7;
  return null;
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const { here, permissionStatus, requestAndAcquire } = useHere();
  const { zones } = useWatchZones();
  const sheetRef = useRef<MapBottomSheetHandle>(null);
  const [zonesVisible, setZonesVisible] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(ZONES_VISIBLE_KEY).then((v) => {
      if (v === 'false') setZonesVisible(false);
    });
  }, []);

  const toggleZonesVisible = useCallback(() => {
    setZonesVisible((prev) => {
      const next = !prev;
      AsyncStorage.setItem(ZONES_VISIBLE_KEY, next ? 'true' : 'false').catch(() => {});
      return next;
    });
  }, []);

  const zoneOverlays = useMemo(
    () =>
      zones
        .filter((z) => z.geojson?.type === 'Polygon')
        .map((z) => ({
          id: z.id,
          // The hook types this as the JSONB shape we get back; cast through
          // unknown because the runtime check above guarantees the discriminant.
          geojson: z.geojson as unknown as {
            type: 'Polygon';
            coordinates: [number, number][][];
          },
          label: z.label,
        })),
    [zones],
  );
  // Shared value the bottom sheet writes its progress into:
  //   0 = minimized (handle only)
  //   1 = peek      (count + WATCH chip)
  //   2 = mid       (list at 45%)
  //   3 = full      (list at 92%)
  // The header animations key off the peek-to-mid range (1 → 2) since
  // that's where the visual real estate competition starts. Below peek
  // (0 → 1) the user has explicitly hidden the sheet, so the header
  // stays in its full visible state.
  const sheetIndex = useSharedValue(1);

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetIndex.value, [1, 1.6], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(
          sheetIndex.value,
          [1, 2],
          [0, -16],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetIndex.value, [1, 1.4], [1, 0], Extrapolation.CLAMP),
    height: interpolate(sheetIndex.value, [1, 2], [16, 0], Extrapolation.CLAMP),
  }));

  const headerStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(
      sheetIndex.value,
      [1, 2],
      [12, 4],
      Extrapolation.CLAMP,
    ),
  }));

  // Pin tap = "narrow scope to one case." Browse-the-list and single-case
  // detail are two distinct UIs and they don't overlap. We swap the entire
  // bottom UI: when selectedSlug is set, the persistent MapBottomSheet
  // unmounts and the PeekSheet (single-case dismissible card) takes over.
  // Tap X to dismiss → MapBottomSheet remounts at peek for browse.
  //
  // Earlier attempts kept the bottom sheet rendered with empty data + snap
  // to peek, but the persistent sheet's mere presence read as "the list is
  // still there, just hiding." Conditional render is the unambiguous fix.
  const handleMarkerPress = useCallback((id: string) => {
    setSelectedSlug(id);
  }, []);

  const handleClearSelection = useCallback(() => setSelectedSlug(null), []);

  // Stepwise recency_alpha → days, mirroring use across the list tab.
  const daysFor = useCallback((c: CaseRowMapBbox) => {
    if (c.recency_alpha != null) {
      if (c.recency_alpha >= 0.99) return 1;
      if (c.recency_alpha >= 0.49) return 7;
    }
    return SAMPLE_LAST_CHANGED_DAYS[c.slug] ?? 999;
  }, []);

  // Viewport-bounded query: as the user pans/zooms the map, onRegionChange
  // fires and we re-query the cases_in_bbox RPC for up to 100 cases inside
  // the new viewport. The 5000mi-radius "show everything" pattern was a
  // closed-testing crutch that's no longer needed now that the corpus is
  // geographically dense (Doe + Charley + PCC across all 50 states).
  //
  // Query unfiltered so chip counts can preview selectivity (spec §3.5 —
  // show counts on every chip, not just the active one). The kind filter
  // is applied client-side from the same result set; the RPC caps at 100
  // and the kind set is closed (4 values), so the per-render cost is
  // negligible.
  //
  // Initial-frame note: bounds is null on the very first paint (Leaflet
  // hasn't reported its initial region yet). The hook holds the previous
  // (empty) data + loading=false until the WebView's first onRegionChange
  // lands. LeafletMap explicitly posts an initial `region` message right
  // before `ready` (Leaflet doesn't fire moveend for the L.map()
  // constructor's center/zoom), so the null-bounds window is one render.
  // Two layers of bbox state:
  //   visibleBounds: what Leaflet just reported as the viewport
  //   fetchBounds:   the bbox we passed to the RPC; deliberately wider
  //                  than visibleBounds so small pans don't trigger a
  //                  refetch every time. Updated only when visibleBounds
  //                  drifts outside the current fetchBounds.
  const [fetchBounds, setFetchBounds] = useState<CaseBounds | null>(null);
  const fetchBoundsRef = useRef<CaseBounds | null>(null);

  const handleRegionChange = useCallback((nextVisible: CaseBounds) => {
    const current = fetchBoundsRef.current;
    // First report — or new visible bbox extends outside the cached
    // fetch bbox. Re-fetch with an expanded version so subsequent pans
    // within the buffer don't re-fire the RPC.
    const insideCurrent =
      !!current &&
      nextVisible.minLng >= current.minLng &&
      nextVisible.minLat >= current.minLat &&
      nextVisible.maxLng <= current.maxLng &&
      nextVisible.maxLat <= current.maxLat;
    if (insideCurrent) return;

    // Expand by 50% on each axis around the visible bbox center. With
    // result_limit:100, the RPC cap absorbs the extra area; if a region
    // truly has more than 100 cases inside the expanded bbox, the user
    // will see <100 returned (already true today, the cap was 100).
    const dLng = nextVisible.maxLng - nextVisible.minLng;
    const dLat = nextVisible.maxLat - nextVisible.minLat;
    const expanded: CaseBounds = {
      minLng: nextVisible.minLng - dLng * 0.5,
      minLat: nextVisible.minLat - dLat * 0.5,
      maxLng: nextVisible.maxLng + dLng * 0.5,
      maxLat: nextVisible.maxLat + dLat * 0.5,
    };
    fetchBoundsRef.current = expanded;
    setFetchBounds(expanded);
  }, []);

  const {
    data: casesAll,
    loading,
    error,
    refetch,
    source,
  } = useCasesInBbox({
    bounds: fetchBounds,
    kinds: null,
    // Limit set well above the active corpus so a continental-zoom
    // bbox returns every case, never silently clipping the
    // longest-cold rows off the bottom of ORDER BY last_changed_at
    // DESC NULLS LAST. With the doe_uid rescrape the corpus crossed
    // ~3,800 active cases (vs the ~3,100 baseline) and 3,500 was
    // visibly clipping. 6,000 headroom covers the next two scrape
    // cycles at the current growth pace.
    //
    // Performance: at low zoom this returns the full corpus, which
    // leaflet-markercluster handles fine via chunkedLoading. The
    // index on cases(last_changed_at DESC NULLS LAST) WHERE
    // deleted_at IS NULL (migration 23) keeps the ORDER BY + LIMIT
    // path index-walked, so RPC time scales with limit not with
    // corpus size.
    //
    // Long-term: this is a stopgap. The proper answer is server-
    // side aggregation — return cluster centroids at low zoom,
    // individual rows at high zoom — instead of shipping the entire
    // corpus to the client and clustering there. Queue once corpus
    // growth makes the per-call payload meaningful (~10k+).
    limit: 6000,
  });

  // Headline corpus-size stat for the bottom-sheet header. Cached at
  // module scope inside the hook (5min TTL) so this is a no-op on
  // re-renders. See feedback_ingest_metric_axis memory note for why
  // total-cases is the right headline metric (steady-state inflow is
  // mostly merge-into-existing, not net-new — a velocity headline would
  // false-zero on a healthy day).
  const { total: totalCount } = useCaseCount();

  const counts = useMemo(() => {
    const c = { all: casesAll.length, homicide: 0, missing: 0, unidentified: 0 };
    for (const row of casesAll) {
      if (row.kind === 'homicide' || row.kind === 'suspicious_death') c.homicide += 1;
      else if (row.kind === 'missing') c.missing += 1;
      else if (row.kind === 'unidentified' || row.kind === 'unclaimed') c.unidentified += 1;
    }
    return c;
  }, [casesAll]);

  const cases = useMemo(() => {
    const allowed = KIND_FILTER_TO_RPC[filter];
    if (!allowed) return casesAll;
    return casesAll.filter((c) => allowed.includes(c.kind));
  }, [casesAll, filter]);

  const allCount = casesAll.length;

  // If the previously-selected pin disappears from the filtered set (e.g.
  // user toggled away from "all"), drop the selection so the sheet header
  // doesn't render a phantom case.
  useEffect(() => {
    if (selectedSlug && !cases.some((c) => c.slug === selectedSlug)) {
      setSelectedSlug(null);
    }
  }, [cases, selectedSlug]);

  // If the active filter belongs to a kind that just dropped to zero (data
  // refresh removed all of those cases), snap the filter back to "all" so
  // the user isn't stranded on a chip that's about to be hidden.
  useEffect(() => {
    if (loading) return;
    if (filter === 'homicide' && counts.homicide === 0) setFilter('all');
    else if (filter === 'missing' && counts.missing === 0) setFilter('all');
    else if (filter === 'unidentified' && counts.unidentified === 0) setFilter('all');
  }, [loading, counts, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      {/* Header — collapses on bottom-sheet drag. The wordmark fades + slides up,
          the subtitle's height drops to zero so the chip row rises to a 56dp
          compact bar, leaving more vertical map. */}
      <Animated.View
        style={[
          { paddingTop: insets.top + 6, paddingHorizontal: 16 },
          headerStyle,
        ]}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <View style={{ flex: 1 }}>
            <Animated.View
              style={[
                { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' },
                wordmarkStyle,
              ]}
            >
              {/* numberOfLines:1 + adjustsFontSizeToFit prevents Android Text
                  in a flexDirection:'row' parent from silently visually
                  clipping the trailing word when its measured width exceeds
                  the available row space — the prior brand "The Cold File"
                  fit; "The Cold Files" with the SearchButton sibling and
                  varying inset widths can clip to "The Cold" on some
                  device-width / font-scale combinations. */}
              <SerifTitle
                size="h2"
                style={{ fontSize: 22, flexShrink: 1 }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                The Cold Files
              </SerifTitle>
              {source === 'sample' ? <SampleTag /> : null}
            </Animated.View>
            <Animated.View style={[{ overflow: 'hidden' }, subtitleStyle]}>
              <MonoLabel
                size={tokens.size.monoLabel}
                color={tokens.color.text.secondary}
                style={{ marginTop: 4 }}
              >
                {headerSubLabel(loading ? null : allCount)}
              </MonoLabel>
            </Animated.View>
          </View>
          <SearchButton />
        </View>
      </Animated.View>

      {/* Filter chip row.
          flexGrow:0 + flexShrink:0 on the ScrollView itself is load-bearing —
          a horizontal <ScrollView> in a column-flex parent on Android Fabric
          will otherwise compete with the map View's flex:1 and steal roughly
          half the remaining vertical space (the chip row "thinks" it's a row
          axis to its content but a column-flex item to its parent). Forcing
          flex:0 on both axes makes it size to content (~36px), exactly what
          its visual contract requires. */}
      {/* Filter chips. Zero-count kinds are hidden once data lands so the
          row reads as "what's actually in the dataset" rather than "every
          axis we could theoretically filter on." During loading we render
          the full row to avoid a chip-flicker as counts settle.
          The "All" chip is unconditional — it's the reset action, not just
          a filter. Even when counts.all is 0 (rare but possible at deep
          map zoom into an empty area), keeping All visible means the user
          isn't stranded on a hidden filter with no way back to the wider
          view. Don't wrap this in a conditional. */}
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

      {/* Map canvas — native MapLibre if/when re-enabled, WebView+Leaflet otherwise */}
      <View style={{ flex: 1 }}>
        {isNativeMapAvailable() ? (
          <NativeRenderer
            cases={cases}
            selectedSlug={selectedSlug}
            onMarkerPress={handleMarkerPress}
            here={here}
          />
        ) : (
          <LeafletRenderer
            cases={cases}
            selectedSlug={selectedSlug}
            onMarkerPress={handleMarkerPress}
            onMarkerOpen={(slug) => router.push({ pathname: '/case/[slug]', params: { slug } })}
            here={here}
            zones={zoneOverlays}
            zonesVisible={zonesVisible}
            onRegionChange={handleRegionChange}
          />
        )}
        {zoneOverlays.length > 0 ? (
          <LayerToggleButton
            visible={zonesVisible}
            onPress={toggleZonesVisible}
          />
        ) : null}
        {error && cases.length === 0 ? (
          // ErrorState is built as a flex:1 fill (used full-page on
          // case-detail). Wrap absolutely so it overlays the map renderer
          // instead of stacking below it.
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: tokens.color.bg.base,
            }}
          >
            <ErrorState
              title="Couldn't load cases."
              detail={error.message}
              onRetry={refetch}
            />
          </View>
        ) : !loading && cases.length === 0 ? (
          <EmptyState
            variant={filter === 'all' ? 'no-cases-in-region' : 'no-matches'}
          />
        ) : null}
        {/* The FAB serves two roles. Before the user has granted location it
            prompts; after grant it acts as "recenter on me" — calling
            requestAndAcquire() acquires a fresh fix which flips here.fresh
            to true for 30s, and LeafletMap's auto-pan effect treats that
            rising edge as an explicit user-requested recenter (bypassing
            the >5km move threshold). Useful when the user has scrolled
            away from their dot, or when the auto-pan didn't catch a
            cross-city move. */}
        <LocationFAB
          mode={permissionStatus === 'granted' ? 'recenter' : 'request'}
          onPress={() => void requestAndAcquire()}
        />
        {loading && cases.length > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: 12,
              alignSelf: 'center',
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 12,
              backgroundColor: 'rgba(10, 10, 10, 0.85)',
              borderWidth: 0.5,
              borderColor: tokens.color.border.strong,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <ActivityIndicator size="small" color={tokens.color.accent.amber} />
            <MonoLabel
              size={tokens.size.monoCaption}
              tracking={tokens.tracking.chip}
              color={tokens.color.text.secondary}
            >
              UPDATING
            </MonoLabel>
          </View>
        ) : null}
      </View>

      {/* Bottom-sheet shows the cases list always. The previously-shown
          PeekSheet (when a pin was selected) is now replaced by the
          in-map case-file popup that opens directly above the tapped
          pin — the bottom-sheet stays put as the cases list browser
          regardless of selection state. */}
      <MapBottomSheet
        ref={sheetRef}
        cases={cases}
        totalCount={totalCount}
        selectedSlug={selectedSlug}
        daysFor={daysFor}
        animatedIndex={sheetIndex}
        onWatchHere={() => router.push('/watch-zone')}
        watchHereDisabled={zones.length >= ZONE_SOFT_CAP}
      />
    </View>
  );
}

/* ---------------- renderers ---------------- */

function NativeRenderer({
  cases,
  selectedSlug,
  onMarkerPress,
  here,
}: {
  cases: CaseRowMapBbox[];
  selectedSlug: string | null;
  onMarkerPress: (id: string) => void;
  here: { lat: number; lng: number; fresh: boolean };
}) {
  const markers: MapsMarker[] = useMemo(() => {
    return cases
      .filter((c) => c.lat != null && c.lng != null)
      .map((c) => ({
        id: c.slug,
        lat: c.lat as number,
        lng: c.lng as number,
        kind: c.kind,
        selected: c.slug === selectedSlug,
        recentDays:
          c.recency_alpha != null
            ? alphaToDays(c.recency_alpha)
            : (SAMPLE_LAST_CHANGED_DAYS[c.slug] ?? null),
      }));
  }, [cases, selectedSlug]);

  return (
    <MapsView
      center={{
        lat: here.lat,
        lng: here.lng,
        zoomLevel: tokens.map.defaultCenter.zoomLevel,
      }}
      markers={markers}
      here={{ lat: here.lat, lng: here.lng }}
      onMarkerPress={onMarkerPress}
    />
  );
}

function LeafletRenderer({
  cases,
  selectedSlug,
  onMarkerPress,
  onMarkerOpen,
  here,
  zones,
  zonesVisible,
  onRegionChange,
}: {
  cases: CaseRowMapBbox[];
  selectedSlug: string | null;
  onMarkerPress: (id: string) => void;
  onMarkerOpen?: (id: string) => void;
  here: { lat: number; lng: number; fresh: boolean };
  zones: { id: string; geojson: { type: 'Polygon'; coordinates: [number, number][][] }; label: string | null }[];
  zonesVisible: boolean;
  onRegionChange?: (bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number }) => void;
}) {
  const markers: LeafletMarker[] = useMemo(() => {
    // Many cases land on the same fallback coordinate (city centroid,
    // county centroid, etc.) when the source didn't carry precise
    // location data. Stacks at the same lat/lng force markercluster
    // into spiderfy mode, which spirals pins around the cluster center
    // — visually dramatic, often unstable, and the "0.0 miles" sub-
    // label reads like a bug. Detect groups of coincident pins and
    // apply a small deterministic jitter so pins render at distinct
    // positions without the spiderfy. ~0.0008° ≈ 90 meters at typical
    // mid-latitudes — visible at zoom 14+ as separate pins, invisible
    // at low zoom.
    const filtered = cases.filter((c) => c.lat != null && c.lng != null);
    const groups = new Map<string, typeof filtered>();
    for (const c of filtered) {
      const k = `${(c.lat as number).toFixed(5)}|${(c.lng as number).toFixed(5)}`;
      const arr = groups.get(k);
      if (arr) arr.push(c);
      else groups.set(k, [c]);
    }
    return filtered.map((c) => {
      const k = `${(c.lat as number).toFixed(5)}|${(c.lng as number).toFixed(5)}`;
      const group = groups.get(k);
      let lat = c.lat as number;
      let lng = c.lng as number;
      if (group && group.length > 1) {
        const idx = group.findIndex((g) => g.slug === c.slug);
        if (idx > 0) {
          // Spread on a ring around the shared point. ~330m radius
          // (0.003°) so adjacent pins are ~330-660m apart depending
          // on group size. At zoom 13+ this puts pins well outside
          // markercluster's 30px radius (combined with the dropped
          // maxClusterRadius below), so the cluster never forms in
          // the first place — no spiderfy, no spiral, no snap-back.
          // Deterministic by group index so a case always lands at
          // the same offset across renders.
          const angle = (idx / group.length) * Math.PI * 2;
          lat += Math.cos(angle) * 0.003;
          lng += Math.sin(angle) * 0.003;
        }
      }
      // Popup preview content. Title = victim name (or "Unidentified
      // person" for Doe cases that genuinely have no name), meta = kind
      // label · year · state. Kept terse so it fits comfortably in the
      // popup card width without truncation. Real wraps happen on the
      // case-detail screen.
      const titlePreview =
        c.victim_name ??
        ((c.kind === 'unidentified' || c.kind === 'unclaimed')
          ? 'Unidentified person'
          : 'Name not released');
      const yearPreview = c.incident_date
        ? c.incident_date.slice(0, 4)
        : null;
      const kindLabel =
        c.kind === 'homicide' || c.kind === 'suspicious_death'
          ? 'Homicide'
          : c.kind === 'missing'
          ? 'Missing'
          : 'Unidentified';
      const metaPreview = [kindLabel, yearPreview, c.location_state]
        .filter(Boolean)
        .join(' · ');
      return {
        id: c.slug,
        lat,
        lng,
        kind: c.kind,
        selected: c.slug === selectedSlug,
        recentDays:
          c.recency_alpha != null
            ? alphaToDays(c.recency_alpha)
            : (SAMPLE_LAST_CHANGED_DAYS[c.slug] ?? null),
        popup: {
          title: titlePreview,
          meta: metaPreview,
        },
      };
    });
  }, [cases, selectedSlug]);

  return (
    <LeafletMap
      center={{
        lat: here.lat,
        lng: here.lng,
        zoomLevel: tokens.map.defaultCenter.zoomLevel,
      }}
      markers={markers}
      here={{ lat: here.lat, lng: here.lng, fresh: here.fresh }}
      zones={zones}
      zonesVisible={zonesVisible}
      onMarkerPress={onMarkerPress}
      onMarkerOpen={onMarkerOpen}
      onRegionChange={onRegionChange}
    />
  );
}

/**
 * Layer-toggle for the right-edge stack (spec §7). The "Z" glyph maps to
 * watch-zone visibility; "on" = zones overlaid on the map, "off" = hidden.
 * Persisted preference. Only renders when the user has zones — no point
 * cluttering the screen with a control that does nothing.
 */
function LayerToggleButton({
  visible,
  onPress,
}: {
  visible: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={visible ? 'Hide watch zones' : 'Show watch zones'}
      accessibilityState={{ selected: visible }}
      hitSlop={6}
      style={({ pressed }) => [
        {
          position: 'absolute',
          right: 16,
          top: 12,
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: visible ? tokens.color.bg.amberTintCard : tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: visible ? tokens.color.accent.amber : tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 1 },
          elevation: 4,
        },
      ]}
    >
      <MonoLabel
        size={14}
        tracking={0}
        color={visible ? tokens.color.accent.amber : tokens.color.text.secondary}
      >
        Z
      </MonoLabel>
    </Pressable>
  );
}

/* ---------------- floating affordances ---------------- */

/**
 * Floating button — two modes:
 *   - 'request': user hasn't granted location yet. Tap → system prompt.
 *   - 'recenter': user is granted. Tap → fresh fix + map auto-pans to it
 *     (the LeafletMap effect treats here.fresh true→ as a recenter signal).
 * Visual cue: filled locate icon for recenter, outline for request.
 */
function LocationFAB({
  onPress,
  mode,
}: {
  onPress: () => void;
  mode: 'request' | 'recenter';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={mode === 'recenter' ? 'Recenter on my location' : 'Use my location'}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [
        {
          position: 'absolute',
          right: 16,
          // 96 = MapBottomSheet's peek snap height (see SNAP_POINTS in
          // map-bottom-sheet.tsx). The original 16px sat behind that
          // peek and was effectively invisible whenever the user had
          // already granted location. 112 = peek + 16 breathing room.
          bottom: 112,
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 1 },
          elevation: 4,
        },
      ]}
    >
      <Ionicons
        name={mode === 'recenter' ? 'locate' : 'locate-outline'}
        size={20}
        color={tokens.color.you.here}
      />
    </Pressable>
  );
}

/* ---------------- header bits ---------------- */

function SearchButton() {
  return (
    <Pressable
      onPress={() => router.push('/search')}
      accessibilityLabel="Search cases"
      accessibilityRole="button"
      hitSlop={12}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name="search" size={18} color={tokens.color.text.primary} />
    </Pressable>
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


function headerSubLabel(count: number | null): string {
  if (count == null) return 'LOADING';
  return `${count.toLocaleString()} ${count === 1 ? 'CASE' : 'CASES'} NATIONWIDE`;
}
