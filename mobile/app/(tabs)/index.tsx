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
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

  const {
    data: cases,
    loading,
    source,
  } = useCasesNear({
    lat: tokens.map.defaultCenter.lat,
    lng: tokens.map.defaultCenter.lng,
    radiusMiles: 25,
    kinds: KIND_FILTER_TO_RPC[filter],
    limit: 100,
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
              color={tokens.color.evidence.chrome}
              style={{ marginTop: 4 }}
            >
              VENTURA · 25mi RADIUS
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
          />
        ) : (
          <LeafletRenderer
            cases={cases}
            selectedSlug={selectedSlug}
            onMarkerPress={setSelectedSlug}
          />
        )}
      </View>

      {selectedCase ? (
        <PeekSheet
          distanceMiles={selectedCase.distance_miles ?? 0}
          kindLine={kindLine(selectedCase)}
          victimName={peekDisplayName(selectedCase)}
          onOpen={() => router.push(`/case/${selectedCase.slug}`)}
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
}: {
  cases: CaseRowMapNear[];
  selectedSlug: string | null;
  onMarkerPress: (id: string) => void;
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
        lat: tokens.map.defaultCenter.lat,
        lng: tokens.map.defaultCenter.lng,
        zoomLevel: tokens.map.defaultCenter.zoomLevel,
      }}
      markers={markers}
      here={{ lat: tokens.map.defaultCenter.lat, lng: tokens.map.defaultCenter.lng }}
      onMarkerPress={onMarkerPress}
    />
  );
}

function LeafletRenderer({
  cases,
  selectedSlug,
  onMarkerPress,
}: {
  cases: CaseRowMapNear[];
  selectedSlug: string | null;
  onMarkerPress: (id: string) => void;
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
        lat: tokens.map.defaultCenter.lat,
        lng: tokens.map.defaultCenter.lng,
        zoomLevel: tokens.map.defaultCenter.zoomLevel,
      }}
      markers={markers}
      // Placeholder default-center until expo-location is wired. fresh:false so
      // the static dot doesn't lie about live tracking. Flip to fresh:true (and
      // set up a 30s freshness timer) once a real GPS fix is available.
      here={{
        lat: tokens.map.defaultCenter.lat,
        lng: tokens.map.defaultCenter.lng,
        fresh: false,
      }}
      onMarkerPress={onMarkerPress}
    />
  );
}

/* ---------------- header bits ---------------- */

function SearchButton() {
  return (
    <Pressable
      onPress={() => {}}
      style={({ pressed }) => [
        {
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name="search" size={16} color={tokens.color.text.primary} />
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
      <MonoLabel size={9} tracking={0.12} color={tokens.color.evidence.chrome}>
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
