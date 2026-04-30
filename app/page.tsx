/**
 * Marketing landing — coldfile.app
 *
 * Minimal placeholder for V1: serif title, mono caption, "what it is /
 * what it isn't / who runs it" prose for E-E-A-T, footer linking to the
 * legal pages. The real marketing site is a follow-up; this exists so
 * visiting the bare domain doesn't 404, the publisher identity is
 * legible to search engines, and the legal links Play Store requires
 * have a working anchor.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

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
          style={{ color: 'var(--accent-amber)', marginBottom: 56 }}
        >
          Coming soon to Play Store + App Store
        </p>

        <section
          style={{
            maxWidth: 640,
            color: 'var(--body-reading)',
            fontSize: 16,
            lineHeight: 1.7,
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <p>
            <strong style={{ color: 'var(--text-primary)' }}>What it is.</strong>{' '}
            The Cold File is a map-first directory of unsolved cold cases —
            missing persons and unidentified remains — aggregated from
            publicly available federal, state, and local records.
            Investigations are linked back to their original source. Tips
            you submit go directly to the agency that owns the case; we
            never receive or store the content of what you wrote.
          </p>
          <p>
            <strong style={{ color: 'var(--text-primary)' }}>What it isn&apos;t.</strong>{' '}
            Not a community. Not a forum. Not a discussion board. There are
            no comments, no upvotes, no public profiles. Cold File is a
            directory and a tip-router. Speculation belongs on platforms
            built for it, not on case records.
          </p>
          <p>
            <strong style={{ color: 'var(--text-primary)' }}>Who runs it.</strong>{' '}
            Cold File is operated by Matte Black Dev LLC, a California
            limited liability company based in Ventura. We&apos;re not
            affiliated with any law enforcement agency. Tips you submit
            through the app go to the agency&apos;s own public infrastructure
            — state clearinghouses, Crime Stoppers programs, or the FBI
            tip line as the honest fallback.
          </p>
        </section>
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
