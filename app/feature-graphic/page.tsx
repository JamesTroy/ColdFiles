/**
 * Play Store feature graphic — 1024×500.
 *
 * Renders at exactly the Play Console's required dimensions so you can
 * capture it as a PNG and upload to the listing without resizing.
 *
 * To capture:
 *   1. Open https://coldfile.app/feature-graphic in Chrome
 *   2. F12 → DevTools → Cmd+Shift+P → "Capture node screenshot"
 *   3. Click the outer #feature-graphic div in the elements pane first,
 *      then run the command — it captures only that node, sized exactly.
 *
 * Or: use Cmd+Shift+5 (macOS) and drag-select the rendered region.
 *
 * Design:
 *   - Wordmark anchors the left half — Newsreader serif at 56px, the
 *     same arrival-signal typeface used inside the app.
 *   - Mono caption underneath: "UNSOLVED CASES · ROUTED HONESTLY".
 *   - Right half shows the three pin-shape grammar (filled circle =
 *     homicide, ring+dot = missing, open ring = unidentified) with
 *     mono-cap labels — visible expression of the shape-first pin
 *     language that defines the map.
 *   - Hairline frame and corner brackets quote the case-file frame
 *     used in PhotoFrame, without showing any photo.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Feature graphic · The Cold File',
  // Don't index — this page is a listing asset, not content.
  robots: { index: false, follow: false },
};

const W = 1024;
const H = 500;

export default function FeatureGraphic() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
      }}
    >
      <div
        id="feature-graphic"
        style={{
          width: W,
          height: H,
          background: 'var(--bg-base)',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        {/* Hairline inner frame — file-cabinet aesthetic */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 24,
            right: 24,
            bottom: 24,
            left: 24,
            border: '0.5px solid var(--border-strong)',
            pointerEvents: 'none',
          }}
        />
        {/* Corner brackets — quote PhotoFrame's bracket language */}
        <CornerBracket pos="tl" />
        <CornerBracket pos="tr" />
        <CornerBracket pos="bl" />
        <CornerBracket pos="br" />

        {/* Left half — wordmark */}
        <div
          style={{
            flex: 1.3,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            paddingLeft: 64,
            paddingRight: 32,
          }}
        >
          <div
            className="mono"
            style={{
              color: 'var(--evidence-chrome)',
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              marginBottom: 14,
            }}
          >
            CASE FILE · v1.0
          </div>
          <div
            className="serif"
            style={{
              fontSize: 64,
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              color: 'var(--text-primary)',
              marginBottom: 18,
            }}
          >
            The Cold File
          </div>
          <div
            className="mono"
            style={{
              color: 'var(--accent-amber)',
              fontSize: 13,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Unsolved cases · Routed honestly
          </div>
        </div>

        {/* Right half — pin grammar legend */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            paddingRight: 64,
            paddingLeft: 32,
            gap: 28,
          }}
        >
          <PinRow shape="filled" label="HOMICIDE" />
          <PinRow shape="ring-dot" label="MISSING" />
          <PinRow shape="open-ring" label="UNIDENTIFIED" />
        </div>
      </div>
    </div>
  );
}

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const offset = 24;
  const len = 16;
  const thick = 1;
  const color = 'var(--accent-amber)';
  const styles: Record<string, React.CSSProperties> = {
    tl: { top: offset, left: offset },
    tr: { top: offset, right: offset, transform: 'scaleX(-1)' },
    bl: { bottom: offset, left: offset, transform: 'scaleY(-1)' },
    br: { bottom: offset, right: offset, transform: 'scale(-1, -1)' },
  };
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        width: len,
        height: len,
        ...styles[pos],
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: len,
          height: thick,
          background: color,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: thick,
          height: len,
          background: color,
        }}
      />
    </div>
  );
}

function PinRow({ shape, label }: { shape: 'filled' | 'ring-dot' | 'open-ring'; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
      <PinShape shape={shape} />
      <div
        className="mono"
        style={{
          fontSize: 13,
          letterSpacing: '0.14em',
          color: 'var(--body-reading)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function PinShape({ shape }: { shape: 'filled' | 'ring-dot' | 'open-ring' }) {
  const SIZE = 28;
  const STROKE = 2.5;
  const amber = '#c5a572';

  if (shape === 'filled') {
    return (
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 2} fill={amber} />
      </svg>
    );
  }
  if (shape === 'ring-dot') {
    return (
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={SIZE / 2 - STROKE / 2 - 1}
          fill="none"
          stroke={amber}
          strokeWidth={STROKE}
        />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={4} fill={amber} />
      </svg>
    );
  }
  // open-ring
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={SIZE / 2 - STROKE / 2 - 1}
        fill="none"
        stroke={amber}
        strokeWidth={STROKE}
      />
    </svg>
  );
}
