/**
 * Default Open Graph image for coldfile.app — generated at build time
 * via next/og. Twin to /feature-graphic but at the OG-canonical 1200×630
 * ratio (Play's feature graphic is 1024×500, OG is wider).
 *
 * Renders with next/og's edge runtime; no fonts or images fetched at
 * build (uses inline styles + system fallback). For brand fidelity we
 * could load Newsreader from Google Fonts, but the 200KB font fetch
 * adds build-time complexity that isn't justified for a site with no
 * social-share traffic in v1.0.
 */

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'The Cold File — Cold cases on a map';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0a0a0a',
          padding: 64,
          position: 'relative',
        }}
      >
        {/* Hairline frame to quote the file-cabinet aesthetic */}
        <div
          style={{
            position: 'absolute',
            top: 28,
            right: 28,
            bottom: 28,
            left: 28,
            border: '1px solid #2a2a2a',
            display: 'flex',
          }}
        />

        {/* Corner brackets — top-left, top-right, bottom-left, bottom-right */}
        {[
          { top: 28, left: 28, transform: 'none' },
          { top: 28, right: 28, transform: 'scaleX(-1)' },
          { bottom: 28, left: 28, transform: 'scaleY(-1)' },
          { bottom: 28, right: 28, transform: 'scale(-1, -1)' },
        ].map((pos, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              width: 22,
              height: 22,
              display: 'flex',
              ...pos,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 22,
                height: 1,
                background: '#c5a572',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 1,
                height: 22,
                background: '#c5a572',
              }}
            />
          </div>
        ))}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'flex-start',
            flex: 1,
            paddingLeft: 48,
            paddingRight: 48,
          }}
        >
          <div
            style={{
              color: '#5a5550',
              fontSize: 18,
              letterSpacing: 4,
              textTransform: 'uppercase',
              marginBottom: 22,
              fontFamily: 'monospace',
            }}
          >
            CASE FILE · v1.0
          </div>
          <div
            style={{
              fontSize: 96,
              lineHeight: 1.05,
              color: '#f5f1ea',
              letterSpacing: '-0.015em',
              marginBottom: 24,
              fontFamily: 'serif',
              fontWeight: 500,
            }}
          >
            The Cold File
          </div>
          <div
            style={{
              color: '#c5a572',
              fontSize: 22,
              letterSpacing: 3,
              textTransform: 'uppercase',
              fontFamily: 'monospace',
            }}
          >
            Unsolved cases · Routed honestly
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
