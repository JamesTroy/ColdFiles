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

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/cf/empty-state';
import { ErrorState } from '@/components/cf/error-state';
import { LeafletMap, type LeafletMarker } from '@/components/cf/leaflet-map';
import {
  MapsView,
  type MapsMarker,
  isNativeMapAvailable,
} from '@/components/cf/maps-view';
import { PeekSheet } from '@/components/cf/peek-sheet';
import { FilterChip } from '@/components/cf/pill';
import { MonoLabel, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { kindLine } from '@/lib/format';
import { useCasesNear } from '@/lib/hooks/use-cases-near';
import { useHere } from '@/lib/hooks/use-here';
import { SAMPLE_LAST_CHANGED_DAYS } from '@/lib/sample-data';
import type { CaseKind, CaseRowMapNear } from '@/lib/types/database';

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

  // Closed-testing radius: 5000mi effectively returns all seeded cases for
  // any tester anywhere in the continental US. v1.0.0 ships ~50 alphabetical
  // cases nationwide (no LA-specific scraper yet); a small radius would show
  // empty for most testers because the seed isn't geographically dense.
  // Restore "cases near you" semantics in v1.0.1 once the LA-county scraper
  // and broader source coverage land.
  const {
    data: cases,
    loading,
    error,
    refetch,
    source,
  } = useCasesNear({
    lat: here.lat,
    lng: here.lng,
    radiusMiles: 5000,
    kinds: KIND_FILTER_TO_RPC[filter],
    limit: 200,
  });

  const allCount = cases.length;
  const selectedCase = cases.find((c) => c.slug === selectedSlug) ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      {/* Header */}
      <View
        style={{ paddingTop: insets.top + 6, paddingBottom: 12, paddingHorizontal: 16 }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <SerifTitle size="h2" style={{ fontSize: 22 }}>
                The Cold File
              </SerifTitle>
              {source === 'sample' ? <SampleTag /> : null}
            </View>
            <MonoLabel
              size={tokens.size.monoLabel}
              color={tokens.color.text.secondary}
              style={{ marginTop: 4 }}
            >
              {headerSubLabel(loading ? null : allCount)}
            </MonoLabel>
          </View>
          <SearchButton />
        </View>
      </View>

      {/* Filter chip row.
          flexGrow:0 + flexShrink:0 on the ScrollView itself is load-bearing —
          a horizontal <ScrollView> in a column-flex parent on Android Fabric
          will otherwise compete with the map View's flex:1 and steal roughly
          half the remaining vertical space (the chip row "thinks" it's a row
          axis to its content but a column-flex item to its parent). Forcing
          flex:0 on both axes makes it size to content (~36px), exactly what
          its visual contract requires. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
      >
        <FilterChip
          label="All"
          count={loading ? undefined : allCount}
          active={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        <FilterChip
          label="Homicide"
          active={filter === 'homicide'}
          onPress={() => setFilter('homicide')}
        />
        <FilterChip
          label="Missing"
          active={filter === 'missing'}
          onPress={() => setFilter('missing')}
        />
        <FilterChip
          label="Doe"
          active={filter === 'unidentified'}
          onPress={() => setFilter('unidentified')}
        />
      </ScrollView>

      {/* Map canvas — native MapLibre if/when re-enabled, WebView+Leaflet otherwise */}
      <View style={{ flex: 1 }}>
        {isNativeMapAvailable() ? (
          <NativeRenderer
            cases={cases}
            selectedSlug={selectedSlug}
            onMarkerPress={setSelectedSlug}
            here={here}
          />
        ) : (
          <LeafletRenderer
            cases={cases}
            selectedSlug={selectedSlug}
            onMarkerPress={setSelectedSlug}
            here={here}
          />
        )}
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
        {permissionStatus !== 'granted' ? (
          <LocationFAB onPress={() => void requestAndAcquire()} />
        ) : null}
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

      {selectedCase ? (
        <PeekSheet
          distanceMiles={selectedCase.distance_miles ?? 0}
          kindLine={kindLine(selectedCase)}
          victimName={peekDisplayName(selectedCase)}
          onOpen={() => router.push(`/case/${selectedCase.slug}`)}
          onDismiss={() => setSelectedSlug(null)}
        />
      ) : null}
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
  cases: CaseRowMapNear[];
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
  here,
}: {
  cases: CaseRowMapNear[];
  selectedSlug: string | null;
  onMarkerPress: (id: string) => void;
  here: { lat: number; lng: number; fresh: boolean };
}) {
  const markers: LeafletMarker[] = useMemo(() => {
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
    <LeafletMap
      center={{
        lat: here.lat,
        lng: here.lng,
        zoomLevel: tokens.map.defaultCenter.zoomLevel,
      }}
      markers={markers}
      here={{ lat: here.lat, lng: here.lng, fresh: here.fresh }}
      onMarkerPress={onMarkerPress}
    />
  );
}

/* ---------------- floating affordances ---------------- */

/**
 * "Use my location" floating button — appears when the user hasn't granted
 * location yet. Tapping prompts the system permission dialog (with the
 * usage description from app.config.ts as the rationale). On grant, the
 * map recenters and the YouAreHere dot starts pulsing for 30s.
 */
function LocationFAB({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Use my location"
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [
        {
          position: 'absolute',
          right: 16,
          bottom: 16,
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
      <Ionicons name="locate-outline" size={20} color={tokens.color.you.here} />
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

function peekDisplayName(c: CaseRowMapNear): string {
  if (c.victim_name) return c.victim_name;
  if (c.kind === 'unidentified' || c.kind === 'unclaimed') return 'Unidentified';
  return 'Name not released';
}

/**
 * Sub-header copy. Drops a locality string entirely — `useHere` doesn't
 * reverse-geocode, and a hardcoded "VENTURA" lies for any reviewer or
 * tester outside that metro. Radius is also dropped for v1.0.0: the
 * map effectively shows all seeded cases (5000mi radius covers the
 * continental US from any starting point), so showing "5000mi" would
 * be misleading. v1.0.1 reintroduces locality + radius once the
 * LA-county scraper densifies the seed.
 */
function headerSubLabel(count: number | null): string {
  if (count == null) return 'LOADING';
  return `${count.toLocaleString()} ${count === 1 ? 'CASE' : 'CASES'} NATIONWIDE`;
}
