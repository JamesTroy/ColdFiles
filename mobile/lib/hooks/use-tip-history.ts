/**
 * useTipHistory — list-form view of the device-local submitted-tips store.
 *
 * Companion to useSubmittedTip (single-receipt, per-slug) — same AsyncStorage
 * key (`cf:submitted_tips:v1`), same subscriber set, just shaped for the
 * Tip-history screen instead of the case-detail receipt bar.
 *
 * Each row joins the local receipt with a best-effort case-name lookup against
 * the sample dataset (designer mode). When live mode lands and the saved-cases
 * server cache is hot, the same lookup can hit it via slug; until then,
 * unmatched slugs fall back to the slug itself as the display name.
 *
 * Status: defaults to 'pending' for every row. The `tip_routings` schema has
 * `acknowledged_at` / `closed_at` columns and a future Edge Function
 * (`tip-status-watch`) will sync those down to the device-local store. When it
 * does, a row's status flips here without touching the screen — the UI already
 * branches by `tip.status`.
 *
 * TODO(v1.0.2): replace the static 'pending' default with a status field
 * persisted on the SubmittedTip record. Wire to the agency-acknowledgment
 * Edge Function once it ships.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { SAMPLE_CASES_MAP } from '../sample-data';

const STORAGE_KEY = 'cf:submitted_tips:v1';

export type TipStatus = 'pending' | 'acknowledged' | 'closed';

export interface TipHistoryRow {
  /** Slug — also the route parameter for /tip/[slug] and /case/[slug]. */
  caseSlug: string;
  /** Best-effort display name; falls back to the slug when no lookup hit. */
  caseName: string;
  /** Receiving agency name as captured at submit time. */
  agencyName: string;
  /** ISO timestamp from the device-local receipt. */
  submittedAt: string;
  /**
   * Always 'pending' until the agency-acknowledgment Edge Function ships.
   * See file header.
   */
  status: TipStatus;
}

interface RawSubmittedTip {
  caseSlug: string;
  agencyName: string;
  submittedAt: string;
}

type Store = Record<string, RawSubmittedTip>;

export interface UseTipHistoryShape {
  loading: boolean;
  tips: TipHistoryRow[];
  error: string | null;
}

function lookupCaseName(slug: string): string {
  const hit = SAMPLE_CASES_MAP.find((c) => c.slug === slug);
  if (hit?.victim_name) return hit.victim_name;
  if (hit && (hit.kind === 'unidentified' || hit.kind === 'unclaimed')) {
    return 'Unidentified person';
  }
  if (hit) return 'Name not released';
  return slug;
}

function shape(store: Store): TipHistoryRow[] {
  return Object.values(store)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map((t) => ({
      caseSlug: t.caseSlug,
      caseName: lookupCaseName(t.caseSlug),
      agencyName: t.agencyName,
      submittedAt: t.submittedAt,
      status: 'pending' as const,
    }));
}

export function useTipHistory(): UseTipHistoryShape {
  const [tips, setTips] = useState<TipHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        try {
          const parsed = raw ? (JSON.parse(raw) as Store) : {};
          setTips(shape(parsed));
        } catch {
          setTips([]);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't load tip history.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, tips, error };
}
