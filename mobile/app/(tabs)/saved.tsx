/**
 * Saved tab — segmented [Cases] · [Zones].
 *
 * The schema is polymorphic (one user_watches table holds both case bookmarks
 * and watch zones), but the UI shouldn't be. Cases get card layout with pin
 * glyph + name + kind line; zones get thumbnail + place name + cases-inside
 * count. Mixing them means awkward scan rhythm and ambiguous verbs ("save"
 * vs "watch"). Segmented control keeps the verbs honest.
 *
 * Last-segment preference persists across sessions via AsyncStorage so the
 * user lands on the segment they last cared about.
 *
 * v1.0.1 notes:
 *   - "Watch zones" UI never says "notify" or "alert" — see spec §0.6.
 *     Honest copy is "saved area / check when you open." Notifications wire
 *     in v1.1 alongside FCM.
 *   - Static thumbnail for zone cards is deferred (MapLibre snapshot is
 *     blocked by the Fabric bug); fallback is the §14 styled abstract
 *     pattern with the zone label overlaid in Newsreader. Lands intentional,
 *     not lazy.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  Pressable,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PinGlyph } from '@/components/cf/pin';
import { MonoLabel, NarrativeText, SansBody, SansMedium, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { confirmDeleteZone } from '@/lib/confirm-delete-zone';
import { displayName, kindLine } from '@/lib/format';
import { useSavedCases } from '@/lib/hooks/use-saved-cases';
import { useWatchZones, type WatchZone } from '@/lib/hooks/use-watch-zones';
import type { CaseKind, CaseRowMapNear } from '@/lib/types/database';

type Segment = 'cases' | 'zones';

const SEGMENT_PREF_KEY = 'cf:saved_segment:v1';

const PIN_KIND_FOR_LIST: Record<CaseKind, CaseKind> = {
  homicide: 'homicide',
  missing: 'missing',
  unidentified: 'unidentified',
  unclaimed: 'unidentified',
  suspicious_death: 'homicide',
};

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const { rows, count: caseCount, loading: casesLoading } = useSavedCases();
  const { zones, loading: zonesLoading, remove } = useWatchZones();

  const [segment, setSegment] = useState<Segment>('cases');

  // Restore last-used segment.
  useEffect(() => {
    AsyncStorage.getItem(SEGMENT_PREF_KEY).then((v) => {
      if (v === 'cases' || v === 'zones') setSegment(v);
    });
  }, []);

  const switchSegment = (s: Segment) => {
    setSegment(s);
    AsyncStorage.setItem(SEGMENT_PREF_KEY, s).catch(() => {});
  };

  const handleDeleteZone = (zone: WatchZone) => {
    confirmDeleteZone(zone, () => {
      void remove(zone.id);
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}
      >
        <SerifTitle size="h2" style={{ fontSize: 22 }}>
          Saved
        </SerifTitle>

        <Segmented
          segment={segment}
          casesCount={caseCount}
          zonesCount={zones.length}
          onChange={switchSegment}
        />
      </View>

      {segment === 'cases' ? (
        <CasesPane rows={rows} loading={casesLoading} />
      ) : (
        <ZonesPane
          zones={zones}
          loading={zonesLoading}
          onDelete={handleDeleteZone}
        />
      )}
    </View>
  );
}

function Segmented({
  segment,
  casesCount,
  zonesCount,
  onChange,
}: {
  segment: Segment;
  casesCount: number;
  zonesCount: number;
  onChange: (s: Segment) => void;
}) {
  return (
    <View
      style={{
        marginTop: 12,
        flexDirection: 'row',
        backgroundColor: tokens.color.bg.elev2,
        borderRadius: 14,
        padding: 4,
        gap: 4,
      }}
    >
      <SegmentButton
        label="Cases"
        count={casesCount}
        active={segment === 'cases'}
        onPress={() => onChange('cases')}
      />
      <SegmentButton
        label="Zones"
        count={zonesCount}
        active={segment === 'zones'}
        onPress={() => onChange('zones')}
      />
    </View>
  );
}

function SegmentButton({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        {
          flex: 1,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: 10,
          backgroundColor: active ? tokens.color.accent.amber : 'transparent',
          alignItems: 'center',
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <SansBody
        style={{
          color: active ? tokens.color.bg.base : tokens.color.text.primary,
          fontSize: 13,
          fontFamily: tokens.font.sansMedium,
        }}
      >
        {`${label} · ${count}`}
      </SansBody>
    </Pressable>
  );
}

function CasesPane({
  rows,
  loading,
}: {
  rows: CaseRowMapNear[];
  loading: boolean;
}) {
  const keyExtractor = useCallback((row: CaseRowMapNear) => row.slug, []);
  const renderItem = useCallback<ListRenderItem<CaseRowMapNear>>(
    ({ item }) => <SavedRow row={item} />,
    [],
  );

  if (loading && rows.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={tokens.color.accent.amber} />
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="bookmark-outline"
        title="No saved cases yet"
        body="Save a case from the case detail screen to follow it. Your bookmarks live on this device."
      />
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      removeClippedSubviews
      maxToRenderPerBatch={10}
      windowSize={7}
      initialNumToRender={12}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  );
}

function ZonesPane({
  zones,
  loading,
  onDelete,
}: {
  zones: WatchZone[];
  loading: boolean;
  onDelete: (zone: WatchZone) => void;
}) {
  const keyExtractor = useCallback((zone: WatchZone) => zone.id, []);
  const renderItem = useCallback<ListRenderItem<WatchZone>>(
    ({ item }) => <ZoneCard zone={item} onDelete={() => onDelete(item)} />,
    [onDelete],
  );

  if (loading && zones.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={tokens.color.accent.amber} />
      </View>
    );
  }

  if (zones.length === 0) {
    return (
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8 }}>
        <SectionRow label="YOUR ZONES" trailing={<NewZoneButton />} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: tokens.color.bg.elev1,
              borderWidth: 0.5,
              borderColor: tokens.color.border.strong,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <Ionicons
              name="location-outline"
              size={28}
              color={tokens.color.text.secondary}
            />
          </View>
          <SerifTitle size="h2" style={{ fontSize: 20, marginBottom: 8 }}>
            No watch zones yet
          </SerifTitle>
          <SansBody
            style={{
              color: tokens.color.text.secondary,
              textAlign: 'center',
              lineHeight: tokens.size.body * 1.55,
              maxWidth: 280,
              marginBottom: 18,
            }}
          >
            Add one from the map to follow new cases in an area you care about. We&apos;ll surface them next time you check.
          </SansBody>
        </View>
      </View>
    );
  }

  return (
    <FlatList
      data={zones}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      removeClippedSubviews
      maxToRenderPerBatch={10}
      windowSize={7}
      initialNumToRender={12}
      contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 16 }}
      ListHeaderComponent={<SectionRow label="YOUR ZONES" trailing={<NewZoneButton />} />}
    />
  );
}

function SectionRow({ label, trailing }: { label: string; trailing?: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 16,
        paddingBottom: 10,
      }}
    >
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.label}
        color={tokens.color.text.secondary}
      >
        {label}
      </MonoLabel>
      {trailing}
    </View>
  );
}

function NewZoneButton() {
  return (
    <Pressable
      onPress={() => router.push('/watch-zone')}
      accessibilityRole="button"
      accessibilityLabel="New watch zone"
      hitSlop={8}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 12,
          borderWidth: 0.5,
          borderColor: tokens.color.accent.amber,
          backgroundColor: tokens.color.bg.amberTintCard,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name="add" size={14} color={tokens.color.accent.amber} />
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.chip}
        color={tokens.color.accent.amber}
      >
        NEW ZONE
      </MonoLabel>
    </Pressable>
  );
}

function ZoneCard({
  zone,
  onDelete,
}: {
  zone: WatchZone;
  onDelete: () => void;
}) {
  const areaText = useMemo(() => formatAreaMi2(zone.geojson), [zone.geojson]);
  const savedAt = useMemo(() => formatSavedDate(zone.created_at), [zone.created_at]);

  return (
    <Pressable
      onLongPress={onDelete}
      onPress={() => router.push({ pathname: '/zone/[id]', params: { id: zone.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${zone.label ?? 'Untitled zone'}: ${zone.cases_inside} cases. Long-press to delete.`}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          gap: 14,
          paddingVertical: 12,
          marginBottom: 10,
          borderRadius: 12,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.subtle,
          padding: 12,
          alignItems: 'center',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <ZoneThumbnail label={zone.label ?? 'Zone'} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <SansMedium style={{ fontSize: 17 }} numberOfLines={1}>
          {zone.label ?? 'Untitled zone'}
        </SansMedium>
        <MonoLabel
          size={tokens.size.monoLabel}
          tracking={tokens.tracking.label}
          color={tokens.color.text.secondary}
          style={{ marginTop: 4 }}
        >
          {`${zone.cases_inside} ${zone.cases_inside === 1 ? 'CASE' : 'CASES'}${areaText ? ` · ${areaText}` : ''}`}
        </MonoLabel>
        <NarrativeText
          style={{
            marginTop: 4,
            color: tokens.color.text.disabled,
            fontSize: 13,
            lineHeight: 18,
          }}
        >
          {`Saved ${savedAt}`}
        </NarrativeText>
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={tokens.color.text.disabled}
      />
    </Pressable>
  );
}

/**
 * Static thumbnail fallback (spec §14): styled abstract pattern with the
 * label initials over warm-amber gradient. Looks intentional, not lazy. Real
 * map snapshots land when MapLibre's Fabric blocker is fixed.
 */
function ZoneThumbnail({ label }: { label: string }) {
  const initials = label
    .split(/[\s,—-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: tokens.color.bg.elev2,
        borderWidth: 0.5,
        borderColor: tokens.color.border.hairline,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: tokens.color.bg.amberTintCard,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: 36,
          height: 36,
          borderRadius: 18,
          borderWidth: 1.5,
          borderColor: tokens.color.accent.amber,
          opacity: 0.8,
        }}
      />
      <SerifTitle
        size="h2"
        style={{
          fontSize: 16,
          color: tokens.color.text.primary,
          letterSpacing: 0.5,
        }}
      >
        {initials || '◇'}
      </SerifTitle>
    </View>
  );
}

function SavedRow({ row }: { row: CaseRowMapNear }) {
  const display = displayName(row);
  const isDoe = row.kind === 'unidentified' || row.kind === 'unclaimed';
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/case/[slug]', params: { slug: row.slug } })
      }
      style={({ pressed }) => [
        {
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: 0.5,
          borderBottomColor: tokens.color.border.subtle,
          opacity: pressed ? 0.7 : 1,
          flexDirection: 'row',
          alignItems: 'flex-start',
        },
      ]}
    >
      <View style={{ marginRight: 12, marginTop: 4, opacity: isDoe ? 0.5 : 1 }}>
        <PinGlyph kind={PIN_KIND_FOR_LIST[row.kind]} />
      </View>
      <View style={{ flex: 1 }}>
        <SansMedium>{display}</SansMedium>
        <MonoLabel
          size={tokens.size.monoLabel}
          tracking={tokens.tracking.label}
          color={tokens.color.text.secondary}
          style={{ marginTop: 4 }}
        >
          {kindLine(row)}
        </MonoLabel>
      </View>
    </Pressable>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        gap: 14,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={28} color={tokens.color.text.secondary} />
      </View>
      <SerifTitle size="h2" style={{ fontSize: 20 }}>
        {title}
      </SerifTitle>
      <SansBody
        style={{
          color: tokens.color.text.secondary,
          textAlign: 'center',
          lineHeight: tokens.size.body * 1.55,
          maxWidth: 280,
        }}
      >
        {body}
      </SansBody>
    </View>
  );
}

/**
 * Approximate area in mi² from a closed lng/lat polygon. Spherical-shoelace
 * good enough for v1 — within a few percent at zone-scale (≤500 mi²) which
 * is the only place we render this.
 */
function formatAreaMi2(geo: WatchZone['geojson']): string | null {
  if (!geo || geo.type !== 'Polygon' || !geo.coordinates?.[0]) return null;
  const ring = geo.coordinates[0];
  const R = 3958.7613; // mi
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    area += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  area = Math.abs((area * R * R) / 2);
  if (area < 1) return `${area.toFixed(1)} MI²`;
  if (area < 10) return `${area.toFixed(1)} MI²`;
  return `${Math.round(area)} MI²`;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function formatSavedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
