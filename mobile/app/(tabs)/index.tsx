/**
 * Map tab — the home screen.
 *
 * Wired to useCasesNear() against the cases_within_radius() RPC. Marker xy
 * positions are deterministic hashes of the case slug while we wait on the
 * real Mapbox native integration (Week 5b) — pin kind, selection state, and
 * recently-updated rings are all real from the data; only the spatial layout
 * is a placeholder. When Mapbox lands, MapCanvas swaps to real coordinates
 * behind the same component contract.
 *
 * Layout per docs/04_DESIGN_SYSTEM.md "Map & clustering":
 *   - Header: app name (serif) + locality / radius mono-cap line
 *   - Filter chip row: All · {count}  Homicide  Missing  Doe
 *   - Map canvas — full-bleed, with case-kind shape encoding
 *   - Peek sheet — slides up on pin tap
 */

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapCanvas, type MapMarker } from '@/components/cf/map-canvas';
import { PeekSheet } from '@/components/cf/peek-sheet';
import { FilterChip } from '@/components/cf/pill';
import { MonoLabel, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { kindLine } from '@/lib/format';
import { useCasesNear } from '@/lib/hooks/use-cases-near';
import type { CaseKind, CaseRowMapNear } from '@/lib/types/database';

type Filter = 'all' | 'homicide' | 'missing' | 'unidentified';

// Default map center — Ventura, CA. Will become user location when permission UX lands.
const DEFAULT_LAT = 34.275;
const DEFAULT_LNG = -119.229;

/**
 * Deterministic [0..1] x/y from a slug. Stable across renders; visually
 * scattered. Removed the moment Mapbox markers replace this.
 */
function placeholderPosition(slug: string): { x: number; y: number } {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  // Two independent dimensions out of one hash, biased away from screen edges.
  const x = 0.1 + ((Math.abs(hash) % 1000) / 1000) * 0.8;
  const y = 0.15 + ((Math.abs(hash >> 7) % 1000) / 1000) * 0.65;
  return { x, y };
}

const KIND_FILTER_TO_RPC: Record<Filter, CaseKind[] | null> = {
  all: null,
  homicide: ['homicide', 'suspicious_death'],
  missing: ['missing'],
  unidentified: ['unidentified', 'unclaimed'],
};

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
      const pos = placeholderPosition(c.slug);
      return {
        id: c.slug,
        x: pos.x,
        y: pos.y,
        kind: pinKindFor(c.kind),
        selected: c.slug === selectedSlug,
        // recentDays: derive from last_changed_at when the RPC carries it (it doesn't yet).
        recentDays: null,
      };
    });
  }, [cases, selectedSlug]);

  const selectedCase = cases.find((c) => c.slug === selectedSlug) ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 6, paddingBottom: 12, paddingHorizontal: 16 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View>
            <SerifTitle size="h2" style={{ fontSize: 19 }}>
              The Cold File
            </SerifTitle>
            <MonoLabel size={tokens.size.monoLabel} style={{ marginTop: 2 }}>
              {`VENTURA · 25mi RADIUS${source === 'sample' ? ' · SAMPLE DATA' : ''}`}
            </MonoLabel>
          </View>
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
          here={{ x: 0.59, y: 0.78 }}
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

function pinKindFor(kind: CaseRowMapNear['kind']): MapMarker['kind'] {
  // PinKind happens to match CaseKind one-to-one. Keep this mapping explicit
  // in case they diverge (e.g. a future "ambient nearby" category that doesn't
  // get a kind in the schema).
  return kind;
}

function peekDisplayName(c: CaseRowMapNear): string {
  if (c.victim_name) return c.victim_name;
  if (c.kind === 'unidentified' || c.kind === 'unclaimed') return 'Unidentified';
  return 'Name not released';
}
