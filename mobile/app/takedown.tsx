import { LegalDocScreen } from '@/components/cf/legal-doc';

export default function TakedownScreen() {
  return (
    <LegalDocScreen
      title="Takedown Request"
      lastUpdated="2026-04-28"
      sections={[
        {
          body: [
            'If you are a family member or rights holder of someone whose case appears in The Cold Files, and you would like a photo or case removed, or information corrected, this page explains how.',
          ],
        },
        {
          heading: 'What we honor',
          body: [
            'We honor takedown requests from:',
            '• Immediate family members (parent, child, spouse, sibling) of a person depicted.',
            '• Legal representatives of the person or family.',
            '• Photographers / rights holders of a specific image.',
            'For photos sourced from law enforcement agencies, we also relay your request to that agency where appropriate. The current list of sources is documented in our Privacy Policy.',
          ],
        },
        {
          heading: 'How to request',
          body: [
            'Email takedown@coldfile.app with:',
            '1. The case slug or URL (visible at the top of the case detail screen, e.g. "CASE-LASD-1985-0413").',
            '2. Your name and relationship to the subject.',
            '3. What you would like changed: remove photo / remove case / correct info.',
            '4. If correcting info, what should change and why.',
            'We respond within 5 business days. If urgent (active investigation, ongoing harm), say so in the subject line.',
          ],
        },
        {
          heading: 'What happens after',
          body: [
            'If we agree the request is valid, we remove the content within 24 hours of acknowledgment. If the case originated from an agency tip or aggregator that publishes it themselves, we will also tell you who to contact at the source.',
          ],
        },
        {
          heading: 'Bad-faith requests',
          body: [
            'We reserve the right to decline requests we believe are made in bad faith — for example, attempts by persons of interest in an active investigation to suppress public-awareness material. Such requests will be referred to the investigating agency.',
          ],
        },
        {
          heading: 'Contact',
          body: ['Matte Black Dev LLC · Ventura, CA', 'takedown@coldfile.app'],
        },
      ]}
    />
  );
}
