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

export const metadata: Metadata = {
  title: 'The Cold File',
  description:
    'Discover unsolved cases near you. Tips routed to the agencies that own them — never held by us.',
  metadataBase: new URL('https://coldfile.app'),
  openGraph: {
    title: 'The Cold File',
    description:
      'Discover unsolved cases near you. Tips routed to the agencies that own them — never held by us.',
    type: 'website',
    url: 'https://coldfile.app',
  },
};

export const viewport: Viewport = {
  // Dark voice — system UI matches.
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${inter.variable} ${jetbrains.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
