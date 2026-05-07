/**
 * Display formatters shared across the map peek-sheet, list rows, and case-detail.
 *
 * Single source of truth so a change to (e.g.) the kind-line grammar or the
 * Doe-case display fallback updates every surface that uses it.
 */

import type { CaseKind, CaseRowFull, CaseRowMapNear, DateQuality } from './types/database';

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
/**
 * Inline pick rather than Pick<CaseRowMapNear, ...> so kindLine accepts
 * rows from any of the map-tier shapes (CaseRowMapNear, CaseRowMapBbox,
 * CaseRowFull). incident_date_quality is optional — pre-migration-36
 * rows from cases_in_bbox don't carry it; they fall back to no-marker
 * rendering, matching the prior behavior so the rollout is graceful.
 */
type KindLineRow = {
  kind: CaseKind;
  incident_date: string | null;
  incident_date_quality?: DateQuality | null;
  location_city: string | null;
  location_state: string | null;
};

export function kindLine(c: KindLineRow): string {
  const kind = KIND_DISPLAY[c.kind];
  const year = formatYearWithPrecision(c.incident_date, c.incident_date_quality);
  const city = c.location_city ? c.location_city.toUpperCase() : null;
  const state = c.location_state ? c.location_state.toUpperCase() : null;
  const place = [city, state].filter(Boolean).join(', ');
  return [kind, year, place].filter(Boolean).join(' · ');
}

/**
 * Year segment for kindLine, with precision marker AND explicit
 * "DATE UNKNOWN" surfacing.
 *
 *   exact                  → "1985"
 *   year_only              → "~1985"
 *   approximate            → "~1985"
 *   suspect                → "DATE UNKNOWN"  (source flagged date
 *                                              unreliable — don't
 *                                              show its year as if
 *                                              it were a real signal)
 *   unknown                → "DATE UNKNOWN"
 *   null incident_date     → "DATE UNKNOWN"  (no temporal claim at all)
 *   null/undefined quality → "1985"          (rollout-tolerant;
 *                                              pre-migration-36 rows
 *                                              that don't carry quality
 *                                              render with the legacy
 *                                              shape, no regression)
 *
 * Why "DATE UNKNOWN" inline instead of a separate badge: the
 * mono-caps kindLine already reads as label-register, the segment
 * occupies exactly the slot where a year would otherwise appear,
 * and a tipster scanning rows can't miss it. A separate badge
 * would add chrome without adding signal.
 *
 * The Same-Period bucketing layer (lib/period-bucket.ts) treats
 * suspect/unknown/missing-date rows as having no temporal claim
 * and routes them to "Other Nearby." This rendering is the paired
 * user-facing signal for that routing decision: the row lands in
 * Other Nearby AND visibly says why.
 */
function formatYearWithPrecision(
  incidentDate: string | null,
  quality: DateQuality | null | undefined,
): string | null {
  if (quality === 'suspect' || quality === 'unknown') return 'DATE UNKNOWN';
  if (!incidentDate) return 'DATE UNKNOWN';
  const year = incidentDate.slice(0, 4);
  if (!year) return 'DATE UNKNOWN';
  if (!quality) return year;
  if (quality === 'exact') return year;
  return `~${year}`;
}

/**
 * Display-safe victim name. Doe cases (kind = 'unidentified', no name) get
 * a respectful demographic fallback. The em-dash treatment for no-photo
 * cases is the parallel rule for missing photos.
 *
 * Accepts the narrower map-tier row shapes (CaseRowMapBbox / CaseRowMapNear),
 * which don't carry victim_sex / victim_age_min / victim_age_max — the demo-
 * graphic fallback degrades gracefully to "Unidentified" when those fields
 * are absent. Keeps every list/zone/case-row surface consistent with the
 * fuller "Unidentified Female, est. 25–35" rendering on case-detail.
 */
type DisplayNameRow = {
  kind: CaseKind;
  victim_name: string | null;
  victim_sex?: CaseRowFull['victim_sex'];
  victim_age_min?: number | null;
  victim_age_max?: number | null;
};

export function displayName(c: DisplayNameRow): string {
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

/**
 * Stepwise recency_alpha → representative day count for the Pin renderer
 * and the List tab's date buckets. Server emits 1.0 for 0–3 days,
 * 0.5 for 4–10 days, 0 (or null) for everything older.
 *
 * Returns null when the row has no recency signal at all — the caller
 * decides whether to fall back to a sample-data day count or treat the
 * row as stale.
 */
export function alphaToDays(alpha: number | null | undefined): number | null {
  if (alpha == null) return null;
  if (alpha >= 0.99) return 1;
  if (alpha >= 0.49) return 7;
  return null;
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

/**
 * "Oct 13 · 1985" — ledger format for cold-case dates where the year
 * is the emotional content and should read as a distinct unit. The
 * mid-dot separator gives the year breathing room compared to the
 * comma'd "Oct 13, 1985" form, where at-a-glance reading can register
 * "Oct 13" as a recent date and miss the year entirely.
 *
 * Use for case incident_date and last_seen_date in case-detail
 * surfaces. Keep formatDateMonthDay (comma) for recent / current-year
 * dates like tip submission timestamps.
 */
export function formatDateLedger(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d} · ${y}`;
}

/** "Claremont, CA" from city + state. */
export function formatPlace(c: { location_city: string | null; location_state: string | null }): string {
  return [c.location_city, c.location_state].filter(Boolean).join(', ');
}
