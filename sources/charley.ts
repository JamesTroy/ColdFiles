import type { SourceConfig } from '../supabase/functions/_shared/types.ts';

/**
 * The Charley Project — single-operator site, ~16k missing-person profiles.
 * Be exceptionally polite (5s between requests, 02:00–05:00 UTC window).
 *
 * Selectors are best-effort starting points based on the public site structure.
 * Verify against fixtures in scraper-fixtures/charley/*.html before promoting
 * out of dryrun.
 */
export const charleyProject: SourceConfig = {
  slug: 'charley_project',
  name: 'The Charley Project',
  kind: 'nonprofit',
  baseUrl: 'https://charleyproject.org',
  rateLimitMs: 5000,
  scheduleCron: '0 9 1 * *', // first of month, 09:00 UTC
  trustWeight: 75,
  windowUtc: { startHour: 2, endHour: 5 },
  attribution: {
    html: 'Source: <a href="https://charleyproject.org" rel="external">The Charley Project</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'alpha_index',
    indexUrl: 'https://charleyproject.org/cases',
    detailLinkSelector: 'a[href*="/case/"]',
  },
  detail: {
    kind: 'cheerio',
    selectors: {
      name: 'h1, .case-name',
      age: '.case-meta .age, dt:contains("Age") + dd',
      sex: '.case-meta .sex, dt:contains("Sex") + dd',
      race: '.case-meta .race, dt:contains("Race") + dd',
      height: 'dt:contains("Height") + dd',
      weight: 'dt:contains("Weight") + dd',
      incidentDate: '.case-meta .missing-since, dt:contains("Missing Since") + dd',
      lastSeenDate: 'dt:contains("Last Seen") + dd',
      locationText: '.case-meta .missing-from, dt:contains("Missing From") + dd',
      narrative:
        'article .case-narrative, article .field--name-body, article .body, .case-body',
      photoUrls: 'article img, .case-photos img',
      agencyName:
        '.case-agency .name, dt:contains("Investigating Agency") + dd',
      agencyPhone:
        '.case-agency .phone, dt:contains("Phone") + dd, dt:contains("Telephone") + dd',
      ncicNumber: 'dt:contains("NCIC") + dd',
      namusNumber: 'dt:contains("NamUs") + dd, dt:contains("NCMA") + dd',
      distinguishingMarks:
        'dt:contains("Distinguishing") + dd, dt:contains("Marks") + dd',
      clothing:
        'dt:contains("Clothing") + dd, dt:contains("Last seen wearing") + dd',
    },
    inferKind: () => 'missing',
  },
  defaults: {
    status: 'open',
    kind: 'missing',
    incident_date_quality: 'unknown',
    photos: [],
    raw: {},
  },
};
