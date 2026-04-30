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
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import {
  LeafletWatchZoneMap,
  type InsidePin,
  type PolygonVertex,
} from '@/components/cf/leaflet-watch-zone';
import { isNativeMapAvailable } from '@/components/cf/maps-view';
import { Mono, MonoLabel, NarrativeText, SansBody, SerifTitle } from '@/components/cf/text';
import { WatchZoneMap } from '@/components/cf/watch-zone-map';
import { tokens } from '@/constants/theme';
import { useUser } from '@/lib/hooks/use-user';

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

export default function WatchZoneScreen() {
  const insets = useSafeAreaInsets();
  const { user, authAvailable, loading: userLoading } = useUser();
  const [zoneName, setZoneName] = useState('Ventura County');
  const [notifyNew, setNotifyNew] = useState(true);
  const [notifyUpdated, setNotifyUpdated] = useState(true);
  const [notifyResolved, setNotifyResolved] = useState(false);

  // Watch zones live on the server (the user can have them across devices and
  // get push notifications); guest mode can't satisfy that contract.
  if (authAvailable && !userLoading && !user) {
    return <WatchZoneSignInGate />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: tokens.color.bg.base }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
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
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={12}
          style={({ pressed }) => [
            {
              width: 36,
              height: 36,
              borderRadius: 18,
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
            color={tokens.color.text.secondary}
            style={{ marginTop: 2 }}
          >
            TAP THE MAP TO DRAW A PERIMETER
          </MonoLabel>
        </View>
        <PremiumPill />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {isNativeMapAvailable() ? <ZoneMapNativePreview /> : <ZoneMapLeafletPreview />}

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
    </KeyboardAvoidingView>
  );
}

/* ---------------- Sign-in gate ---------------- */

function WatchZoneSignInGate() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
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
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={12}
          style={({ pressed }) => [
            {
              width: 36,
              height: 36,
              borderRadius: 18,
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
        <SerifTitle size="h2" style={{ fontSize: 20, flex: 1 }}>
          Watch zones
        </SerifTitle>
        <PremiumPill />
      </View>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 32 }}>
        <NarrativeText style={{ marginBottom: 14 }}>
          Watch zones notify you when a new case enters a perimeter you draw, or
          when an existing case inside it is updated. They live on the server and
          fire push notifications — that means we need an account to attach them
          to.
        </NarrativeText>
        <NarrativeText style={{ color: tokens.color.text.secondary, marginBottom: 32 }}>
          One-tap email sign-in. No password.
        </NarrativeText>
        <AmberCTA label="Continue with email" onPress={() => router.push('/sign-in')} />
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
        backgroundColor: tokens.color.photoFrame.bg,
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

/* ---------------- WebView Leaflet preview ---------------- */

function ZoneMapLeafletPreview() {
  return (
    <View
      style={{
        height: 240,
        marginHorizontal: 16,
        marginTop: 4,
        borderRadius: 6,
        overflow: 'hidden',
        backgroundColor: tokens.color.photoFrame.bg,
        borderColor: tokens.color.border.strong,
        borderWidth: 0.5,
        position: 'relative',
      }}
    >
      <LeafletWatchZoneMap
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
          zIndex: 2,
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
      color={tokens.color.text.secondary}
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
