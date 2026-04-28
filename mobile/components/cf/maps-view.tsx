/**
 * MapsView — disabled native MapLibre renderer (kept as a stub).
 *
 * The MapLibre RN runtime is intentionally NOT imported at module scope.
 * Top-level `import { Map } from '@maplibre/maplibre-react-native'` triggers
 * `TurboModuleRegistry.getEnforcing('MLRNCameraModule')` at module-load time,
 * which throws if the native module isn't linked into the dev client APK.
 * Since `isNativeMapAvailable()` returns false (V1 ships WebView Leaflet —
 * see docs/00_DECISIONS.md "V1 ships the SVG MapCanvas"), we don't want to
 * pay that load cost or require the native module to be present. Stubbing
 * the runtime here lets the project build and run even if the dev client
 * was compiled without MapLibre linked.
 *
 * Restoring the real implementation:
 *   1. Wait for the upstream MapLibre Native Fabric fix, OR
 *   2. Re-add the runtime imports + body below the comment, OR
 *   3. Use a dynamic require() inside the component so the native module
 *      lookup only fires when isNativeMapAvailable() === true.
 *
 * The MapsMarker type and isNativeMapAvailable() function remain so
 * consumers (app/(tabs)/index.tsx, app/watch-zone.tsx) keep compiling
 * without changes.
 */

import type { ReactElement } from 'react';

import type { PinKind } from './pin';

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
  onRegionChange?: (bounds: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
  }) => void;
}

/**
 * Stub. `isNativeMapAvailable()` is false so this component is never
 * rendered; consumers always hit the LeafletMap path. If a caller does
 * reach here despite the gate, fail loudly rather than render an empty box —
 * silent renders make the underlying logic bug harder to find.
 */
export function MapsView(_props: MapsViewProps): ReactElement {
  throw new Error(
    'MapsView is disabled while native MapLibre is gated off. Use LeafletMap.',
  );
}

/**
 * NATIVE MAP RENDERER IS DISABLED FOR V1.
 *
 * MapLibre Native (and its forks Mapbox + the @rnmapbox/maps SDK) all hit the
 * same GL-surface measurement bug under Fabric (newArchEnabled = true, which
 * Reanimated 4 forces). V1 ships the WebView Leaflet renderer instead.
 *
 * Flip back by returning true once the upstream MapLibre Native Fabric fix
 * lands AND the runtime imports are restored above.
 */
export function isNativeMapAvailable(): boolean {
  return false;
}
