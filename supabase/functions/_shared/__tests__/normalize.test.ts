import { describe, expect, it } from 'vitest';
import {
  buildSlug,
  dedupeNorm,
  heightToCm,
  parseAge,
  parseDate,
  parseSex,
  parseState,
  snapToBlock,
  splitName,
  weightToKg,
} from '../normalize.ts';

describe('normalize.splitName', () => {
  it('handles "First Last"', () => {
    expect(splitName('Jane Doe')).toEqual({ first: 'Jane', last: 'Doe' });
  });
  it('handles "Last, First"', () => {
    expect(splitName('Doe, Jane')).toEqual({ first: 'Jane', last: 'Doe' });
  });
  it('keeps last only on a single-token name', () => {
    expect(splitName('Madonna')).toEqual({ last: 'Madonna' });
  });
  it('takes first + last around a middle initial', () => {
    expect(splitName('Jane Q. Doe')).toEqual({ first: 'Jane', last: 'Doe' });
  });
});

describe('normalize.parseDate', () => {
  it('parses ISO', () => {
    expect(parseDate('2015-06-13')).toEqual({ iso: '2015-06-13', quality: 'exact' });
  });
  it('parses US slash', () => {
    expect(parseDate('6/13/2015')).toEqual({ iso: '2015-06-13', quality: 'exact' });
  });
  it('parses "June 13, 2015"', () => {
    expect(parseDate('June 13, 2015')).toEqual({ iso: '2015-06-13', quality: 'exact' });
  });
  it('parses "June 1985" as approximate', () => {
    const r = parseDate('June 1985');
    expect(r.iso).toBe('1985-06-01');
    expect(r.quality).toBe('approximate');
  });
  it('parses "1985" as year_only', () => {
    const r = parseDate('1985');
    expect(r.iso).toBe('1985-01-01');
    expect(r.quality).toBe('year_only');
  });
  it('returns unknown for garbage', () => {
    expect(parseDate('').quality).toBe('unknown');
  });
});

describe('normalize.parseSex', () => {
  it('maps F/M/Unknown', () => {
    expect(parseSex('Female')).toBe('female');
    expect(parseSex('Male')).toBe('male');
    expect(parseSex('Unknown')).toBe('unknown');
  });
});

describe('normalize.parseState', () => {
  it('handles 2-letter codes', () => {
    expect(parseState('CA')).toBe('CA');
  });
  it('handles full names', () => {
    expect(parseState('California')).toBe('CA');
    expect(parseState('NEW YORK')).toBe('NY');
  });
  it('handles abbreviations with periods', () => {
    expect(parseState('Calif.')).toBe('CA');
  });
});

describe('normalize.parseAge', () => {
  it('extracts a leading number', () => {
    expect(parseAge('23')).toBe(23);
    expect(parseAge('23 years old')).toBe(23);
  });
  it('rejects out-of-range', () => {
    expect(parseAge('500')).toBeUndefined();
  });
});

describe('normalize.heightToCm', () => {
  it('parses 5\'10"', () => {
    expect(heightToCm("5'10\"")).toBe(178);
  });
  it('parses 178cm', () => {
    expect(heightToCm('178 cm')).toBe(178);
  });
});

describe('normalize.weightToKg', () => {
  it('parses 150 lbs', () => {
    expect(weightToKg('150 lbs')).toBe(68);
  });
  it('parses 68 kg', () => {
    expect(weightToKg('68 kg')).toBe(68);
  });
});

describe('normalize.snapToBlock', () => {
  it('rounds to 3 decimals', () => {
    expect(snapToBlock(34.067123, -118.395876)).toEqual({ lat: 34.067, lng: -118.396 });
  });
});

describe('normalize.dedupeNorm', () => {
  it('lowercases and strips non-alnum', () => {
    expect(dedupeNorm('Doe, Jane!')).toBe('doejane');
  });
});

describe('normalize.buildSlug', () => {
  it('produces a stable slug', () => {
    const s = buildSlug({
      victim_name: 'Jane Doe',
      location_state: 'CA',
      incident_date: '1985-06-13',
      source_external_id: 'charley-12345',
    });
    expect(s).toBe('jane-doe-ca-1985-charley-12345');
  });
  it('falls back to "unidentified" with no name', () => {
    const s = buildSlug({
      location_state: 'CA',
      incident_date: '1985-06-13',
      source_external_id: 'doe-99',
    });
    expect(s.startsWith('unidentified')).toBe(true);
  });
});
