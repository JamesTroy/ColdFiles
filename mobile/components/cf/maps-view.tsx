/**
 * MapsView — MapLibre GL Native + OpenFreeMap public tiles.
 *
 * Replaces the previous react-native-maps integration. No API key, no signup,
 * no Google Cloud — OpenFreeMap is community-funded OSM-derived tile hosting.
 * The dark style URL lives in tokens.map.styleUrl.
 *
 * The pin grammar is preserved by construction: each <Marker> renders the
 * existing <Pin /> SVG component as its child, so filled-circle / ring-plus-
 * dot / open-ring shape encoding, the selection halo, and the recency ring
 * decay all work unchanged.
 *
 * MapLibre RN v11 supports the New Architecture (Fabric) cleanly — no GL
 * surface measurement bugs like @rnmapbox/maps v10.
 */

import {
  Camera,
  Map as MapLibreMap,
  Marker,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import { useRef } from 'react';
import { type NativeSyntheticEvent, Pressable, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { tokens } from '@/constants/theme';

import { Pin, type PinKind } from './pin';

export interface MapsMarker {
  id: string;
  lat: number;
  lng: number;
  kind: PinKind;
  selected?: boolean;
  /** Days since last_changed_at (or null). Drives the recency ring. */
  recentDays?: number | null;
}

interface MapsViewProps {
  center: { lat: number; lng: number; zoomLevel?: number };
  markers: MapsMarker[];
  here?: { lat: number; lng: number } | null;
  onMarkerPress?: (id: string) => void;
  /**
   * Fires when the visible region settles after pan/zoom. Drives a debounced
   * cases_in_bbox refetch upstream (tokens.map.viewportDebounceMs).
   */
  onRegionChange?: (bounds: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
  }) => void;
}

export function MapsView({
  center,
  markers,
  here,
  onMarkerPress,
  onRegionChange,
}: MapsViewProps) {
  const mapRef = useRef<unknown>(null);

  const handleRegionDidChange = (e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    if (!onRegionChange) return;
    const b = e.nativeEvent.bounds;
    if (!b) return;
    // LngLatBounds is the flat GeoJSON ordering [west, south, east, north].
    onRegionChange({
      minLng: b[0],
      minLat: b[1],
      maxLng: b[2],
      maxLat: b[3],
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <MapLibreMap
        ref={mapRef as never}
        style={{ flex: 1 }}
        mapStyle={tokens.map.styleUrl}
        attribution
        attributionPosition={{ bottom: 8, right: 8 }}
        logo={false}
        compass={false}
        scaleBar={false}
        onRegionDidChange={handleRegionDidChange}
      >
        <Camera
          center={[center.lng, center.lat]}
          zoom={center.zoomLevel ?? tokens.map.defaultCenter.zoomLevel}
        />

        {markers.map((m) => (
          <Marker
            key={m.id}
            lngLat={[m.lng, m.lat]}
            anchor="center"
          >
            <Pressable
              onPress={() => onMarkerPress?.(m.id)}
              hitSlop={8}
              style={{ alignItems: 'center', justifyContent: 'center' }}
            >
              <Pin
                kind={m.kind}
                diameter={m.selected ? 16 : 14}
                selected={m.selected}
                recentDays={m.recentDays ?? null}
              />
            </Pressable>
          </Marker>
        ))}

        {here ? (
          <Marker lngLat={[here.lng, here.lat]} anchor="center">
            <YouAreHereDot />
          </Marker>
        ) : null}
      </MapLibreMap>
    </View>
  );
}

function YouAreHereDot() {
  return (
    <Svg width={28} height={28}>
      <Path
        d="M 14 14 m -10 0 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0"
        fill={tokens.color.you.here}
        fillOpacity={0.1}
      />
      <Circle
        cx={14}
        cy={14}
        r={7}
        fill="none"
        stroke={tokens.color.you.here}
        strokeWidth={1}
        strokeOpacity={0.5}
      />
      <Circle cx={14} cy={14} r={5} fill={tokens.color.you.here} />
    </Svg>
  );
}

/**
 * NATIVE MAP RENDERER IS DISABLED FOR V1.
 *
 * MapLibre Native (and its forks Mapbox + the @rnmapbox/maps SDK) all hit the
 * same GL-surface measurement bug under Fabric (newArchEnabled = true, which
 * Reanimated 4 forces). The map renders at half height regardless of layout
 * tricks — explicit dimensions, absolute positioning, deferred mount, force
 * re-mount, three different SDK swaps; none stick.
 *
 * Bug fixes are upstream of all three bindings, in MapLibre Native itself,
 * and not yet released. V1 ships with the SVG MapCanvas fallback (real
 * design language, hashed pin positions instead of real geography). Real
 * basemap returns when:
 *   - MapLibre Native ships the Fabric fix, or
 *   - We add a WebView-Leaflet integration that bypasses the native layout
 *     chain entirely.
 *
 * Flip back by returning true once the upstream is fixed; the rest of the
 * code path is intact and waiting.
 */
export function isNativeMapAvailable(): boolean {
  return false;
}
