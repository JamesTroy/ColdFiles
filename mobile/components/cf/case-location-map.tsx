/**
 * CaseLocationMap — small inline map preview for the case-detail screen.
 *
 * Single amber pin at the case's location_point, fixed zoom, no gestures.
 * Spatial anchor without making it a navigation surface — users who want
 * to actually browse the area go to the Map tab. This is the case-detail
 * "where it happened" thumbnail, not a destination.
 *
 * Mirrors the WebView+Leaflet renderer choice used elsewhere
 * (components/cf/leaflet-map.tsx, leaflet-watch-zone.tsx) — native MapLibre
 * is gated off by the Fabric measurement bug.
 *
 * If lat/lng aren't available (location_point is null on a case with only
 * city/state precision), the parent should not render this component.
 * Don't ship a "no location" stub here — the map is information density,
 * not decorative chrome.
 */

import { useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { WebView } from 'react-native-webview';

import { tokens } from '@/constants/theme';

import { type PinKind } from './pin';

interface CaseLocationMapProps {
  lat: number;
  lng: number;
  /** Case kind drives pin color; defaults to homicide tone for cold-case feel. */
  kind?: PinKind;
  /** Defaults to zoom 13 — enough to show street/block context, broad enough
   *  to read as "neighborhood" rather than "house at this exact address." */
  zoom?: number;
}

export function CaseLocationMap({ lat, lng, kind, zoom = 13 }: CaseLocationMapProps) {
  const webRef = useRef<WebView>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const html = useMemo(
    () => buildHtml(lat, lng, zoom, kind ?? 'homicide'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setSize((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height },
    );
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
        />
      ) : null}
    </View>
  );
}

function buildHtml(lat: number, lng: number, zoom: number, kind: PinKind): string {
  // Pin color comes from the same case-kind palette the map tab uses; keeps
  // the spatial anchor visually consistent across surfaces.
  const pinColor =
    kind === 'unidentified' || kind === 'unclaimed'
      ? tokens.color.pin.doe
      : kind === 'missing'
        ? tokens.color.pin.missing
        : tokens.color.pin.homicide;

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
    .cf-loc-pin { background: transparent; border: 0; }
    .cf-loc-pin svg {
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script>
    (function () {
      var COLOR = '${pinColor}';
      var BG = '${tokens.color.bg.base}';

      var map = L.map('map', {
        center: [${lat}, ${lng}],
        zoom: ${zoom},
        zoomControl: false,
        attributionControl: true,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        tap: false,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '© OpenStreetMap contributors, © CARTO',
      }).addTo(map);

      // Single amber-toned pin — same shape language as the map-tab pin
      // grammar (filled circle for homicide-leaning kinds; ring+dot for
      // missing; open ring for Doe). 20dp.
      var pinSvg = (function () {
        var d = 20;
        var cx = d / 2;
        return '<svg width="' + d + '" height="' + d + '" viewBox="0 0 ' + d + ' ' + d + '" xmlns="http://www.w3.org/2000/svg">' +
          '<circle cx="' + cx + '" cy="' + cx + '" r="' + (d/2 - 1.5) + '" fill="' + COLOR + '" stroke="' + BG + '" stroke-width="1.5" />' +
          '</svg>';
      })();

      L.marker([${lat}, ${lng}], {
        icon: L.divIcon({
          className: 'cf-loc-pin',
          html: pinSvg,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        keyboard: false,
        interactive: false,
      }).addTo(map);

      // Belt-and-suspenders invalidate after WebView lays out.
      setTimeout(function () { try { map.invalidateSize(true); } catch (e) {} }, 0);
      setTimeout(function () { try { map.invalidateSize(true); } catch (e) {} }, 100);
      setTimeout(function () { try { map.invalidateSize(true); } catch (e) {} }, 500);
    })();
  </script>
</body>
</html>`;
}
