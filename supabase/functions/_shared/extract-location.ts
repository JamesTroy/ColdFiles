// Orchestration for narrative-based location extraction. Single
// shared module imported by both the backfill CLI (scripts/enrich-
// locations.ts) and the future forward-integration edge function
// (Phase 2.5). Pure logic; runtime-agnostic; uses fetch + the
// SupabaseClient interface from @supabase/supabase-js.
//
// Pipeline per case:
//   1. Skip if location_precision is already 'address' or 'street'
//      (no upgrade possible) → log 'rejected_already_precise'.
//   2. Call extractLocation() to get an LLM candidate.
//   3. If candidate is null or confidence < threshold → log
//      'rejected_no_signal' / 'rejected_low_confidence'.
//   4. Pass candidate through resolveGeocode() (Mapbox via the
//      existing geocode-resolver, which uses geocode_cache).
//   5. If geocoder returned precision in (address, street) → update
//      cases.location_point + cases.location_precision and log
//      'upgraded'.
//   6. Otherwise → log 'rejected_geocode_imprecise' /
//      'rejected_geocode_failed'.
//
// Log row is written via Supabase (.from('location_extraction_log')
// .insert(...)). The CLI / edge function checks the log first to
// short-circuit cases already attempted (idempotency).

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveGeocode, makePointWkt } from './geocode-resolver.ts';
import {
  EXTRACTION_MODEL,
  extractLocation,
  type ExtractionInput,
  type ExtractionResult,
} from './llm-extract.ts';

/** Confidence threshold the LLM must meet for the candidate to even
 *  reach the geocoder. Conservative — better to skip an ambiguous
 *  case than to write a wrong upgraded position. The rejected case
 *  stays at city precision; backfill can be re-run with a lower
 *  threshold later if needed. */
export const CONFIDENCE_THRESHOLD = 0.75;

/** Precision tiers we accept as "upgrade." 'county' from the geocoder
 *  is a coarser tier than the 'city' we started with in some sense
 *  (county can be larger than a city-centroid pile-up), so don't
 *  treat county as an upgrade. */
const UPGRADE_PRECISIONS = new Set(['address', 'street']);

/** Precisions that are already specific enough to skip extraction
 *  on. */
const ALREADY_PRECISE = new Set(['address', 'street']);

export interface CaseInput {
  id: string;
  narrative: string | null;
  narrative_short: string | null;
  primary_agency_name_raw: string | null;
  location_city: string | null;
  location_state: string | null;
  location_precision: string | null;
}

export type ExtractionOutcome =
  | 'upgraded'
  | 'rejected_no_narrative'
  | 'rejected_no_signal'
  | 'rejected_low_confidence'
  | 'rejected_geocode_imprecise'
  | 'rejected_geocode_failed'
  | 'rejected_already_precise'
  | 'errored';

export interface ExtractionLogEntry {
  case_id: string;
  outcome: ExtractionOutcome;
  prior_precision: string;
  new_precision: string | null;
  llm_model: string | null;
  llm_candidate: string | null;
  llm_confidence: number | null;
  llm_reasoning: string | null;
  geocode_precision: string | null;
  geocode_lat: number | null;
  geocode_lng: number | null;
  error_detail: string | null;
}

export interface OrchestrationContext {
  supabase: SupabaseClient;
  anthropicApiKey: string;
  mapboxToken: string;
}

/**
 * Run the full extraction pipeline for a single case. Returns the
 * log entry that was written. The caller can use the returned
 * outcome to drive progress reporting / rate-limiting / decisions.
 *
 * Throws only on Supabase write failure — every other failure mode
 * (LLM error, geocode error, parse error) is captured in the log
 * with outcome='errored' and returned normally.
 */
export async function extractAndUpgradeCase(
  ctx: OrchestrationContext,
  caseRow: CaseInput,
): Promise<ExtractionLogEntry> {
  const priorPrecision = caseRow.location_precision ?? 'unknown';

  // Short-circuit 1: already precise.
  if (caseRow.location_precision && ALREADY_PRECISE.has(caseRow.location_precision)) {
    return await writeLog(ctx, {
      case_id: caseRow.id,
      outcome: 'rejected_already_precise',
      prior_precision: priorPrecision,
      new_precision: null,
      llm_model: null,
      llm_candidate: null,
      llm_confidence: null,
      llm_reasoning: null,
      geocode_precision: null,
      geocode_lat: null,
      geocode_lng: null,
      error_detail: null,
    });
  }

  // Short-circuit 2: nothing to extract from.
  const hasNarrative = !!(caseRow.narrative || caseRow.narrative_short);
  if (!hasNarrative && !caseRow.primary_agency_name_raw) {
    return await writeLog(ctx, {
      case_id: caseRow.id,
      outcome: 'rejected_no_narrative',
      prior_precision: priorPrecision,
      new_precision: null,
      llm_model: null,
      llm_candidate: null,
      llm_confidence: null,
      llm_reasoning: null,
      geocode_precision: null,
      geocode_lat: null,
      geocode_lng: null,
      error_detail: null,
    });
  }

  // Step 1: LLM extraction.
  const llmInput: ExtractionInput = {
    narrative: caseRow.narrative,
    narrativeShort: caseRow.narrative_short,
    agencyName: caseRow.primary_agency_name_raw,
    city: caseRow.location_city,
    state: caseRow.location_state,
  };

  let llmResult: ExtractionResult;
  try {
    llmResult = await extractLocation(llmInput, ctx.anthropicApiKey);
  } catch (err) {
    return await writeLog(ctx, {
      case_id: caseRow.id,
      outcome: 'errored',
      prior_precision: priorPrecision,
      new_precision: null,
      llm_model: EXTRACTION_MODEL,
      llm_candidate: null,
      llm_confidence: null,
      llm_reasoning: null,
      geocode_precision: null,
      geocode_lat: null,
      geocode_lng: null,
      error_detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 2: confidence + signal gates.
  if (!llmResult.candidate) {
    return await writeLog(ctx, {
      case_id: caseRow.id,
      outcome: 'rejected_no_signal',
      prior_precision: priorPrecision,
      new_precision: null,
      llm_model: llmResult.model,
      llm_candidate: null,
      llm_confidence: llmResult.confidence,
      llm_reasoning: llmResult.reasoning,
      geocode_precision: null,
      geocode_lat: null,
      geocode_lng: null,
      error_detail: null,
    });
  }
  if ((llmResult.confidence ?? 0) < CONFIDENCE_THRESHOLD) {
    return await writeLog(ctx, {
      case_id: caseRow.id,
      outcome: 'rejected_low_confidence',
      prior_precision: priorPrecision,
      new_precision: null,
      llm_model: llmResult.model,
      llm_candidate: llmResult.candidate,
      llm_confidence: llmResult.confidence,
      llm_reasoning: llmResult.reasoning,
      geocode_precision: null,
      geocode_lat: null,
      geocode_lng: null,
      error_detail: null,
    });
  }

  // Step 3: geocode the candidate. Reuses the existing
  // resolveGeocode (cache-aside through geocode_cache).
  let geocoded;
  try {
    geocoded = await resolveGeocode(
      { supabase: ctx.supabase, mapboxToken: ctx.mapboxToken },
      llmResult.candidate,
    );
  } catch (err) {
    return await writeLog(ctx, {
      case_id: caseRow.id,
      outcome: 'errored',
      prior_precision: priorPrecision,
      new_precision: null,
      llm_model: llmResult.model,
      llm_candidate: llmResult.candidate,
      llm_confidence: llmResult.confidence,
      llm_reasoning: llmResult.reasoning,
      geocode_precision: null,
      geocode_lat: null,
      geocode_lng: null,
      error_detail: `geocode threw: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (!geocoded) {
    return await writeLog(ctx, {
      case_id: caseRow.id,
      outcome: 'rejected_geocode_failed',
      prior_precision: priorPrecision,
      new_precision: null,
      llm_model: llmResult.model,
      llm_candidate: llmResult.candidate,
      llm_confidence: llmResult.confidence,
      llm_reasoning: llmResult.reasoning,
      geocode_precision: null,
      geocode_lat: null,
      geocode_lng: null,
      error_detail: null,
    });
  }

  // Step 4: precision gate.
  if (!UPGRADE_PRECISIONS.has(geocoded.precision)) {
    return await writeLog(ctx, {
      case_id: caseRow.id,
      outcome: 'rejected_geocode_imprecise',
      prior_precision: priorPrecision,
      new_precision: null,
      llm_model: llmResult.model,
      llm_candidate: llmResult.candidate,
      llm_confidence: llmResult.confidence,
      llm_reasoning: llmResult.reasoning,
      geocode_precision: geocoded.precision,
      geocode_lat: geocoded.lat,
      geocode_lng: geocoded.lng,
      error_detail: null,
    });
  }

  // Step 5: writeback. Update cases row + log success.
  const { error: updateErr } = await ctx.supabase
    .from('cases')
    .update({
      location_point: makePointWkt(geocoded.lng, geocoded.lat),
      location_precision: geocoded.precision,
    })
    .eq('id', caseRow.id);

  if (updateErr) {
    return await writeLog(ctx, {
      case_id: caseRow.id,
      outcome: 'errored',
      prior_precision: priorPrecision,
      new_precision: null,
      llm_model: llmResult.model,
      llm_candidate: llmResult.candidate,
      llm_confidence: llmResult.confidence,
      llm_reasoning: llmResult.reasoning,
      geocode_precision: geocoded.precision,
      geocode_lat: geocoded.lat,
      geocode_lng: geocoded.lng,
      error_detail: `cases update failed: ${updateErr.message}`,
    });
  }

  return await writeLog(ctx, {
    case_id: caseRow.id,
    outcome: 'upgraded',
    prior_precision: priorPrecision,
    new_precision: geocoded.precision,
    llm_model: llmResult.model,
    llm_candidate: llmResult.candidate,
    llm_confidence: llmResult.confidence,
    llm_reasoning: llmResult.reasoning,
    geocode_precision: geocoded.precision,
    geocode_lat: geocoded.lat,
    geocode_lng: geocoded.lng,
    error_detail: null,
  });
}

/**
 * Write the log row and return it. Throws on insert failure — log
 * writes are core to the pipeline (idempotency, audit), so a failed
 * insert is a real error worth surfacing rather than swallowing.
 */
async function writeLog(
  ctx: OrchestrationContext,
  entry: ExtractionLogEntry,
): Promise<ExtractionLogEntry> {
  const { error } = await ctx.supabase
    .from('location_extraction_log')
    .insert({
      case_id: entry.case_id,
      outcome: entry.outcome,
      prior_precision: entry.prior_precision,
      new_precision: entry.new_precision,
      llm_model: entry.llm_model,
      llm_candidate: entry.llm_candidate,
      llm_confidence: entry.llm_confidence,
      llm_reasoning: entry.llm_reasoning,
      geocode_precision: entry.geocode_precision,
      geocode_lat: entry.geocode_lat,
      geocode_lng: entry.geocode_lng,
      error_detail: entry.error_detail,
    });
  if (error) {
    throw new Error(`location_extraction_log insert failed: ${error.message}`);
  }
  return entry;
}
