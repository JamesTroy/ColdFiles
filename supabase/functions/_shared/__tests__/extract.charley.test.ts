// Fixture-backed test of the Charley Project extractor.
//
// Two fixture flavors:
//   - case_jane_doe_synthetic.html : structural scaffolding, mirrors real DOM
//   - case_john-andrew-aarlie.html : real response vendored 2026-04-27
//
// Both are run through the SAME production extractor with the SAME source config.
// Synthetic catches structural regressions on the path we control;
// real fixture pins production behavior in CI.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { extractWithStrategy, load } from '../extract.ts';
import { generateDedupeKeys } from '../dedupe.ts';
import { charleyProject } from '../../../../sources/charley.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../../../scraper-fixtures/charley_project');

function readFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8');
}

describe('charley extractor — synthetic fixture (Jane Doe)', () => {
  const html = readFixture('case_jane_doe_synthetic.html');
  const $ = load(html);
  const detailUrl = 'https://charleyproject.org/case/jane-synthetic-doe';
  const out = extractWithStrategy($, detailUrl, charleyProject.detail);

  it('extracts the victim name and splits it', () => {
    expect(out.victim_name).toBe('Jane Synthetic Doe');
    expect(out.victim_first_name).toBe('Jane');
    expect(out.victim_last_name).toBe('Doe');
  });

  it('extracts demographics from labelled meta items', () => {
    expect(out.victim_age).toBe(23);
    expect(out.victim_sex).toBe('female');
    expect(out.victim_race).toBe('White');
    expect(out.victim_height_cm).toBe(168);
    expect(out.victim_weight_kg).toBe(59);
  });

  it('extracts the missing-since date as exact', () => {
    expect(out.incident_date).toBe('1985-06-13');
    expect(out.incident_date_quality).toBe('exact');
    expect(out.incident_date_text).toBeUndefined();
  });

  it('parses Missing From into city + state', () => {
    expect(out.location_text).toBe('Claremont, California');
    expect(out.location_city).toBe('Claremont');
    expect(out.location_state).toBe('CA');
  });

  it('extracts agency hint with normalized phone', () => {
    expect(out.agency_hint?.name).toBe('Claremont Police Department');
    expect(out.agency_hint?.phone).toBe('+19093995411');
  });

  it('extracts distinguishing marks and clothing from labelled items', () => {
    expect(out.distinguishing_marks).toMatch(/scar above the left eyebrow/);
    expect(out.last_seen_clothing).toMatch(/denim jeans/);
  });

  it('strips the "Details of Disappearance" prefix from the narrative', () => {
    expect(out.narrative).toBeDefined();
    expect(out.narrative).not.toMatch(/^Details of Disappearance/);
    expect(out.narrative).toMatch(/Honda Civic/);
    expect(out.narrative_short).toBeDefined();
    expect(out.narrative_short!.length).toBeLessThanOrEqual(240);
    expect(out.narrative_short).not.toMatch(/^Details of Disappearance/);
  });

  it('extracts photos and resolves them to absolute URLs', () => {
    expect(out.photos?.length).toBe(2);
    expect(out.photos![0].url).toBe(
      'https://charleyproject.org/wp-content/uploads/2020/01/jane_doe_synthetic_1.jpg',
    );
  });

  it('inferKind() returns missing', () => {
    expect(out.kind).toBe('missing');
  });
});

describe('charley extractor — real fixture (John Andrew Aarlie)', () => {
  // This fixture was vendored 2026-04-27 from
  // https://charleyproject.org/case/john-andrew-aarlie via npm run vendor:fixture.
  // Updating Charley source config selectors must keep this case green.
  const html = readFixture('case_john-andrew-aarlie.html');
  const $ = load(html);
  const detailUrl = 'https://charleyproject.org/case/john-andrew-aarlie';
  const out = extractWithStrategy($, detailUrl, charleyProject.detail);

  it('extracts the victim name', () => {
    expect(out.victim_name).toBe('John Andrew Aarlie');
    expect(out.victim_first_name).toBe('John');
    expect(out.victim_last_name).toBe('Aarlie');
  });

  it('extracts age, sex, race', () => {
    expect(out.victim_age).toBe(52); // age at disappearance, not current
    expect(out.victim_sex).toBe('male');
    expect(out.victim_race).toMatch(/White/);
  });

  it('parses 5\'10, 170 pounds into cm + kg', () => {
    expect(out.victim_height_cm).toBe(178);
    expect(out.victim_weight_kg).toBe(77);
  });

  it('parses Missing Since 07/16/2011 as exact', () => {
    expect(out.incident_date).toBe('2011-07-16');
    expect(out.incident_date_quality).toBe('exact');
  });

  it('parses Missing From "Yakima, Washington" into city/state', () => {
    expect(out.location_text).toMatch(/^Yakima/);
    expect(out.location_city).toBe('Yakima');
    expect(out.location_state).toBe('WA');
  });

  it('extracts the investigating agency name + phone', () => {
    expect(out.agency_hint?.name).toBe('Quincy Police Department');
    expect(out.agency_hint?.phone).toBe('+15097874718');
  });

  it('extracts the long distinguishing-characteristics text', () => {
    expect(out.distinguishing_marks).toMatch(/eight-inch scar on his left leg/);
  });

  it('captures the medical-conditions clue in the clothing field tolerantly', () => {
    expect(out.last_seen_clothing).toMatch(/A watch/);
  });

  it('extracts narrative without the section header', () => {
    expect(out.narrative).toBeDefined();
    expect(out.narrative).not.toMatch(/^Details of Disappearance/);
    expect(out.narrative).toMatch(/Yakima Memorial Hospital/);
  });

  it('discovers one photo at the WordPress upload path', () => {
    expect(out.photos?.length).toBe(1);
    expect(out.photos![0].url).toMatch(/wp-content\/uploads\/.*aarlie/i);
  });

  it('produces dedupe keys including name_state_year and lastname_age_sex', () => {
    const record = {
      source_external_id: 'john-andrew-aarlie',
      source_url: detailUrl,
      kind: 'missing' as const,
      status: 'open' as const,
      incident_date_quality: 'exact' as const,
      photos: out.photos ?? [],
      raw: out.raw ?? {},
      victim_name: out.victim_name,
      victim_first_name: out.victim_first_name,
      victim_last_name: out.victim_last_name,
      victim_age: out.victim_age,
      victim_sex: out.victim_sex,
      incident_date: out.incident_date,
      location_state: out.location_state,
    };
    const types = generateDedupeKeys(record).map((k) => k.type);
    expect(types).toContain('name_state_year');
    expect(types).toContain('lastname_age_sex');
    // No explicit NamUs/NCIC number on this case → those tiers absent
    expect(types).not.toContain('namus_number');
  });
});

describe('charley extractor — sitemap URL filter', () => {
  const xml = readFixture('sitemap_synthetic.xml');
  const pattern =
    charleyProject.list.kind === 'sitemap' ? charleyProject.list.urlPattern : /never/;

  it('matches /case/<slug> URLs and rejects non-case URLs', () => {
    const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
    const matched = locs.filter((u) => pattern.test(u));
    expect(matched).toEqual([
      'https://charleyproject.org/case/jane-synthetic-doe',
      'https://charleyproject.org/case/john-synthetic-doe',
    ]);
  });
});
