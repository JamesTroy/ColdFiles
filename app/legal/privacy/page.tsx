import type { Metadata } from 'next';

import { LegalDoc } from '@/app/_components/legal-doc';

export const metadata: Metadata = {
  title: 'Privacy Policy · The Cold File',
  description:
    'How The Cold File collects, uses, and protects your data. Tips never pass through our servers.',
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      lastUpdated="2026-04-28"
      sections={[
        {
          body: [
            'The Cold File helps you discover unsolved cases in your area and route tips to official law enforcement channels. This page explains what data the app collects, what we do with it, and how to contact us.',
          ],
        },
        {
          heading: 'What we collect',
          body: [
            'Device location (when you grant permission). Used only on your device, to filter cases by distance from where you are. Your location is not stored on our servers and is not shared.',
            'Account information (when you sign in). Email address used to sign in, plus any cases you save and watch zones you create. Stored on Supabase, our database provider.',
            'Tip routing logs. When you tap "Submit a tip," we log the date, the case, and which agency the tip was routed to. We do NOT log the content of your tip, and tips do not pass through our servers — they go directly from your phone to the agency\'s existing tip channel (Crime Stoppers, agency form, agency phone).',
            'Crash reports. If the app crashes, an anonymous report is sent to help us fix bugs. These reports do not include personal information.',
          ],
        },
        {
          heading: "What we don't collect",
          body: [
            '• Tip content (we never read or store what you submit to agencies)',
            '• Browsing history',
            '• Contact lists, photos, microphone, or camera',
            '• Identifiers used to track you across other apps',
          ],
        },
        {
          heading: 'Who we share data with',
          body: [
            '• Supabase (database and authentication)',
            '• Apple / Google (push notification delivery)',
            '• No advertisers, no analytics that track you across apps',
          ],
        },
        {
          heading: 'Your rights',
          body: [
            'Request a copy of your data: email support@coldfile.app',
            'Delete your account and all data: in-app via Me → Delete account, on the web at coldfile.app/account/delete, or email support@coldfile.app',
            'Opt out of crash reports: in-app via Me → Privacy',
          ],
        },
        {
          heading: 'Photos in The Cold File',
          body: [
            'Case photos come from public agency releases (LASD, FBI, NamUs) and case-awareness aggregators (Charley Project, Doe Network). If you are a family member or rights holder and want a photo removed, see Takedown Request.',
          ],
        },
        {
          heading: 'Children',
          body: [
            'The Cold File is rated for users 17+ and is not directed at children. We do not knowingly collect data from children under 13. Cases involving minors are handled with attribution to the appropriate agency (typically NCMEC) and follow that agency\'s guidance for public dissemination.',
          ],
        },
        {
          heading: 'California (CCPA / CPRA)',
          body: [
            'California residents have the right to know what personal information we collect, request deletion, and opt out of any "sale" of personal information. We do not sell personal information. To exercise your rights, email support@coldfile.app.',
          ],
        },
        {
          heading: 'Changes',
          body: [
            'We may update this policy. The "Last updated" date above reflects the current version. Material changes will be announced in-app before they take effect.',
          ],
        },
        {
          heading: 'Contact',
          body: ['Matte Black Dev LLC · Ventura, CA', 'support@coldfile.app'],
        },
      ]}
    />
  );
}
