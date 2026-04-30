/**
 * DrawZoneMap — WebView Leaflet renderer for the Draw Mode circle picker.
 *
 * Shape: the user pans/zooms the underlying map; a Leaflet L.circle stays
 * pinned to viewport center with the current radius. The circle's center
 * therefore IS the viewport center — no draggable marker, one-handed friendly.
 * On `moveend`, the WebView posts the new center latLng up so React Native
 * can drive the cases-inside count.
 *
 * Mirrors the renderer choice used by leaflet-map.tsx and leaflet-watch-zone:
 * native MapLibre is gated off by the Fabric measurement bug (see
 * components/cf/maps-view.tsx), so the WebView path is v1's renderer.
 *
 * The RN-side overlay (cream center dot, edit handles when polygon mode lands)
 * is the parent's responsibility; this component handles the basemap + circle.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { tokens } from '@/constants/theme';

interface DrawZoneMapProps {
  initialCenter: { lat: number; lng: number; zoomLevel?: number };
  /** Radius in meters. Drives the L.circle. */
  radiusMeters: number;
  /** Fired when the user finishes a pan/zoom. The viewport center IS the zone center. */
  onCenterChange?: (center: { lat: number; lng: number }) => void;
}

interface IncomingMessage {
  type: 'center';
  lat: number;
  lng: number;
}

export function DrawZoneMap({
  initialCenter,
  radiusMeters,
  onCenterChange,
}: DrawZoneMapProps) {
  const webRef = useRef<WebView>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  // The HTML is rendered once with the initial center + initial radius.
  // Subsequent radius changes fly through `injectJavaScript` to cf.setRadius.
  const html = useMemo(
    () => buildHtml(initialCenter, radiusMeters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Push radius changes once the WebView is loaded — and on every change
  // thereafter. injectJavaScript is a no-op until onLoad fires.
  //
  // Throttling note (low-end Android only): if a Pixel 6a tester reports
  // the circle "snapping" rather than gliding while sliding the radius,
  // the fix is a 16ms (one-frame) throttle wrapper around this inject plus
  // an authoritative postMessage on slider release. The slider component
  // already exposes `onSlidingComplete` for that. Not applied preemptively
  // because every device tested so far is fine — see SHIP-BLOCKERS §12
  // "Slider radius lag" for the full story.
  useEffect(() => {
    if (!loaded) return;
    webRef.current?.injectJavaScript(
      `if (window.cfSetRadius) window.cfSetRadius(${radiusMeters}); true;`,
    );
  }, [loaded, radiusMeters]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setSize((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height },
    );
  };

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as IncomingMessage;
      if (msg.type === 'center') {
        onCenterChange?.({ lat: msg.lat, lng: msg.lng });
      }
    } catch {
      /* ignore malformed payloads */
    }
  };

  return (
    <View
      style={{ flex: 1, overflow: 'hidden', backgroundColor: tokens.color.bg.elev1 }}
      onLayout={onLayout}
    >
      {size ? (
        <WebView
          ref={webRef}
          source={{ html }}
          originWhitelist={[
            'https://basemaps.cartocdn.com',
            'https://a.basemaps.cartocdn.com',
            'https://b.basemaps.cartocdn.com',
            'https://c.basemaps.cartocdn.com',
            'https://d.basemaps.cartocdn.com',
            'https://unpkg.com',
            'about:blank',
          ]}
          style={{
            width: size.width,
            height: size.height,
            backgroundColor: tokens.color.bg.elev1,
          }}
          containerStyle={{ width: size.width, height: size.height }}
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled
          androidLayerType="hardware"
          scrollEnabled={false}
          bounces={false}
          mixedContentMode="never"
          onLoad={() => setLoaded(true)}
          onMessage={onMessage}
        />
      ) : null}
    </View>
  );
}

function buildHtml(
  center: { lat: number; lng: number; zoomLevel?: number },
  initialRadius: number,
): string {
  const zoom = center.zoomLevel ?? 11;
  const amber = tokens.color.accent.amber;
  return /* html */ `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  <style>
    html, body, #map {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: ${tokens.color.bg.elev1};
      -webkit-tap-highlight-color: transparent;
    }
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
    .leaflet-control-attribution a { color: ${tokens.color.text.secondary} !important; }
    .leaflet-container { background: ${tokens.color.bg.elev1}; outline: none; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script>
    (function () {
      var AMBER = '${amber}';

      var map = L.map('map', {
        center: [${center.lat}, ${center.lng}],
        zoom: ${zoom},
        zoomControl: false,
        attributionControl: true,
        rotate: false,
        // pan + pinch-to-zoom only; matches spec §3.2.
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '© OpenStreetMap contributors, © CARTO',
      }).addTo(map);

      // The L.circle that follows the map center. Re-centered on every moveend.
      var circle = L.circle([${center.lat}, ${center.lng}], {
        radius: ${initialRadius},
        color: AMBER,
        weight: 1.5,
        opacity: 1,
        fillColor: AMBER,
        fillOpacity: 0.10,
      }).addTo(map);

      function postMessage(obj) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(obj));
        }
      }

      function recentre() {
        var c = map.getCenter();
        circle.setLatLng(c);
        postMessage({ type: 'center', lat: c.lat, lng: c.lng });
      }

      map.on('moveend zoomend', recentre);

      // Receiving radius changes from RN via injection.
      window.cfSetRadius = function (meters) {
        circle.setRadius(meters);
      };

      // Push the initial center up so RN seeds the cases-inside count.
      setTimeout(function () { try { recentre(); map.invalidateSize(true); } catch (e) {} }, 0);
      setTimeout(function () { try { map.invalidateSize(true); } catch (e) {} }, 100);
      setTimeout(function () { try { map.invalidateSize(true); } catch (e) {} }, 500);
    })();
  </script>
</body>
</html>`;
}
