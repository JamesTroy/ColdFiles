/**
 * WatchZoneMap — disabled native MapLibre polygon renderer (kept as a stub).
 *
 * Same gating reason as maps-view.tsx: top-level imports from
 * `@maplibre/maplibre-react-native` trigger the MLRNCameraModule TurboModule
 * lookup at module-load time, which throws if the dev client APK doesn't
 * have MapLibre linked. Since the watch-zone screen uses
 * `LeafletWatchZoneMap` whenever `isNativeMapAvailable()` returns false
 * (always true in V1), the MapLibre version is never rendered — but its
 * imports must not run.
 *
 * Restore by re-adding the runtime imports + body once the upstream
 * MapLibre Native Fabric fix lands and `isNativeMapAvailable()` flips.
 */

import type { ReactElement } from 'react';

import type { PinKind } from './pin';

export interface PolygonVertex {
  lat: number;
  lng: number;
}

export interface InsidePin {
  id: string;
  lat: number;
  lng: number;
  kind: PinKind;
}

interface WatchZoneMapProps {
  vertices: PolygonVertex[];
  insidePins?: InsidePin[];
  center?: { lat: number; lng: number };
  zoomLevel?: number;
}

export function WatchZoneMap(_props: WatchZoneMapProps): ReactElement {
  throw new Error(
    'WatchZoneMap is disabled while native MapLibre is gated off. Use LeafletWatchZoneMap.',
  );
}
