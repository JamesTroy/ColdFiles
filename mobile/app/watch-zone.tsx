/**
 * Draw Mode — circle-only watch-zone editor (v1.0.1).
 *
 * Spec alignment:
 *   §3.2 — circle is the default and the only mode in v1.0.1 (polygon is in
 *          §14's cut list; ships v1.0.2). The mode toggle is therefore
 *          omitted; we'll add it back when polygon mode lands.
 *   §3.3 — viewport center IS the zone center; no draggable handle. The
 *          fixed-screen-center crosshair is an RN overlay over the WebView.
 *          Slider on the bottom bar drives radius. Live cases-inside count
 *          fires after 200ms debounce on (center, radius) changes.
 *   §3.6 — soft 500 mi² area cap + soft 25-zone-per-user cap. Both warn,
 *          neither blocks in v1.0.1 (hard caps in v1.1 alongside FCM).
 *   §0.5 — copy never says "notify" or "alert" anywhere on this screen.
 *          We're "watching" / "saving an area" / "we'll have it ready next
 *          time you open."
 *   §4   — Save & Name sheet: 60% bottom sheet, non-dismissible by drag-down,
 *          name field + 140-char note + summary + Save / Cancel.
 *
 * Auth-gated: zones live on the server, so guest mode hits a sign-in gate.
 * We never bait the user into the editor before checking sign-in state.
 */

import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import { AmberSlider } from '@/components/cf/amber-slider';
import { DrawZoneMap } from '@/components/cf/draw-zone-map';
import { Mono, MonoLabel, NarrativeText, SansBody, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { useHere } from '@/lib/hooks/use-here';
import { useUser } from '@/lib/hooks/use-user';
import { useWatchZones } from '@/lib/hooks/use-watch-zones';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

const RADIUS_MIN_MI = 0.5;
const RADIUS_MAX_MI = 25;
const RADIUS_DEFAULT_MI = 5;

const SOFT_AREA_CAP_MI2 = 500;
const SOFT_ZONE_CAP = 25;

const COUNT_DEBOUNCE_MS = 200;
const MILES_TO_METERS = 1609.344;

interface CenterPoint {
  lat: number;
  lng: number;
}

export default function WatchZoneScreen() {
  const insets = useSafeAreaInsets();
  const { user, authAvailable, loading: userLoading } = useUser();
  const { zones, create } = useWatchZones();
  const { here } = useHere();

  // Initial map center: the user's last-known location, falling back to the
  // app default. Don't pan to (0,0) on permission-denied — that's a
  // confusing landing.
  const initialCenter = useMemo(
    () => ({ lat: here.lat, lng: here.lng, zoomLevel: 11 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [center, setCenter] = useState<CenterPoint>({ lat: here.lat, lng: here.lng });
  const [radiusMi, setRadiusMi] = useState(RADIUS_DEFAULT_MI);
  const [casesInside, setCasesInside] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  const [saveSheetOpen, setSaveSheetOpen] = useState(false);

  const radiusMeters = radiusMi * MILES_TO_METERS;
  const areaMi2 = Math.PI * radiusMi * radiusMi;
  const overAreaCap = areaMi2 > SOFT_AREA_CAP_MI2;
  const overZoneCap = zones.length >= SOFT_ZONE_CAP;

  // Sign-in gate. Per CLAUDE.md, all hooks must run on every render — so
  // every hook in this component has to be declared ABOVE this conditional
  // return, never below it. Adding a hook between this `if` and the
  // editor's `return` would skip on the gated render and surface as
  // "Rendered more hooks than during the previous render" → blank grey
  // screen on Android Fabric production. If you need state/effects scoped
  // to the editor branch, put them in a child component (DrawZoneMap,
  // SaveSheet, etc.) rather than here.
  const showSignInGate = authAvailable && !userLoading && !user;
  if (showSignInGate) {
    return <WatchZoneSignInGate />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <TopBar onClose={() => maybeDismiss(() => router.back())} />

      <View style={{ flex: 1, position: 'relative' }}>
        <DrawZoneMap
          initialCenter={initialCenter}
          radiusMeters={radiusMeters}
          onCenterChange={(c) => setCenter(c)}
        />
        <CrosshairOverlay />
        <CountChip
          count={casesInside}
          loading={countLoading}
          area={areaMi2}
        />
      </View>

      <BottomBar
        radiusMi={radiusMi}
        onRadiusChange={setRadiusMi}
        onSavePress={() => {
          if (overZoneCap) {
            Alert.alert(
              'Many zones already',
              `You have ${zones.length} zones saved. We'd suggest cleaning a few out before adding more — keeps the list scannable. Save anyway?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Save anyway', onPress: () => setSaveSheetOpen(true) },
              ],
            );
            return;
          }
          if (overAreaCap) {
            Alert.alert(
              'That area is large',
              `This zone covers ~${Math.round(areaMi2).toLocaleString()} mi². Most useful zones are under ${SOFT_AREA_CAP_MI2}. Larger areas mean lots of cases — easy to miss the ones that matter. Save anyway?`,
              [
                { text: 'Adjust', style: 'cancel' },
                { text: 'Save anyway', onPress: () => setSaveSheetOpen(true) },
              ],
            );
            return;
          }
          setSaveSheetOpen(true);
        }}
      />

      <UseCasesInsideQuery
        center={center}
        radiusMi={radiusMi}
        onCount={setCasesInside}
        onLoadingChange={setCountLoading}
      />

      {saveSheetOpen ? (
        <SaveSheet
          center={center}
          radiusMi={radiusMi}
          areaMi2={areaMi2}
          casesInside={casesInside ?? 0}
          onSave={async (label: string) => {
            const vertices = circleToPolygon(center, radiusMeters, 32);
            await create({ label, vertices });
            setSaveSheetOpen(false);
            router.back();
          }}
          onCancel={() => setSaveSheetOpen(false)}
          insets={insets}
        />
      ) : null}
    </View>
  );
}

/* ---------------- query side-effect ---------------- */

/**
 * Cases-inside live count. Renders nothing — purely a side-effect component
 * so the count refreshes on (center, radius) change without re-rendering the
 * map. Debounced 200ms; the result is cached per (center, radius) pair so
 * the user wiggling back and forth doesn't re-fire the query.
 */
function UseCasesInsideQuery({
  center,
  radiusMi,
  onCount,
  onLoadingChange,
}: {
  center: CenterPoint;
  radiusMi: number;
  onCount: (n: number) => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const cacheRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    // Cache key is (lat, lng, radius) rounded to small precision so wiggle
    // doesn't bust the cache.
    const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${radiusMi.toFixed(2)}`;
    const cached = cacheRef.current.get(key);
    if (cached !== undefined) {
      onCount(cached);
      onLoadingChange(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      onLoadingChange(true);
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc('cases_within_radius', {
          search_lat: center.lat,
          search_lng: center.lng,
          radius_miles: radiusMi,
          filter_kinds: null,
          filter_status: ['open'],
          result_limit: 5000,
        });
        if (cancelled) return;
        if (error) {
          onCount(0);
        } else {
          const n = (data ?? []).length;
          cacheRef.current.set(key, n);
          onCount(n);
        }
      } finally {
        if (!cancelled) onLoadingChange(false);
      }
    }, COUNT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [center.lat, center.lng, radiusMi, onCount, onLoadingChange]);

  return null;
}

/* ---------------- bits ---------------- */

function TopBar({ onClose }: { onClose: () => void }) {
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
        backgroundColor: tokens.color.bg.elev1,
        borderBottomWidth: 0.5,
        borderBottomColor: tokens.color.border.subtle,
      }}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        accessibilityRole="button"
        hitSlop={12}
        style={({ pressed }) => [
          {
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: tokens.color.bg.base,
            borderWidth: 0.5,
            borderColor: tokens.color.border.strong,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons name="close" size={18} color={tokens.color.text.primary} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <MonoLabel
          size={tokens.size.monoChip}
          tracking={tokens.tracking.chip}
          color={tokens.color.text.secondary}
        >
          DRAW WATCH ZONE
        </MonoLabel>
        <NarrativeText
          style={{
            marginTop: 2,
            color: tokens.color.text.disabled,
            fontSize: 11,
            lineHeight: 14,
          }}
        >
          Pan and zoom to position; slider sets the radius
        </NarrativeText>
      </View>
      {/* Spacer to balance the close button — keeps the title centered. */}
      <View style={{ width: 36 }} />
    </View>
  );
}

/**
 * Cream center crosshair, fixed at screen center over the map. Mirrors the
 * user-location-dot glyph language but without a halo — distinguishes "thing
 * I'm placing" from "where I am."
 */
function CrosshairOverlay() {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: tokens.color.text.primary,
          borderWidth: 1.5,
          borderColor: tokens.color.bg.base,
        }}
      />
    </View>
  );
}

function CountChip({
  count,
  loading,
  area,
}: {
  count: number | null;
  loading: boolean;
  area: number;
}) {
  const countText = count == null ? '…' : count.toLocaleString();
  const caseWord = count === 1 ? 'CASE' : 'CASES';
  const areaText = area >= 1 ? `${area < 10 ? area.toFixed(1) : Math.round(area)} MI²` : `${area.toFixed(1)} MI²`;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 12,
        alignSelf: 'center',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: 'rgba(10,10,10,0.85)',
        borderWidth: 0.5,
        borderColor: tokens.color.accent.amber,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: loading ? 0.7 : 1,
      }}
    >
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.chip}
        color={tokens.color.accent.amber}
      >
        {`${countText} ${caseWord} · ${areaText}`}
      </MonoLabel>
    </View>
  );
}

function BottomBar({
  radiusMi,
  onRadiusChange,
  onSavePress,
}: {
  radiusMi: number;
  onRadiusChange: (mi: number) => void;
  onSavePress: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: 14,
        paddingHorizontal: 16,
        paddingBottom: insets.bottom > 0 ? insets.bottom + 8 : 24,
        backgroundColor: tokens.color.bg.elev1,
        borderTopWidth: 0.5,
        borderTopColor: tokens.color.border.subtle,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 4,
        }}
      >
        <MonoLabel
          size={tokens.size.monoChip}
          tracking={tokens.tracking.chip}
          color={tokens.color.text.secondary}
        >
          RADIUS
        </MonoLabel>
        <Mono
          size={13}
          style={{ color: tokens.color.text.primary, letterSpacing: 0.5 }}
        >
          {`${formatRadius(radiusMi)} mi`}
        </Mono>
      </View>
      <AmberSlider
        minimumValue={RADIUS_MIN_MI}
        maximumValue={RADIUS_MAX_MI}
        step={0.1}
        value={radiusMi}
        onValueChange={onRadiusChange}
      />
      <View style={{ marginTop: 12 }}>
        <AmberCTA label="Save zone" onPress={onSavePress} />
      </View>
    </View>
  );
}

function SaveSheet({
  center,
  radiusMi,
  areaMi2,
  casesInside,
  onSave,
  onCancel,
  insets,
}: {
  center: CenterPoint;
  radiusMi: number;
  areaMi2: number;
  casesInside: number;
  onSave: (label: string) => Promise<void>;
  onCancel: () => void;
  insets: { top: number; bottom: number };
}) {
  const sheetRef = useRef<BottomSheet>(null);
  const [name, setName] = useState(() => defaultZoneName());
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reverse-geocode the centroid for a more useful default ("Ojai, CA"
  // instead of "Watch area — Mar 5"). Won't overwrite a name the user has
  // already edited. If the geocode returns empty / fails, we silently keep
  // the date-based fallback.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.functions.invoke('reverse-geocode', {
          body: { lat: center.lat, lng: center.lng },
        });
        if (cancelled) return;
        const label = (data as { label?: string } | null)?.label?.trim();
        if (label && !nameTouched) {
          setName(label);
        }
      } catch {
        /* keep fallback */
      }
    })();
    return () => { cancelled = true; };
    // Only resolve once on mount — the centroid doesn't change while the
    // SaveSheet is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    const label = name.trim();
    if (!label) {
      Alert.alert('Name your zone', 'A short label helps you find it again later.');
      return;
    }
    setSubmitting(true);
    try {
      await onSave(label);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save zone';
      Alert.alert("Couldn't save", msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ position: 'absolute', inset: 0 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={['62%']}
        enablePanDownToClose={false}
        backgroundStyle={{
          backgroundColor: tokens.color.bg.elev1,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
        }}
        handleIndicatorStyle={{
          backgroundColor: tokens.color.border.hairline,
          width: 36,
          height: 4,
        }}
      >
        <BottomSheetView
          style={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: insets.bottom > 0 ? insets.bottom + 8 : 24,
          }}
        >
          <SerifTitle size="h2" style={{ fontSize: 22, marginBottom: 4 }}>
            Name this zone
          </SerifTitle>
          <NarrativeText
            style={{
              color: tokens.color.text.secondary,
              fontSize: 13,
              lineHeight: 18,
              marginBottom: 20,
            }}
          >
            We&apos;ll have it ready in your Saved tab next time you open the app.
          </NarrativeText>

          <MonoLabel
            size={tokens.size.monoChip}
            tracking={tokens.tracking.chip}
            color={tokens.color.text.secondary}
            style={{ marginBottom: 8 }}
          >
            ZONE NAME
          </MonoLabel>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setName(t);
              setNameTouched(true);
            }}
            placeholder="e.g. Ventura Coast"
            placeholderTextColor={tokens.color.text.disabled}
            maxLength={40}
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

          <View style={{ marginTop: 22, flexDirection: 'row', gap: 12 }}>
            <SansBody
              style={{
                color: tokens.color.text.secondary,
                fontSize: tokens.size.body,
              }}
            >
              {`${casesInside.toLocaleString()} ${casesInside === 1 ? 'case' : 'cases'} inside · `}
            </SansBody>
            <SansBody
              style={{
                color: tokens.color.text.secondary,
                fontSize: tokens.size.body,
              }}
            >
              {`${formatRadius(radiusMi)} mi · ~${formatArea(areaMi2)} mi²`}
            </SansBody>
          </View>

          <View style={{ marginTop: 22 }}>
            <AmberCTA
              label={submitting ? 'Saving…' : 'Save zone'}
              onPress={handleSave}
              loading={submitting}
            />
            <Pressable
              onPress={onCancel}
              hitSlop={12}
              style={({ pressed }) => [
                { alignItems: 'center', paddingVertical: 14, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <SansBody style={{ color: tokens.color.text.secondary, fontSize: 14 }}>
                Cancel
              </SansBody>
            </Pressable>
          </View>
        </BottomSheetView>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

/* ---------------- sign-in gate ---------------- */

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
      </View>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 32 }}>
        <NarrativeText style={{ marginBottom: 14 }}>
          Watch zones live with your account so you can check them across devices.
          One-tap email sign-in. No password.
        </NarrativeText>
        <AmberCTA label="Continue with email" onPress={() => router.push('/sign-in')} />
      </View>
    </View>
  );
}

/* ---------------- helpers ---------------- */

function maybeDismiss(onConfirm: () => void) {
  // No draft state to lose for v1.0.1 — there's nothing in flight that the
  // user shouldn't lose by closing. If/when polygon mode lands with mid-edit
  // state, gate the close behind a "Discard?" alert here.
  onConfirm();
}

function defaultZoneName(): string {
  // Date-based fallback used at SaveSheet mount before the reverse-geocode
  // returns. Once the RPC resolves, the SaveSheet replaces this with the
  // place-based label ("Ojai, CA") unless the user has already typed.
  const today = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Watch area — ${months[today.getMonth()]} ${today.getDate()}`;
}

function formatRadius(mi: number): string {
  if (mi < 1) return mi.toFixed(2);
  return mi.toFixed(1);
}

function formatArea(mi2: number): string {
  if (mi2 < 1) return mi2.toFixed(1);
  if (mi2 < 10) return mi2.toFixed(1);
  return Math.round(mi2).toLocaleString();
}

/**
 * Tessellate a circle to N vertices for storage as a polygon. Equally spaced
 * around the centroid, in lat/lng space — the slight lng-distortion at high
 * latitudes is acceptable at zone scale (≤500 mi²). Closes implicitly via
 * the create_watch_zone RPC ring-close.
 */
function circleToPolygon(
  center: CenterPoint,
  radiusMeters: number,
  segments: number,
): { lat: number; lng: number }[] {
  const earthR = 6371000;
  const verts: { lat: number; lng: number }[] = [];
  const latRad = (center.lat * Math.PI) / 180;
  const angularDist = radiusMeters / earthR;
  for (let i = 0; i < segments; i++) {
    const bearing = (i / segments) * 2 * Math.PI;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const sinD = Math.sin(angularDist);
    const cosD = Math.cos(angularDist);
    const lat2 = Math.asin(sinLat * cosD + cosLat * sinD * Math.cos(bearing));
    const lng2 =
      (center.lng * Math.PI) / 180 +
      Math.atan2(
        Math.sin(bearing) * sinD * cosLat,
        cosD - sinLat * Math.sin(lat2),
      );
    verts.push({ lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI });
  }
  return verts;
}

