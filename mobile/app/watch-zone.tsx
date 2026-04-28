/**
 * Watch Zone — premium feature, accessed from Me → "Premium · watch zones".
 *
 * Layout (matches prototype):
 *   - Header with "New watch zone" serif title + premium pill
 *   - Map preview with a polygon (placeholder — real Mapbox polygon edit lands
 *     in Week 5b alongside the rest of the Mapbox integration)
 *   - "42 cases inside" floating amber-bordered chip on the map
 *   - Zone name input
 *   - Three notification toggles (new case enters, existing updated, identified/solved)
 *   - Save CTA at the bottom
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';

import { AmberCTA } from '@/components/cf/cta-button';
import { isNativeMapAvailable } from '@/components/cf/maps-view';
import { Mono, MonoLabel, SansBody, SerifTitle } from '@/components/cf/text';
import {
  WatchZoneMap,
  type InsidePin,
  type PolygonVertex,
} from '@/components/cf/watch-zone-map';
import { tokens } from '@/constants/theme';

// A Ventura-area polygon roughly matching the prototype's outline. Six vertices.
const SAMPLE_VERTICES: PolygonVertex[] = [
  { lat: 34.42, lng: -119.4 },
  { lat: 34.45, lng: -118.95 },
  { lat: 34.32, lng: -118.78 },
  { lat: 34.18, lng: -118.85 },
  { lat: 34.12, lng: -119.18 },
  { lat: 34.25, lng: -119.42 },
];

// Five sample pins inside the zone — same kinds as the prototype.
const SAMPLE_INSIDE_PINS: InsidePin[] = [
  { id: 'wz-1', lat: 34.36, lng: -119.18, kind: 'homicide' },
  { id: 'wz-2', lat: 34.28, lng: -118.95, kind: 'missing' },
  { id: 'wz-3', lat: 34.21, lng: -119.22, kind: 'homicide' },
  { id: 'wz-4', lat: 34.32, lng: -118.86, kind: 'unidentified' },
  { id: 'wz-5', lat: 34.24, lng: -119.05, kind: 'homicide' },
];

const useNativeMap = isNativeMapAvailable();

export default function WatchZoneScreen() {
  const insets = useSafeAreaInsets();
  const [zoneName, setZoneName] = useState('Ventura County');
  const [notifyNew, setNotifyNew] = useState(true);
  const [notifyUpdated, setNotifyUpdated] = useState(true);
  const [notifyResolved, setNotifyResolved] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      {/* Top chrome with back arrow */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            {
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: tokens.color.bg.elev1,
              borderWidth: 0.5,
              borderColor: tokens.color.border.strong,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="chevron-back" size={18} color={tokens.color.text.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <SerifTitle size="h2" style={{ fontSize: 20 }}>
            New watch zone
          </SerifTitle>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.evidence.chrome}
            style={{ marginTop: 2 }}
          >
            TAP THE MAP TO DRAW A PERIMETER
          </MonoLabel>
        </View>
        <PremiumPill />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {useNativeMap ? <ZoneMapNativePreview /> : <ZoneMapPreview />}

        <SectionLabel>ZONE NAME</SectionLabel>
        <View style={{ paddingHorizontal: 16 }}>
          <TextInput
            value={zoneName}
            onChangeText={setZoneName}
            placeholder="e.g. Ventura County"
            placeholderTextColor={tokens.color.text.disabled}
            style={{
              backgroundColor: tokens.color.bg.elev1,
              borderColor: tokens.color.border.strong,
              borderWidth: 0.5,
              borderRadius: 6,
              paddingHorizontal: 12,
              paddingVertical: 12,
              color: tokens.color.text.primary,
              fontFamily: tokens.font.sans,
              fontSize: tokens.size.rowName,
            }}
          />
        </View>

        <SectionLabel>NOTIFY ME WHEN</SectionLabel>
        <View
          style={{
            marginHorizontal: 16,
            backgroundColor: tokens.color.bg.elev1,
            borderColor: tokens.color.border.subtle,
            borderWidth: 0.5,
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <ToggleRow
            label="A new case enters the zone"
            value={notifyNew}
            onChange={setNotifyNew}
            isFirst
          />
          <ToggleRow
            label="An existing case is updated"
            value={notifyUpdated}
            onChange={setNotifyUpdated}
          />
          <ToggleRow
            label="A case is identified or solved"
            value={notifyResolved}
            onChange={setNotifyResolved}
          />
        </View>
      </ScrollView>

      <View
        style={{
          backgroundColor: tokens.color.bg.base,
          borderTopWidth: 0.5,
          borderTopColor: tokens.color.border.subtle,
          paddingTop: 12,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom > 0 ? insets.bottom + 8 : 28,
        }}
      >
        <AmberCTA label="Save zone" onPress={() => router.back()} />
      </View>
    </View>
  );
}

/* ---------------- Mapbox preview ---------------- */

function ZoneMapNativePreview() {
  return (
    <View
      style={{
        height: 240,
        marginHorizontal: 16,
        marginTop: 4,
        borderRadius: 6,
        overflow: 'hidden',
        backgroundColor: '#0e0e0e',
        borderColor: tokens.color.border.strong,
        borderWidth: 0.5,
        position: 'relative',
      }}
    >
      <WatchZoneMap
        vertices={SAMPLE_VERTICES}
        insidePins={SAMPLE_INSIDE_PINS}
      />
      {/* "42 cases inside" floating chip — driven by cases_in_polygon when wired */}
      <View
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          backgroundColor: tokens.color.bg.base,
          borderColor: tokens.color.accent.amber,
          borderWidth: 0.5,
          borderRadius: 12,
          paddingVertical: 5,
          paddingHorizontal: 11,
        }}
      >
        <Mono
          size={tokens.size.monoChip}
          style={{
            color: tokens.color.accent.amber,
            letterSpacing: tokens.size.monoChip * tokens.tracking.chip,
          }}
        >
          42 cases inside
        </Mono>
      </View>
    </View>
  );
}

/* ---------------- SVG fallback preview ---------------- */

function ZoneMapPreview() {
  return (
    <View
      style={{
        height: 240,
        marginHorizontal: 16,
        marginTop: 4,
        borderRadius: 6,
        overflow: 'hidden',
        backgroundColor: '#0e0e0e',
        borderColor: tokens.color.border.strong,
        borderWidth: 0.5,
        position: 'relative',
      }}
    >
      <Svg viewBox="0 0 380 240" width="100%" height="100%">
        {/* land + faint water hint */}
        <Path d="M 0 180 Q 60 160 130 175 Q 200 195 270 175 Q 330 160 380 170 L 380 240 L 0 240 Z" fill="#070b10" />
        <Line x1="0" y1="60" x2="380" y2="72" stroke="#161616" strokeWidth={0.5} />
        <Line x1="0" y1="130" x2="380" y2="138" stroke="#161616" strokeWidth={0.5} />
        <Line x1="100" y1="0" x2="115" y2="240" stroke="#161616" strokeWidth={0.5} />
        <Line x1="240" y1="0" x2="255" y2="240" stroke="#161616" strokeWidth={0.5} />

        {/* The polygon — amber dashed perimeter, faint amber fill */}
        <Polygon
          points="70,40 290,30 340,130 270,180 90,170 50,90"
          fill={tokens.color.accent.amber}
          fillOpacity={0.08}
          stroke={tokens.color.accent.amber}
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />

        {/* Vertex handles */}
        {[
          [70, 40],
          [290, 30],
          [340, 130],
          [270, 180],
          [90, 170],
          [50, 90],
        ].map(([x, y], i) => (
          <Circle
            key={i}
            cx={x}
            cy={y}
            r={5}
            fill={tokens.color.accent.amber}
            stroke={tokens.color.bg.base}
            strokeWidth={1.5}
          />
        ))}

        {/* Pins inside the zone — to give the user a sense of density */}
        <Circle cx={140} cy={80} r={3.5} fill={tokens.color.pin.homicide} />
        <Circle cx={220} cy={120} r={3.5} fill={tokens.color.pin.missing} />
        <Circle cx={120} cy={150} r={3.5} fill={tokens.color.pin.homicide} />
        <Circle
          cx={260}
          cy={100}
          r={3.5}
          fill="none"
          stroke={tokens.color.pin.doe}
          strokeWidth={1.5}
        />
        <Circle cx={180} cy={160} r={3.5} fill={tokens.color.pin.homicide} />
      </Svg>

      {/* "42 cases inside" floating chip */}
      <View
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          backgroundColor: tokens.color.bg.base,
          borderColor: tokens.color.accent.amber,
          borderWidth: 0.5,
          borderRadius: 12,
          paddingVertical: 5,
          paddingHorizontal: 11,
        }}
      >
        <Mono
          size={tokens.size.monoChip}
          style={{
            color: tokens.color.accent.amber,
            letterSpacing: tokens.size.monoChip * tokens.tracking.chip,
          }}
        >
          42 cases inside
        </Mono>
      </View>
    </View>
  );
}

/* ---------------- bits ---------------- */

function PremiumPill() {
  return (
    <View
      style={{
        paddingVertical: 3,
        paddingHorizontal: 8,
        borderRadius: 11,
        borderWidth: 0.5,
        borderColor: tokens.color.accent.amber,
        backgroundColor: tokens.color.bg.amberTintCard,
      }}
    >
      <Mono
        size={9}
        style={{
          color: tokens.color.accent.amber,
          letterSpacing: 9 * 0.1,
        }}
      >
        PREMIUM
      </Mono>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <MonoLabel
      size={tokens.size.monoChip}
      tracking={tokens.tracking.chip}
      color={tokens.color.evidence.chrome}
      style={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: 8 }}
    >
      {children}
    </MonoLabel>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  isFirst,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  isFirst?: boolean;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: 13,
          paddingVertical: 14,
          borderTopWidth: isFirst ? 0 : 0.5,
          borderTopColor: tokens.color.border.subtle,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <SansBody style={{ fontSize: 13.5, flex: 1 }}>{label}</SansBody>
      <Toggle value={value} />
    </Pressable>
  );
}

function Toggle({ value }: { value: boolean }) {
  return (
    <View
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        backgroundColor: value ? tokens.color.accent.amber : tokens.color.border.strong,
        position: 'relative',
      }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: value ? '#1a1408' : tokens.color.text.primary,
          position: 'absolute',
          top: 2,
          left: value ? 18 : 2,
        }}
      />
    </View>
  );
}
