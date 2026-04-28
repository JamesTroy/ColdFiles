/**
 * MapboxView — real Mapbox basemap rendering with MarkerView pins.
 *
 * Replaces the SVG `MapCanvas` placeholder when EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN
 * is configured. The Map screen picks between the two at render time so
 * designer mode (token-less) still works with the SVG fallback.
 *
 * Pin grammar is preserved by construction: each MarkerView renders the
 * existing <Pin /> SVG component as its child, so the filled-circle / ring-
 * plus-dot / open-ring shape encoding, the selection halo, and the recency
 * ring decay all work unchanged.
 *
 * Native clustering is deferred — at v1 the LA-county dataset (≤200 pins
 * within 25mi) renders fine as MarkerView children. When the dataset density
 * grows past ~300 pins, swap MarkerView for a ShapeSource + step-expression
 * cluster layer per docs/04_DESIGN_SYSTEM.md "Map & clustering".
 */

import Mapbox, {
  Camera,
  type MapState,
  MapView,
  MarkerView,
} from '@rnmapbox/maps';
import { useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { tokens } from '@/constants/theme';

import { Pin, type PinKind } from './pin';

export interface MapboxMarker {
  id: string;
  lat: number;
  lng: number;
  kind: PinKind;
  selected?: boolean;
  /** Days since last_changed_at (or null if no recent update). Drives the recency ring. */
  recentDays?: number | null;
}

interface MapboxViewProps {
  /** WGS84 [lng, lat] camera center. */
  center: { lat: number; lng: number };
  /** Initial zoom level. */
  zoom?: number;
  markers: MapboxMarker[];
  /** "You are here" — rendered as a separate blue dot. */
  here?: { lat: number; lng: number } | null;
  onMarkerPress?: (id: string) => void;
  /**
   * Fires whenever the camera settles after a pan/zoom. Use this to drive a
   * cases_in_bbox refetch (debounced upstream — see tokens.map.viewportDebounceMs).
   */
  onViewportChange?: (bbox: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
  }) => void;
}

export function MapboxView({
  center,
  zoom,
  markers,
  here,
  onMarkerPress,
  onViewportChange,
}: MapboxViewProps) {
  const mapRef = useRef<MapView | null>(null);

  /**
   * Explicit dimension state.
   *
   * @rnmapbox/maps v10 + Fabric (newArchEnabled) has a known measurement issue
   * where MapView's `flex: 1` doesn't propagate correctly through nested flex
   * containers — the map renders at half-height (or worse) until something
   * forces a remeasure. Pinning explicit width/height from onLayout sidesteps
   * the issue: the parent View still flexes; we measure it once and hand the
   * MapView fixed numbers.
   */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (
      !size ||
      Math.abs(size.width - width) > 0.5 ||
      Math.abs(size.height - height) > 0.5
    ) {
      setSize({ width, height });
    }
  };

  const handleCameraChanged = (state: MapState) => {
    if (!onViewportChange) return;
    const b = state.properties.bounds;
    if (!b) return;
    // bounds = { ne: [lng, lat], sw: [lng, lat] }
    onViewportChange({
      minLng: b.sw[0],
      minLat: b.sw[1],
      maxLng: b.ne[0],
      maxLat: b.ne[1],
    });
  };

  return (
    <View
      style={{ flex: 1, backgroundColor: tokens.color.bg.base }}
      onLayout={handleLayout}
    >
      {size ? (
      <MapView
        // Re-mount the SDK whenever the measured dimensions change. @rnmapbox/maps
        // v10 caches its initial size on the GL surface and won't pick up later
        // size prop changes — re-keying forces a fresh native view.
        key={`mb-${Math.round(size.width)}x${Math.round(size.height)}`}
        ref={mapRef}
        style={{ width: size.width, height: size.height }}
        styleURL={tokens.map.styleUrl}
        logoEnabled={false}
        attributionEnabled
        attributionPosition={{ bottom: 8, right: 8 }}
        scaleBarEnabled={false}
        compassEnabled={false}
        onCameraChanged={handleCameraChanged}
      >
        <Camera
          centerCoordinate={[center.lng, center.lat]}
          zoomLevel={zoom ?? tokens.map.defaultCenter.zoomLevel}
          animationMode="none"
        />

        {markers.map((m) => (
          <MarkerView
            key={m.id}
            coordinate={[m.lng, m.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
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
          </MarkerView>
        ))}

        {here ? (
          <MarkerView
            coordinate={[here.lng, here.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <YouAreHereDot />
          </MarkerView>
        ) : null}
      </MapView>
      ) : null}
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

/** Convenience: is Mapbox configured? Used by the Map screen to pick the renderer. */
export function isMapboxAvailable(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN);
}

// Make sure the SDK module is imported so the runtime side-effect setAccessToken
// in app/_layout.tsx is treated as load-bearing. (This export is unused
// otherwise and exists purely so static analyzers don't flag the import.)
export const __mapboxSdkRef = Mapbox;
