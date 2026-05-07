import { LegalDocScreen } from '@/components/cf/legal-doc';

export default function TermsScreen() {
  return (
    <LegalDocScreen
      title="Terms of Service"
      lastUpdated="2026-05-08"
      sections={[
        {
          body: [
            'The Cold Files is operated by Matte Black Dev LLC, a California limited liability company (registration b20260078079). By using The Cold Files, you agree to these terms.',
          ],
        },
        {
          heading: 'What this app does',
          body: [
            'The Cold Files aggregates publicly available information about unsolved cases (homicides, missing persons, unidentified persons) from law enforcement agencies and case-awareness aggregators. The app helps you discover cases and submit tips to the agencies that own them.',
          ],
        },
        {
          heading: 'What this app does NOT do',
          body: [
            '• We do not investigate cases.',
            '• We do not read or moderate the content of the tips you submit. The tip content itself never reaches our servers — we only log that a routing happened (timestamp, case ID, a one-way hash of your tip, the agency we sent you to, and your user ID if signed in). See the Privacy Policy for the full list.',
            '• We are not affiliated with any law enforcement agency.',
            '• We do not guarantee that the information shown is current, accurate, or complete. Always verify with the investigating agency before acting on it.',
          ],
        },
        {
          heading: 'Tips',
          body: [
            'When you submit a tip, the app routes you to the agency\'s existing tip channel. The tip text itself never passes through our servers — it is hashed locally on your device. We do log that a routing happened (timestamp, case ID, the one-way hash, a hashed approximation of your IP for abuse rate-limiting, the agency / URL we sent you to, and your user ID if signed in). This routing log is retained for 12 months and then purged. The Privacy Policy has the full breakdown.',
          ],
        },
        {
          heading: 'Photos and content',
          body: [
            'Photos and case information shown in this app come from publicly available federal, state, and local public records, including law enforcement agency releases and volunteer case-awareness aggregators. The current source list is documented in our Privacy Policy. Photos are attributed to their source. If you are a family member or rights holder and want content removed, submit a Takedown Request from the Me tab.',
          ],
        },
        {
          heading: 'Copyright (DMCA notice and counter-notice)',
          body: [
            'If you believe content in The Cold Files infringes your copyright, send a notice that includes (1) your physical or electronic signature, (2) identification of the copyrighted work claimed to be infringed, (3) identification of the material to be removed and where it appears in the app (case slug or URL is sufficient), (4) your contact information, (5) a statement under penalty of perjury that you have a good-faith belief the use is unauthorized, and (6) a statement that the information in your notice is accurate and you are the owner or authorized to act on the owner\'s behalf.',
            'Send DMCA notices to our designated agent at dmca@coldfile.app. Once we receive a complete notice we remove the material expeditiously and notify the source from which the material was ingested.',
            'If you believe material was removed in error, you may submit a counter-notice to the same address with the elements required by 17 U.S.C. § 512(g)(3). We will restore the material within 10 to 14 business days unless the original complainant files a lawsuit.',
            'We terminate accounts of repeat infringers in appropriate circumstances.',
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
          heading: 'Indemnification',
          body: [
            'You agree to indemnify, defend, and hold harmless Matte Black Dev LLC, its officers, employees, and agents from any claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys\' fees) arising out of or related to (a) your use of the app in violation of these terms, (b) your misuse of tip routing, (c) any content you republish from the app, or (d) your violation of any law or any third party\'s rights. We reserve the right to assume the exclusive defense of any matter for which you must indemnify us, in which case you agree to cooperate with our defense at your own expense.',
          ],
        },
        {
          heading: 'No warranty',
          body: [
            'The app is provided "as is" and "as available" by Matte Black Dev LLC, without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, non-infringement, or accuracy of data. We make no guarantees about uptime, data accuracy, or fitness for any particular purpose. Cold cases are sensitive — verify before you act.',
          ],
        },
        {
          heading: 'Limitation of liability',
          body: [
            'To the maximum extent permitted by law, Matte Black Dev LLC and its officers, employees, and agents shall not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages arising out of or related to your use of the app, including but not limited to lost profits, lost data, business interruption, or personal injury, even if we have been advised of the possibility of such damages.',
            'In any event, the aggregate liability of Matte Black Dev LLC arising out of or related to these terms or your use of the app shall not exceed one hundred U.S. dollars ($100), or the total amount you paid us for the app in the 12 months preceding the event giving rise to liability, whichever is greater.',
            'Some jurisdictions do not allow the exclusion or limitation of certain damages, so portions of this limitation may not apply to you. Nothing in these terms limits our liability for fraud, gross negligence, willful misconduct, or any liability that cannot be excluded under applicable law.',
          ],
        },
        {
          heading: 'Disputes — informal resolution, then arbitration',
          body: [
            'We want to resolve any dispute quickly and informally. Before initiating arbitration, you and Matte Black Dev LLC agree to attempt a good-faith resolution by contacting the other in writing — for you, by emailing legal@coldfile.app describing the dispute and the relief you seek. We will respond within 30 days. If we cannot resolve the dispute within 60 days of the written notice, either party may begin arbitration.',
            'Any dispute that is not resolved informally shall be resolved by final and binding arbitration administered by the American Arbitration Association (AAA) under its Consumer Arbitration Rules, by a single arbitrator. The arbitration will be conducted in English, in California, by video conference, by phone, or based solely on written submissions, at the option of the party initiating the arbitration. Judgment on the award may be entered in any court of competent jurisdiction.',
            'EXCEPTIONS: Nothing in this section requires arbitration of (a) claims solely for injunctive or equitable relief based on intellectual property rights, or (b) claims that may be brought in small-claims court if they qualify.',
            'CLASS ACTION WAIVER: You and Matte Black Dev LLC agree that each may bring claims against the other only in your or its individual capacity, and not as a plaintiff or class member in any purported class, collective, or representative action. The arbitrator may not consolidate more than one person\'s claims and may not preside over any form of representative or class proceeding.',
            'OPT-OUT: You can opt out of this arbitration agreement by sending an email to legal@coldfile.app within 30 days of first accepting these terms with the subject line "Arbitration Opt-Out" and your registered email address. Opting out does not affect any other provision of these terms.',
            'If any portion of this arbitration agreement is found unenforceable, the unenforceable portion will be severed and the remainder shall remain in force, except that if the class-action waiver is found unenforceable as to a particular claim or remedy, then that claim or remedy (and only that claim or remedy) must be brought in court.',
          ],
        },
        {
          heading: 'Force majeure',
          body: [
            'Matte Black Dev LLC is not liable for any failure or delay in performing its obligations under these terms when such failure or delay is caused by events beyond its reasonable control, including without limitation acts of God, natural disasters, war, terrorism, civil unrest, pandemic, government action, network or infrastructure outages, or labor disputes.',
          ],
        },
        {
          heading: 'Severability',
          body: [
            'If any provision of these terms is held invalid or unenforceable by a court of competent jurisdiction, that provision shall be severed and the remaining provisions shall remain in full force and effect. The court is authorized to modify such provision to the minimum extent necessary to make it valid and enforceable.',
          ],
        },
        {
          heading: 'Entire agreement',
          body: [
            'These terms, together with the Privacy Policy and any other policies expressly referenced here, constitute the entire agreement between you and Matte Black Dev LLC regarding your use of the app, and supersede all prior or contemporaneous understandings, communications, or agreements, whether written or oral.',
          ],
        },
        {
          heading: 'Changes',
          body: [
            'We may update these terms from time to time. When we do, we will revise the "Last updated" date at the top of this document and, for material changes, surface a notice in the app on next launch. Continued use of the app after an update means you accept the new terms. If you do not accept the new terms, you must stop using the app and may delete your account.',
          ],
        },
        {
          heading: 'Governing law and venue',
          body: [
            'These terms are governed by the laws of the State of California, USA, without regard to its conflict-of-laws rules. For any dispute not subject to arbitration under the section above, you and Matte Black Dev LLC submit to the exclusive jurisdiction of the state and federal courts located in Ventura County, California.',
          ],
        },
        {
          heading: 'Contact',
          body: [
            'Matte Black Dev LLC · Ventura, CA',
            'General: support@coldfile.app',
            'Legal / arbitration / opt-out: legal@coldfile.app',
            'DMCA notices: dmca@coldfile.app',
            'Privacy: privacy@coldfile.app',
            'Takedowns: takedown@coldfile.app',
          ],
        },
      ]}
    />
  );
}
