import { LegalDocScreen } from '@/components/cf/legal-doc';

export default function AboutScreen() {
  return (
    <LegalDocScreen
      title="About"
      lastUpdated="2026-04-28"
      sections={[
        {
          body: [
            'The Cold File is a discovery and tip-routing app for unsolved cases — homicides, missing persons, and unidentified-person investigations.',
            'Cold cases get cold partly because they fall out of public attention. This app puts them back in front of people who might recognize something — a name, a place, a face — and routes any tip directly to the agency that owns the case.',
          ],
        },
        {
          heading: 'How it works',
          body: [
            'We aggregate cases from public agency releases and case-awareness aggregators (LASD, FBI, NamUs, Charley Project, Doe Network).',
            'The map and list show cases near you. Tap a case for the full file. If you have information, "Submit a tip" routes you to the agency\'s existing tip channel — Crime Stoppers, agency form, or agency phone.',
            'We never read or store your tip. The agency does.',
          ],
        },
        {
          heading: "Why we don't store tips",
          body: [
            'Holding tips means moderating them. Moderating tips on cold cases means making credibility judgments about active investigations, which is not our place. The agencies that own these cases have the authority and the experience. We just connect you to them.',
          ],
        },
        {
          heading: 'Who we are',
          body: [
            'Matte Black Dev LLC, based in Ventura, California.',
            'Questions? support@coldfile.app',
            'Takedown requests? takedown@coldfile.app',
          ],
        },
      ]}
    />
  );
}
