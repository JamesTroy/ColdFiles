/**
 * JSON-LD structured data for the per-case share landing.
 *
 * The land-grab thesis (see project_landgrab_playbook_2026_05): the SEO
 * surface is the lever we have against Charley Project + Doe Network's
 * 20-year backlink head start. Same underlying data; faster pages with
 * proper schema.org markup; Google starts surfacing /case/{slug} for
 * victim-name long-tail. Inline JSON-LD is the cheapest correct way to
 * tell Google what each page is *about*.
 *
 * Graph shape:
 *   WebPage  →  about Person, mainEntity Article
 *   Article  →  about Person, contentLocation Place (when locality known)
 *   Person   →  the victim (or labeled "Unidentified Person" for UID)
 *   Place    →  PostalAddress only for v1 (city/state from cases.location_*).
 *               lat/lng lives in cases.location_point (PostGIS geography);
 *               surfacing GeoCoordinates needs an RPC that returns
 *               ST_X/ST_Y — separate pass once we measure whether
 *               address-only is enough for rich-results visibility.
 *
 * XSS safety: `<` is escaped to < on the stringified output. JSON
 * parsers unescape it back to `<` on read, but the HTML parser never
 * sees a literal `</script>` inside the script body even if some
 * future narrative_short contains the substring. React does NOT escape
 * inside <script> children, so this escape is load-bearing.
 *
 * Unidentified-persons caveat: emitting Person schema for synthetic
 * "Unidentified Person" identities is allowed but is the most likely
 * place Google's rich-results pipeline misbehaves. If Search Console
 * starts flagging Person errors on UID slugs we add an early-return
 * in `buildVictim` to skip Person entirely for kind === 'unidentified'.
 */

interface CaseJsonLdRow {
  slug: string;
  kind: 'homicide' | 'missing' | 'unidentified' | 'unclaimed' | 'suspicious_death';
  victim_name: string | null;
  victim_first_name: string | null;
  victim_last_name: string | null;
  victim_sex: string | null;
  victim_age: number | null;
  incident_date: string | null;
  location_city: string | null;
  location_state: string | null;
  narrative_short: string | null;
  created_at: string;
  last_changed_at: string;
}

const SITE_URL = 'https://coldfile.app';

const ORG = {
  '@type': 'Organization',
  '@id': `${SITE_URL}#org`,
  name: 'The Cold File',
  url: SITE_URL,
} as const;

function displayName(c: CaseJsonLdRow): string {
  if (c.victim_name) return c.victim_name;
  if (c.kind === 'unidentified') return 'Unidentified Person';
  return 'Unnamed case';
}

function headlineFor(c: CaseJsonLdRow, name: string): string {
  switch (c.kind) {
    case 'homicide':
      return `Unsolved homicide: ${name}`;
    case 'missing':
      return `Missing person: ${name}`;
    case 'unidentified':
      return `Unidentified person: ${name}`;
    case 'unclaimed':
      return `Unclaimed person: ${name}`;
    case 'suspicious_death':
      return `Suspicious death: ${name}`;
  }
}

function disambiguatingDescription(c: CaseJsonLdRow): string | null {
  if (!c.incident_date) return null;
  switch (c.kind) {
    case 'missing':
      return `Missing since ${c.incident_date}`;
    case 'unidentified':
      return `Unidentified; remains found ${c.incident_date}`;
    case 'homicide':
    case 'suspicious_death':
      return `Incident date ${c.incident_date}`;
    case 'unclaimed':
      return `Recorded ${c.incident_date}`;
  }
}

function buildCaseJsonLd(c: CaseJsonLdRow) {
  const pageId = `${SITE_URL}/case/${c.slug}`;
  const victimId = `${pageId}#victim`;
  const articleId = `${pageId}#case`;
  const placeId = `${pageId}#location`;

  const name = displayName(c);
  const headline = headlineFor(c, name);
  const disambig = disambiguatingDescription(c);

  const victim: Record<string, unknown> = {
    '@type': 'Person',
    '@id': victimId,
    name,
  };
  if (c.victim_first_name) victim.givenName = c.victim_first_name;
  if (c.victim_last_name) victim.familyName = c.victim_last_name;
  if (c.victim_sex) victim.gender = c.victim_sex;
  if (disambig) victim.disambiguatingDescription = disambig;

  const hasLocality = Boolean(c.location_city ?? c.location_state);
  const place = hasLocality
    ? {
        '@type': 'Place',
        '@id': placeId,
        name: [c.location_city, c.location_state].filter(Boolean).join(', '),
        address: {
          '@type': 'PostalAddress',
          ...(c.location_city ? { addressLocality: c.location_city } : {}),
          ...(c.location_state ? { addressRegion: c.location_state } : {}),
          addressCountry: 'US',
        },
      }
    : null;

  const article: Record<string, unknown> = {
    '@type': 'Article',
    '@id': articleId,
    headline,
    datePublished: c.created_at,
    dateModified: c.last_changed_at,
    author: ORG,
    publisher: ORG,
    mainEntityOfPage: { '@id': pageId },
    about: { '@id': victimId },
  };
  if (c.narrative_short) article.description = c.narrative_short;
  if (place) article.contentLocation = { '@id': placeId };

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': pageId,
        url: pageId,
        name: headline,
        ...(c.narrative_short ? { description: c.narrative_short } : {}),
        about: { '@id': victimId },
        mainEntity: { '@id': articleId },
      },
      victim,
      article,
      ...(place ? [place] : []),
    ],
  };
}

export function CaseJsonLd({ caseRow }: { caseRow: CaseJsonLdRow }) {
  const data = buildCaseJsonLd(caseRow);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}

export type { CaseJsonLdRow };
