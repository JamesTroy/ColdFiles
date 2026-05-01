import type { Metadata } from 'next';

import { LegalDoc } from '@/app/_components/legal-doc';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms governing your use of The Cold File.',
  alternates: { canonical: '/legal/terms' },
  openGraph: {
    title: 'Terms of Service · The Cold File',
    description: 'Terms governing your use of The Cold File.',
    url: '/legal/terms',
    type: 'article',
  },
};

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      lastUpdated="2026-05-01"
      sections={[
        { body: ['By using The Cold File, you agree to these terms.'] },
        {
          heading: 'What this app does',
          body: [
            'The Cold File aggregates publicly available information about unsolved cases (homicides, missing persons, unidentified persons) from law enforcement agencies and case-awareness aggregators. The app helps you discover cases and submit tips to the agencies that own them.',
          ],
        },
        {
          heading: 'What this app does NOT do',
          body: [
            '• We do not investigate cases.',
            '• We do not store, read, or moderate the tips you submit.',
            '• We are not affiliated with any law enforcement agency.',
            '• We do not guarantee that the information shown is current, accurate, or complete. Always verify with the investigating agency before acting on it.',
          ],
        },
        {
          heading: 'Tips',
          body: [
            'When you submit a tip, the app routes you to the agency\'s existing tip channel. The tip itself never passes through our servers. We log only that a tip was submitted (for abuse rate-limiting), not the content.',
          ],
        },
        {
          heading: 'Photos and content',
          body: [
            'Photos and case information shown in this app come from publicly available federal, state, and local public records, including law enforcement agency releases and volunteer case-awareness aggregators. The current source list is documented in our Privacy Policy. Photos are attributed to their source. If you are a family member or rights holder and want content removed, submit a Takedown Request.',
          ],
        },
        {
          heading: 'Acceptable use',
          body: [
            'You agree NOT to:',
            '• Use the app to harass family members or persons of interest.',
            '• Submit false or malicious tips.',
            '• Republish content from this app to social media in a way that violates the rights or privacy of victims, families, or persons of interest.',
            '• Scrape or bulk-extract data from the app.',
            'We may suspend access for violations.',
          ],
        },
        {
          heading: 'No warranty',
          body: [
            'This app is provided "as is." We make no guarantees about uptime, data accuracy, or fitness for any particular purpose. Cold cases are sensitive — verify before you act.',
          ],
        },
        {
          heading: 'Limitation of liability',
          body: [
            'To the maximum extent permitted by law, Matte Black Dev LLC is not liable for any indirect, incidental, or consequential damages arising from your use of this app.',
          ],
        },
        {
          heading: 'Changes',
          body: [
            'We may update these terms. The "Last updated" date above will reflect the current version. Continued use after an update means you accept the new terms.',
          ],
        },
        {
          heading: 'Governing law',
          body: ['These terms are governed by the laws of the State of California, USA.'],
        },
        {
          heading: 'Contact',
          body: ['Matte Black Dev LLC · Ventura, CA', 'support@coldfile.app'],
        },
      ]}
    />
  );
}
