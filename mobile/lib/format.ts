/**
 * Display formatters shared across the map peek-sheet, list rows, and case-detail.
 *
 * Single source of truth so a change to (e.g.) the kind-line grammar or the
 * Doe-case display fallback updates every surface that uses it.
 */

import type { CaseKind, CaseRowFull, CaseRowMapNear } from './types/database';

const KIND_DISPLAY: Record<CaseKind, string> = {
  homicide: 'HOMICIDE',
  missing: 'MISSING',
  unidentified: 'UNIDENTIFIED',
  unclaimed: 'UNCLAIMED',
  suspicious_death: 'SUSPICIOUS DEATH',
};

/**
 * "HOMICIDE / 1985 / CLAREMONT, CA" — the mono-cap kind/year/place line that
 * goes ABOVE the victim name on map peek-sheets and list rows.
 *
 * Per docs/04_DESIGN_SYSTEM.md "Pill grammar" — case kind never appears as a
 * pill in the map/list surfaces because there's no key-facts table to
 * cross-reference; it's expressed here as the mono-caps label instead.
 */
export function kindLine(c: Pick<
  CaseRowMapNear,
  'kind' | 'incident_date' | 'location_city' | 'location_state'
>): string {
  const kind = KIND_DISPLAY[c.kind];
  const year = c.incident_date ? c.incident_date.slice(0, 4) : null;
  const city = c.location_city ? c.location_city.toUpperCase() : null;
  const state = c.location_state ? c.location_state.toUpperCase() : null;
  const place = [city, state].filter(Boolean).join(', ');
  return [kind, year, place].filter(Boolean).join(' / ');
}

/**
 * Display-safe victim name. Doe cases (kind = 'unidentified', no name) get
 * a respectful demographic fallback. The em-dash treatment for no-photo
 * cases is the parallel rule for missing photos.
 */
export function displayName(c: Pick<
  CaseRowFull,
  'kind' | 'victim_name' | 'victim_sex' | 'victim_age_min' | 'victim_age_max'
>): string {
  if (c.victim_name) return c.victim_name;

  if (c.kind === 'unidentified' || c.kind === 'unclaimed') {
    const sexLabel =
      c.victim_sex === 'male'
        ? 'Male'
        : c.victim_sex === 'female'
          ? 'Female'
          : null;
    const ageRange =
      c.victim_age_min && c.victim_age_max
        ? `${c.victim_age_min}–${c.victim_age_max}`
        : null;
    if (sexLabel && ageRange) return `Unidentified ${sexLabel}, est. ${ageRange}`;
    if (sexLabel) return `Unidentified ${sexLabel}`;
    return 'Unidentified';
  }

  return 'Name not released';
}

/** "1.4 mi away" or "" when distance unknown. */
export function distancePhrase(miles: number | null): string {
  if (miles == null) return '';
  if (miles < 0.1) return 'less than 0.1 mi away';
  return `${miles.toFixed(1)} mi away`;
}

/** "Oct 13, 1985" from an ISO date string. */
export function formatDateMonthDay(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** "Claremont, CA" from city + state. */
export function formatPlace(c: { location_city: string | null; location_state: string | null }): string {
  return [c.location_city, c.location_state].filter(Boolean).join(', ');
}
