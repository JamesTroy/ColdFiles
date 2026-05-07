// Persistence layer — turns CaseRecord + dedupe keys into INSERT/UPDATE
// against the Cold File schema. Used by ingest-source and the local CLI.
//
// Treats the supabase-js client as a black-box transport. The actual SQL
// shape is RPC-friendly so the same code runs from a Deno Edge Function
// or a Node CLI without divergence.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaseRecord, RunStats, SourceConfig } from './types.ts';
import { generateDedupeKeys, detectConflicts } from './dedupe.ts';
import { mergeRecord } from './trust-merge.ts';
import { buildSlug } from './normalize.ts';
import { PoliteFetcher, sha256Hex } from './http.ts';
import { cacheMediaForCase } from './media.ts';
import { resolveGeocode, makePointWkt } from './geocode-resolver.ts';
import { persistCaseEvents } from './case-events.ts';

interface PersistContext {
  supabase: SupabaseClient;
  source: SourceConfig;
  /** Resolved sources.id for this source slug. */
  sourceId: string;
  /** Trust weight to write into case_sources.trust_weight. */
  trustWeight: number;
  /** Polite fetcher used for media downloads. Re-uses the source rate-limit. */
  fetcher: PoliteFetcher;
  /** Mapbox token. If absent, geocoding is skipped — case ingests with null point. */
  mapboxToken?: string;
  /**
   * When true (the default), Tier-3-only matches (`lastname_age_sex` only,
   * no stronger key) route to dedupe_review_queue instead of auto-merging.
   * Trades silent wrongful-merges for visible duplicates-in-list — the
   * right asymmetry for this app, since a same-case-shown-twice is a 30-
   * second user-reported polish item but a wrongful merge is a takedown
   * + trust hit.
   *
   * Disable (set to false) only as a kill-switch if the queue starts
   * filling at unexpected volume. The forward path is v1.0.2's review
   * tooling that consumes `dedupe_review_queue` — see CLAUDE.md.
   */
  tier3ToReview?: boolean;
}

export async function persistRecord(
  ctx: PersistContext,
  record: CaseRecord,
  stats: RunStats,
): Promise<void> {
  // Normalize: for missing-kind cases the source's "missing since" date
  // typically lands in incident_date (Charley, Doe MP, PCC, etc. all map
  // their primary date that way), but the schema also has a parallel
  // last_seen_date column that no current extractor populates. Dual-write
  // here so both columns carry the same value for missing cases. Removes
  // the UI fallback the case-detail LastSeenBlock currently uses, and
  // gives any future RPC/query that joins on last_seen_date specifically
  // (e.g., a "missing-since-decade" filter) clean data without the
  // fallback chain. Mutating the input record is fine — persist.ts is
  // the terminal stage.
  if (record.kind === 'missing' && !record.last_seen_date && record.incident_date) {
    record.last_seen_date = record.incident_date;
  }

  // Flatten the parsed agency_hint onto the record so both the insert
  // path (which reads explicit fields) and the merge path (which goes
  // through stripUnknownColumns) write primary_agency_name_raw +
  // primary_agency_phone_raw. The agency_hint object itself is dropped
  // by stripUnknownColumns since it's not a column. Step 1 of the
  // tier-2 routing spike — see migration 24 for context.
  if (record.agency_hint) {
    if (record.agency_hint.name && !record.primary_agency_name_raw) {
      record.primary_agency_name_raw = record.agency_hint.name;
    }
    if (record.agency_hint.phone && !record.primary_agency_phone_raw) {
      record.primary_agency_phone_raw = record.agency_hint.phone;
    }
  }

  const keys = generateDedupeKeys(record);
  const payloadJson = JSON.stringify({ ...record, photos: record.photos.map((p) => p.url) });
  const payloadHash = await sha256Hex(payloadJson);

  // 1. Try to find an existing case via dedupe keys.
  const match = await findCaseByDedupeKeys(ctx.supabase, keys);

  let caseId: string;
  if (match) {
    // Tier-3-only matches (`lastname_age_sex` matched, no stronger key)
    // are not auto-merged. Route to the review queue instead — see the
    // tier3ToReview comment on PersistContext for the why.
    const tier3Only =
      match.matched_key_types.length === 1 &&
      match.matched_key_types[0] === 'lastname_age_sex';
    const tier3ToReview = ctx.tier3ToReview !== false;

    if (tier3Only && tier3ToReview) {
      // Insert as a NEW case + queue both case_ids in dedupe_review_queue
      // for v1.0.2's review tooling. The candidate signal is preserved
      // with the metadata the candidate generator produced (which keys
      // matched, which sources, conflict reasons), so future-you doesn't
      // re-scan the corpus to find these pairs.
      const created = await createNewCase(ctx, record, keys, payloadHash, payloadJson);
      caseId = created.case_id;
      if (created.kind === 'created') {
        await queueForTier3Review(ctx, match.case_id, caseId, record, match.matched_key_types);
        stats.cases_new += 1;
      } else {
        // Race-lost during the Tier-3 review-route path — extremely rare,
        // but the right thing is to treat as merge into the winner rather
        // than queue a stale review pair.
        await mergeIntoExistingCase(ctx, caseId, record, payloadHash, payloadJson);
        stats.cases_updated += 1;
      }
    } else {
      await mergeIntoExistingCase(ctx, match.case_id, record, payloadHash, payloadJson);
      caseId = match.case_id;
      stats.cases_updated += 1;
    }
  } else {
    const created = await createNewCase(ctx, record, keys, payloadHash, payloadJson);
    caseId = created.case_id;
    if (created.kind === 'created') {
      stats.cases_new += 1;
    } else {
      // Race-lost: the winner already owns the case row. Merge our record
      // into theirs so this run's data isn't dropped.
      await mergeIntoExistingCase(ctx, caseId, record, payloadHash, payloadJson);
      stats.cases_updated += 1;
    }
  }
  stats.cases_seen += 1;

  // Side effects that don't block the dedupe transaction.
  // Timeline events are best-effort: persistCaseEvents internally swallows
  // upsert errors as structured warnings so a timeline write failure
  // doesn't roll back the case row write. Idempotent via the
  // unique(case_id, ingest_signature) constraint — safe to re-call on
  // re-scrapes.
  await persistCaseEvents(
    { supabase: ctx.supabase, sourceId: ctx.sourceId },
    caseId,
    record.events,
  );
  await ensureGeocode(ctx, caseId, record);
  if (record.photos?.length) {
    await cacheMediaForCase(
      { supabase: ctx.supabase, caseId, sourceId: ctx.sourceId, fetcher: ctx.fetcher },
      record.photos,
    );
  }
}

async function ensureGeocode(
  ctx: PersistContext,
  caseId: string,
  record: CaseRecord,
): Promise<void> {
  // Skip if we've already set a point on this case.
  const { data: existing } = await ctx.supabase
    .from('cases')
    .select('location_point, location_precision')
    .eq('id', caseId)
    .maybeSingle();
  if (existing?.location_point && existing.location_precision !== 'unknown') return;

  // Pre-supplied coordinates (NamUs UP cases include publicGeolocation;
  // FBI seeking-info posters sometimes embed GPS). When the source has
  // already done the geocoding work, trust it — saves an upstream Mapbox
  // call per case and gives us address-level precision for free.
  if (
    typeof record.location_lat === 'number' &&
    typeof record.location_lng === 'number'
  ) {
    await ctx.supabase
      .from('cases')
      .update({
        location_point: makePointWkt(record.location_lng, record.location_lat),
        location_precision: 'address',
      })
      .eq('id', caseId);
    return;
  }

  // Fall through to Mapbox forward geocoding when the source didn't
  // pre-geocode. Skipped silently when MAPBOX_ACCESS_TOKEN isn't set.
  if (!ctx.mapboxToken) return;
  const query = record.location_text ?? joinLocation(record);
  if (!query) return;

  const result = await resolveGeocode(
    { supabase: ctx.supabase, mapboxToken: ctx.mapboxToken },
    query,
  );
  if (!result) return;

  await ctx.supabase
    .from('cases')
    .update({
      location_point: makePointWkt(result.lng, result.lat),
      location_precision: result.precision,
    })
    .eq('id', caseId);
}

function joinLocation(record: CaseRecord): string | undefined {
  const parts = [record.location_city, record.location_county, record.location_state];
  const joined = parts.filter(Boolean).join(', ');
  return joined || undefined;
}

interface DedupeMatch {
  /** The existing case the incoming record would merge into. */
  case_id: string;
  /** EVERY key type that matched (intersection of generated × existing keys
   *  on the same case_id). Lets the caller decide based on tier strength —
   *  e.g. Tier-3-only matches route to review rather than auto-merge. */
  matched_key_types: string[];
}

async function findCaseByDedupeKeys(
  supabase: SupabaseClient,
  keys: ReturnType<typeof generateDedupeKeys>,
): Promise<DedupeMatch | undefined> {
  if (!keys.length) return undefined;
  const { data, error } = await supabase
    .from('case_dedupe_keys')
    .select('case_id, key_type, key_value')
    .in('key_type', keys.map((k) => k.type))
    .in('key_value', keys.map((k) => k.value))
    .limit(50);
  if (error) throw error;

  // Prefer the strongest match — namus/ncic > name_state_year > lastname_age_sex.
  const order = [
    'namus_number',
    'ncic_number',
    'name_state_year',
    'agency_case_number',
    'lastname_age_sex',
  ];
  for (const t of order) {
    const hit = data?.find(
      (r: { key_type: string; key_value: string; case_id: string }) =>
        r.key_type === t &&
        keys.some((k) => k.type === t && k.value === r.key_value),
    );
    if (!hit) continue;
    // Found a winning case_id. Now collect ALL key types that hit for that
    // same case_id — gives the caller the full picture of how strong the
    // match is (Tier-3-only vs Tier-3+stronger).
    const matched_key_types = Array.from(
      new Set(
        (data ?? [])
          .filter(
            (r: { case_id: string; key_type: string; key_value: string }) =>
              r.case_id === hit.case_id &&
              keys.some((k) => k.type === r.key_type && k.value === r.key_value),
          )
          .map((r: { key_type: string }) => r.key_type),
      ),
    );
    return { case_id: hit.case_id, matched_key_types };
  }
  return undefined;
}

/**
 * Tier-3 candidate review path. The incoming record has been inserted as
 * its own NEW case (caller already did createNewCase); now we link the
 * pair in dedupe_review_queue so v1.0.2's review tooling has a real corpus
 * to work against rather than starting from scratch.
 *
 * detectConflicts runs and its output is stitched into match_keys.conflicts
 * so a reviewer can see "Tier-3 hit but conflicts disagree" without re-
 * deriving the conclusion. Reduces human-review burden when the candidate
 * is already algorithmically rejected.
 *
 * Forward pointer: when v1.0.2 ships review tooling, it consumes pending
 * rows from dedupe_review_queue and either flips status='merged' (and
 * collapses the two cases) or status='rejected' (and drops the link).
 */
async function queueForTier3Review(
  ctx: PersistContext,
  existingCaseId: string,
  newCaseId: string,
  record: CaseRecord,
  matchedKeyTypes: string[],
): Promise<void> {
  // Pull the existing case so we can run conflict detection. Cheap — single
  // row by id, no joins.
  const { data: existing } = await ctx.supabase
    .from('cases')
    .select('*')
    .eq('id', existingCaseId)
    .maybeSingle();

  const conflicts = existing
    ? detectConflicts(existing as Partial<CaseRecord>, record)
    : [];

  // Canonical ordering — the table check constraint is `case_id_a < case_id_b`.
  const [a, b] =
    existingCaseId < newCaseId
      ? [existingCaseId, newCaseId]
      : [newCaseId, existingCaseId];

  await ctx.supabase
    .from('dedupe_review_queue')
    .insert({
      case_id_a: a,
      case_id_b: b,
      match_keys: {
        matched_key_types: matchedKeyTypes,
        // Why this row exists: Tier-3-only candidate, intentionally
        // routed to review instead of auto-merging.
        reason: 'tier3_only_no_stronger_match',
        triggered_source: ctx.source.slug,
        // Empty when the candidate is algorithmically valid; non-empty
        // when detectConflicts already rejected the pair (sex mismatch,
        // year-drift > 2y, kind disagreement). Reviewers can filter
        // auto-rejects without re-running the conflict logic.
        conflicts,
      },
      // similarity_score left null — we don't compute trigram/embedding
      // similarity in v1.0.1. Reviewer tooling can backfill once the
      // similarity model lands.
      status: 'pending',
    })
    // Idempotency: if the same (a, b) pair has already been queued,
    // don't insert a duplicate row. Migration 09 adds the unique
    // constraint that backs this; until then it's a no-op upsert.
    .then((res) => res, (err: unknown) => {
      // Swallow uniqueness-violation errors silently. Anything else
      // bubbles via the broader caller error handling.
      const e = err as { code?: string } | null;
      if (e?.code === '23505') return;
      throw err;
    });
}

async function mergeIntoExistingCase(
  ctx: PersistContext,
  caseId: string,
  record: CaseRecord,
  payloadHash: string,
  payloadJson: string,
): Promise<void> {
  // Read the current row.
  const { data: existing, error: readErr } = await ctx.supabase
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .single();
  if (readErr) throw readErr;

  // Read the prior trust weight on this case (max of all source rows).
  const { data: priorSources } = await ctx.supabase
    .from('case_sources')
    .select('trust_weight')
    .eq('case_id', caseId);
  const currentTrust = (priorSources ?? []).reduce(
    (max: number, r: { trust_weight: number }) => Math.max(max, r.trust_weight),
    0,
  );

  const conflicts = detectConflicts(existing, record);
  if (conflicts.length > 0) {
    // Hard conflicts — log and skip merge for safety. The dedupe-resolver
    // worker will surface this to the human review queue.
    await ctx.supabase.from('case_updates').insert({
      case_id: caseId,
      source_id: ctx.sourceId,
      update_type: 'conflict_detected',
      title: `Conflict on merge from ${ctx.source.slug}`,
      body: conflicts.join('; '),
      occurred_at: new Date().toISOString(),
    });
    return;
  }

  const merged = mergeRecord(existing, currentTrust, record, ctx.trustWeight);

  // Update the cases row with merged fields.
  const { error: updErr } = await ctx.supabase
    .from('cases')
    .update({
      ...stripUnknownColumns(merged),
      last_seen_at: new Date().toISOString(),
      last_changed_at: new Date().toISOString(),
      has_photo:
        existing.has_photo || (record.photos?.some((p) => p.kind.startsWith('photo')) ?? false),
      has_sketch:
        existing.has_sketch || (record.photos?.some((p) => p.kind === 'sketch_victim' || p.kind === 'sketch_poi') ?? false),
      has_reconstruction:
        existing.has_reconstruction || (record.photos?.some((p) => p.kind === 'reconstruction') ?? false),
    })
    .eq('id', caseId);
  if (updErr) throw updErr;

  // Upsert the case_sources row for this source.
  await upsertCaseSource(ctx, caseId, record, payloadHash, payloadJson);
}

/**
 * Order dedupe keys by tier strength so the strongest is claimed first.
 * Mirrors the precedence in findCaseByDedupeKeys; kept duplicated here on
 * purpose so the claim path doesn't depend on the lookup path's ordering
 * being authoritative — they both express the same precedence.
 */
const KEY_STRENGTH_ORDER: ReadonlyArray<string> = [
  'namus_number',
  'ncic_number',
  'name_state_year',
  'agency_case_number',
  'lastname_age_sex',
];

function strongestFirst(
  keys: ReturnType<typeof generateDedupeKeys>,
): ReturnType<typeof generateDedupeKeys> {
  return [...keys].sort((a, b) => {
    const ai = KEY_STRENGTH_ORDER.indexOf(a.type);
    const bi = KEY_STRENGTH_ORDER.indexOf(b.type);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

interface CreateNewCaseResult {
  /** 'created' = we won the dedupe-key race and own the case row.
   *  'race_lost' = a concurrent persist won; case_id is theirs, our
   *  provisional row was deleted, caller should merge instead. */
  kind: 'created' | 'race_lost';
  case_id: string;
}

async function createNewCase(
  ctx: PersistContext,
  record: CaseRecord,
  keys: ReturnType<typeof generateDedupeKeys>,
  payloadHash: string,
  payloadJson: string,
): Promise<CreateNewCaseResult> {
  const slug = buildSlug(record);
  const insertRow = {
    slug,
    kind: record.kind,
    status: record.status,
    victim_name: record.victim_name,
    victim_aliases: record.victim_aliases,
    victim_first_name: record.victim_first_name,
    victim_last_name: record.victim_last_name,
    victim_age: record.victim_age,
    victim_age_min: record.victim_age_min,
    victim_age_max: record.victim_age_max,
    victim_sex: record.victim_sex,
    victim_race: record.victim_race,
    victim_ethnicity: record.victim_ethnicity,
    victim_height_cm: record.victim_height_cm,
    victim_weight_kg: record.victim_weight_kg,
    victim_eye_color: record.victim_eye_color,
    victim_hair_color: record.victim_hair_color,
    distinguishing_marks: record.distinguishing_marks,
    incident_date: record.incident_date,
    incident_date_quality: record.incident_date_quality,
    incident_date_text: record.incident_date_text,
    location_text: record.location_text,
    location_city: record.location_city,
    location_county: record.location_county,
    location_state: record.location_state,
    location_zip: record.location_zip,
    last_seen_text: record.last_seen_text,
    last_seen_date: record.last_seen_date,
    last_seen_clothing: record.last_seen_clothing,
    last_seen_circumstances: record.last_seen_circumstances,
    narrative: record.narrative,
    narrative_short: record.narrative_short,
    case_number_primary: record.case_number_primary,
    ncic_number: record.ncic_number,
    namus_number: record.namus_number,
    reward_amount_usd: record.reward_amount_usd,
    reward_text: record.reward_text,
    has_photo: record.photos.some((p) => p.kind.startsWith('photo')),
    has_sketch: record.photos.some((p) => p.kind === 'sketch_victim' || p.kind === 'sketch_poi'),
    has_reconstruction: record.photos.some((p) => p.kind === 'reconstruction'),
    // agency_hint extracted by the source's parser. Stored as raw text;
    // no FK to agencies yet. Migration 24 added these columns; the
    // routing path stays on tier-3 fallback until step 2 lands a
    // matching layer with a confidence threshold.
    primary_agency_name_raw: record.agency_hint?.name ?? null,
    primary_agency_phone_raw: record.agency_hint?.phone ?? null,
  };

  const { data: inserted, error: insErr } = await ctx.supabase
    .from('cases')
    .insert(insertRow)
    .select('id')
    .single();
  if (insErr) throw insErr;
  const candidateId = inserted.id as string;

  // Atomic dedupe-key claim. The strongest key gates ownership of the case:
  // whoever lands the strongest key first owns the case row, and any
  // concurrent loser pivots to merge into the winner instead of leaving an
  // orphan. See migration 30 for the RPC.
  const ordered = strongestFirst(keys);
  const strongest = ordered[0];

  let caseId = candidateId;

  if (strongest) {
    const { data: winnerCaseId, error: claimErr } = await ctx.supabase.rpc(
      'claim_dedupe_key',
      {
        p_case_id: candidateId,
        p_key_type: strongest.type,
        p_key_value: strongest.value,
      },
    );
    if (claimErr) throw claimErr;

    if (winnerCaseId && winnerCaseId !== candidateId) {
      // Lost the strongest-key race. Clean up the provisional cases row
      // we just inserted and hand off the winner's id to the caller. No
      // case_sources upsert here — the caller's merge path handles that.
      await ctx.supabase.from('cases').delete().eq('id', candidateId);
      return { kind: 'race_lost', case_id: winnerCaseId as string };
    }
    // Won (or no concurrent claim) — proceed with the candidate id.
    caseId = (winnerCaseId as string) ?? candidateId;
  }

  // Secondary keys: claim each, log split-conflicts. A split-conflict means
  // a weaker key for THIS new case already points to a DIFFERENT existing
  // case — evidence that two existing cases describe the same person but
  // share no Tier-1/2 key. Policy for that is not pinned yet (see CLAUDE.md
  // dedupe-asymmetry rule, which only covers Tier-3 review-queue routing).
  // For now we log a structured line so the future case_pair_review_queue
  // tooling has a corpus to consume; we DO NOT auto-merge.
  for (const key of ordered.slice(1)) {
    const { data: keyOwner, error: secErr } = await ctx.supabase.rpc(
      'claim_dedupe_key',
      {
        p_case_id: caseId,
        p_key_type: key.type,
        p_key_value: key.value,
      },
    );
    if (secErr) {
      // Non-fatal — the strongest key already gates dedupe; secondary keys
      // are belt-and-suspenders. Log and continue.
      console.warn(
        JSON.stringify({
          msg: 'persist: secondary dedupe key claim failed',
          case_id: caseId,
          key_type: key.type,
          error: secErr.message,
        }),
      );
      continue;
    }
    if (keyOwner && keyOwner !== caseId) {
      // SPLIT-CONFLICT. TODO(case_pair_review_queue): when the case-pair
      // review tooling lands, persist this candidate pair for operator
      // review. Until then, the structured log line is the audit trail
      // and serves as the seed for the queue's initial backfill.
      console.warn(
        JSON.stringify({
          msg: 'persist: split-conflict on secondary dedupe key',
          new_case_id: caseId,
          existing_case_id: keyOwner,
          key_type: key.type,
          key_value: key.value,
          source_slug: ctx.source.slug,
        }),
      );
    }
  }

  await upsertCaseSource(ctx, caseId, record, payloadHash, payloadJson);
  return { kind: 'created', case_id: caseId };
}

async function upsertCaseSource(
  ctx: PersistContext,
  caseId: string,
  record: CaseRecord,
  payloadHash: string,
  payloadJson: string,
): Promise<void> {
  await ctx.supabase.from('case_sources').upsert(
    {
      case_id: caseId,
      source_id: ctx.sourceId,
      source_external_id: record.source_external_id,
      source_url: record.source_url,
      raw_payload: JSON.parse(payloadJson),
      payload_hash: payloadHash,
      trust_weight: ctx.trustWeight,
      last_ingested_at: new Date().toISOString(),
    },
    { onConflict: 'source_id,source_external_id' },
  );
}

/** Drop fields that aren't columns on the `cases` table. */
function stripUnknownColumns(rec: Partial<CaseRecord>): Record<string, unknown> {
  const allowed = new Set([
    'kind','status','victim_name','victim_aliases','victim_first_name','victim_last_name',
    'victim_age','victim_age_min','victim_age_max','victim_sex','victim_race','victim_ethnicity',
    'victim_height_cm','victim_weight_kg','victim_eye_color','victim_hair_color',
    'distinguishing_marks','incident_date','incident_date_quality','incident_date_text',
    'location_text','location_city','location_county','location_state','location_zip',
    'last_seen_text','last_seen_date','last_seen_clothing','last_seen_circumstances',
    'narrative','narrative_short','case_number_primary','ncic_number','namus_number',
    'reward_amount_usd','reward_text',
    // agency_hint extracted by source parsers gets flattened onto the
    // record at the top of persistRecord (see the dual-write block).
    'primary_agency_name_raw','primary_agency_phone_raw',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (allowed.has(k) && v !== undefined) out[k] = v;
  }
  return out;
}

/** Resolve a source.slug → source.id, creating the row if it doesn't exist. */
export async function ensureSourceRow(
  supabase: SupabaseClient,
  source: SourceConfig,
): Promise<string> {
  const { data, error } = await supabase
    .from('sources')
    .select('id')
    .eq('slug', source.slug)
    .maybeSingle();
  if (error) throw error;
  if (data) return data.id as string;

  const { data: ins, error: insErr } = await supabase
    .from('sources')
    .insert({
      slug: source.slug,
      name: source.name,
      kind: source.kind,
      base_url: source.baseUrl,
      attribution_html: source.attribution.html,
      link_back_required: source.attribution.linkBackRequired,
      default_rate_limit_ms: source.rateLimitMs,
      active: true,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  return ins.id as string;
}
