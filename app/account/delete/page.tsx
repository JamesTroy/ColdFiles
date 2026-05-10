import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Delete Account',
  description:
    'Request permanent deletion of your Cold File account and associated data.',
  alternates: { canonical: '/account/delete' },
  openGraph: {
    title: 'Delete Account · The Cold File',
    description:
      'Request permanent deletion of your Cold File account and associated data.',
    url: '/account/delete',
    type: 'article',
  },
};

/**
 * Web-accessible account deletion path — required by Google Play policy
 * since 2024 for any app with accounts. Mirrors the in-app screen at
 * /delete-account in mobile/.
 *
 * Flow for V1: collect a deletion request via email (manual triage). When
 * traffic warrants it, replace this page with a form that calls a
 * Supabase auth-link → delete_my_account RPC pipeline. Until then the
 * email path is sufficient and conservative — we want a human eyeball on
 * each delete during the period when the dataset is small.
 */
export default function DeleteAccountPage() {
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
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            padding: '0 4px',
            marginLeft: -4,
          }}
        >
          ← The Cold File
        </Link>
      </nav>

      <header style={{ marginBottom: 32 }}>
        <h1
          className="serif"
          style={{ fontSize: 'clamp(26px, 6vw, 36px)', lineHeight: 1.15, margin: '0 0 12px 0' }}
        >
          Delete account
        </h1>
        <p className="mono-cap" style={{ margin: 0 }}>
          Permanent · Cannot be undone
        </p>
      </header>

      <section>
        <p
          style={{
            color: 'var(--body-reading)',
            fontSize: 15,
            lineHeight: 1.65,
            margin: '0 0 14px 0',
          }}
        >
          You can delete your account directly from the app at <span className="mono">Me → Delete account</span>. If you can&rsquo;t open the app — uninstalled, locked out, lost device — request deletion by email and we&rsquo;ll process it manually within 5 business days.
        </p>

        <h2
          className="mono-cap"
          style={{ marginTop: 36, marginBottom: 12, fontSize: 12 }}
        >
          What gets deleted
        </h2>
        <ul
          style={{
            color: 'var(--body-reading)',
            fontSize: 15,
            lineHeight: 1.7,
            paddingLeft: 20,
            margin: '0 0 14px 0',
          }}
        >
          <li>Your sign-in email and any session data.</li>
          <li>Saved cases synced to your account.</li>
          <li>Watch zones and notification preferences.</li>
          <li>Tip routing logs (the agency-side records remain — agencies own those).</li>
        </ul>
        <p
          style={{
            color: 'var(--body-reading)',
            fontSize: 15,
            lineHeight: 1.65,
            margin: '0 0 14px 0',
          }}
        >
          We cannot recover deleted accounts.
        </p>

        <h2
          className="mono-cap"
          style={{ marginTop: 36, marginBottom: 12, fontSize: 12 }}
        >
          How to request by email
        </h2>
        <ol
          style={{
            color: 'var(--body-reading)',
            fontSize: 15,
            lineHeight: 1.7,
            paddingLeft: 20,
            margin: '0 0 14px 0',
          }}
        >
          <li>
            Send an email to{' '}
            <a href="mailto:support@coldfile.app?subject=Delete%20my%20account">
              support@coldfile.app
            </a>{' '}
            from the email address on the account.
          </li>
          <li>Subject line: <span className="mono">Delete my account</span>.</li>
          <li>We confirm receipt within one business day and complete the deletion within five.</li>
          <li>If you cannot send from the account email, include enough information for us to verify you (e.g. approximate sign-up date, last device used).</li>
        </ol>

        <div
          style={{
            marginTop: 36,
            padding: '20px 24px',
            border: '0.5px solid var(--border-strong)',
            borderRadius: 6,
            background: 'var(--bg-elev1)',
          }}
        >
          <p
            className="mono-cap"
            style={{ margin: '0 0 8px 0', color: 'var(--accent-amber)' }}
          >
            Quick action
          </p>
          <p
            style={{
              color: 'var(--body-reading)',
              fontSize: 15,
              lineHeight: 1.65,
              margin: 0,
            }}
          >
            <a
              href="mailto:support@coldfile.app?subject=Delete%20my%20account&body=Please%20delete%20my%20Cold%20File%20account%20associated%20with%20this%20email%20address."
              style={{
                color: 'var(--accent-amber)',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                borderBottom: '0.5px solid var(--accent-amber)',
              }}
            >
              Email support@coldfile.app to delete →
            </a>
          </p>
        </div>
      </section>

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
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
          }}
        >
          MATTE BLACK DEV LLC · VENTURA, CA
          <br />
          <Link
            href="/legal/privacy"
            style={{
              color: 'var(--text-secondary)',
              borderBottom: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 44,
              padding: '0 12px',
            }}
          >
            Privacy
          </Link>
          <Link
            href="/legal/terms"
            style={{
              color: 'var(--text-secondary)',
              borderBottom: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 44,
              padding: '0 12px',
            }}
          >
            Terms
          </Link>
          <Link
            href="/legal/takedown"
            style={{
              color: 'var(--text-secondary)',
              borderBottom: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 44,
              padding: '0 12px',
            }}
          >
            Takedown
          </Link>
        </p>
      </footer>
    </div>
  );
}
