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
      lastUpdated="2026-04-29"
      sections={[
        {
          heading: 'Plain-language summary',
          body: [
            'The Cold File is a map-first directory of cold cases. We aggregate publicly available case information from federal and state sources and display it on a map so you can find unsolved cases near a given location.',
            'Our most important privacy commitment is the one that defines the product: we never see the content of your tips. When you submit a tip on a case, you leave The Cold File and submit directly to the agency that owns the case, using that agency\'s existing infrastructure. We do log that a routing happened — see "Tips" below — but we never see what you wrote.',
            'We collect very little. The short version of what we do collect: your approximate location, briefly, when you ask the app to show cases near you (we do not retain your location history); your email address, only if you choose to sign in, and only to authenticate you; a record that a tip routing happened (case ID, time, a one-way hash of your tip text, a hashed approximation of your IP, a coarse summary of your device, and your user ID if you are signed in). The content of the tip itself is never recorded.',
          ],
        },
        {
          heading: 'Who we are',
          body: [
            'The Cold File is operated by Matte Black Dev LLC ("we", "us", "our"), a California limited liability company. You can reach us at privacy@coldfile.app, or by mail at Matte Black Dev LLC, Ventura, California, USA. (Mailing address available on request — email privacy@coldfile.app.)',
          ],
        },
        {
          heading: 'Location',
          body: [
            'When you grant the app location permission, we use your device\'s approximate location to query our case database for cases within a chosen radius around you. Your approximate location is transmitted to our database for the duration of that query, and the query result is returned to your device. We do not retain your location, build a history of your movements, or correlate your location with any identifier.',
            'If you decline location permission, you can still use the app. You can pan and zoom the map manually to see cases in any region.',
          ],
        },
        {
          heading: 'Account information (optional)',
          body: [
            'The Cold File works without an account. If you choose to sign in — to save cases across devices, or to attach watch zones to your profile in a future release — we ask for your email address. We use it solely to authenticate you and to send the one-tap sign-in link. We do not send marketing email, and we do not have a marketing email program.',
            'Your email address is held by our authentication provider, Supabase, on infrastructure operated in the United States.',
            'If you delete your account from the app\'s Me → Delete account screen, your email and any saved-case records are permanently deleted from our active database within 7 days. Supabase retains backup copies of authentication data for up to 30 days, after which your email is purged from all systems.',
          ],
        },
        {
          heading: 'Crash and stability data',
          body: [
            'Version 1.0 of The Cold File does not include automated crash reporting. If you encounter a crash and want to help us fix it, you can email a description to support@coldfile.app.',
          ],
        },
        {
          heading: 'What we do not collect',
          body: [
            'The app is not designed to capture, and we do not collect: the content of tips (see "Tips" below); names, phone numbers, or other identifiers, beyond the email address you optionally provide for sign-in; browsing history within the app, including which cases you have viewed; photos, files, contacts, calendar entries, or other content from your device; advertising or marketing identifiers; behavioral analytics tied to your identity.',
            'We do not sell or rent any data. We do not run advertisements. We do not have advertising partners.',
          ],
        },
        {
          heading: 'Tips',
          body: [
            'The Cold File never sees the content of your tips. We do, however, log the fact that a routing happened.',
            'When you tap a tip button on a case, the app opens an external page or phone number — typically the investigating agency\'s own anonymous tip URL, or a tip processor the agency uses (such as a regional Crime Stoppers program or P3 Tips). From that point forward, you are interacting directly with the agency or its tip processor. What you write, and whether the agency receives it, are invisible to us.',
            'What we do record at the moment you tap the tip button, for the purpose of showing you a "TIP ROUTED" receipt in the app and detecting abuse: the case ID you were viewing; the time of the routing; a one-way hash of your tip text (the hash cannot be reversed to recover what you wrote; identical tip text submitted twice produces the same hash, which is how we detect copy-paste abuse across many cases; we do not attempt to identify users from their hashes); a hashed approximation of your IP address, used to detect bursts of routings from a single source; a coarse summary of your device and operating system (for example, "iOS 17 / Pixel 8 Pro"); and your user ID, if you are signed in. None of these fields reveal the content of your tip.',
            'If you want to understand how an agency or tip processor handles your tip after it leaves the app, please consult that organization\'s own privacy practices. We have no visibility into them and no relationship with them other than directing you to their public tip line.',
          ],
        },
        {
          heading: 'Where case information comes from',
          body: [
            'The cases shown in The Cold File are sourced from publicly available records and case-awareness aggregators, including: the National Missing and Unidentified Persons System (NamUs), operated by the U.S. Department of Justice; The Charley Project, a long-running volunteer archive of cold missing-persons cases; The Doe Network, an international volunteer organization for unidentified-persons cases; Project: Cold Case, an unsolved-homicide registry; and federal, state, and local law enforcement agencies that publish information about unsolved cases on their public websites.',
            'Each case in the app links back to the original source so you can read the full record.',
          ],
        },
        {
          heading: 'Photos',
          body: [
            'Photos shown in the app come from these same public sources. Most are loaded directly from the original source\'s servers. A small number — primarily from volunteer-funded archives whose bandwidth is donation-supported — are mirrored on our infrastructure to avoid burdening their hosting. Every photo is attributed to its original source.',
          ],
        },
        {
          heading: 'Takedown and correction requests',
          body: [
            'We honor takedown and correction requests from family members, rights holders, and the agencies that own a case. If you would like a case, a photo, or specific information removed or corrected, please contact us at takedown@coldfile.app with: the case number or a clear description of the case; the specific item you would like removed or corrected; and your relationship to the case, if you are willing to share it.',
            'We aim to respond within 7 days. While the request is being reviewed, we will hide the item where doing so does not interfere with an active investigation we have been notified of.',
          ],
        },
        {
          heading: "Children's privacy",
          body: [
            'The Cold File is rated for users 17 and older and is not directed at children. We do not knowingly collect personal information from anyone under 13.',
            'Some cases displayed in the app involve victims who were minors at the time of their disappearance or death. We display photos and information for these cases only when the photos have been released for public dissemination by an investigating agency, an official aggregator such as NamUs, or the National Center for Missing & Exploited Children (NCMEC). Takedown requests from family members or rights holders are honored as described above.',
          ],
        },
        {
          heading: 'Service providers',
          body: [
            'We use a small set of third-party services to operate the app. Each receives only what it needs to do its job.',
            'Supabase (Database) hosts our case database and tip-routing audit log and serves radius queries; it sees your approximate location at query time and a record that a tip routing occurred.',
            'Supabase Auth authenticates you if you sign in; it sees your email address.',
            'OpenStreetMap provides map tiles and rendering; it sees the map area you are currently viewing.',
            'Expo / EAS builds and delivers the app; it sees no runtime user data.',
            'Apple Push Notification service / Firebase Cloud Messaging will deliver push notifications in a future release; not used in version 1.0.',
            'We do not share data with any party that is not on this list, except where required by law (for example, in response to a valid subpoena).',
          ],
        },
        {
          heading: 'Data retention',
          body: [
            'Location queries: not retained after the query result is returned.',
            'Tip-routing audit log: retained for 12 months, then automatically deleted. Hashes do not expire earlier because abuse detection benefits from a longer comparison window.',
            'Account information (email, saved cases): retained until you delete your account. After deletion, removed from our active database within 7 days; backup copies purged within 30 days.',
            'Email correspondence with us: retained for as long as necessary to resolve your message, and for 2 years after that for our records.',
            'Takedown correspondence: retained for 2 years to document our good-faith handling of requests.',
          ],
        },
        {
          heading: 'Your rights',
          body: [
            'You may exercise the following rights at any time. Access: email privacy@coldfile.app to ask what information, if any, we hold about you. Deletion: you can delete your account directly from the app (Me → Delete account); you can also email privacy@coldfile.app to request deletion of any other information we hold. Correction: email privacy@coldfile.app to ask us to correct inaccurate information. Opt out of location: revoke location permission in your device\'s settings at any time — the app continues to work; you can pan the map manually.',
          ],
        },
        {
          heading: 'California residents',
          body: [
            'If you are a California resident, the California Consumer Privacy Act (CCPA) and the California Privacy Rights Act (CPRA) give you additional rights, including the right to know, the right to delete, the right to correct, the right to limit the use of sensitive personal information, and the right not to be discriminated against for exercising your rights. The Cold File does not sell or share personal information for cross-context behavioral advertising.',
          ],
        },
        {
          heading: 'EEA and UK residents',
          body: [
            'If you are in the European Economic Area or the United Kingdom, you have rights under the General Data Protection Regulation (GDPR) including access, correction, deletion, restriction of processing, data portability, and the right to object. The Cold File is operated in the United States and is not currently targeted at users in the EEA or the UK. If you reach out, we will respond in good faith.',
          ],
        },
        {
          heading: 'Security',
          body: [
            'We use standard industry practices to protect the data we handle. Connections between the app and our servers use TLS. Our database provider encrypts data at rest. Access to our infrastructure is restricted to the operator and protected by multi-factor authentication.',
            'No system is perfectly secure. If you discover a vulnerability, we appreciate responsible disclosure at security@coldfile.app.',
          ],
        },
        {
          heading: 'Changes to this policy',
          body: [
            'We will update this policy as the app evolves. When we make material changes — for example, when we add user accounts, payments, push notifications, or new categories of data — we will update the "Last updated" date and post a notice in the app before the change takes effect.',
            'We keep prior versions of this policy on request.',
          ],
        },
        {
          heading: 'Contact',
          body: ['Matte Black Dev LLC · Ventura, California, USA', 'privacy@coldfile.app'],
        },
      ]}
    />
  );
}
