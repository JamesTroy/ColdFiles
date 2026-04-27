// Fixture-backed test of the Doe Network JSON extractor.
//
//   Synthetic:  case_synthetic_fields.json + agencies + images  (hand-built scaffolding)
//   Real:       case_1002DMNY_fields.json + agencies + images   (vendored 2026-04-27)
//
// Both run through the SAME doeNetwork.detail.mapJson with the SAME source config.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateDedupeKeys } from '../dedupe.ts';
import { doeNetwork } from '../../../../sources/doe_network.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../../../scraper-fixtures/doe_network');

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8'));
}

function mapDetail(idPrefix: string) {
  if (doeNetwork.detail.kind !== 'json') throw new Error('expected json detail strategy');
  const detailUrl = `https://www.doenetwork.org/cases/software/php/mpdatabase.php?id=${idPrefix}&fields=true`;
  const data = {
    fields: readJson(`case_${idPrefix}_fields.json`),
    agencies: readJson(`case_${idPrefix}_agencies.json`),
    images: readJson(`case_${idPrefix}_images.json`),
  };
  return doeNetwork.detail.mapJson(data, detailUrl);
}

describe('doe network extractor — synthetic fixture (Jane Synthetic Doe)', () => {
  const out = mapDetail('synthetic');

  it('extracts the victim name and splits it', () => {
    expect(out.victim_name).toBe('Jane Synthetic Doe');
    expect(out.victim_first_name).toBe('Jane');
    expect(out.victim_last_name).toBe('Doe');
  });

  it('captures alias when present (and not "Unknown")', () => {
    expect(out.victim_aliases).toEqual(['Janie']);
  });

  it('extracts demographics', () => {
    expect(out.victim_age).toBe(23);
    expect(out.victim_sex).toBe('female');
    expect(out.victim_race).toBe('White');
    expect(out.victim_height_cm).toBe(168);
    expect(out.victim_weight_kg).toBe(59);
    expect(out.victim_hair_color).toBe('Brown');
    expect(out.victim_eye_color).toBe('Hazel');
  });

  it('parses missing_since as exact', () => {
    expect(out.incident_date).toBe('1985-06-13');
    expect(out.incident_date_quality).toBe('exact');
  });

  it('splits location into city / county / state', () => {
    expect(out.location_text).toBe('Claremont, Los Angeles County, California');
    expect(out.location_city).toBe('Claremont');
    expect(out.location_county).toMatch(/Los Angeles County/);
    expect(out.location_state).toBe('CA');
  });

  it('strips HTML from circumstances narrative', () => {
    expect(out.narrative).toBeDefined();
    expect(out.narrative).not.toMatch(/<\/?p>/);
    expect(out.narrative).not.toMatch(/<br/);
    expect(out.narrative).toMatch(/last seen leaving her workplace/);
    expect(out.narrative).toMatch(/case suspicious/);
    // narrative_short is the first paragraph capped at 240
    expect(out.narrative_short).toBeDefined();
    expect(out.narrative_short!.length).toBeLessThanOrEqual(240);
  });

  it('extracts agency hint from the first agency entry', () => {
    expect(out.agency_hint?.name).toBe('Claremont Police Department');
    expect(out.agency_hint?.phone).toBe('+19093995411');
    expect(out.case_number_primary).toBe('CLR-1985-0613');
  });

  it('extracts NamUs MP number from information_sources HTML', () => {
    expect(out.namus_number).toBe('MP9876');
  });

  it('extracts photo URLs out of img_reference HTML strings', () => {
    expect(out.photos?.length).toBe(2);
    expect(out.photos![0].url).toBe('https://www.doenetwork.org/cases/images/jane_synth_1.jpg');
    expect(out.photos![0].kind).toBe('photo_victim');
  });

  it('infers state from the ID suffix when location parsing also gives state', () => {
    // 9001DMCA → CA suffix matches the parsed location state (also CA).
    expect(out.location_state).toBe('CA');
  });

  it('produces all four dedupe key tiers', () => {
    const record = {
      source_external_id: '9001DMCA',
      source_url: 'https://www.doenetwork.org/cases/software/php/mpdatabase.php?id=9001DMCA&fields=true',
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
      case_number_primary: out.case_number_primary,
    };
    const types = generateDedupeKeys(record).map((k) => k.type);
    expect(types).toContain('namus_number');
    expect(types).toContain('name_state_year');
    expect(types).toContain('lastname_age_sex');
    expect(types).toContain('agency_case_number');
    // namus_number is strongest tier — must come first
    expect(types[0]).toBe('namus_number');
  });
});

describe('doe network extractor — real fixture (Duane Robert Talmon, Jr. — 1002DMNY)', () => {
  // Vendored 2026-04-27 from
  //   https://www.doenetwork.org/cases/software/php/mpdatabase.php?id=1002DMNY&fields=true
  // (also &agencies=true and &images=true). Updating the Doe Network mapper must keep
  // this real case green.
  const out = mapDetail('1002DMNY');

  it('extracts the victim name', () => {
    expect(out.victim_name).toBe('Duane Robert Talmon, Jr.');
    expect(out.victim_first_name).toBe('Duane');
  });

  it('extracts age, sex, race', () => {
    expect(out.victim_age).toBe(16);
    expect(out.victim_sex).toBe('male');
    expect(out.victim_race).toBe('White');
  });

  it('parses height + weight from human-formatted strings', () => {
    expect(out.victim_height_cm).toBe(173); // 5'8"
    expect(out.victim_weight_kg).toBe(66); // 145 lbs
  });

  it('parses missing_since "October 30, 1974" as exact', () => {
    expect(out.incident_date).toBe('1974-10-30');
    expect(out.incident_date_quality).toBe('exact');
  });

  it('parses location_last_seen + ID suffix into city / county / state', () => {
    expect(out.location_text).toBe('Buffalo, Erie County, New York');
    expect(out.location_city).toBe('Buffalo');
    expect(out.location_county).toMatch(/Erie County/);
    expect(out.location_state).toBe('NY');
  });

  it('extracts the first agency name + phone', () => {
    expect(out.agency_hint?.name).toMatch(/New York State Police/);
    expect(out.agency_hint?.phone).toBe('+17164066215');
    expect(out.case_number_primary).toBe('ACLA5307');
  });

  it('strips HTML from the circumstances narrative', () => {
    expect(out.narrative).toBeDefined();
    expect(out.narrative).not.toMatch(/<[a-z]+/i);
    expect(out.narrative).toMatch(/Williamsville North High School/);
    expect(out.narrative).toMatch(/Mike Thuman/);
  });

  it('extracts NamUs case 4566 from information_sources HTML', () => {
    expect(out.namus_number).toBe('MP4566');
  });

  it('captures the photo URL out of the image record', () => {
    expect(out.photos?.length).toBe(1);
    expect(out.photos![0].url).toBe('https://www.doenetwork.org/cases/images/DTalmon.jpg');
  });
});

describe('doe network extractor — closed-case path', () => {
  it('returns a stub with raw.closed=true when the case is marked is_closed=X', () => {
    if (doeNetwork.detail.kind !== 'json') throw new Error('expected json detail strategy');
    const detailUrl = 'https://www.doenetwork.org/cases/software/php/mpdatabase.php?id=999CLOSE&fields=true';
    const out = doeNetwork.detail.mapJson(
      {
        fields: { id: '999CLOSE', is_closed: 'X', pname: '' },
        agencies: [],
        images: [],
      },
      detailUrl,
    );
    expect((out.raw as { closed?: boolean })?.closed).toBe(true);
    expect(out.victim_name).toBeUndefined();
  });

  it('returns a stub when the fields endpoint returns null (case removed)', () => {
    if (doeNetwork.detail.kind !== 'json') throw new Error('expected json detail strategy');
    const out = doeNetwork.detail.mapJson(
      { fields: null, agencies: [], images: [] },
      'https://www.doenetwork.org/cases/software/php/mpdatabase.php?id=999NULL&fields=true',
    );
    expect((out.raw as { closed?: boolean })?.closed).toBe(true);
  });
});

describe('doe network — list strategy URL filter (sanity check on the index endpoints)', () => {
  it('exposes 10 missing-person index endpoints (5 countries × 2 sexes)', () => {
    if (doeNetwork.list.kind !== 'json_api') throw new Error('expected json_api list strategy');
    expect(doeNetwork.list.endpoints).toHaveLength(10);
    expect(doeNetwork.list.endpoints[0]).toMatch(/get_mp_males_index_us=true/);
    expect(doeNetwork.list.endpoints[1]).toMatch(/get_mp_females_index_us=true/);
  });

  it('produces a fields-bearing detail URL from a synthetic index entry', () => {
    if (doeNetwork.list.kind !== 'json_api') throw new Error('expected json_api list strategy');
    const indexEntries = readJson('index_us_males_synthetic.json') as Array<Record<string, unknown>>;
    const first = doeNetwork.list.detailUrl(indexEntries[0]);
    expect(first).toBe(
      'https://www.doenetwork.org/cases/software/php/mpdatabase.php?id=9001DMCA&fields=true',
    );
  });
});
