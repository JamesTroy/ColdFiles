/**
 * Root layout for coldfile.app — the public web property.
 *
 * Same case-file aesthetic as the mobile app, mirrored via CSS variables in
 * globals.css. The four legal pages (privacy / terms / takedown) and the
 * web-accessible account-deletion path live under this layout.
 *
 * Architecture rule (docs/00_DECISIONS.md, "Two thin frontends, one Supabase
 * backend"): this Next.js codebase and mobile/ are siblings, not parent/child.
 * Pages here read directly from Supabase via @supabase/supabase-js.
 */

import { Inter, JetBrains_Mono, Newsreader } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import './globals.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-newsreader',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-jetbrains',
  display: 'swap',
});

// Canonical host = apex (coldfile.app). Vercel Project → Domains must list
// it as the primary; www should 308-redirect to apex. metadataBase + the
// per-page canonical alternates assume this convention.
const SITE_URL = 'https://coldfile.app';
const SITE_NAME = 'The Cold File';
const SITE_DESCRIPTION =
  'Discover unsolved cases near you. Tips routed to the agencies that own them — never held by us.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: 'Matte Black Dev LLC', url: SITE_URL }],
  creator: 'Matte Black Dev LLC',
  publisher: 'Matte Black Dev LLC',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_US',
    url: SITE_URL,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  // Dark voice — system UI matches.
  themeColor: '#0a0a0a',
};

// JSON-LD Organization — cheapest publisher-identity signal a brand-new
// domain can give a search engine. Matched to the privacy-policy
// attribution. Add SoftwareApplication once the app launches publicly.
const ORG_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Matte Black Dev LLC',
  url: SITE_URL,
  logo: `${SITE_URL}/icon.png`,
  description: SITE_DESCRIPTION,
  sameAs: [],
  contactPoint: [
    {
      '@type': 'ContactPoint',
      contactType: 'privacy',
      email: 'privacy@coldfile.app',
    },
    {
      '@type': 'ContactPoint',
      contactType: 'takedown',
      email: 'takedown@coldfile.app',
    },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonce stamped by middleware.ts so the CSP nonce-source-list entry
  // accepts this inline JSON-LD <script>. `application/ld+json` is
  // technically a data block (browsers don't execute it as JS), but
  // CSP3 still applies script-src to the element, so the nonce is
  // load-bearing here.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${inter.variable} ${jetbrains.variable}`}
    >
      <body>
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_LD) }}
        />
        {children}
      </body>
    </html>
  );
}
