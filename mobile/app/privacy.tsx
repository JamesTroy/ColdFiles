import { LegalDocScreen } from '@/components/cf/legal-doc';

const FULL_POLICY_URL = 'https://coldfile.app/legal/privacy';

export default function PrivacyScreen() {
  return (
    <LegalDocScreen
      title="Privacy Policy"
      lastUpdated="2026-04-29"
      sections={[
        {
          body: [
            'This in-app summary covers the load-bearing claims. The full policy — including retention windows, third-party providers, and your rights under CCPA / CPRA / GDPR — lives at coldfile.app/legal/privacy.',
          ],
        },
        {
          heading: 'The tip claim',
          body: [
            'When you submit a tip, the content of what you wrote never reaches our servers. The text is hashed locally on your device, and the hash cannot be reversed to recover the words. We do log that a routing happened — case ID, time, the one-way hash, a hashed approximation of your IP, your device summary, the agency / URL / route kind we sent you to, and your user ID if you are signed in. None of those reveal the content.',
            'After leaving the app you are interacting directly with the agency or its tip processor. We have no visibility into what you submit there.',
          ],
        },
        {
          heading: 'Location',
          body: [
            'Approximate location is used briefly when you ask the app to show cases near you. It is sent to our database in the request and the result returns. We do not retain your location, build a movement history, or correlate it with any identifier.',
            'You can revoke location permission at any time in your device Settings.',
          ],
        },
        {
          heading: 'Accounts',
          body: [
            'The app works without an account. If you sign in, we ask only for your email — used solely to authenticate you, never for marketing.',
            'Delete your account via Me → Delete account. Your email and any server-side records are removed from our active database within 7 days. Saved cases live in device storage on your phone and are removed when you sign out or uninstall the app.',
          ],
        },
        {
          heading: 'What we do not do',
          body: [
            '• Sell or rent your data.',
            '• Run ads or have advertising partners.',
            '• Use third-party analytics that track you across apps.',
            '• Store the content of your tips.',
          ],
        },
        {
          heading: 'Takedown',
          body: [
            'Family members, rights holders, and the agencies that own a case can request a case, photo, or specific information be removed or corrected. Email takedown@coldfile.app and we respond within 7 days.',
          ],
        },
        {
          heading: 'Full policy',
          body: [FULL_POLICY_URL],
        },
        {
          heading: 'Contact',
          body: ['Matte Black Dev LLC · Ventura, CA', 'privacy@coldfile.app'],
        },
      ]}
    />
  );
}
