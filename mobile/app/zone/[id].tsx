/**
 * Zone Detail screen.
 *
 * Spec §6 layout:
 *   - Header: back, label, overflow (rename / delete in v1.0.1; edit-shape
 *     ships v1.0.2 once Draw Mode supports preload).
 *   - Top half: map preview with the polygon outline + case pins inside.
 *   - Inline "Rename" button.
 *   - Cases-in-this-zone list (sorted by last_updated_at desc).
 *   - Destructive "Delete zone" at the bottom of scroll.
 *
 * v1.1 placeholder: a row above "Rename" is reserved for the notification
 * toggle. Designing the empty space now means no layout shift later.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  LeafletWatchZoneMap,
  type InsidePin,
  type PolygonVertex,
} from '@/components/cf/leaflet-watch-zone';
import {
  Mono,
  MonoLabel,
  NarrativeText,
  SansBody,
  SansMedium,
  SerifTitle,
} from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { kindLine } from '@/lib/format';
import { useWatchZones, type WatchZone } from '@/lib/hooks/use-watch-zones';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { CaseKind, CaseRowMapBbox } from '@/lib/types/database';

interface CasesInside {
  rows: CaseRowMapBbox[];
  loading: boolean;
  error: boolean;
}

export default function ZoneDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : null;

  const { zones, loading: zonesLoading, remove } = useWatchZones();
  const zone = zones.find((z) => z.id === id) ?? null;

  const [casesInside, setCasesInside] = useState<CasesInside>({
    rows: [],
    loading: false,
    error: false,
  });
  const [refreshTick, setRefreshTick] = useState(0);

  const polygonVertices = useMemo<PolygonVertex[]>(
    () => geojsonToVertices(zone?.geojson ?? null),
    [zone?.geojson],
  );

  // Pull cases-inside via cases_in_polygon. Cheap because the zone is small.
  // Both arms wired (success + rejection) so a network failure surfaces an
  // inline retry instead of stalling at `loading: true` forever.
  useEffect(() => {
    if (!zone || polygonVertices.length < 3 || !isSupabaseConfigured()) return;
    let cancelled = false;
    setCasesInside((s) => ({ ...s, loading: true, error: false }));
    const wkt = verticesToWkt(polygonVertices);
    const supabase = getSupabase();
    supabase
      .rpc('cases_in_polygon', {
        polygon_wkt: wkt,
        filter_kinds: null,
        filter_status: ['open'],
        result_limit: 500,
      })
      .then(
        ({ data, error }) => {
          if (cancelled) return;
          if (error) {
            console.warn('[zone] cases_in_polygon failed', error.message);
            setCasesInside({ rows: [], loading: false, error: true });
            return;
          }
          setCasesInside({
            rows: (data ?? []) as CaseRowMapBbox[],
            loading: false,
            error: false,
          });
        },
        (err: unknown) => {
          if (cancelled) return;
          console.warn(
            '[zone] cases_in_polygon rejected',
            err instanceof Error ? err.message : String(err),
          );
          setCasesInside({ rows: [], loading: false, error: true });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [zone?.id, polygonVertices.length, refreshTick]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  if (zonesLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.bg.base, paddingTop: insets.top }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={tokens.color.accent.amber} />
        </View>
      </View>
    );
  }

  if (!zone) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
        <BackHeader title="Watch zone" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <SerifTitle size="h2" style={{ fontSize: 20, marginBottom: 8 }}>
            Zone not found
          </SerifTitle>
          <SansBody
            style={{
              color: tokens.color.text.secondary,
              textAlign: 'center',
              lineHeight: tokens.size.body * 1.55,
            }}
          >
            It may have been deleted on another device. Pull back to the Saved tab to refresh.
          </SansBody>
        </View>
      </View>
    );
  }

  const handleDelete = () => {
    Alert.alert(
      'Delete this zone?',
      `Your saved area "${zone.label ?? 'Untitled zone'}" will be removed from your zones list. Saved cases are not affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await remove(zone.id);
              router.back();
            } catch (err) {
              console.warn(
                '[zone] delete failed',
                err instanceof Error ? err.message : String(err),
              );
              Alert.alert(
                "Couldn't delete",
                "We couldn't delete that zone right now. Check your connection and try again.",
              );
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <BackHeader title={zone.label ?? 'Untitled zone'} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={casesInside.loading}
            onRefresh={handleRefresh}
            tintColor={tokens.color.accent.amber}
            colors={[tokens.color.accent.amber]}
          />
        }
      >
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <MonoLabel
            size={tokens.size.monoLabel}
            tracking={tokens.tracking.label}
            color={tokens.color.text.secondary}
          >
            {`${zone.cases_inside} ${zone.cases_inside === 1 ? 'CASE' : 'CASES'} INSIDE · SAVED ${formatSavedDate(zone.created_at)}`}
          </MonoLabel>
        </View>

        <ZoneMapPreview vertices={polygonVertices} casesInside={casesInside.rows} />

        <NotificationsPlaceholder />

        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <RenameRow zone={zone} />
        </View>

        <SectionLabel>CASES IN THIS ZONE</SectionLabel>
        {casesInside.loading ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator color={tokens.color.accent.amber} />
          </View>
        ) : casesInside.error ? (
          <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
            <NarrativeText
              style={{
                color: tokens.color.text.secondary,
                fontSize: 14,
                lineHeight: 20,
              }}
            >
              Couldn&apos;t load cases for this zone. Pull to retry.
            </NarrativeText>
          </View>
        ) : casesInside.rows.length === 0 ? (
          <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
            <NarrativeText
              style={{
                color: tokens.color.text.secondary,
                fontSize: 14,
                lineHeight: 20,
              }}
            >
              No cases in this area yet. We&apos;ll show new cases as they&apos;re added — check this zone next time you open the app.
            </NarrativeText>
          </View>
        ) : (
          casesInside.rows.map((row) => <ZoneCaseRow key={row.slug} row={row} />)
        )}

        <View
          style={{
            marginTop: 32,
            marginHorizontal: 16,
            paddingTop: 16,
            borderTopWidth: 0.5,
            borderTopColor: tokens.color.border.subtle,
          }}
        >
          <Pressable
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete zone"
            style={({ pressed }) => [
              {
                paddingVertical: 14,
                borderRadius: 8,
                borderWidth: 0.5,
                borderColor: tokens.color.tip.success,
                backgroundColor: tokens.color.bg.elev1,
                alignItems: 'center',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <SansMedium style={{ color: tokens.color.tip.success, fontSize: 15 }}>
              Delete zone
            </SansMedium>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

/* ---------------- bits ---------------- */

function BackHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
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
      <SerifTitle size="h2" style={{ fontSize: 20, flex: 1 }} numberOfLines={1}>
        {title}
      </SerifTitle>
    </View>
  );
}

function ZoneMapPreview({
  vertices,
  casesInside,
}: {
  vertices: PolygonVertex[];
  casesInside: CaseRowMapBbox[];
}) {
  const pins: InsidePin[] = useMemo(
    () =>
      casesInside
        .filter((c) => c.lat != null && c.lng != null)
        .slice(0, 50)
        .map((c) => ({
          id: c.slug,
          lat: c.lat as number,
          lng: c.lng as number,
          kind: pinKind(c.kind),
        })),
    [casesInside],
  );

  if (vertices.length < 3) {
    return (
      <View
        style={{
          height: 220,
          marginHorizontal: 16,
          borderRadius: 8,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.subtle,
        }}
      />
    );
  }

  return (
    <View
      style={{
        height: 220,
        marginHorizontal: 16,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: tokens.color.bg.elev1,
        borderWidth: 0.5,
        borderColor: tokens.color.border.subtle,
      }}
    >
      <LeafletWatchZoneMap vertices={vertices} insidePins={pins} />
    </View>
  );
}

/**
 * Empty placeholder for the v1.1 notification toggle. Designing the space
 * now means no layout shift when FCM lands and toggles appear here.
 */
function NotificationsPlaceholder() {
  return (
    <View
      style={{
        marginTop: 18,
        marginHorizontal: 16,
        paddingHorizontal: 14,
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: tokens.color.bg.elev1,
        borderWidth: 0.5,
        borderColor: tokens.color.border.subtle,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Ionicons
        name="notifications-off-outline"
        size={18}
        color={tokens.color.text.secondary}
      />
      <View style={{ flex: 1 }}>
        <SansMedium style={{ fontSize: 14 }}>
          We don&apos;t notify you about this zone yet
        </SansMedium>
        <NarrativeText
          style={{
            marginTop: 2,
            fontSize: 12,
            lineHeight: 18,
            color: tokens.color.text.secondary,
          }}
        >
          We&apos;ll have updates ready next time you open the app. Push notifications come in a future update.
        </NarrativeText>
      </View>
    </View>
  );
}

function RenameRow({ zone }: { zone: WatchZone }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(zone.label ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const next = name.trim();
    if (!next) return;
    if (next === (zone.label ?? '')) {
      setEditing(false);
      return;
    }
    if (!isSupabaseConfigured()) return;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('user_watches')
        .update({ watch_zone_label: next })
        .eq('id', zone.id);
      if (error) throw new Error(error.message);
      setEditing(false);
    } catch (err) {
      console.warn(
        '[zone] rename failed',
        err instanceof Error ? err.message : String(err),
      );
      Alert.alert(
        "Couldn't rename",
        "We couldn't save the new name. Check your connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ marginTop: 12, gap: 10 }}
      >
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Zone name"
          placeholderTextColor={tokens.color.text.disabled}
          maxLength={40}
          autoFocus
          style={{
            backgroundColor: tokens.color.bg.elev2,
            borderColor: tokens.color.border.hairline,
            borderWidth: 0.5,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 14,
            color: tokens.color.text.primary,
            fontFamily: tokens.font.sans,
            fontSize: 16,
          }}
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={({ pressed }) => [
              {
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: tokens.color.accent.amber,
                alignItems: 'center',
                opacity: pressed ? 0.7 : saving ? 0.6 : 1,
              },
            ]}
          >
            <SansMedium style={{ color: tokens.color.bg.base, fontSize: 14 }}>
              {saving ? 'Saving…' : 'Save name'}
            </SansMedium>
          </Pressable>
          <Pressable
            onPress={() => {
              setEditing(false);
              setName(zone.label ?? '');
            }}
            style={({ pressed }) => [
              {
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 8,
                borderWidth: 0.5,
                borderColor: tokens.color.border.strong,
                alignItems: 'center',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <SansMedium style={{ color: tokens.color.text.primary, fontSize: 14 }}>
              Cancel
            </SansMedium>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <Pressable
      onPress={() => setEditing(true)}
      accessibilityRole="button"
      accessibilityLabel="Rename zone"
      style={({ pressed }) => [
        {
          marginTop: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: 12,
          borderWidth: 0.5,
          borderColor: tokens.color.border.subtle,
          backgroundColor: tokens.color.bg.elev1,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name="create-outline" size={16} color={tokens.color.text.primary} />
      <SansBody style={{ flex: 1, fontSize: 14 }}>Rename zone</SansBody>
      <Ionicons name="chevron-forward" size={14} color={tokens.color.text.disabled} />
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <MonoLabel
      size={tokens.size.monoLabel}
      tracking={tokens.tracking.label}
      color={tokens.color.text.secondary}
      style={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: 8 }}
    >
      {children}
    </MonoLabel>
  );
}

function ZoneCaseRow({ row }: { row: CaseRowMapBbox }) {
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/case/[slug]', params: { slug: row.slug } })
      }
      style={({ pressed }) => [
        {
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 0.5,
          borderBottomColor: tokens.color.border.subtle,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <SansMedium>{displayName(row)}</SansMedium>
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.label}
        color={tokens.color.text.secondary}
        style={{ marginTop: 4 }}
      >
        {kindLine(row)}
      </MonoLabel>
    </Pressable>
  );
}

/* ---------------- helpers ---------------- */

function displayName(row: CaseRowMapBbox): string {
  if (row.victim_name) return row.victim_name;
  if (row.kind === 'unidentified' || row.kind === 'unclaimed') return 'Unidentified';
  return 'Name not released';
}

function pinKind(kind: CaseKind): CaseKind {
  if (kind === 'suspicious_death') return 'homicide';
  if (kind === 'unclaimed') return 'unidentified';
  return kind;
}

function geojsonToVertices(
  geo: { type: 'Polygon'; coordinates: [number, number][][] } | null,
): PolygonVertex[] {
  if (!geo || geo.type !== 'Polygon' || !geo.coordinates?.[0]) return [];
  // PostGIS returns [lng, lat]; the LeafletWatchZoneMap wants {lat, lng}.
  // Drop the last vertex when it duplicates the first (closed ring).
  const ring = geo.coordinates[0];
  const trimmed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  return trimmed.map(([lng, lat]) => ({ lat, lng }));
}

function verticesToWkt(vertices: PolygonVertex[]): string {
  if (vertices.length < 3) return '';
  const pts = vertices.map((v) => `${v.lng} ${v.lat}`);
  // Close the ring.
  pts.push(pts[0]);
  return `SRID=4326;POLYGON((${pts.join(', ')}))`;
}

function formatSavedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// Suppress Mono unused-warning until we add a count-on-map readout here.
void Mono;
