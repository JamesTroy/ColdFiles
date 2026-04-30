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
  onMarkerPress?: (id: string) => void;
  onRegionChange?: (bounds: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
  }) => void;
}

export function LeafletMap({
  center,
  markers,
  here,
  onMarkerPress,
  onRegionChange,
}: LeafletMapProps) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);

  const html = useMemo(
    () => buildLeafletHtml(center, here ?? null, markers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const markersJson = JSON.stringify(markers);
  const hereJson = JSON.stringify(here ?? null);

  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(`
      try {
        window.__cf_setMarkers && window.__cf_setMarkers(${markersJson});
        window.__cf_setHere && window.__cf_setHere(${hereJson});
      } catch (e) {}
      true;
    `);
  }, [ready, markersJson, hereJson]);

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
      } else if (msg.type === 'region' && onRegionChange) {
        onRegionChange(msg.bounds);
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
        originWhitelist={['https://tile.openstreetmap.org', 'https://unpkg.com', 'about:blank']}
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
    text: tokens.color.cluster.text,
    border: tokens.color.border.strong,
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
    /* The Cold File dark voice: dim the OSM raster tiles + tame the attribution. */
    .leaflet-tile-pane {
      filter: brightness(0.45) saturate(0.5) hue-rotate(-10deg) contrast(1.1);
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
       drop-shadow on the SVG element gives the pin separation from the dimmed OSM
       basemap without introducing a hard outline that fights the design grammar. */
    .cf-pin {
      background: transparent;
      border: 0;
    }
    .cf-pin svg {
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
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
    /* Cluster icon — token-driven, replaces leaflet.markercluster defaults. */
    .cf-cluster {
      background: transparent;
      border: 0;
    }
    .cf-cluster-inner {
      border-radius: 50%;
      background: ${tokens.color.cluster.fill};
      border: 0.5px solid ${tokens.color.border.strong};
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
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
      function pinSvg(opts) {
        var diameter = opts.diameter || 14;
        var color = PALETTE[opts.kind] || PALETTE.homicide;
        var shape = SHAPE[opts.kind] || 'filled';
        var stroke = strokeForDiameter(diameter);
        var inner = diameter * 0.4;
        var haloD = opts.selected ? diameter * TOKENS.haloScale : 0;
        var recAlpha = recentAlphaFor(opts.recentDays);
        var recD = recAlpha > 0 ? diameter * TOKENS.recentScale : 0;
        var canvas = Math.max(diameter, haloD, recD);
        var cx = canvas / 2;
        var cy = canvas / 2;
        var parts = [];

        // Recent ring (outermost)
        if (recD > 0) {
          parts.push(
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + (recD / 2) + '" ' +
            'stroke="' + TOKENS.amberHot + '" stroke-width="' + Math.max(1, strokeForDiameter(recD) - 0.5) + '" ' +
            'stroke-opacity="' + recAlpha + '" fill="none" />'
          );
        }

        // Selection halo
        if (opts.selected) {
          parts.push(
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + (haloD / 2) + '" ' +
            'stroke="' + TOKENS.amber + '" stroke-width="' + strokeForDiameter(haloD) + '" ' +
            'stroke-opacity="' + TOKENS.haloAlpha + '" fill="none" />'
          );
        }

        // Base shape
        if (shape === 'filled') {
          parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (diameter / 2) + '" fill="' + color + '" />');
        } else if (shape === 'open_ring') {
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
          html: '<svg width="' + canvas + '" height="' + canvas + '" viewBox="0 0 ' + canvas + ' ' + canvas + '" xmlns="http://www.w3.org/2000/svg">' + parts.join('') + '</svg>',
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

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);

      // Region change → debounced postMessage so the consumer can refetch.
      var regionTimer = null;
      map.on('moveend zoomend', function () {
        if (regionTimer) clearTimeout(regionTimer);
        regionTimer = setTimeout(function () {
          var b = map.getBounds();
          postMessage({
            type: 'region',
            bounds: {
              minLng: b.getWest(),
              minLat: b.getSouth(),
              maxLng: b.getEast(),
              maxLat: b.getNorth(),
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

      var markerLayer = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true,
        maxClusterRadius: 50,
        chunkedLoading: true,
        iconCreateFunction: clusterIconFor,
      }).addTo(map);
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

      window.__cf_setMarkers = function (list) {
        markerLayer.clearLayers();
        if (!Array.isArray(list)) return;
        var batch = [];
        for (var i = 0; i < list.length; i++) {
          var m = list[i];
          // Bumped from 14/16 → 18/22 for legibility against dimmed OSM tiles.
          var diameter = m.selected ? 22 : 18;
          var svg = pinSvg({
            kind: m.kind,
            diameter: diameter,
            selected: !!m.selected,
            recentDays: m.recentDays,
          });
          var icon = L.divIcon({
            className: 'cf-pin',
            html: svg.html,
            iconSize: [svg.size, svg.size],
            iconAnchor: [svg.size / 2, svg.size / 2],
          });
          (function (id) {
            var marker = L.marker([m.lat, m.lng], { icon: icon, keyboard: false });
            marker.on('click', function () {
              pressFlash(marker);
              postMessage({ type: 'marker', id: id });
            });
            batch.push(marker);
          })(m.id);
        }
        if (batch.length) markerLayer.addLayers(batch);
      };

      window.__cf_setHere = function (here) {
        if (hereMarker) {
          map.removeLayer(hereMarker);
          hereMarker = null;
        }
        if (!here) return;
        var built = hereHtml(!!here.fresh);
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
      };

      window.__cf_setCenter = function (c) {
        if (!c || typeof c.lat !== 'number') return;
        map.setView([c.lat, c.lng], c.zoomLevel || map.getZoom(), { animate: false });
      };

      // Force Leaflet to re-measure its container. Called from RN whenever
      // the parent View's onLayout reports a new size.
      window.__cf_invalidate = function () {
        try { map.invalidateSize(true); } catch (e) {}
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

      postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}
