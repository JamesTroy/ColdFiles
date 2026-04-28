/**
 * Marketing landing — coldfile.app
 *
 * Minimal placeholder for V1: serif title, mono caption, app store badges
 * (when live), and footer linking to the legal pages. The real marketing
 * site is a follow-up; this exists so visiting the bare domain doesn't 404
 * and so the legal links Play Store requires have a working anchor.
 */

import Link from 'next/link';

export default function HomePage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '64px 24px',
          textAlign: 'center',
        }}
      >
        <p
          className="mono-cap"
          style={{ marginBottom: 24 }}
        >
          THE COLD FILE
        </p>
        <h1
          className="serif"
          style={{
            fontSize: 56,
            lineHeight: 1.1,
            margin: '0 0 24px 0',
            maxWidth: 720,
          }}
        >
          Discover unsolved cases near you.
        </h1>
        <p
          style={{
            color: 'var(--body-reading)',
            fontSize: 18,
            lineHeight: 1.6,
            margin: '0 auto 36px',
            maxWidth: 560,
          }}
        >
          Tips routed to the agencies that own them — never held by us.
        </p>
        <p
          className="mono-cap"
          style={{ color: 'var(--accent-amber)' }}
        >
          Coming soon to Play Store + App Store
        </p>
      </main>

      <footer
        style={{
          padding: '32px 24px',
          borderTop: '0.5px solid var(--border-subtle)',
          textAlign: 'center',
        }}
      >
        <p
          className="mono"
          style={{
            color: 'var(--evidence-chrome)',
            fontSize: 11,
            letterSpacing: '0.05em',
            margin: 0,
            lineHeight: 1.7,
          }}
        >
          MATTE BLACK DEV LLC · VENTURA, CA
          <br />
          <Link
            href="/legal/privacy"
            style={{
              color: 'var(--text-secondary)',
              borderBottom: 'none',
              marginRight: 16,
            }}
          >
            Privacy
          </Link>
          <Link
            href="/legal/terms"
            style={{
              color: 'var(--text-secondary)',
              borderBottom: 'none',
              marginRight: 16,
            }}
          >
            Terms
          </Link>
          <Link
            href="/legal/takedown"
            style={{
              color: 'var(--text-secondary)',
              borderBottom: 'none',
              marginRight: 16,
            }}
          >
            Takedown
          </Link>
          <Link
            href="/account/delete"
            style={{ color: 'var(--text-secondary)', borderBottom: 'none' }}
          >
            Delete account
          </Link>
        </p>
      </footer>
    </div>
  );
}
