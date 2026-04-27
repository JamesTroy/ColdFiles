// Trust-weighted field merge. When two sources disagree, higher trust wins.
// Equal trust → keep current (stability).

import type { CaseRecord } from './types.ts';

/** Initial weights — see docs/02_SCRAPER_ARCHITECTURE.md. Tunable per source. */
export const DEFAULT_TRUST_WEIGHTS: Record<string, number> = {
  // Investigating-agency direct → strongest, they own the case.
  lapd_unsolved: 95,
  lasd_homicide: 95,
  lasd_blog: 95,
  // Federal vetted.
  namus: 90,
  fbi_wanted: 90,
  ncmec: 85,
  // Active state-level public DBs.
  fdle: 85,
  njsp_cold_case: 80,
  osp_cold_case: 80,
  txdps_cold_case: 80,
  // Researched aggregators.
  charley_project: 75,
  doe_network: 70,
  solve_the_case: 60,
  // Known data quality issues.
  project_cold_case: 50,
  // Media (narrative color, low for facts).
  media: 40,
};

export function mergeField<T>(
  current: T | undefined,
  incoming: T | undefined,
  currentTrust: number,
  incomingTrust: number,
): T | undefined {
  if (incoming === undefined || incoming === null) return current;
  if (current === undefined || current === null) return incoming;
  if (current === incoming) return current;
  return incomingTrust > currentTrust ? incoming : current;
}

/**
 * Merge an incoming CaseRecord onto an existing partial cases-row.
 * Returns the merged shape. Narrative is special: keep the longest narrative
 * from the highest-weight source, not first-write-wins.
 */
export function mergeRecord(
  current: Partial<CaseRecord>,
  currentTrust: number,
  incoming: CaseRecord,
  incomingTrust: number,
): Partial<CaseRecord> {
  const out: Partial<CaseRecord> = { ...current };

  const fields: (keyof CaseRecord)[] = [
    'victim_name',
    'victim_first_name',
    'victim_last_name',
    'victim_age',
    'victim_age_min',
    'victim_age_max',
    'victim_sex',
    'victim_race',
    'victim_ethnicity',
    'victim_height_cm',
    'victim_weight_kg',
    'victim_eye_color',
    'victim_hair_color',
    'distinguishing_marks',
    'incident_date',
    'incident_date_quality',
    'incident_date_text',
    'location_text',
    'location_city',
    'location_county',
    'location_state',
    'location_zip',
    'last_seen_text',
    'last_seen_date',
    'last_seen_clothing',
    'last_seen_circumstances',
    'case_number_primary',
    'ncic_number',
    'namus_number',
    'reward_amount_usd',
    'reward_text',
    'kind',
    'status',
  ];

  for (const f of fields) {
    // @ts-expect-error: indexed assignment across heterogeneous union of property types
    out[f] = mergeField(current[f], incoming[f], currentTrust, incomingTrust);
  }

  // Narrative: pick longest-from-highest-trust.
  if (incoming.narrative) {
    const cur = current.narrative;
    const useIncoming =
      !cur ||
      incomingTrust > currentTrust ||
      (incomingTrust === currentTrust && incoming.narrative.length > cur.length);
    if (useIncoming) out.narrative = incoming.narrative;
  }

  // Aliases: union, preserve order.
  if (incoming.victim_aliases?.length) {
    const set = new Set<string>(current.victim_aliases ?? []);
    for (const a of incoming.victim_aliases) set.add(a);
    out.victim_aliases = Array.from(set);
  }

  return out;
}
