/**
 * LegalDoc — shared chrome for the four legal pages on coldfile.app.
 *
 * Mirrors the in-app design from mobile/components/cf/legal-doc.tsx — same
 * structured sections (heading + paragraphs), same evidence-chrome metadata
 * line, same "MATTE BLACK DEV LLC" footer. Content is passed in as a
 * structured array so the four pages stay free of layout duplication.
 *
 * Keep the wording in lockstep with the mobile screens. Drift between the
 * two is what gets flagged in Play Store reviews ("the in-app privacy policy
 * doesn't match the URL we have on file").
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

export interface DocSection {
  heading?: string;
  body: string[];
}

export interface LegalDocProps {
  title: string;
  lastUpdated: string;
  sections: DocSection[];
}

export function LegalDoc({ title, lastUpdated, sections }: LegalDocProps): ReactElement {
  return (
    <div className="container">
      <nav style={{ marginBottom: 32 }}>
        <Link
          href="/"
          style={{
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            borderBottom: 'none',
          }}
        >
          ← The Cold File
        </Link>
      </nav>

      <header style={{ marginBottom: 32 }}>
        <h1
          className="serif"
          style={{ fontSize: 36, lineHeight: 1.15, margin: '0 0 12px 0' }}
        >
          {title}
        </h1>
        <p className="mono-cap" style={{ margin: 0 }}>
          Last updated · {lastUpdated}
        </p>
      </header>

      {sections.map((section, i) => (
        <section
          key={i}
          style={{ marginTop: i === 0 ? 16 : 36 }}
        >
          {section.heading ? (
            <h2
              className="mono-cap"
              style={{
                margin: '0 0 12px 0',
                fontSize: 12,
                color: 'var(--evidence-chrome)',
              }}
            >
              {section.heading}
            </h2>
          ) : null}
          {section.body.map((paragraph, j) => (
            <p
              key={j}
              style={{
                margin: j === 0 ? '0 0 14px 0' : '0 0 14px 0',
                color: 'var(--body-reading)',
                fontSize: 15,
                lineHeight: 1.65,
                fontFamily: 'var(--font-sans)',
              }}
            >
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      <footer
        style={{
          marginTop: 64,
          paddingTop: 24,
          borderTop: '0.5px solid var(--border-subtle)',
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
