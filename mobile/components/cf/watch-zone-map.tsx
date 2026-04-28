/**
 * WatchZoneMap — MapLibre polygon-edit preview.
 *
 * Polygon perimeter via <GeoJSONSource> + a fill <Layer> + a line <Layer>.
 * Vertex handles are <Marker> circles in accent.amber. Inside-pins use the
 * production <Pin /> SVG.
 *
 * Vertex drag gestures aren't wired yet (matches earlier scope); the polygon
 * is static-positioned for v1.
 */

import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  Marker,
} from '@maplibre/maplibre-react-native';
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

interface WatchZoneMapProps {
  vertices: PolygonVertex[];
  insidePins?: InsidePin[];
  center?: { lat: number; lng: number };
  zoomLevel?: number;
}

export function WatchZoneMap({
  vertices,
  insidePins = [],
  center,
  zoomLevel = 9,
}: WatchZoneMapProps) {
  if (vertices.length < 3) {
    return <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }} />;
  }

  const cameraCenter = center ?? centroid(vertices);

  // GeoJSON ring closes by repeating the first vertex.
  const ring: [number, number][] = [
    ...vertices.map((v) => [v.lng, v.lat] as [number, number]),
    [vertices[0].lng, vertices[0].lat],
  ];

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
      <MapLibreMap
        style={{ flex: 1 }}
        mapStyle={tokens.map.styleUrl}
        attribution
        attributionPosition={{ bottom: 8, right: 8 }}
        logo={false}
        compass={false}
        scaleBar={false}
      >
        <Camera center={[cameraCenter.lng, cameraCenter.lat]} zoom={zoomLevel} />

        <GeoJSONSource id="zone-polygon" data={polygonShape}>
          <Layer
            id="zone-fill"
            type="fill"
            source="zone-polygon"
            style={{
              fillColor: tokens.color.accent.amber,
              fillOpacity: 0.08,
            }}
          />
          <Layer
            id="zone-stroke"
            type="line"
            source="zone-polygon"
            style={{
              lineColor: tokens.color.accent.amber,
              lineWidth: 1.5,
              lineDasharray: [4, 3],
            }}
          />
        </GeoJSONSource>

        {/* Vertex handles */}
        {vertices.map((v, i) => (
          <Marker key={`vertex-${i}`} lngLat={[v.lng, v.lat]} anchor="center">
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
          </Marker>
        ))}

        {/* Inside pins */}
        {insidePins.map((p) => (
          <Marker key={p.id} lngLat={[p.lng, p.lat]} anchor="center">
            <Pin kind={p.kind} diameter={10} />
          </Marker>
        ))}
      </MapLibreMap>
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
  return { lat: lat / vertices.length, lng: lng / vertices.length };
}
