/**
 * Round-robin interleave a list of case-shaped rows by kind, preserving
 * within-kind order. Used on the Map bottom-sheet and the List tab when
 * the kind filter is "all" — surfaces variety at the top of the list
 * instead of letting whichever kind dominates the current sort axis
 * (recency for the map, incident_date for the list) pin the visible
 * window.
 *
 * Why round-robin instead of a more elaborate quota / weighted-shuffle:
 *
 *   • Predictable. Users see one of each kind at the top, then it
 *     repeats. Easy mental model.
 *   • Within-kind order is preserved exactly — pulling one item per
 *     kind per round means item N of kind K still appears in
 *     monotonically-N order across kinds. The recency / incident_date
 *     ordering each surface already computed stays meaningful.
 *   • Naturally degrades when kinds run out. When homicide exhausts
 *     (only ~300 in the corpus) the rotation collapses to two-way
 *     between unidentified and missing, then to whichever has rows
 *     left. No special-case logic needed.
 *
 * Visual-similarity bucketing: 'unclaimed' is treated as 'unidentified'
 * (both are Doe-class) and 'suspicious_death' as 'homicide' (both
 * pinned the same way) so the rotation produces the variety users
 * actually perceive, not pedantic schema-distinct kinds. If a future
 * kind gets distinct treatment in the UI, expand this map.
 */

import type { CaseKind } from './types/database';

const VISUAL_BUCKET: Record<CaseKind, string> = {
  homicide: 'homicide',
  suspicious_death: 'homicide',
  missing: 'missing',
  unidentified: 'unidentified',
  unclaimed: 'unidentified',
};

export function interleaveByKind<T extends { kind: CaseKind }>(rows: T[]): T[] {
  if (rows.length <= 1) return rows;

  // Group preserving within-bucket order. Order of bucket entry into the
  // map is order of first appearance in `rows`, which matters for the
  // first round of the round-robin: kinds appear in the order their
  // representatives first show up in the input. Stable + deterministic.
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const bucket = VISUAL_BUCKET[r.kind] ?? r.kind;
    const g = groups.get(bucket);
    if (g) g.push(r);
    else groups.set(bucket, [r]);
  }

  if (groups.size <= 1) return rows;

  const result: T[] = [];
  const queues = Array.from(groups.values());
  let idxInQueue = 0;
  while (queues.length > 0) {
    const taken = queues[idxInQueue].shift();
    if (taken) result.push(taken);
    if (queues[idxInQueue].length === 0) {
      queues.splice(idxInQueue, 1);
      if (queues.length === 0) break;
      // Don't advance idxInQueue past end-of-array after splice.
      idxInQueue %= queues.length;
    } else {
      idxInQueue = (idxInQueue + 1) % queues.length;
    }
  }
  return result;
}
