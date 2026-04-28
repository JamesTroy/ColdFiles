/**
 * MapsView — react-native-maps wrapper for the home tab.
 *
 * Replaces the previous @rnmapbox/maps integration. Same external props/API
 * so the Map screen didn't need rewriting. The pin grammar is preserved by
 * construction: each <Marker> renders the existing <Pin /> SVG component as
 * its child via the `<Marker.Children>` slot, so filled-circle / ring-plus-
 * dot / open-ring shape encoding, the selection halo, and the recency ring
 * decay all work unchanged.
 *
 * Provider:
 *   Android → Google Maps (PROVIDER_GOOGLE) — needs an API key in app.config.ts
 *   iOS     → Apple Maps  (default) — no key required
 *
 * The dark Google Maps style is in tokens.map.customMapStyle and is applied
 * via the `customMapStyle` prop. Apple Maps doesn't honor that prop; iOS
 * users get the system Apple Maps theme (which already follows dark mode).
 */

import { useRef } from 'react';
import { Platform, Pressable, View } from 'react-native';
import MapView, {
  type MapStyleElement,
  Marker,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
  type Region,
} from 'react-native-maps';
import Svg, { Circle, Path } from 'react-native-svg';

import { tokens } from '@/constants/theme';

import { Pin, type PinKind } from './pin';

export interface MapsMarker {
  id: string;
  lat: number;
  lng: number;
  kind: PinKind;
  selected?: boolean;
  /** Days since last_changed_at (or null). Drives the recency ring on the Pin. */
  recentDays?: number | null;
}

interface MapsViewProps {
  /** Initial region center. */
  center: { lat: number; lng: number; latitudeDelta?: number; longitudeDelta?: number };
  markers: MapsMarker[];
  /** "You are here" — rendered as a separate blue dot via a Marker child. */
  here?: { lat: number; lng: number } | null;
  onMarkerPress?: (id: string) => void;
  /**
   * Fires when the visible region settles after pan/zoom. Drives a debounced
   * cases_in_bbox refetch upstream (tokens.map.viewportDebounceMs).
   */
  onRegionChange?: (region: Region) => void;
}

const PROVIDER = Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;

export function MapsView({
  center,
  markers,
  here,
  onMarkerPress,
  onRegionChange,
}: MapsViewProps) {
  const mapRef = useRef<MapView | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <MapView
        ref={mapRef}
        provider={PROVIDER}
        style={{ flex: 1 }}
        customMapStyle={
          /* Apple Maps ignores this; Google Maps consumes it. Both are happy. */
          tokens.map.customMapStyle as unknown as MapStyleElement[]
        }
        initialRegion={{
          latitude: center.lat,
          longitude: center.lng,
          latitudeDelta: center.latitudeDelta ?? tokens.map.defaultCenter.latitudeDelta,
          longitudeDelta: center.longitudeDelta ?? tokens.map.defaultCenter.longitudeDelta,
        }}
        onRegionChangeComplete={onRegionChange}
        showsCompass={false}
        showsScale={false}
        showsMyLocationButton={false}
        showsUserLocation={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {markers.map((m) => (
          <Marker
            key={m.id}
            coordinate={{ latitude: m.lat, longitude: m.lng }}
            onPress={() => onMarkerPress?.(m.id)}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <Pressable
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
          <Marker
            coordinate={{ latitude: here.lat, longitude: here.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <YouAreHereDot />
          </Marker>
        ) : null}
      </MapView>
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
 * Returns true when the map should render via the native provider (always
 * true now — react-native-maps' Apple Maps fallback works without keys, and
 * Android works once the Google Maps API key lands in app.config.ts). The
 * SVG-canvas fallback path stays available for designer-mode use cases that
 * intentionally avoid native maps.
 */
export function isNativeMapAvailable(): boolean {
  if (Platform.OS === 'ios') return true;
  return Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID);
}
