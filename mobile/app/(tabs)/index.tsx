/**
 * Map tab — the home screen.
 *
 * Wired to useCasesNear() against the cases_within_radius() RPC. Marker xy
 * positions are driven by SAMPLE_MAP_COORDS in designer mode; in live mode
 * (Mapbox lands behind the same MapCanvas contract in Week 5b) real lat/lng
 * replaces this. Pin kind, selection state, and recently-updated rings are
 * all real from the data.
 *
 * Layout per docs/04_DESIGN_SYSTEM.md "Map & clustering" + the prototype:
 *   - Header: app name (serif) + locality / radius mono-cap line + search btn
 *   - Filter chip row: All · {count}  Homicide  Missing  Doe
 *   - Map canvas — full-bleed, with case-kind shape encoding
 *   - Peek sheet — slides up on pin tap
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapCanvas, type MapMarker } from '@/components/cf/map-canvas';
import { PeekSheet } from '@/components/cf/peek-sheet';
import { FilterChip } from '@/components/cf/pill';
import { MonoLabel, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { kindLine } from '@/lib/format';
import { useCasesNear } from '@/lib/hooks/use-cases-near';
import { SAMPLE_LAST_CHANGED_DAYS, SAMPLE_MAP_COORDS } from '@/lib/sample-data';
import type { CaseKind, CaseRowMapNear } from '@/lib/types/database';

type Filter = 'all' | 'homicide' | 'missing' | 'unidentified';

// Default map center — Ventura, CA. Will become user location when permission UX lands.
const DEFAULT_LAT = 34.275;
const DEFAULT_LNG = -119.229;

const KIND_FILTER_TO_RPC: Record<Filter, CaseKind[] | null> = {
  all: null,
  homicide: ['homicide', 'suspicious_death'],
  missing: ['missing'],
  unidentified: ['unidentified', 'unclaimed'],
};

/**
 * Deterministic [0..1] x/y from a slug — used in live mode where we don't yet
 * have real lat/lng to project. Removed when Mapbox markers replace it.
 */
function hashedPosition(slug: string): { x: number; y: number } {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  const x = 0.1 + ((Math.abs(hash) % 1000) / 1000) * 0.8;
  const y = 0.15 + ((Math.abs(hash >> 7) % 1000) / 1000) * 0.65;
  return { x, y };
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
    lat: DEFAULT_LAT,
    lng: DEFAULT_LNG,
    radiusMiles: 25,
    kinds: KIND_FILTER_TO_RPC[filter],
    limit: 100,
  });

  const allCount = cases.length;

  const markers: MapMarker[] = useMemo(() => {
    return cases.map((c) => {
      const sampleCoord = SAMPLE_MAP_COORDS[c.slug];
      const pos = sampleCoord ?? hashedPosition(c.slug);
      const recentDays = SAMPLE_LAST_CHANGED_DAYS[c.slug] ?? null;
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

      {/* Map canvas */}
      <View style={{ flex: 1 }}>
        <MapCanvas
          height={420}
          markers={markers}
          here={{ x: 0.5, y: 0.52 }}
          onMarkerPress={(id) => setSelectedSlug(id)}
        />
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
