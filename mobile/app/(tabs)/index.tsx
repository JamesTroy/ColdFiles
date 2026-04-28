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

import { MapCanvas, type MapMarker } from '@/components/cf/map-canvas';
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
import { SAMPLE_LAST_CHANGED_DAYS, SAMPLE_MAP_COORDS } from '@/lib/sample-data';
import type { CaseKind, CaseRowMapNear } from '@/lib/types/database';

type Filter = 'all' | 'homicide' | 'missing' | 'unidentified';

const KIND_FILTER_TO_RPC: Record<Filter, CaseKind[] | null> = {
  all: null,
  homicide: ['homicide', 'suspicious_death'],
  missing: ['missing'],
  unidentified: ['unidentified', 'unclaimed'],
};

const useNativeMap = isNativeMapAvailable();

/** SVG-fallback hashed position when no real lat/lng. Removed once Mapbox is the only path. */
function hashedPosition(slug: string): { x: number; y: number } {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  const x = 0.1 + ((Math.abs(hash) % 1000) / 1000) * 0.8;
  const y = 0.15 + ((Math.abs(hash >> 7) % 1000) / 1000) * 0.65;
  return { x, y };
}

/** SVG fallback only: stepwise alpha → representative day count for the Pin renderer. */
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

      {/* Filter chip row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
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

      {/* Map canvas — native map if configured, SVG fallback otherwise */}
      <View style={{ flex: 1 }}>
        {useNativeMap ? (
          <NativeRenderer
            cases={cases}
            selectedSlug={selectedSlug}
            onMarkerPress={setSelectedSlug}
          />
        ) : (
          <SvgRenderer
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

function SvgRenderer({
  cases,
  selectedSlug,
  onMarkerPress,
}: {
  cases: CaseRowMapNear[];
  selectedSlug: string | null;
  onMarkerPress: (id: string) => void;
}) {
  const markers: MapMarker[] = useMemo(() => {
    return cases.map((c) => {
      const sampleCoord = SAMPLE_MAP_COORDS[c.slug];
      const pos = sampleCoord ?? hashedPosition(c.slug);
      const recentDays =
        c.recency_alpha != null
          ? alphaToDays(c.recency_alpha)
          : (SAMPLE_LAST_CHANGED_DAYS[c.slug] ?? null);
      return {
        id: c.slug,
        x: pos.x,
        y: pos.y,
        kind: c.kind,
        selected: c.slug === selectedSlug,
        recentDays,
      };
    });
  }, [cases, selectedSlug]);

  return (
    <MapCanvas
      height={420}
      markers={markers}
      here={{ x: 0.5, y: 0.52 }}
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
