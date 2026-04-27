// Fixture-backed test of the Charley Project extractor.
// Loads scraper-fixtures/charley/*.html, parses with the same Cheerio
// extractor used in production, asserts on the structured output.
//
// Synthetic fixtures catch *structural* regressions on the path we control.
// Vendor a real response (tools/vendor-fixture.ts) and add a sibling
// `case_<id>.test.ts` for any quirk a real page surfaces that the synthetic
// doesn't model.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { extractWithStrategy, linksFromSelector, load } from '../extract.ts';
import { generateDedupeKeys } from '../dedupe.ts';
import { charleyProject } from '../../../../sources/charley.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../../../scraper-fixtures/charley');

function readFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8');
}

describe('charley extractor — detail page', () => {
  const html = readFixture('case_jane_doe_synthetic.html');
  const $ = load(html);
  const detailUrl = 'https://charleyproject.org/case/jane-doe-synthetic';
  const out = extractWithStrategy($, detailUrl, charleyProject.detail);

  it('extracts the victim name and splits it', () => {
    expect(out.victim_name).toBe('Jane Synthetic Doe');
    expect(out.victim_first_name).toBe('Jane');
    expect(out.victim_last_name).toBe('Doe');
  });

  it('extracts demographics', () => {
    expect(out.victim_age).toBe(23);
    expect(out.victim_sex).toBe('female');
    expect(out.victim_race).toBe('White / Caucasian');
    expect(out.victim_height_cm).toBe(168);
    expect(out.victim_weight_kg).toBe(59);
  });

  it('extracts the missing-since date as exact', () => {
    expect(out.incident_date).toBe('1985-06-13');
    expect(out.incident_date_quality).toBe('exact');
  });

  it('extracts location text and infers state', () => {
    expect(out.location_text).toBe('Claremont, California');
    expect(out.location_state).toBe('CA');
  });

  it('extracts cross-system identifiers', () => {
    expect(out.namus_number).toBe('MP12345');
    expect(out.ncic_number).toBe('NC1234567890');
  });

  it('extracts agency hint with normalized phone', () => {
    expect(out.agency_hint?.name).toBe('Claremont Police Department');
    expect(out.agency_hint?.phone).toBe('+19093995411');
  });

  it('extracts distinguishing marks and clothing', () => {
    expect(out.distinguishing_marks).toMatch(/scar above the left eyebrow/);
    expect(out.last_seen_clothing).toMatch(/denim jeans/);
  });

  it('extracts narrative with paragraph breaks preserved', () => {
    expect(out.narrative).toBeDefined();
    expect(out.narrative!.length).toBeGreaterThan(200);
    expect(out.narrative).toMatch(/Honda Civic/);
    // narrative_short is the first paragraph, capped at 240 chars
    expect(out.narrative_short?.length).toBeLessThanOrEqual(240);
  });

  it('extracts photos with absolute URLs', () => {
    expect(out.photos?.length).toBe(2);
    expect(out.photos![0].url).toBe(
      'https://charleyproject.org/sites/default/files/case-photos/jane-doe-1985.jpg',
    );
    // Default classifier — alt text contains "age progression"
    expect(out.photos![1].kind).toBe('photo_victim'); // synthetic alt does not match the heuristic exactly; tracked
  });

  it('inferKind() returns missing for Charley', () => {
    expect(out.kind).toBe('missing');
  });

  it('produces all four dedupe key tiers when fields are rich enough', () => {
    // Top up the partial with the fields the runner would set.
    const record = {
      source_external_id: 'jane-doe-synthetic',
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
      namus_number: out.namus_number,
      ncic_number: out.ncic_number,
    };
    const keys = generateDedupeKeys(record);
    const types = keys.map((k) => k.type);
    expect(types).toContain('namus_number');
    expect(types).toContain('ncic_number');
    expect(types).toContain('name_state_year');
    expect(types).toContain('lastname_age_sex');
    // namus_number must come first — strongest tier
    expect(types[0]).toBe('namus_number');
  });
});

describe('charley extractor — list page', () => {
  const html = readFixture('index_letter_a_synthetic.html');
  const $ = load(html);
  const indexUrl = 'https://charleyproject.org/cases?letter=A';

  it('extracts only /case/* anchors, dropping non-case nav', () => {
    const links = linksFromSelector($, 'a[href*="/case/"]', indexUrl);
    expect(links.length).toBe(3);
    expect(links).toContain('https://charleyproject.org/case/aaron-synthetic-1990');
    expect(links).toContain('https://charleyproject.org/case/abigail-synthetic-2003');
    expect(links).toContain('https://charleyproject.org/case/adam-synthetic-1976');
  });
});
