/**
 * LeafletWatchZoneMap — WebView Leaflet polygon preview.
 *
 * Same renderer choice as LeafletMap (bypasses the GL-surface bug). Adds
 * a single closed polygon in accent.amber with dashed perimeter + faint
 * fill, vertex handles as amber circles, and inline pins inside the zone.
 *
 * Drag-to-edit polygon vertices isn't wired here — the prototype's preview
 * is static-positioned, and that's all V1 ships. When polygon edit lands,
 * extend the script to react to marker drag events and post the new
 * vertex set back over postMessage.
 */

import { useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { WebView } from 'react-native-webview';

import { PIN_COLOR_BY_KIND, PIN_SHAPE_BY_KIND, tokens } from '@/constants/theme';

import type { PinKind } from './pin';

export interface PolygonVertex {
  lat: number;
  lng: number;
}

export interface InsidePin {
  id: string;
  lat: number;
  lng: number;
  kind: PinKind;
}

interface LeafletWatchZoneMapProps {
  vertices: PolygonVertex[];
  insidePins?: InsidePin[];
  center?: { lat: number; lng: number };
  zoomLevel?: number;
}

export function LeafletWatchZoneMap({
  vertices,
  insidePins = [],
  center,
  zoomLevel = 9,
}: LeafletWatchZoneMapProps) {
  const webRef = useRef<WebView>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const cameraCenter = center ?? centroid(vertices);

  const html = useMemo(
    () => buildHtml(cameraCenter, zoomLevel, vertices, insidePins),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (vertices.length < 3) {
    return <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }} />;
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setSize((prev) =>
      prev && prev.width === width && prev.height === height
        ? prev
        : { width, height },
    );
  };

  return (
    <View
      style={{ flex: 1, overflow: 'hidden', backgroundColor: tokens.color.bg.base }}
      onLayout={onLayout}
    >
      {size ? (
        <WebView
          ref={webRef}
          source={{ html }}
          originWhitelist={['https://tile.openstreetmap.org', 'https://unpkg.com', 'about:blank']}
          style={{
            width: size.width,
            height: size.height,
            backgroundColor: tokens.color.bg.base,
          }}
          containerStyle={{
            width: size.width,
            height: size.height,
          }}
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

function centroid(vertices: PolygonVertex[]): { lat: number; lng: number } {
  let lat = 0;
  let lng = 0;
  for (const v of vertices) {
    lat += v.lat;
    lng += v.lng;
  }
  const n = vertices.length || 1;
  return { lat: lat / n, lng: lng / n };
}

function buildHtml(
  center: { lat: number; lng: number },
  zoom: number,
  vertices: PolygonVertex[],
  insidePins: InsidePin[],
): string {
  const polygonLatLngs = vertices.map((v) => [v.lat, v.lng]);
  const palette = {
    homicide: PIN_COLOR_BY_KIND.homicide,
    missing: PIN_COLOR_BY_KIND.missing,
    unidentified: PIN_COLOR_BY_KIND.unidentified,
    unclaimed: PIN_COLOR_BY_KIND.unclaimed,
    suspicious_death: PIN_COLOR_BY_KIND.suspicious_death,
  } satisfies Record<PinKind, string>;

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
      background: ${tokens.color.bg.base};
      -webkit-tap-highlight-color: transparent;
    }
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
    .cf-pin, .cf-vertex {
      background: transparent;
      border: 0;
    }
    .cf-pin svg {
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script>
    (function () {
      var PALETTE = ${JSON.stringify(palette)};
      var SHAPE = ${JSON.stringify(PIN_SHAPE_BY_KIND)};
      var AMBER = '${tokens.color.accent.amber}';
      var BG = '${tokens.color.bg.base}';

      function strokeForDiameter(d) { return Math.max(1.5, Math.round(d / 8)); }

      function pinSvg(kind, diameter) {
        var color = PALETTE[kind] || PALETTE.homicide;
        var shape = SHAPE[kind] || 'filled';
        var stroke = strokeForDiameter(diameter);
        var inner = diameter * 0.4;
        var cx = diameter / 2, cy = diameter / 2;
        var body = '';
        if (shape === 'filled') {
          body = '<circle cx="' + cx + '" cy="' + cy + '" r="' + (diameter/2) + '" fill="' + color + '" />';
        } else if (shape === 'open_ring') {
          body = '<circle cx="' + cx + '" cy="' + cy + '" r="' + (diameter/2 - stroke/2) + '" stroke="' + color + '" stroke-width="' + stroke + '" fill="none" />';
        } else if (shape === 'ring_dot') {
          body =
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + (diameter/2 - stroke/2) + '" stroke="' + color + '" stroke-width="' + stroke + '" fill="none" />' +
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + (inner/2) + '" fill="' + color + '" />';
        }
        return '<svg width="' + diameter + '" height="' + diameter + '" viewBox="0 0 ' + diameter + ' ' + diameter + '" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>';
      }

      var map = L.map('map', {
        center: [${center.lat}, ${center.lng}],
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

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);

      var vertices = ${JSON.stringify(polygonLatLngs)};
      L.polygon(vertices, {
        color: AMBER,
        weight: 1.5,
        opacity: 1,
        dashArray: '4 3',
        fillColor: AMBER,
        fillOpacity: 0.08,
      }).addTo(map);

      // Vertex handles
      for (var i = 0; i < vertices.length; i++) {
        var v = vertices[i];
        var html =
          '<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="7" cy="7" r="6" fill="' + AMBER + '" stroke="' + BG + '" stroke-width="1.5" />' +
          '</svg>';
        var icon = L.divIcon({
          className: 'cf-vertex',
          html: html,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        L.marker(v, { icon: icon, interactive: false, keyboard: false }).addTo(map);
      }

      // Inside pins — bumped to 14px to match map-tab legibility.
      var insidePins = ${JSON.stringify(insidePins)};
      for (var j = 0; j < insidePins.length; j++) {
        var p = insidePins[j];
        var size = 14;
        var icon2 = L.divIcon({
          className: 'cf-pin',
          html: pinSvg(p.kind, size),
          iconSize: [size, size],
          iconAnchor: [size/2, size/2],
        });
        L.marker([p.lat, p.lng], { icon: icon2, interactive: false, keyboard: false }).addTo(map);
      }

      // Re-measure after the WebView reaches its final viewport. Same pattern
      // as leaflet-map.tsx — Leaflet caches container size at init, so any
      // late-arriving layout has to be flushed manually.
      setTimeout(function () { try { map.invalidateSize(true); } catch (e) {} }, 0);
      setTimeout(function () { try { map.invalidateSize(true); } catch (e) {} }, 100);
      setTimeout(function () { try { map.invalidateSize(true); } catch (e) {} }, 500);
    })();
  </script>
</body>
</html>`;
}
