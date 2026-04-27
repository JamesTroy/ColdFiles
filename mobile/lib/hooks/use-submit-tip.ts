/**
 * useSubmitTip — the first write-path hook in the app.
 *
 * THIS HOOK SETS THE WRITE-HOOK CONTRACT FOR THE PROJECT. Future write hooks
 * (useCreateWatchZone, useSaveCase, useRequestTakedown) follow this shape:
 *
 *   { submit, submitting, lastResult, error }
 *
 * - `submit(...)` returns a Promise so the caller can await on it for
 *   choreography (e.g. the 200ms anticipation pause + deep-link sequence).
 * - `submitting` is the in-flight flag for disabling buttons / showing dim states.
 * - `lastResult` carries the resolved server response after a successful submit
 *   so the screen can render the post-state (target URL, agency name) without
 *   a follow-up fetch.
 * - `error` is the most recent error; cleared on the next submit() call.
 *
 * Read-path hooks return { data, loading, error, source } — see use-cases-near.ts.
 * The two contracts are deliberately different shapes so a write hook can't be
 * accidentally treated as a read hook (or vice versa).
 *
 * Choreography (see docs/04_DESIGN_SYSTEM.md "Tip-flow choreography"):
 *   T+0ms      caller invokes submit() optimistically
 *              hash content locally, fire tip-route-submit Edge Function
 *   T+200ms    caller attempts the deep link to lastResult.tip_url / tip_phone
 *              ├─ success → fire SuccessFlash, close modal, mark tipped
 *              └─ failure → caller swaps the CTA for the fallback affordance
 *
 * The hook itself doesn't do the deep-link / 200ms wait — the screen owns that
 * because it's a UI-timing concern. The hook's job is content_hash + the
 * server insert + returning the resolved target.
 */

import { useCallback, useState } from 'react';

import { hashTipContent } from '../hash';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { WriteHookShape } from '../types/hooks';

import { markReceiptFresh } from './use-fresh-receipt';
import { markCaseTipped } from './use-submitted-tips';

export interface SubmitTipInput {
  /** UUID of the case this tip is about. */
  caseId: string;
  /** Slug — used for the device-local receipt store. */
  caseSlug: string;
  /** Optional plain-text tip body. Hashed locally; the plaintext never leaves the device. */
  content?: string;
  /** Identifying string for the user-agent column. The mobile app passes 'mobile/{platform}/{version}'. */
  userAgentSummary?: string;
}

export interface SubmitTipResult {
  agency_name: string;
  route_kind: string;
  tip_url: string | null;
  tip_phone: string | null;
}

type UseSubmitTipShape = WriteHookShape<SubmitTipInput, SubmitTipResult>;

export function useSubmitTip(): UseSubmitTipShape {
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<SubmitTipResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const submit = useCallback(async (input: SubmitTipInput): Promise<SubmitTipResult> => {
    setSubmitting(true);
    setError(null);

    try {
      const contentHash = input.content
        ? await hashTipContent(input.content)
        : null;

      let result: SubmitTipResult;

      if (!isSupabaseConfigured()) {
        // Designer mode — return a fake successful resolution so the choreography
        // can be tested in Expo Go without a backend. Always picks LA Crime
        // Stoppers as the receiving agency to match the sample data shape.
        result = {
          agency_name: 'LA Crime Stoppers',
          route_kind: 'crime_stoppers_p3',
          tip_url: 'https://lacrimestoppers.org',
          tip_phone: null,
        };
      } else {
        const supabase = getSupabase();
        const { data, error: invokeError } = await supabase.functions.invoke<SubmitTipResult>(
          'tip-route-submit',
          {
            body: {
              case_id: input.caseId,
              content_hash: contentHash,
              user_agent_summary: input.userAgentSummary ?? null,
            },
          },
        );
        if (invokeError) throw new Error(invokeError.message);
        if (!data) throw new Error('tip-route-submit returned no data');
        result = data;
      }

      // Mark device-local receipt — drives the case-detail "you submitted a tip"
      // affordance. Don't block the return on the AsyncStorage write.
      markCaseTipped(input.caseSlug, result.agency_name).catch((err) =>
        console.warn('[useSubmitTip] markCaseTipped failed:', err),
      );

      // Set the transient fresh-receipt flag. The case-detail screen will
      // consume it on its next render — naturally one-shot, survives the
      // user's 90-second detour on the agency form, no wall-clock window.
      markReceiptFresh(input.caseSlug);

      setLastResult(result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting, lastResult, error };
}
