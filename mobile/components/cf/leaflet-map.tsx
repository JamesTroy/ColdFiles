/**
 * LeafletMap — WebView wrapping Leaflet 1.9 + OSM raster tiles.
 *
 * The native MapLibre / Mapbox / @rnmapbox stack hits the same upstream
 * GL-surface measurement bug under Fabric (newArchEnabled = true). This
 * renderer bypasses the React Native layout chain entirely — Leaflet
 * sits inside a WebView, draws into the WebView's own DOM, and never
 * touches a native GL surface.
 *
 * The pin grammar (filled / ring+dot / open ring + selection halo +
 * recency ring) serializes to inline SVG inside Leaflet `divIcon`s, so
 * the visual contract matches the SVG MapCanvas and the (deferred) native
 * MapLibre renderer one-for-one.
 *
 * Marker presses, region-change events, and "ready" come back over
 * window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload })).
 */

import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import {
  PIN_COLOR_BY_KIND,
  PIN_SHAPE_BY_KIND,
  tokens,
} from '@/constants/theme';

import { type PinKind } from './pin';

export interface LeafletMarker {
  id: string;
  lat: number;
  lng: number;
  kind: PinKind;
  selected?: boolean;
  /** Days since last_changed_at (or null). Drives the recency ring. */
  recentDays?: number | null;
  /**
   * Geocoder precision tier. 'address' / 'street' render as the
   * standard sharp pin (real position). Anything coarser ('city',
   * 'county', 'unknown') renders with reduced fill opacity + dashed
   * outline — the visual cue "this point is approximate, somewhere
   * in the city/county, not the exact event coordinate."
   *
   * Optional because pre-migration-34 / sample-data rows don't carry
   * precision; renderer treats undefined as 'address' (sharp pin) for
   * backward compatibility.
   *
   * 'state' is filtered server-side and never reaches here.
   */
  precision?: 'address' | 'street' | 'city' | 'county' | 'unknown' | null;
  /**
   * Optional preview content rendered inside the in-map popup that opens
   * on a marker tap. Three lines: title (victim name), meta line
   * (kind · year · state), and a "Read full file →" call to action.
   * Plain text — no HTML — sanitized into divs by the WebView side.
   */
  popup?: {
    title: string;
    meta: string;
  };
}

export interface LeafletZoneOverlay {
  id: string;
  /** GeoJSON Polygon: { type: 'Polygon', coordinates: [[ [lng,lat], ... ]] } */
  geojson: {
    type: 'Polygon';
    coordinates: [number, number][][];
  };
  label?: string | null;
}

interface LeafletMapProps {
  center: { lat: number; lng: number; zoomLevel?: number };
  markers: LeafletMarker[];
  /**
   * The "you are here" indicator. `fresh: true` enables the pulse halo;
   * leave it false / omit for stale fixes, the static default-center
   * placeholder, or when GPS is unavailable. The pulse implies live data —
   * never enable it for placeholders. See feedback_design_pulse_only_when_fresh
   * in the project memory.
   */
  here?: { lat: number; lng: number; fresh?: boolean } | null;
  /**
   * The user's saved watch zones to render as low-opacity amber polygons
   * underneath the case pins. Empty array → no overlay. Independent of
   * `zonesVisible` so the parent can show/hide without re-fetching the
   * zone list.
   */
  zones?: LeafletZoneOverlay[];
  /** Defaults to true. Tied to the layer-stack Z toggle. */
  zonesVisible?: boolean;
  /**
   * Fired when the user taps a marker-cluster cluster icon whose
   * children all share the same lat/lng, OR a marker that has other
   * markers stacked at its exact coord. The parent should open a
   * sheet listing the cases at that coordinate. Coordinates returned
   * are the cluster/marker's lat/lng (5-decimal post-snap precision).
   */
  onCoincidentCluster?: (coord: { lat: number; lng: number }) => void;
  /** Fired when the user taps a marker — selects it without opening detail. */
  onMarkerPress?: (id: string) => void;
  /**
   * Fired when the user taps "Read full file →" inside the in-map popup.
   * Distinct from onMarkerPress so the parent can branch: pin tap selects,
   * popup CTA navigates. Defaults to no-op if not provided.
   */
  onMarkerOpen?: (id: string) => void;
  onRegionChange?: (region: {
    bounds: {
      minLng: number;
      minLat: number;
      maxLng: number;
      maxLat: number;
    };
    /**
     * Current Leaflet zoom (fractional). Consumer typically calls
     * `Math.floor(zoom)` and routes between cases_in_bbox (zoom ≥ 8)
     * and cases_grid_in_bbox (zoom < 8) via aggregationForZoom() in
     * use-cases-in-bbox.ts.
     */
    zoom: number;
  }) => void;
}

// Module-level memory of the last-viewed map center. Survives Leaflet
// WebView remounts within a single JS session — when Android reclaims
// the WebView under memory pressure (commonly while case detail occludes
// the map), the WebView reloads on return and would otherwise snap to
// the user-location default via the auto-pan effect. Persisting the
// region across remounts keeps the user where they were browsing.
let lastViewedCenter: { lat: number; lng: number; zoomLevel?: number } | null = null;

export function LeafletMap({
  center,
  markers,
  here,
  zones = [],
  zonesVisible = true,
  onCoincidentCluster,
  onMarkerPress,
  onMarkerOpen,
  onRegionChange,
}: LeafletMapProps) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);

  // Use the remembered center on remount when one exists. The first ever
  // mount in a session falls through to the parent-supplied center
  // (typically the user's last-known location).
  const html = useMemo(
    () => buildLeafletHtml(lastViewedCenter ?? center, here ?? null, markers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // markersKey is a stable identity for the marker set. We re-push markers
  // only when this changes — NOT on every re-render or on incidental order
  // changes from the cases-in-bbox refetch. Re-pushing markers calls
  // clearLayers() under the hood, which collapses any open cluster
  // spiderfy: the user taps a "2" cluster → it spiderfies into 2 pins →
  // the bbox shifts slightly during the animation → React refetches →
  // markers re-push → spiderfy collapses → user is back to the "2" dot
  // before they can tap a pin. Stable key fixes that.
  // markersKey deliberately omits `selected`. Selection state mutates in
  // place via __cf_setSelectedMarker, never via marker remove+add — that
  // path lets the user tap a pin in an open spiderfy without closing the
  // spider. Including `selected` here would re-push the marker on every
  // tap, fire layeradd/layerremove on the cluster group, and snap the
  // pins back to the cluster dot before the popup could surface.
  const markersKey = useMemo(
    () =>
      markers
        .map((m) => `${m.id}|${m.lat.toFixed(5)}|${m.lng.toFixed(5)}|${m.kind}|${m.recentDays ?? ''}|${m.precision ?? ''}`)
        .sort()
        .join(','),
    [markers],
  );
  const markersJson = useMemo(() => JSON.stringify(markers), [markers]);
  const selectedMarkerId = useMemo(
    () => markers.find((m) => m.selected)?.id ?? null,
    [markers],
  );
  const hereJson = JSON.stringify(here ?? null);
  const zonesJson = JSON.stringify(zones);

  // Only re-push markers when the stable key changes. The other channels
  // (here / zones / selection) are independent and can update freely.
  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(`
      try {
        window.__cf_setMarkers && window.__cf_setMarkers(${markersJson});
      } catch (e) {}
      true;
    `);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markersKey]);

  // Selection channel — push the currently-selected marker id into the
  // WebView. The dedicated function mutates icons in place (setIcon),
  // not via remove+add, so an open spiderfy isn't disturbed by tapping
  // a pin inside it.
  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(`
      try {
        window.__cf_setSelectedMarker &&
          window.__cf_setSelectedMarker(${selectedMarkerId == null ? 'null' : JSON.stringify(selectedMarkerId)});
      } catch (e) {}
      true;
    `);
  }, [ready, selectedMarkerId]);

  // Here-marker channel — high-frequency (every GPS sample). Isolated
  // from zones so a steady GPS cadence doesn't keep re-firing the
  // zone-layer clear-and-rebuild path, which would emit layeradd/
  // layerremove events on the map and close any open cluster spiderfy.
  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(`
      try {
        window.__cf_setHere && window.__cf_setHere(${hereJson});
      } catch (e) {}
      true;
    `);
  }, [ready, hereJson]);

  // Zones channel — fires only when the user's actual zone list changes
  // (rare — drawing or deleting a zone) or when the visibility toggle
  // flips. No longer tied to GPS cadence.
  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(`
      try {
        window.__cf_setZones && window.__cf_setZones(${zonesJson}, ${zonesVisible ? 'true' : 'false'});
      } catch (e) {}
      true;
    `);
  }, [ready, zonesJson, zonesVisible]);

  // Auto-pan the map to the user once we have a real location fix.
  //
  // Three pan triggers:
  //   1. First fix per mount: pan once when `here` first arrives at a
  //      non-placeholder position (HTML bakes the placeholder center on
  //      mount; without this effect, the dot moves but the viewport
  //      stays parked over the placeholder).
  //   2. Fresh rising edge: useHere flips here.fresh false→true after an
  //      explicit `requestAndAcquire()` (FAB tap, onboarding completion).
  //      Treat that as the user asking for a recenter — pan regardless
  //      of distance, even if we just panned 100m ago.
  //   3. Big jump (>5km): the user opened the app from a new city/state.
  //      Pan to follow. 5km is wide enough that walking around won't
  //      retrigger and fight a user who panned to browse.
  // Small unprompted movements (<5km) only update the dot via __cf_setHere
  // and don't disturb the viewport — respects map browsing.
  // If a lastViewedCenter was restored on mount, skip the "first fix per
  // mount" auto-pan — the user was already browsing somewhere, don't yank
  // them back to their own location. `freshRising` (explicit recenter
  // request) and `>5km jump` triggers still apply.
  const pannedOnceRef = useRef(lastViewedCenter !== null);
  const lastPannedRef = useRef<{ lat: number; lng: number } | null>(null);
  const prevFreshRef = useRef(false);
  useEffect(() => {
    if (!ready || !here) return;
    const isPlaceholder =
      here.lat === tokens.map.defaultCenter.lat &&
      here.lng === tokens.map.defaultCenter.lng;
    const freshRising = !prevFreshRef.current && !!here.fresh;
    prevFreshRef.current = !!here.fresh;
    if (isPlaceholder) return;

    let shouldPan = false;
    if (!pannedOnceRef.current) {
      shouldPan = true;
    } else if (freshRising) {
      shouldPan = true;
    } else if (lastPannedRef.current) {
      const km = haversineKm(lastPannedRef.current, here);
      if (km > 5) shouldPan = true;
    }
    if (!shouldPan) return;

    pannedOnceRef.current = true;
    lastPannedRef.current = { lat: here.lat, lng: here.lng };
    webRef.current?.injectJavaScript(`
      try { window.__cf_setCenter && window.__cf_setCenter(${JSON.stringify({
        lat: here.lat,
        lng: here.lng,
      })}); } catch (e) {}
      true;
    `);
  }, [ready, here]);

  // Whenever the parent's size changes, force Leaflet to re-measure. Covers
  // device rotation and any case where the WebView grew after Leaflet's init.
  const onLayout = (_e: LayoutChangeEvent) => {
    if (ready && webRef.current) {
      webRef.current.injectJavaScript(`
        try { window.__cf_invalidate && window.__cf_invalidate(); } catch (e) {}
        true;
      `);
    }
  };

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') {
        setReady(true);
      } else if (msg.type === 'marker') {
        // Light haptic on tap. Pairs with the .cf-pin-press CSS animation
        // inside the WebView — the press feels like a single, intentional act
        // even though the visual + tactile sides are dispatched separately.
        Haptics.selectionAsync().catch(() => {
          /* haptic engine missing or denied — silent */
        });
        onMarkerPress?.(msg.id);
      } else if (msg.type === 'popup-open' && msg.id) {
        // User tapped "Read full file →" inside the in-map popup.
        // Heavier haptic to mirror the visit-detail CTA gravity, then
        // fire onMarkerOpen so the parent can route to /case/[slug].
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onMarkerOpen?.(msg.id);
      } else if (msg.type === 'coincident-cluster') {
        // User tapped a coincident-coord cluster (low zoom) or a stacked
        // pin (high zoom past clustering threshold). Light haptic same
        // as marker tap, then surface the coord so the parent can open
        // a list sheet of cases sharing this lat/lng.
        Haptics.selectionAsync().catch(() => {});
        if (typeof msg.lat === 'number' && typeof msg.lng === 'number') {
          onCoincidentCluster?.({ lat: msg.lat, lng: msg.lng });
        }
      } else if (msg.type === 'region') {
        // Capture center+zoom for the next mount's initial position so
        // navigating away and back doesn't snap the map to user-location.
        if (msg.center) {
          lastViewedCenter = {
            lat: msg.center.lat,
            lng: msg.center.lng,
            zoomLevel: msg.center.zoomLevel,
          };
        }
        if (onRegionChange) {
          onRegionChange({
            bounds: msg.bounds,
            zoom: msg.center?.zoomLevel ?? 0,
          });
        }
      }
    } catch {
      // non-JSON message from injected script — ignore
    }
  };

  return (
    <View
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: tokens.color.bg.base,
      }}
      onLayout={onLayout}
    >
      <WebView
        ref={webRef}
        source={{ html }}
        originWhitelist={['https://basemaps.cartocdn.com', 'https://a.basemaps.cartocdn.com', 'https://b.basemaps.cartocdn.com', 'https://c.basemaps.cartocdn.com', 'https://d.basemaps.cartocdn.com', 'https://unpkg.com', 'about:blank']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: tokens.color.bg.base,
        }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        cacheEnabled
        androidLayerType="hardware"
        scrollEnabled={false}
        bounces={false}
        mixedContentMode="never"
      />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  HTML generation                                                            */
/* -------------------------------------------------------------------------- */

function buildLeafletHtml(
  center: { lat: number; lng: number; zoomLevel?: number },
  here: { lat: number; lng: number } | null,
  initialMarkers: LeafletMarker[],
): string {
  const initialZoom = center.zoomLevel ?? 9;
  const pinPalette = {
    homicide: PIN_COLOR_BY_KIND.homicide,
    missing: PIN_COLOR_BY_KIND.missing,
    unidentified: PIN_COLOR_BY_KIND.unidentified,
    unclaimed: PIN_COLOR_BY_KIND.unclaimed,
    suspicious_death: PIN_COLOR_BY_KIND.suspicious_death,
  } satisfies Record<PinKind, string>;
  const shapeMap = PIN_SHAPE_BY_KIND;
  const clusterTokens = {
    fill: tokens.color.cluster.fill,
    ring: tokens.color.cluster.ring,
    halo: tokens.color.cluster.halo,
    text: tokens.color.cluster.text,
  };

  return /* html */ `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
  <style>
    html, body, #map {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: ${tokens.color.bg.base};
      -webkit-tap-highlight-color: transparent;
    }
    /* Carto Dark Matter is already styled-dark; just nudge it a touch toward
       the file-cabinet base color. Filter is light because the basemap was
       designed for overlay data — heavy filtering crushes road contrast. */
    .leaflet-tile-pane {
      filter: brightness(0.85) saturate(0.7);
    }
    .leaflet-control-attribution {
      background: rgba(10, 10, 10, 0.6) !important;
      color: ${tokens.color.text.disabled} !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 9px !important;
      padding: 2px 6px !important;
    }
    .leaflet-control-attribution a {
      color: ${tokens.color.text.secondary} !important;
    }
    .leaflet-container {
      background: ${tokens.color.bg.base};
      outline: none;
    }
    /* Marker icons: SVG owns its own positioning, the wrapping div is a hit target.
       Two-stop drop-shadow gives the pin separation from the dimmed OSM basemap:
       the first stop is a tight 0.5px rim outline that hairlines the pin against
       any tile color (water, road, park) without introducing a hard ink line that
       fights the design grammar; the second stop is a soft falloff for depth. */
    .cf-pin {
      background: transparent;
      border: 0;
    }
    .cf-pin svg {
      filter:
        drop-shadow(0 0 0.5px rgba(10, 10, 10, 0.85))
        drop-shadow(0 1px 3px rgba(0, 0, 0, 0.45));
      transition: transform 120ms cubic-bezier(0.4, 0, 0.2, 1);
      transform-origin: center center;
    }
    /* Tap feedback — momentary squeeze. Class is added on click and removed on
       animation end so it can re-trigger immediately. */
    .cf-pin-press svg {
      animation: cf-pin-press 220ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    @keyframes cf-pin-press {
      0%   { transform: scale(1); }
      35%  { transform: scale(0.82); }
      100% { transform: scale(1); }
    }
    /* Imprecise-precision modifier — applied to pins whose underlying
       case has location_precision in (city, county, unknown). Visual
       cue that the point is approximate (city centroid pile-up, etc.)
       rather than a real event coordinate.

       Two cues stacked:
         1. Reduced fill opacity on the SVG pin (faded amber instead
            of solid).
         2. Dashed amber halo behind the pin via box-shadow inset on
            the wrapper div.

       Tap interaction stays the same (tap → select → popup); the
       coincident-cluster detection (multiple pins at same coord →
       sheet) also fires on these pins as on precise ones. */
    .cf-pin--imprecise svg {
      opacity: 0.55;
    }
    .cf-pin--imprecise {
      border: 1.5px dashed ${tokens.color.cluster.ring};
      border-radius: 50%;
      background: rgba(197, 165, 114, 0.08);
      box-sizing: content-box;
      margin: -2px;
      padding: 1px;
    }
    /* "You are here" — solid blue dot, no concentric rings (those collide
       with the open-ring Doe pin grammar). The halo is a separate element
       underneath that pulses ONLY when the location fix is fresh. A pulsing
       dot implies live tracking; a static placeholder must not pulse. */
    .cf-here {
      background: transparent;
      border: 0;
      position: relative;
    }
    .cf-here-dot,
    .cf-here-halo {
      position: absolute;
      top: 50%;
      left: 50%;
      border-radius: 50%;
      background: ${tokens.color.you.here};
    }
    .cf-here-dot {
      width: 12px;
      height: 12px;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 0 1.5px rgba(10, 10, 10, 0.7), 0 1px 3px rgba(0, 0, 0, 0.5);
      z-index: 2;
    }
    .cf-here-halo {
      width: 12px;
      height: 12px;
      transform: translate(-50%, -50%) scale(1);
      opacity: 0;
      z-index: 1;
    }
    /* Soft-breathing pulse: wide scale (→2.5×), low alpha (0.4→0).
       Anything tighter reads as a chunky throb. */
    .cf-here-fresh .cf-here-halo {
      animation: cf-here-pulse 2s ease-out infinite;
    }
    @keyframes cf-here-pulse {
      0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.4; }
      100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
    }
    /* Cluster icon — translucent amber-haze disc + amber ring + soft halo.
       Reads as "indexed archive" rather than generic data point. The ring
       carries the brand amber; the disc is the same amber at low alpha so
       map tiles show through (you can see WHERE the cluster sits, not just
       that there's a cluster there). */
    .cf-cluster {
      background: transparent;
      border: 0;
    }
    .cf-cluster-inner {
      border-radius: 50%;
      background: ${tokens.color.cluster.fill};
      border: 1.5px solid ${tokens.color.cluster.ring};
      box-shadow:
        0 0 0 6px ${tokens.color.cluster.halo},
        0 1px 3px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${tokens.color.cluster.text};
      font-family: ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    /* Defang the markercluster default classes so they don't bleed through. */
    .marker-cluster, .marker-cluster div { background: transparent !important; color: transparent !important; }

    /* Case-file popup. Replaces leaflet's default white-rectangle styling
       with a token-matched dark card. The .leaflet-popup-content-wrapper
       and .leaflet-popup-tip are leaflet's own classes for the body and
       arrow respectively; our .cf-popup-wrap class on bindPopup options
       lets us scope the overrides without touching unrelated popups. */
    .cf-popup-wrap .leaflet-popup-content-wrapper {
      background: ${tokens.color.bg.elev1};
      color: ${tokens.color.text.primary};
      border: 0.5px solid ${tokens.color.border.strong};
      border-radius: 8px;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
      padding: 0;
    }
    .cf-popup-wrap .leaflet-popup-content {
      margin: 0;
      padding: 12px 14px 12px 14px;
      min-width: 180px;
      max-width: 240px;
      line-height: 1.35;
    }
    .cf-popup-wrap .leaflet-popup-tip {
      background: ${tokens.color.bg.elev1};
      border: 0.5px solid ${tokens.color.border.strong};
    }
    .cf-popup-title {
      font-family: 'Newsreader', Georgia, 'Times New Roman', serif;
      font-size: 16px;
      font-weight: 500;
      color: ${tokens.color.text.primary};
      margin-bottom: 4px;
    }
    .cf-popup-meta {
      font-family: ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace;
      font-size: 10px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: ${tokens.color.text.secondary};
      margin-bottom: 10px;
    }
    .cf-popup-cta {
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace;
      font-size: 11px;
      letter-spacing: 0.04em;
      color: ${tokens.color.accent.amber};
      text-decoration: none;
      padding: 4px 0 0 0;
    }
    .cf-popup-cta:active { opacity: 0.7; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
  <script>
    (function () {
      var PALETTE = ${JSON.stringify(pinPalette)};
      var SHAPE   = ${JSON.stringify(shapeMap)};
      var TOKENS  = ${JSON.stringify({
        amber: tokens.color.accent.amber,
        amberHot: tokens.color.accent.amberHot,
        haloScale: tokens.pin.selected.haloScale,
        haloAlpha: tokens.pin.selected.haloAlpha,
        recentScale: tokens.pin.recent.ringScale,
        youHere: tokens.color.you.here,
      })};
      var CLUSTER = ${JSON.stringify(clusterTokens)};

      function postMessage(obj) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(obj));
        }
      }

      // HTML-escape a string before injecting into a popup body. We don't
      // run user-supplied content through here (case names + meta come
      // from our schema), but defensive escaping prevents a malformed
      // value from breaking the popup's structure or letting an in-name
      // ampersand render as an entity.
      function escapeHtml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      // Popup CTA delegation. Inline onclick handlers are fragile across
      // WebView quirks (CSP, scope, escaping). Using a single delegated
      // listener at the map container with a [data-cf-open="<id>"]
      // attribute on the anchor is more robust and keeps the bindPopup
      // HTML free of script. Stop propagation so leaflet doesn't treat
      // the tap as a map click.
      document.addEventListener('click', function (e) {
        var target = e && e.target;
        // Walk up to find the data-cf-open ancestor (target may be a
        // descendant element when fonts/icons render inside).
        for (var i = 0; i < 4 && target; i++) {
          if (target.getAttribute && target.getAttribute('data-cf-open')) {
            var openId = target.getAttribute('data-cf-open');
            e.preventDefault();
            e.stopPropagation();
            postMessage({ type: 'popup-open', id: openId });
            return;
          }
          target = target.parentNode;
        }
      });

      function recentAlphaFor(days) {
        if (days == null) return 0;
        if (days <= 3) return 1;
        if (days <= 10) return 0.5;
        return 0;
      }

      function strokeForDiameter(d) {
        return Math.max(1.5, Math.round(d / 8));
      }

      // Inline SVG matching components/cf/pin.tsx exactly.
      //
      // Canvas sizing: the largest visible element across all states is the
      // selection halo (1.6× diameter) or the recent ring (1.4× diameter).
      // Each ring's outer-edge sits at half-stroke beyond its nominal radius,
      // so without padding the SVG canvas viewBox would clip the outer half-
      // stroke on the right and bottom edges — visible as a sliced halo /
      // recency ring on selected or recently-updated pins.
      function pinSvg(opts) {
        var diameter = opts.diameter || 14;
        var color = PALETTE[opts.kind] || PALETTE.homicide;
        var shape = SHAPE[opts.kind] || 'filled';
        var stroke = strokeForDiameter(diameter);
        // Inner-dot ratio: 50% on the ring_dot pin (missing). The 40% the
        // pin renderer originally used produced a 7px dot on an 18px ring,
        // which read as a "pinprick" indistinguishable from a tiny filled
        // homicide pin at scroll speed. 50% lands at 9px — clearly a "ring
        // with a centered dot", which is the design-system grammar.
        var inner = diameter * 0.5;
        var haloD = opts.selected ? diameter * TOKENS.haloScale : 0;
        var recAlpha = recentAlphaFor(opts.recentDays);
        var recD = recAlpha > 0 ? diameter * TOKENS.recentScale : 0;
        // Largest stroke-width across whichever rings will be drawn this frame.
        // Pad the canvas by that half-width so no ring's outer edge clips.
        var haloStroke = opts.selected ? strokeForDiameter(haloD) : 0;
        var recStroke = recD > 0 ? Math.max(1, strokeForDiameter(recD) - 0.5) : 0;
        var maxStroke = Math.max(stroke, haloStroke, recStroke);
        var canvas = Math.max(diameter, haloD, recD) + maxStroke;
        var cx = canvas / 2;
        var cy = canvas / 2;
        var parts = [];

        // Selection treatment: a soft amber disc behind the pin (15% alpha)
        // reads as "this is the answer" with more confidence than a hairline
        // ring around the pin. The thin amber ring around the disc keeps the
        // grammar consistent with the existing token (haloScale × diameter).
        if (opts.selected) {
          parts.push(
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + (haloD / 2) + '" ' +
            'fill="' + TOKENS.amber + '" fill-opacity="0.15" />'
          );
          parts.push(
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + (haloD / 2) + '" ' +
            'stroke="' + TOKENS.amber + '" stroke-width="' + haloStroke + '" ' +
            'stroke-opacity="0.6" fill="none" />'
          );
        }

        // Recent ring (drawn after halo so the amberHot lands on top of the
        // halo's amber tone, not buried under it). For selected+recent the
        // hot ring sits inside the selection halo — see design system spec.
        if (recD > 0) {
          parts.push(
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + (recD / 2) + '" ' +
            'stroke="' + TOKENS.amberHot + '" stroke-width="' + recStroke + '" ' +
            'stroke-opacity="' + recAlpha + '" fill="none" />'
          );
        }

        // Base shape
        if (shape === 'filled') {
          parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (diameter / 2) + '" fill="' + color + '" />');
        } else if (shape === 'open_ring') {
          // Doe pins (open ring) get a 25% alpha cream fill so they read as a
          // tinted lens rather than a hole on low-contrast tiles. The earlier
          // 10% pass was too conservative — the pin still disappeared into
          // water and dim-park tiles. 25% reads as "this is a cream-tinted
          // pin with an open-ring stroke" while keeping the open-ring shape
          // grammar (the stroke still encodes the kind, the fill just
          // surfaces the pin's interior).
          parts.push(
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + (diameter / 2 - stroke / 2) + '" ' +
            'fill="' + color + '" fill-opacity="0.25" />'
          );
          parts.push(
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + (diameter / 2 - stroke / 2) + '" ' +
            'stroke="' + color + '" stroke-width="' + stroke + '" fill="none" />'
          );
          if (opts.selected) {
            parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (inner / 2) + '" fill="' + TOKENS.amber + '" />');
          }
        } else if (shape === 'ring_dot') {
          parts.push(
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + (diameter / 2 - stroke / 2) + '" ' +
            'stroke="' + color + '" stroke-width="' + stroke + '" fill="none" />'
          );
          parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (inner / 2) + '" fill="' + color + '" />');
        }

        return {
          html: '<svg width="' + canvas + '" height="' + canvas + '" viewBox="0 0 ' + canvas + ' ' + canvas + '" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">' + parts.join('') + '</svg>',
          size: canvas,
        };
      }

      // YouAreHere is two stacked div elements (dot + halo) inside a divIcon
      // big enough to accommodate the halo's 2.5× pulse. The dot is solid;
      // the halo only animates when fresh === true.
      function hereHtml(fresh) {
        var size = 36; // 12px dot × 2.5 halo + a bit of slack
        var className = 'cf-here' + (fresh ? ' cf-here-fresh' : '');
        return {
          html:
            '<div class="' + className + '" style="width:' + size + 'px;height:' + size + 'px;">' +
              '<span class="cf-here-halo"></span>' +
              '<span class="cf-here-dot"></span>' +
            '</div>',
          size: size,
        };
      }

      var map = L.map('map', {
        center: [${center.lat}, ${center.lng}],
        zoom: ${initialZoom},
        zoomControl: false,
        attributionControl: true,
      });

      // Carto Dark Matter (no labels) — pre-styled dark monochrome basemap
      // designed by Stamen for Carto, specifically tuned to "get out of the
      // way" of overlay data. Strips POI / commercial labels / landuse;
      // keeps water + roads + boundaries. The Cold File pins carry the
      // visual weight; the basemap is forensic chart, not destination map.
      // Free, no API key, subdomain-rotated for performance.
      // keepBuffer 8 (default 2) — Leaflet retains 8 tile-rings outside
      // the visible viewport instead of discarding aggressively. Eats a
      // bit more memory in exchange for far less white-tile flashing
      // when the user pans, which is the dominant 'lag' experience on
      // a WebView-backed map. Combined with the subdomain rotation
      // ({s} = a/b/c/d) over Carto's CDN, tile latency for a
      // freshly-revealed area drops to near-zero in cached regions.
      // updateWhenIdle false (default) keeps tiles streaming during pan,
      // which is what we want — the 'lag' isn't from waiting for
      // pan-end, it's from tiles not being ready.
      // crossOrigin true lets the browser tile cache deduplicate
      // requests across pans/zooms.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '© OpenStreetMap contributors, © CARTO',
        keepBuffer: 8,
        updateWhenIdle: false,
        crossOrigin: true,
      }).addTo(map);

      // Region change → debounced postMessage so the consumer can refetch.
      // Includes both bounds (for the cases query) and center+zoom (for
      // the React-side last-viewed memory that survives WebView remount).
      var regionTimer = null;
      map.on('moveend zoomend', function () {
        if (regionTimer) clearTimeout(regionTimer);
        regionTimer = setTimeout(function () {
          var b = map.getBounds();
          var c = map.getCenter();
          postMessage({
            type: 'region',
            bounds: {
              minLng: b.getWest(),
              minLat: b.getSouth(),
              maxLng: b.getEast(),
              maxLat: b.getNorth(),
            },
            center: {
              lat: c.lat,
              lng: c.lng,
              zoomLevel: map.getZoom(),
            },
          });
        }, 200);
      });

      // Cluster icon — sized by count via tokens.cluster.diameterFor (24/32/40).
      function clusterIconFor(cluster) {
        var count = cluster.getChildCount();
        var diameter = count >= 50 ? 40 : count >= 10 ? 32 : 24;
        var fontSize = count >= 50 ? 13 : count >= 10 ? 12 : 11;
        return L.divIcon({
          className: 'cf-cluster',
          html:
            '<div class="cf-cluster-inner" style="width:' + diameter + 'px;height:' + diameter + 'px;font-size:' + fontSize + 'px;">' +
              count +
            '</div>',
          iconSize: [diameter, diameter],
          iconAnchor: [diameter / 2, diameter / 2],
        });
      }

      // Zone overlays sit BENEATH the markers/clusters so case pins read
      // first and the zone is recognizable but quiet. addTo before the
      // marker cluster ensures z-order.
      var zoneLayer = L.layerGroup().addTo(map);
      var zoneVisibleState = true;

      window.__cf_setZones = function (list, visible) {
        zoneLayer.clearLayers();
        zoneVisibleState = !!visible;
        if (!Array.isArray(list) || !zoneVisibleState) return;
        for (var zi = 0; zi < list.length; zi++) {
          var z = list[zi];
          if (!z || !z.geojson) continue;
          try {
            // Spec §7: low-opacity amber. Visible enough to remind, quiet
            // enough not to compete with case pins.
            L.geoJSON(z.geojson, {
              style: {
                color: '${tokens.color.accent.amber}',
                weight: 1.25,
                opacity: 0.45,
                fillColor: '${tokens.color.accent.amber}',
                fillOpacity: 0.10,
              },
              interactive: false,
            }).addTo(zoneLayer);
          } catch (e) { /* skip malformed */ }
        }
      };

      // Cluster click behavior: always spiderfy, never zoom-to-bounds.
      // The default (zoomToBoundsOnClick: true + spiderfyOnMaxZoom: true)
      // creates a noticeable dance where the map zooms in, then either
      // spiderfies or doesn't depending on whether the children are still
      // clustered post-zoom. The transition reads as "tapped cluster,
      // pins flash, snaps back to cluster" because the zoom-in animation
      // can re-cluster mid-flight as the bbox refetch lands new data.
      // Forcing spiderfy on every click skips the zoom entirely — pins
      // fan out around the cluster center in a stable animation that
      // doesn't depend on bbox math. spiderfyDistanceMultiplier widens
      // the fan so 6+ pins remain tappable without overlap.
      // disableClusteringAtZoom:13 means once the user zooms in past
      // street-level (zoom 13 ~= city), pins render individually with
      // no clustering at all. Spiderfy was unreliable in earlier
      // releases — the click animation would visibly flash and snap
      // back. Skipping clustering entirely at moderate zoom is a
      // simpler UX: zoom in to disambiguate, never tap a cluster.
      // Below zoom 13 (regional / country view), clustering still
      // applies so the map doesn't render thousands of pins.
      // Tap-to-zoom on remaining clusters: the parent map jumps to
      // the cluster's bounds, naturally crossing the zoom-13 threshold
      // and surfacing the individual pins.
      // Tightened cluster radius (50 → 30 px) plus disableClusteringAtZoom
      // means jittered coincident pins separate at zoom 13+. With the
      // 0.003° jitter applied React-side, group members at the same
      // source coordinate land ~330-660m apart, which exceeds 30 px at
      // any zoom 13+. Combined: no spiderfy, no spiral, no snap-back.
      // No spiderfy. Clusters disable at zoom 14 — needs to be high
      // enough that the React-side ~330m jitter on coincident pins
      // resolves to enough pixels for non-overlapping pin icons.
      //   zoom 11: 0.003° ≈ ~4 px → pins overlap heavily
      //   zoom 13: 0.003° ≈ ~17 px → pin icons (18-22 px) still touch
      //   zoom 14: 0.003° ≈ ~35 px → pins clearly separated
      // 14 is the right floor for the disable threshold.
      // zoomToBoundsOnClick is left on so cluster taps zoom in to fit
      // the cluster's bounds. With clusters disabled at 14, that zoom
      // typically crosses the threshold and surfaces individual pins.
      var markerLayer = L.markerClusterGroup({
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        spiderfyOnMaxZoom: false,
        disableClusteringAtZoom: 14,
        maxClusterRadius: 30,
        chunkedLoading: true,
        iconCreateFunction: clusterIconFor,
      }).addTo(map);

      // Coincident-coord cluster intercept: when a cluster's children
      // ALL share the same lat/lng (e.g., 211 cases at the LA city
      // centroid), the default zoomToBoundsOnClick is a no-op (one
      // point → zero-area bounds → no zoom). Tap looks broken. Stop
      // the default and post a 'coincident-cluster' message so the
      // React side opens a list sheet of cases at that coord.
      //
      // Non-coincident clusters (genuine spatial proximity of distinct
      // lat/lngs) keep the default behavior — fall through, zoom in.
      markerLayer.on('clusterclick', function (e) {
        var children = e.layer.getAllChildMarkers();
        if (!children || children.length < 2) return;
        var ll0 = children[0].getLatLng();
        var allSame = true;
        for (var ci = 1; ci < children.length; ci++) {
          var ll = children[ci].getLatLng();
          if (Math.abs(ll.lat - ll0.lat) > 1e-6 || Math.abs(ll.lng - ll0.lng) > 1e-6) {
            allSame = false;
            break;
          }
        }
        if (!allSame) return;
        // Suppress the default zoom-to-bounds and emit our own event.
        if (e.originalEvent) {
          L.DomEvent.stopPropagation(e.originalEvent);
          L.DomEvent.preventDefault(e.originalEvent);
        }
        postMessage({
          type: 'coincident-cluster',
          lat: ll0.lat,
          lng: ll0.lng,
        });
      });

      var hereMarker = null;

      // Trigger the press animation on a marker's icon. Removing the class
      // first + forcing reflow lets the same marker animate again on a
      // repeat tap.
      function pressFlash(marker) {
        var el = marker.getElement && marker.getElement();
        if (!el) return;
        el.classList.remove('cf-pin-press');
        // eslint-disable-next-line no-unused-expressions
        void el.offsetWidth;
        el.classList.add('cf-pin-press');
        setTimeout(function () {
          if (el && el.classList) el.classList.remove('cf-pin-press');
        }, 260);
      }

      // markerById tracks live Leaflet markers keyed by case slug. Used by
      // __cf_setMarkers to do an incremental diff (add new, remove gone)
      // instead of clearLayers/addLayers — clearLayers collapses any open
      // markercluster spiderfy, which manifests as the user-visible
      // bug of "tap cluster, spiderfy starts, snaps back to cluster
      // before the user can tap a pin."
      var markerById = Object.create(null);

      // coordCount tracks how many live markers share the same 5-decimal
      // (lat, lng) — i.e., post-snap coincident-coord pile-ups. The marker
      // click handler branches on it: solo → existing select+popup,
      // coincident → post a 'coincident-cluster' message so the React
      // side can open a list sheet of cases at that point. Maintained
      // alongside markerById through __cf_setMarkers' add/remove diff.
      var coordCount = Object.create(null);

      function buildMarker(m) {
        // Bumped from 14/16 → 18/22 for legibility against dimmed OSM tiles.
        // Build the icon at the un-selected baseline. Selection state is
        // applied via setIcon in __cf_setSelectedMarker — keeping it out
        // of the diff key prevents tap-to-select from triggering a
        // remove+add cycle on the cluster group, which would close any
        // open spiderfy and snap pins back to the cluster dot.
        var svg = pinSvg({
          kind: m.kind,
          diameter: m.selected ? 22 : 18,
          selected: !!m.selected,
          recentDays: m.recentDays,
        });
        // Precision tier — address/street precision render as the
        // standard sharp pin (real position). Anything coarser
        // ('city', 'county', 'unknown') gets the .cf-pin--imprecise
        // modifier: reduced opacity + dashed halo. Visual cue for
        // "this point is approximate." Pre-migration-34 rows that
        // don't carry precision render as standard pins (treated as
        // address-precision for backward compat).
        var precise =
          !m.precision || m.precision === 'address' || m.precision === 'street';
        var className = precise ? 'cf-pin' : 'cf-pin cf-pin--imprecise';
        var icon = L.divIcon({
          className: className,
          html: svg.html,
          iconSize: [svg.size, svg.size],
          iconAnchor: [svg.size / 2, svg.size / 2],
        });
        var id = m.id;
        var marker = L.marker([m.lat, m.lng], { icon: icon, keyboard: false });
        marker._cfId = id;
        marker._cfKind = m.kind;
        marker._cfRecentDays = m.recentDays;
        // _cfCoordKey is the 5-decimal-precision coord index used to
        // detect coincident-coord pile-ups at click time. Same precision
        // the rest of the file uses for coord comparison.
        marker._cfCoordKey =
          m.lat.toFixed(5) + '|' + m.lng.toFixed(5);
        marker._cfLat = m.lat;
        marker._cfLng = m.lng;
        // _cfKey deliberately excludes 'selected'. Selection mutations
        // ride a separate channel (setIcon, not remove+add) so the
        // open-spider state survives a tap on a pin in the spider.
        marker._cfKey =
          id + '|' + m.lat.toFixed(5) + '|' + m.lng.toFixed(5) +
          '|' + m.kind +
          '|' + (m.recentDays == null ? '' : m.recentDays) +
          '|' + (m.precision == null ? '' : m.precision);

        // Bind in-map popup with the case-file preview. HTML is hand-built
        // with already-escaped values (escapeHtml below) — leaflet will
        // render it as inert content. The "Read full file →" anchor calls
        // a top-level window.__cf_openCase(id) helper that posts back to
        // React for the navigation transition.
        if (m.popup) {
          var titleHtml = escapeHtml(m.popup.title || '');
          var metaHtml = escapeHtml(m.popup.meta || '');
          var idAttr = escapeHtml(id);
          var ctaHtml =
            '<a class="cf-popup-cta" href="#" data-cf-open="' + idAttr + '">Read full file →</a>';
          marker.bindPopup(
            '<div class="cf-popup">' +
              '<div class="cf-popup-title">' + titleHtml + '</div>' +
              (metaHtml ? '<div class="cf-popup-meta">' + metaHtml + '</div>' : '') +
              ctaHtml +
            '</div>',
            {
              closeButton: false,
              autoPan: true,
              autoPanPaddingTopLeft: [16, 16],
              autoPanPaddingBottomRight: [16, 96],
              className: 'cf-popup-wrap',
              maxWidth: 240,
            }
          );
        }

        marker.on('click', function () {
          pressFlash(marker);
          // Coincident-coord branch: if multiple markers share this
          // exact coord (e.g., 211 cases at the LA centroid 34.048,
          // -118.254), open the list sheet instead of selecting just
          // the topmost pin. At high zoom past disableClusteringAtZoom
          // the stack is otherwise inaccessible — only one of N pins
          // is visible/tappable.
          if ((coordCount[marker._cfCoordKey] || 0) > 1) {
            postMessage({
              type: 'coincident-cluster',
              lat: marker._cfLat,
              lng: marker._cfLng,
            });
            return;
          }
          // Selection still goes back so the React state knows what's
          // active (drives the bottom-sheet header / count UI).
          postMessage({ type: 'marker', id: id });
        });
        return marker;
      }

      window.__cf_setMarkers = function (list) {
        if (!Array.isArray(list)) return;

        // Build a quick lookup of incoming markers by id and by full key.
        var nextById = Object.create(null);
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].id) nextById[list[i].id] = list[i];
        }

        // Remove markers that aren't in the incoming list, plus markers
        // whose visual props changed (so the new icon ships).
        var toRemove = [];
        for (var id in markerById) {
          var existing = markerById[id];
          var incoming = nextById[id];
          if (!incoming) {
            toRemove.push(existing);
            delete markerById[id];
            // Decrement the coord index for the removed marker.
            var rk = existing._cfCoordKey;
            if (rk && coordCount[rk]) {
              coordCount[rk] -= 1;
              if (coordCount[rk] <= 0) delete coordCount[rk];
            }
            continue;
          }
          var newKey =
            incoming.id + '|' + incoming.lat.toFixed(5) + '|' + incoming.lng.toFixed(5) +
            '|' + incoming.kind +
            '|' + (incoming.recentDays == null ? '' : incoming.recentDays) +
            '|' + (incoming.precision == null ? '' : incoming.precision);
          if (existing._cfKey !== newKey) {
            toRemove.push(existing);
            delete markerById[id];
            // Removed-and-readded path: decrement here, the add loop
            // below will increment again with the (possibly new) coord.
            var rk2 = existing._cfCoordKey;
            if (rk2 && coordCount[rk2]) {
              coordCount[rk2] -= 1;
              if (coordCount[rk2] <= 0) delete coordCount[rk2];
            }
          }
        }
        if (toRemove.length) markerLayer.removeLayers(toRemove);

        // Add new markers (those not currently mapped, plus the ones we
        // just removed because their key changed).
        var toAdd = [];
        for (var j = 0; j < list.length; j++) {
          var m = list[j];
          if (!m || !m.id) continue;
          if (markerById[m.id]) continue;
          var built = buildMarker(m);
          markerById[m.id] = built;
          // Increment the coord index for the new marker.
          var ak = built._cfCoordKey;
          if (ak) coordCount[ak] = (coordCount[ak] || 0) + 1;
          toAdd.push(built);
        }
        if (toAdd.length) markerLayer.addLayers(toAdd);
      };

      // Tracks the currently-selected slug so we know which marker to
      // un-style when selection moves to a new one. null = no selection.
      var selectedMarkerId = null;

      // Mutate selection state in place via setIcon — does NOT fire
      // layeradd/layerremove. Lets the user tap a pin in an open
      // spiderfy without the spider closing under them.
      window.__cf_setSelectedMarker = function (slug) {
        // Demote the previous selection back to its baseline icon.
        if (selectedMarkerId && selectedMarkerId !== slug) {
          var prev = markerById[selectedMarkerId];
          if (prev) {
            var prevSvg = pinSvg({
              kind: prev._cfKind,
              diameter: 18,
              selected: false,
              recentDays: prev._cfRecentDays,
            });
            prev.setIcon(L.divIcon({
              className: 'cf-pin',
              html: prevSvg.html,
              iconSize: [prevSvg.size, prevSvg.size],
              iconAnchor: [prevSvg.size / 2, prevSvg.size / 2],
            }));
          }
        }
        // Promote the new selection. slug == null clears.
        if (slug && markerById[slug]) {
          var next = markerById[slug];
          var nextSvg = pinSvg({
            kind: next._cfKind,
            diameter: 22,
            selected: true,
            recentDays: next._cfRecentDays,
          });
          next.setIcon(L.divIcon({
            className: 'cf-pin',
            html: nextSvg.html,
            iconSize: [nextSvg.size, nextSvg.size],
            iconAnchor: [nextSvg.size / 2, nextSvg.size / 2],
          }));
        }
        selectedMarkerId = slug || null;
      };

      // Tracks the last-rendered fresh state so we only swap the icon
      // when fresh actually changes — most __cf_setHere calls are pure
      // position updates (GPS samples) and shouldn't touch the DOM.
      var hereFreshState = false;

      window.__cf_setHere = function (here) {
        // Null payload = clear the dot. Use removeLayer here only for
        // genuine teardown (rare in practice — useHere never sends null
        // post-init). The frequent path is the position update below.
        if (!here) {
          if (hereMarker) {
            map.removeLayer(hereMarker);
            hereMarker = null;
          }
          return;
        }

        var built = hereHtml(!!here.fresh);
        if (!hereMarker) {
          // First fix per WebView mount. Lazy-create.
          var icon = L.divIcon({
            className: '',
            html: built.html,
            iconSize: [built.size, built.size],
            iconAnchor: [built.size / 2, built.size / 2],
          });
          hereMarker = L.marker([here.lat, here.lng], {
            icon: icon,
            interactive: false,
            keyboard: false,
          }).addTo(map);
          hereFreshState = !!here.fresh;
          return;
        }

        // Subsequent fix — mutate in place. Avoids removeLayer/addLayer,
        // which fires layeradd/layerremove events that markercluster's
        // global listeners interpret as "user did something" and use to
        // close any open spiderfy. That's been the root cause of the
        // "tap cluster → spiral fans out → snaps back" report on the
        // Pixel: GPS jitter cadence (every few seconds) raced the
        // spiderfy animation and dismissed it before the user could
        // tap a pin.
        hereMarker.setLatLng([here.lat, here.lng]);
        if (hereFreshState !== !!here.fresh) {
          var icon2 = L.divIcon({
            className: '',
            html: built.html,
            iconSize: [built.size, built.size],
            iconAnchor: [built.size / 2, built.size / 2],
          });
          hereMarker.setIcon(icon2);
          hereFreshState = !!here.fresh;
        }
      };

      window.__cf_setCenter = function (c) {
        if (!c || typeof c.lat !== 'number') return;
        map.setView([c.lat, c.lng], c.zoomLevel || map.getZoom(), { animate: false });
      };

      // Force Leaflet to re-measure its container. Called from RN whenever
      // the parent View's onLayout reports a new size, plus from the
      // 0/100/500ms cascade after init.
      //
      // Also force-fires moveend so the region postMessage re-runs with
      // post-invalidate bounds. invalidateSize fires moveend natively
      // *only when the container size changed*; firing it ourselves
      // covers the no-op invalidate path so the parent always gets a
      // refresh after a measure. Consecutive fires collapse into one
      // postMessage via the existing 200ms regionTimer debounce.
      //
      // The initial-region seed at 'ready' time stays in place — it
      // covers the case where the WebView mounted at the right size and
      // none of the invalidate calls produce a meaningful re-emit.
      window.__cf_invalidate = function () {
        try { map.invalidateSize(true); } catch (e) {}
        try { map.fire('moveend'); } catch (e) {}
      };

      // Auto-invalidate whenever the WebView viewport itself changes.
      window.addEventListener('resize', function () {
        if (map) map.invalidateSize(true);
      });

      window.__cf_setMarkers(${JSON.stringify(initialMarkers)});
      window.__cf_setHere(${JSON.stringify(here)});

      // Belt-and-suspenders invalidate calls. Leaflet caches container size
      // at init; if the WebView's viewport grew after that point, the tile
      // layer otherwise paints into the original (smaller) bounds.
      setTimeout(function () { window.__cf_invalidate(); }, 0);
      setTimeout(function () { window.__cf_invalidate(); }, 100);
      setTimeout(function () { window.__cf_invalidate(); }, 500);

      // Seed the parent with the initial viewport so cases_in_bbox can
      // fire without waiting for a user gesture. Leaflet does NOT fire
      // moveend for the L.map() constructor's center/zoom — only for
      // subsequent movements — so without this seed the parent stays
      // at fetchBounds === null and no pins paint until the user pans.
      // Mirrors the moveend handler's payload shape exactly.
      var b0 = map.getBounds();
      var c0 = map.getCenter();
      postMessage({
        type: 'region',
        bounds: {
          minLng: b0.getWest(),
          minLat: b0.getSouth(),
          maxLng: b0.getEast(),
          maxLat: b0.getNorth(),
        },
        center: {
          lat: c0.lat,
          lng: c0.lng,
          zoomLevel: map.getZoom(),
        },
      });

      postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
