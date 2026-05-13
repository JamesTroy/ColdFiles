/**
 * Case-not-found 404 for /case/{slug}.
 *
 * Triggered when fetchCase() returns null — case is deleted (deleted_at
 * is not null per takedown flow), slug has been changed (rare), or a
 * stale share link was clicked. Renders the same chrome as the marketing
 * page so a 404 from a wild share still looks like Cold File, not a
 * vendor error.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.matteblackdev.coldfile';

export const metadata: Metadata = {
  title: 'Case not found',
  robots: { index: false, follow: false },
};

export default function CaseNotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <main
        className="landing-main"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <p className="mono-cap" style={{ marginBottom: 24 }}>
          THE COLD FILE
        </p>
        <h1
          className="serif"
          style={{
            fontSize: 'clamp(28px, 6vw, 40px)',
            lineHeight: 1.15,
            margin: '0 0 16px 0',
            color: 'var(--text-primary)',
          }}
        >
          This case is no longer available.
        </h1>
        <p
          style={{
            color: 'var(--body-reading)',
            fontSize: 16,
            lineHeight: 1.6,
            margin: '0 auto 28px',
            maxWidth: 480,
          }}
        >
          The case may have been removed at a family member&apos;s request, or
          the link may be out of date.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <Link
            href="/"
            style={{
              color: 'var(--text-secondary)',
              fontSize: 14,
            }}
          >
            Back to The Cold File
          </Link>
          <Link
            href={PLAY_STORE_URL}
            style={{
              color: 'var(--text-secondary)',
              fontSize: 14,
            }}
          >
            Get the app on Google Play
          </Link>
        </div>
      </main>
    </div>
  );
}
