/**
 * WatchZoneMap — react-native-maps polygon-edit preview.
 *
 * Replaces WatchZoneMapbox after the @rnmapbox/maps swap. Renders the
 * perimeter as a <Polygon> with the same dashed-amber treatment, vertex
 * handles as <Marker> circles, inside-pins as the production <Pin /> SVG.
 *
 * Vertex drag gestures aren't wired yet (matches the previous Mapbox version's
 * scope); the polygon is static-positioned for v1. Real edit gestures land
 * when watch-zones go from prototype to production.
 */

import { Platform, View } from 'react-native';
import MapView, {
  type MapStyleElement,
  Marker,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
  Polygon,
} from 'react-native-maps';

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
  /** Camera center; defaults to centroid of the polygon. */
  center?: { lat: number; lng: number };
  latitudeDelta?: number;
  longitudeDelta?: number;
}

const PROVIDER = Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;

export function WatchZoneMap({
  vertices,
  insidePins = [],
  center,
  latitudeDelta = 0.5,
  longitudeDelta = 0.5,
}: WatchZoneMapProps) {
  if (vertices.length < 3) {
    return <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }} />;
  }

  const cameraCenter = center ?? centroid(vertices);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <MapView
        provider={PROVIDER}
        style={{ flex: 1 }}
        customMapStyle={tokens.map.customMapStyle as unknown as MapStyleElement[]}
        initialRegion={{
          latitude: cameraCenter.lat,
          longitude: cameraCenter.lng,
          latitudeDelta,
          longitudeDelta,
        }}
        showsCompass={false}
        showsScale={false}
        showsMyLocationButton={false}
        showsUserLocation={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Polygon
          coordinates={vertices.map((v) => ({ latitude: v.lat, longitude: v.lng }))}
          strokeColor={tokens.color.accent.amber}
          strokeWidth={1.5}
          // react-native-maps Polygon doesn't support strokeDasharray on Android,
          // but the amber + fillOpacity reads correctly as a perimeter even
          // without dashes. iOS Apple Maps respects lineDashPattern on the
          // similar primitive.
          fillColor={`${tokens.color.accent.amber}14`} // ~8% alpha
          lineDashPattern={[6, 4]}
        />

        {/* Vertex handles */}
        {vertices.map((v, i) => (
          <Marker
            key={`vertex-${i}`}
            coordinate={{ latitude: v.lat, longitude: v.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
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
          </Marker>
        ))}

        {/* Inside pins — production Pin geometry */}
        {insidePins.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <Pin kind={p.kind} diameter={10} />
          </Marker>
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
  return { lat: lat / vertices.length, lng: lng / vertices.length };
}
