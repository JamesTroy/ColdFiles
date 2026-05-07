import { LegalDocScreen } from '@/components/cf/legal-doc';

const FULL_POLICY_URL = 'https://coldfile.app/legal/privacy';

export default function PrivacyScreen() {
  return (
    <LegalDocScreen
      title="Privacy Policy"
      lastUpdated="2026-05-08"
      sections={[
        {
          body: [
            'The Cold Files is operated by Matte Black Dev LLC, a California limited liability company (registration b20260078079), which is the data controller for the purposes of this policy.',
            'This in-app summary covers the load-bearing claims. The full policy — including retention windows, third-party providers, and your rights under CCPA / CPRA / GDPR — lives at coldfile.app/legal/privacy.',
          ],
        },
        {
          heading: 'The tip claim',
          body: [
            'When you submit a tip, the content of what you wrote never reaches our servers. The text is hashed locally on your device, and the hash cannot be reversed to recover the words. We do log that a routing happened — case ID, time, the one-way hash, a hashed approximation of your IP, your device summary, the agency / URL / route kind we sent you to, and your user ID if you are signed in. None of those reveal the content. We retain this routing log for 12 months for abuse detection, then purge it on a daily job.',
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
          heading: 'Watch zones',
          body: [
            'If you draw a watch zone to receive alerts about cases in that area, we store the polygon you drew, your label for it, and your alert preferences server-side so we can match new cases against it on a recurring schedule. The polygon is yours; we do not share or sell it. You can delete a watch zone at any time from the Saved tab — deletion is immediate, server-side included.',
          ],
        },
        {
          heading: 'Accounts',
          body: [
            'The app works without an account. If you sign in, we ask only for your email — used solely to authenticate you, never for marketing.',
            'Delete your account via Me → Delete account. Your email and any server-side records are removed from our active database within 5 business days. Saved cases live in device storage on your phone and are removed when you sign out or uninstall the app.',
          ],
        },
        {
          heading: 'What we do not do',
          body: [
            '• Sell or rent your personal information.',
            '• Share your personal information for cross-context behavioral advertising.',
            '• Run ads or have advertising partners.',
            '• Use third-party analytics that track you across apps.',
            '• Store the content of your tips.',
          ],
        },
        {
          heading: 'Notifications',
          body: [
            'When you turn on notifications, we register a delivery token from your device\'s push service (Apple or Google) so we can send alerts about cases you save, new cases in your watch zones, and tip status updates. Alongside the token, we record your platform (iOS or Android), an anonymous install identifier (so a single device with multiple tokens over time deduplicates), your alert preferences, and the last time the token checked in. We do not log notification content. Tokens are deleted when you delete your account or revoke notification permission in device settings.',
          ],
        },
        {
          heading: 'Takedown',
          body: [
            'Family members, rights holders, and the agencies that own a case can request a case, photo, or specific information be removed or corrected. Email takedown@coldfile.app and we respond within 5 business days.',
          ],
        },
        {
          heading: 'Personal information we collect',
          body: [
            'Under California law (CCPA / CPRA) we are required to enumerate the categories of personal information we collect. We collect:',
            '• Identifiers — email address (only if you sign in), an internal user ID, push notification token, an anonymous install identifier per device.',
            '• Internet or network activity — a one-way hash approximation of your IP address (for tip-submission abuse rate-limiting), a coarse summary of your device (model + OS major version), and request timestamps.',
            '• Geolocation — approximate (city-level) location used only in transit when you ask the app to show cases near you. Precise location is not collected. If you draw a watch zone, we store the polygon you drew (the geometry of the area, not your real-time location).',
            '• Audit information — for each tip you submit, a routing record (timestamp, case ID, one-way hash of your tip text, the agency / URL we sent you to, and your user ID if signed in).',
            'We do not collect commercial information, biometric data, professional or employment information, education information, sensitive personal information beyond approximate location, or any inferences drawn from the above.',
          ],
        },
        {
          heading: 'Where we get it',
          body: [
            'Directly from you — your email at sign-in, the tip you submit, the watch zone you draw, the cases you save.',
            'Automatically from your device — push token (when you opt into notifications), platform, anonymous install ID, IP address, user agent.',
            'We do not buy or receive personal information about you from any third party.',
          ],
        },
        {
          heading: 'Service providers we share with',
          body: [
            'We use a small set of vendors to operate the app. Each is bound by a data processing agreement that prohibits using your data for their own purposes:',
            '• Supabase — database, authentication, row-level-security-gated reads and writes.',
            '• Apple Push Notification service / Google Firebase Cloud Messaging — push notification delivery (only the token you authorized).',
            '• Mapbox — map tiles. Mapbox sees your approximate map viewport but not who you are.',
            '• Resend — transactional email delivery (the magic link for sign-in).',
            '• Vercel — hosting for the web property at coldfile.app.',
            'We do not "sell" personal information as defined by CCPA §1798.140(ad) or "share" it for cross-context behavioral advertising as defined by §1798.140(ah).',
          ],
        },
        {
          heading: 'How long we keep it',
          body: [
            '• Email and account record — until you delete your account (then purged within 5 business days).',
            '• Tip-routing audit log — 12 months from the routing event, then purged on a daily job. The user_id link is anonymized at account deletion even before the 12 months expires.',
            '• Push notification token + install ID — until you revoke notification permission or delete your account.',
            '• Watch zone polygons — until you delete the zone or your account.',
            '• Approximate location — not retained; used in the request and discarded.',
            '• Saved cases — only on your device, never on our servers.',
          ],
        },
        {
          heading: 'Your rights',
          body: [
            'Under California law (and similar rights under GDPR for EU residents) you have the right to:',
            '• Know what personal information we hold about you.',
            '• Delete your personal information.',
            '• Correct inaccurate personal information.',
            '• Opt out of any sale or sharing (see "Do Not Sell or Share" below — we do neither).',
            '• Receive equal service even if you exercise these rights (we do not discriminate against you for it).',
            'You can exercise these rights from the Me tab — Delete account purges your account record; Export your data downloads everything we have. For correction or any other request, email privacy@coldfile.app. We verify your request by confirming you control the email address on the account, and respond within 45 days (CCPA) or 30 days (GDPR), often much faster.',
          ],
        },
        {
          heading: 'Do Not Sell or Share My Personal Information',
          body: [
            'We do not sell your personal information and we do not share it for cross-context behavioral advertising. There is nothing to opt out of, but you have the explicit right to ask us to confirm this — email privacy@coldfile.app and we will respond in writing.',
          ],
        },
        {
          heading: 'Users under 16',
          body: [
            'The Cold Files contains depictions of deceased and missing persons (case content) and is not intended for users under 16. We do not knowingly collect personal information from anyone under 16. If you believe we have, email privacy@coldfile.app and we will delete the account.',
            'For California residents under 16, we will not sell or share your personal information without your affirmative authorization (per CCPA §1798.120(c)) — but as stated above, we do not sell or share at all.',
          ],
        },
        {
          heading: 'EU users',
          body: [
            'If you are in the EU, the lawful bases under GDPR Article 6 for our processing are: contract (your account email, to authenticate you), legitimate interest (tip-routing audit log, to prevent abuse), and consent (push notifications, location). You can withdraw consent at any time by revoking the relevant permission in your device settings. Full GDPR rights, including the right to lodge a complaint with your supervisory authority, are documented in the canonical policy at coldfile.app/legal/privacy.',
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
