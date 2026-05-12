/**
 * useDnaFundingHandoff — write-path hook for per-case DNA-funding CTA clicks.
 *
 * Follows the write-hook contract from useSubmitTip (see use-submit-tip.ts):
 * `{ submit, submitting, lastResult, error }`. The Edge Function on the
 * other end is dna-funding-route — it audit-logs the handoff and returns
 * the resolved funding_url for the caller to open via Linking.
 *
 * Posture (mirrored from feedback_dna_funding_externalize):
 *   - No donor identity, amount, card data, or held funds.
 *   - Audit-only logging on the server (case_id, ts, ip_hash).
 *   - The funding_url is per-case; we never fall back to org-level pages.
 *
 * Caller is responsible for the deep-link itself + any optimistic UI —
 * same split as useSubmitTip / use-submit-tip.ts.
 */

import { useCallback, useState } from 'react';

import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { DnaFundingKind } from '../types/database';
import type { WriteHookShape } from '../types/hooks';

export interface DnaFundingHandoffInput {
  caseId: string;
  /** Identifying string for the user-agent column. Mobile passes 'mobile/{platform}/{version}'. */
  userAgentSummary?: string;
}

export interface DnaFundingHandoffResult {
  funding_url: string;
  funding_kind: DnaFundingKind;
}

type UseDnaFundingHandoffShape = WriteHookShape<
  DnaFundingHandoffInput,
  DnaFundingHandoffResult
>;

export function useDnaFundingHandoff(): UseDnaFundingHandoffShape {
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<DnaFundingHandoffResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const submit = useCallback(
    async (input: DnaFundingHandoffInput): Promise<DnaFundingHandoffResult> => {
      setSubmitting(true);
      setError(null);

      try {
        let result: DnaFundingHandoffResult;

        if (!isSupabaseConfigured()) {
          // Designer-mode stub matches useSubmitTip's pattern — a fake
          // Othram resolution so the choreography is testable in Expo Go
          // without a backend.
          result = {
            funding_url: 'https://dnasolves.com/',
            funding_kind: 'othram',
          };
        } else {
          const supabase = getSupabase();
          const { data, error: invokeError } =
            await supabase.functions.invoke<DnaFundingHandoffResult>(
              'dna-funding-route',
              {
                body: {
                  case_id: input.caseId,
                  user_agent_summary: input.userAgentSummary ?? null,
                },
              },
            );
          if (invokeError) throw new Error(invokeError.message);
          if (!data) throw new Error('dna-funding-route returned no data');
          result = data;
        }

        setLastResult(result);
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  return { submit, submitting, lastResult, error };
}
