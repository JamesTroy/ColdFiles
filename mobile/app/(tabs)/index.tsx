/**
 * Map tab — the home screen.
 *
 * Layout (docs/04_DESIGN_SYSTEM.md "Map & clustering"):
 *   - Header: app name (serif) + locality / radius mono-cap line + locate button
 *   - Filter chip row: All · 247  Homicide  Missing  Doe
 *   - Map canvas — full-bleed, with case-kind shape encoding
 *   - Peek sheet — slides up on pin tap
 *
 * The Mapbox integration lands behind <MapCanvas/> in Week 5b. Today the canvas
 * renders an SVG approximation with the production <Pin/> renderer, so the
 * visual contract is identical to what shipping markers will look like.
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

type Filter = 'all' | 'homicide' | 'missing' | 'unidentified';

const SAMPLE_MARKERS: MapMarker[] = [
  { id: 'evans-1985', x: 0.53, y: 0.67, kind: 'homicide', recentDays: 1 },
  { id: 'doe-1985', x: 0.25, y: 0.33, kind: 'homicide' },
  { id: 'doe-2', x: 0.47, y: 0.5, kind: 'homicide' },
  { id: 'm-1', x: 0.65, y: 0.25, kind: 'missing' },
  { id: 'm-2', x: 0.29, y: 0.61, kind: 'missing' },
  { id: 'd-1', x: 0.79, y: 0.44, kind: 'unidentified' },
];

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string>('evans-1985');

  const markers = useMemo(() => {
    return SAMPLE_MARKERS.filter((m) => filter === 'all' || m.kind === filter).map((m) => ({
      ...m,
      selected: m.id === selectedId,
    }));
  }, [filter, selectedId]);

  const selectedMarker = markers.find((m) => m.selected);

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
              VENTURA · 25mi RADIUS
            </MonoLabel>
          </View>
          {/* TODO: Locate button — re-centers map on user. */}
        </View>
      </View>

      {/* Filter chip row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}
      >
        <FilterChip
          label="All"
          count={247}
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
          onMarkerPress={(id) => setSelectedId(id)}
        />
      </View>

      {/* Peek sheet — only when a marker is selected */}
      {selectedMarker ? (
        <PeekSheet
          distanceMiles={1.4}
          kindLine="HOMICIDE / 1985 / CLAREMONT, CA"
          victimName="David R. Evans"
          onOpen={() => {
            router.push(`/case/${selectedMarker.id}`);
          }}
        />
      ) : null}
    </View>
  );
}
