/**
 * WatchZoneMapbox — the polygon-edit map for the Watch Zone screen.
 *
 * Renders the perimeter as a Mapbox FillLayer + LineLayer driven by a
 * ShapeSource. Vertex handles are MarkerView children so they read at the
 * design's amber color and remain tappable. A wrapper above this component
 * decides whether to call this (token configured) or the SVG fallback.
 *
 * v1 scope: render the polygon and surface vertex coords; vertex drag is
 * deferred (the prototype shows a static polygon; real edit gestures need
 * either a custom gesture-handler integration or react-native-mapbox-gl's
 * GestureResponderEvent path which is moderately involved). The screen still
 * looks correct on a real basemap, which is the immediate win.
 */

import {
  Camera,
  FillLayer,
  LineLayer,
  MapView,
  MarkerView,
  ShapeSource,
} from '@rnmapbox/maps';
import { View } from 'react-native';

import { tokens } from '@/constants/theme';

import { Pin, type PinKind } from './pin';

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

interface WatchZoneMapboxProps {
  /** Polygon vertices in draw order. Must be at least 3. */
  vertices: PolygonVertex[];
  /** Optional pins to render inside the polygon for the "X cases inside" preview. */
  insidePins?: InsidePin[];
  /** Camera center; defaults to the centroid of the polygon. */
  center?: { lat: number; lng: number };
  zoom?: number;
}

export function WatchZoneMapbox({
  vertices,
  insidePins = [],
  center,
  zoom = 9,
}: WatchZoneMapboxProps) {
  if (vertices.length < 3) {
    // Polygon needs at least 3 vertices; render an empty map.
    return <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }} />;
  }

  const cameraCenter = center ?? centroid(vertices);

  // Mapbox GeoJSON convention: ring is closed by repeating the first vertex.
  const ring = [...vertices, vertices[0]].map((v) => [v.lng, v.lat]);

  const polygonShape = {
    type: 'Feature' as const,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [ring],
    },
    properties: {},
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <MapView
        style={{ flex: 1 }}
        styleURL={tokens.map.styleUrl}
        logoEnabled={false}
        attributionEnabled
        attributionPosition={{ bottom: 8, right: 8 }}
        scaleBarEnabled={false}
        compassEnabled={false}
      >
        <Camera
          centerCoordinate={[cameraCenter.lng, cameraCenter.lat]}
          zoomLevel={zoom}
          animationMode="none"
        />

        <ShapeSource id="zone-polygon" shape={polygonShape}>
          <FillLayer
            id="zone-fill"
            style={{
              fillColor: tokens.color.accent.amber,
              fillOpacity: 0.08,
            }}
          />
          <LineLayer
            id="zone-stroke"
            style={{
              lineColor: tokens.color.accent.amber,
              lineWidth: 1.5,
              lineDasharray: [4, 3],
            }}
          />
        </ShapeSource>

        {/* Vertex handles — MarkerViews so the amber/border treatment matches the design system. */}
        {vertices.map((v, i) => (
          <MarkerView
            key={`vertex-${i}`}
            coordinate={[v.lng, v.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: tokens.color.accent.amber,
                borderWidth: 1.5,
                borderColor: tokens.color.bg.base,
              }}
            />
          </MarkerView>
        ))}

        {/* Pins inside the zone — uses the production Pin geometry */}
        {insidePins.map((p) => (
          <MarkerView
            key={p.id}
            coordinate={[p.lng, p.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <Pin kind={p.kind} diameter={10} />
          </MarkerView>
        ))}
      </MapView>
    </View>
  );
}

function centroid(vertices: PolygonVertex[]): { lat: number; lng: number } {
  let lat = 0;
  let lng = 0;
  for (const v of vertices) {
    lat += v.lat;
    lng += v.lng;
  }
  return {
    lat: lat / vertices.length,
    lng: lng / vertices.length,
  };
}
