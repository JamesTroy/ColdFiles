// String / value normalizers used across extraction, dedupe, and persistence.
// Pure TS — runtime-agnostic.

import type { CaseRecord, DateQuality, SexKind } from './types.ts';

const US_STATES = new Set<string>([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY','DC',
]);

/** Lowercase, strip accents, collapse whitespace, trim. */
export function normString(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Aggressive lowercase, alnum-and-underscore only. Used as a dedupe key building block. */
export function dedupeNorm(s: string): string {
  return normString(s)
    .replace(/[^a-z0-9_]/g, '')
    .trim();
}

/** Split a "First Middle Last" name. Returns [first, last]. Tolerates "Last, First" and "First Last". */
export function splitName(name: string): { first?: string; last?: string } {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (!cleaned) return {};

  // "Smith, John" form
  if (cleaned.includes(',')) {
    const [last, ...rest] = cleaned.split(',').map((p) => p.trim());
    const first = rest.join(' ').split(/\s+/)[0];
    return { first, last };
  }

  // "John Smith" or "John Q. Smith"
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { last: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/** "5'10\"" → 178cm. Best-effort. */
export function heightToCm(raw: string): number | undefined {
  const m = raw.match(/(\d+)\s*['']\s*(\d{1,2})/);
  if (m) return Math.round(parseInt(m[1], 10) * 30.48 + parseInt(m[2], 10) * 2.54);
  const cm = raw.match(/(\d{2,3})\s*cm/i);
  if (cm) return parseInt(cm[1], 10);
  const inches = raw.match(/^(\d{2,3})\s*in/i);
  if (inches) return Math.round(parseInt(inches[1], 10) * 2.54);
  return undefined;
}

/** "150 lbs" / "150 pounds" → 68kg. Best-effort. */
export function weightToKg(raw: string): number | undefined {
  const lb = raw.match(/(\d{2,3})\s*(?:lb|pound)/i);
  if (lb) return Math.round(parseInt(lb[1], 10) * 0.453592);
  const kg = raw.match(/(\d{2,3})\s*kg/i);
  if (kg) return parseInt(kg[1], 10);
  return undefined;
}

export function parseSex(raw: string): SexKind | undefined {
  const s = normString(raw);
  if (!s) return undefined;
  if (s.startsWith('m')) return 'male';
  if (s.startsWith('f')) return 'female';
  if (s.includes('unk') || s === '?') return 'unknown';
  return 'other';
}

export function parseAge(raw: string): number | undefined {
  const m = raw.match(/(\d{1,3})/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return n > 0 && n < 130 ? n : undefined;
}

/** Two-letter state code from "California", "CA", "calif.", etc. */
export function parseState(raw: string): string | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  if (US_STATES.has(upper)) return upper;

  // Match "California" → "CA"
  const NAME_TO_CODE: Record<string, string> = {
    'ALABAMA': 'AL','ALASKA': 'AK','ARIZONA': 'AZ','ARKANSAS': 'AR','CALIFORNIA': 'CA',
    'COLORADO': 'CO','CONNECTICUT': 'CT','DELAWARE': 'DE','FLORIDA': 'FL','GEORGIA': 'GA',
    'HAWAII': 'HI','IDAHO': 'ID','ILLINOIS': 'IL','INDIANA': 'IN','IOWA': 'IA','KANSAS': 'KS',
    'KENTUCKY': 'KY','LOUISIANA': 'LA','MAINE': 'ME','MARYLAND': 'MD','MASSACHUSETTS': 'MA',
    'MICHIGAN': 'MI','MINNESOTA': 'MN','MISSISSIPPI': 'MS','MISSOURI': 'MO','MONTANA': 'MT',
    'NEBRASKA': 'NE','NEVADA': 'NV','NEW HAMPSHIRE': 'NH','NEW JERSEY': 'NJ','NEW MEXICO': 'NM',
    'NEW YORK': 'NY','NORTH CAROLINA': 'NC','NORTH DAKOTA': 'ND','OHIO': 'OH','OKLAHOMA': 'OK',
    'OREGON': 'OR','PENNSYLVANIA': 'PA','RHODE ISLAND': 'RI','SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD','TENNESSEE': 'TN','TEXAS': 'TX','UTAH': 'UT','VERMONT': 'VT',
    'VIRGINIA': 'VA','WASHINGTON': 'WA','WEST VIRGINIA': 'WV','WISCONSIN': 'WI','WYOMING': 'WY',
    'DISTRICT OF COLUMBIA': 'DC',
  };
  const cleaned = upper.replace(/[.,]/g, '').trim();
  if (NAME_TO_CODE[cleaned]) return NAME_TO_CODE[cleaned];

  // Try first 4 chars as a fuzzy match (e.g. "CALIF" → "CA")
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (cleaned.length >= 4 && name.startsWith(cleaned.slice(0, 4))) return code;
  }
  return undefined;
}

/**
 * Best-effort date parser. Returns ISO YYYY-MM-DD plus a quality flag.
 * Recognizes:
 *   - ISO: 2015-06-13
 *   - US:  06/13/2015, 6/13/15
 *   - "June 13, 2015"
 *   - "June 2015" → year_only with month=06, day=01 (caller should drop day)
 *   - "1985"      → year_only
 */
export function parseDate(raw: string): { iso?: string; quality: DateQuality; text?: string } {
  if (!raw) return { quality: 'unknown' };
  const s = raw.trim();

  // ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { iso: s, quality: 'exact' };

  // US numeric
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    let [, mo, d, y] = us;
    if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y;
    return {
      iso: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`,
      quality: 'exact',
    };
  }

  // "Month D, YYYY"
  const monthFull = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthFull) {
    const [, monthName, day, year] = monthFull;
    const m = MONTHS.indexOf(monthName.toLowerCase().slice(0, 3));
    if (m >= 0) {
      return {
        iso: `${year}-${String(m + 1).padStart(2, '0')}-${day.padStart(2, '0')}`,
        quality: 'exact',
      };
    }
  }

  // "Month YYYY"
  const monthYear = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const [, monthName, year] = monthYear;
    const m = MONTHS.indexOf(monthName.toLowerCase().slice(0, 3));
    if (m >= 0) {
      return {
        iso: `${year}-${String(m + 1).padStart(2, '0')}-01`,
        quality: 'approximate',
        text: s,
      };
    }
  }

  // Year only
  const y = s.match(/^(\d{4})$/);
  if (y) return { iso: `${y[1]}-01-01`, quality: 'year_only', text: s };

  // Year embedded
  const yEmbed = s.match(/(\d{4})/);
  if (yEmbed) return { iso: `${yEmbed[1]}-01-01`, quality: 'approximate', text: s };

  return { quality: 'unknown', text: s };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Project: Cold Case has a known data quality issue where bad imports
 * reset incident_date to 1970-01-01. Flag those.
 */
export function markSuspectDates(rec: CaseRecord): CaseRecord {
  if (rec.incident_date === '1970-01-01') {
    return { ...rec, incident_date_quality: 'suspect' };
  }
  return rec;
}

/** Pull common phone formats out of free text. */
export function extractPhone(raw: string): string | undefined {
  const m = raw.match(/(\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/);
  if (!m) return undefined;
  return `+1${m[2]}${m[3]}${m[4]}`;
}

/**
 * Snap lat/lng to ~100m granularity (3 decimals ≈ 111m at equator) so we never
 * pinpoint a private residence. Apply before storing location_point.
 */
export function snapToBlock(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
  };
}

/** Derive a URL-safe slug from victim name + state + year. Stable input → stable slug. */
export function buildSlug(rec: Pick<CaseRecord, 'victim_name' | 'location_state' | 'incident_date' | 'source_external_id'>): string {
  const parts: string[] = [];
  if (rec.victim_name) parts.push(rec.victim_name);
  else parts.push('unidentified');
  if (rec.location_state) parts.push(rec.location_state);
  if (rec.incident_date) parts.push(rec.incident_date.slice(0, 4));
  parts.push(rec.source_external_id);
  return parts
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

/** Cap narrative length for storage; keep the head where the lede sits. */
export function truncateNarrative(text: string, maxLen = 8000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
