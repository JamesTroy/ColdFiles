/**
 * MapsView — MapLibre GL Native + OpenFreeMap public tiles.
 *
 * Currently gated off in production. The map renders at half-height under
 * Fabric (newArchEnabled = true, which Reanimated 4 forces). Symptom
 * reproduces across @rnmapbox/maps, react-native-maps, and
 * @maplibre/maplibre-react-native — see the project memory
 * `feedback_map_top_half_not_render.md`: "symptom reproduces across four
 * map SDKs; investigate layout/measurement, not the renderer." The fix is
 * almost certainly in our layout chain, not in the map SDK.
 *
 * IMPORTANT — top-level imports are TYPE-ONLY. The runtime MapLibre
 * import is a `require()` inside MapsView's body so the native-module
 * lookup (TurboModuleRegistry.getEnforcing('MLRNCameraModule')) only
 * fires when the component actually renders. This keeps the file safe
 * to import in Expo Go, which doesn't link MapLibre — without this, a
 * top-level `import` would crash the app at module-load time.
 *
 * Diagnostic flow (requires a CUSTOM DEV CLIENT — Expo Go cannot run
 * MapLibre regardless of the env var):
 *
 *   1. Build a dev client: `cd mobile && npx expo run:android`. The
 *      first build takes 5–10 minutes; subsequent JS-only changes
 *      hot-reload via `npx expo start`. Requires Android Studio + an
 *      AVD or a USB-debug device.
 *   2. Set `EXPO_PUBLIC_ENABLE_NATIVE_MAP=1` in `mobile/.env` (or pass
 *      via `EXPO_PUBLIC_ENABLE_NATIVE_MAP=1 npx expo start`).
 *   3. Open the Map tab in the dev client. `isNativeMapAvailable()`
 *      returns true, consumers route to <MapsView>, lazy require fires,
 *      and the half-render bug should reproduce.
 *   4. Diagnose the parent layout chain in `app/(tabs)/index.tsx` and
 *      `app/watch-zone.tsx` per the memory's hint.
 *
 * Production builds (env var unset) → `isNativeMapAvailable()` returns
 * false → consumers route to <LeafletMap> → ships unchanged.
 *
 * The pin grammar is preserved by construction: each <Marker> renders the
 * existing <Pin /> SVG component as its child, so filled-circle / ring-
 * plus-dot / open-ring shape encoding, the selection halo, and the
 * recency ring decay all work unchanged.
 */

import type { ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
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
  // Diagnostic log — confirms the native MapLibre path is active. Remove
  // before merging this branch to main.
  console.log('[diag] MapsView rendering — native MapLibre path active');
  // Lazy require — the native MapLibre module lookup only fires when this
  // component actually renders. If MapsView is gated off (env var unset)
  // or the consumer never reaches this component, MapLibre is never loaded
  // and Expo Go / dev-clients-without-MapLibre keep working.
  //
  // If require fails (e.g., the env var was set in Expo Go by mistake),
  // we throw a clear error message that the top-level <ErrorBoundary> in
  // app/_layout.tsx catches and renders as the "Something broke" fallback.
  // Better than crashing the whole app at module-load time.
  let MapLibre: typeof import('@maplibre/maplibre-react-native');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    MapLibre = require('@maplibre/maplibre-react-native');
  } catch (err) {
    throw new Error(
      'MapLibre native module not linked. ' +
        'EXPO_PUBLIC_ENABLE_NATIVE_MAP=1 only works in a custom dev client ' +
        '(`npx expo run:android`), not Expo Go. ' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const { Camera, Map: MapLibreMap, Marker } = MapLibre;

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
 * Returns true only when the developer has explicitly opted into the
 * native MapLibre renderer for diagnosis (set
 * EXPO_PUBLIC_ENABLE_NATIVE_MAP=1 in mobile/.env). Production builds
 * leave the env var unset and route to the LeafletMap WebView path.
 *
 * NOTE: turning this on in Expo Go will throw when MapsView renders —
 * MapLibre's native module isn't linked into Expo Go. Build a custom
 * dev client (`npx expo run:android`) to actually exercise the path.
 *
 * The known-broken behavior under Fabric is a layout-side measurement
 * issue (per project memory `feedback_map_top_half_not_render.md`),
 * not an SDK bug — flipping this on without fixing the layout chain
 * upstream of <MapsView> will reproduce the half-render.
 */
export function isNativeMapAvailable(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_NATIVE_MAP === '1';
}
