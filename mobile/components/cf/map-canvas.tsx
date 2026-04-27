/**
 * Map canvas placeholder — the surface a real Mapbox GL view will render into.
 *
 * Until the Mapbox SDK is wired (Week 5b), this renders a stylized SVG
 * approximation that matches the visual language of the map mockup. Pins
 * use the production <Pin> renderer so the visual contract is identical
 * to what real Mapbox markers will look like.
 *
 * Real Mapbox integration goes here behind the same component contract.
 */

import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { tokens } from '@/constants/theme';

import { Pin, type PinKind } from './pin';

export interface MapMarker {
  id: string;
  /** 0..1 normalized x (left → right). */
  x: number;
  /** 0..1 normalized y (top → bottom). */
  y: number;
  kind: PinKind;
  selected?: boolean;
  recentDays?: number | null;
}

interface MapCanvasProps {
  height: number;
  markers: MapMarker[];
  /** "You are here" position, normalized. Render a separate blue dot. */
  here?: { x: number; y: number } | null;
  onMarkerPress?: (id: string) => void;
}

export function MapCanvas({ height, markers, here, onMarkerPress }: MapCanvasProps) {
  return (
    <View
      style={{
        height,
        backgroundColor: tokens.color.bg.base,
        overflow: 'hidden',
      }}
    >
      <Svg width="100%" height={height} viewBox={`0 0 340 ${height}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="land" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0e0e0e" />
            <Stop offset="1" stopColor="#070b10" />
          </LinearGradient>
        </Defs>
        {/* Background land tint */}
        <Path d={`M 0 0 L 340 0 L 340 ${height} L 0 ${height} Z`} fill="url(#land)" />
        {/* A muted "freeway" line for visual orientation */}
        <Path
          d={`M 0 ${height * 0.32} Q 100 ${height * 0.26} 200 ${height * 0.36} Q 280 ${height * 0.45} 340 ${height * 0.4}`}
          stroke="#252015"
          strokeWidth={1.5}
          fill="none"
        />
      </Svg>

      {/* Markers (overlaid as RN views so they get press handlers and crisp pin rendering) */}
      {markers.map((m) => (
        <View
          key={m.id}
          style={{
            position: 'absolute',
            left: `${m.x * 100}%`,
            top: m.y * height,
            transform: [{ translateX: -12 }, { translateY: -12 }],
          }}
        >
          <Pin
            kind={m.kind}
            diameter={m.selected ? 14 : 12}
            selected={m.selected}
            recentDays={m.recentDays ?? null}
          />
        </View>
      ))}

      {/* "You are here" — blue dot with halo, intentionally outside the case-color family. */}
      {here ? <YouAreHereDot xPct={here.x * 100} yPct={here.y * 100} /> : null}
    </View>
  );
}

function YouAreHereDot({ xPct, yPct }: { xPct: number; yPct: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: [{ translateX: -14 }, { translateY: -14 }],
      }}
    >
      <Svg width={28} height={28}>
        <Path
          d="M 14 14 m -10 0 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0"
          fill={tokens.color.you.here}
          fillOpacity={0.1}
        />
        <Path
          d="M 14 14 m -7 0 a 7 7 0 1 0 14 0 a 7 7 0 1 0 -14 0"
          fill="none"
          stroke={tokens.color.you.here}
          strokeWidth={1}
          strokeOpacity={0.5}
        />
        <Path
          d="M 14 14 m -5 0 a 5 5 0 1 0 10 0 a 5 5 0 1 0 -10 0"
          fill={tokens.color.you.here}
        />
      </Svg>
    </View>
  );
}
