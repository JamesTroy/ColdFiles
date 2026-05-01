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
}

export async function persistRecord(
  ctx: PersistContext,
  record: CaseRecord,
  stats: RunStats,
): Promise<void> {
  const keys = generateDedupeKeys(record);
  const payloadJson = JSON.stringify({ ...record, photos: record.photos.map((p) => p.url) });
  const payloadHash = await sha256Hex(payloadJson);

  // 1. Try to find an existing case via dedupe keys.
  const existingCaseId = await findCaseByDedupeKeys(ctx.supabase, keys);

  let caseId: string;
  if (existingCaseId) {
    await mergeIntoExistingCase(ctx, existingCaseId, record, payloadHash, payloadJson);
    caseId = existingCaseId;
    stats.cases_updated += 1;
  } else {
    caseId = await createNewCase(ctx, record, keys, payloadHash, payloadJson);
    stats.cases_new += 1;
  }
  stats.cases_seen += 1;

  // Side effects that don't block the dedupe transaction.
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

async function findCaseByDedupeKeys(
  supabase: SupabaseClient,
  keys: ReturnType<typeof generateDedupeKeys>,
): Promise<string | undefined> {
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
    if (hit) return hit.case_id;
  }
  return undefined;
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

async function createNewCase(
  ctx: PersistContext,
  record: CaseRecord,
  keys: ReturnType<typeof generateDedupeKeys>,
  payloadHash: string,
  payloadJson: string,
): Promise<string> {
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
  };

  const { data: inserted, error: insErr } = await ctx.supabase
    .from('cases')
    .insert(insertRow)
    .select('id')
    .single();
  if (insErr) throw insErr;
  const caseId = inserted.id as string;

  // Insert dedupe keys.
  if (keys.length) {
    const rows = keys.map((k) => ({
      case_id: caseId,
      key_type: k.type,
      key_value: k.value,
    }));
    await ctx.supabase.from('case_dedupe_keys').upsert(rows, {
      onConflict: 'key_type,key_value',
      ignoreDuplicates: true,
    });
  }

  await upsertCaseSource(ctx, caseId, record, payloadHash, payloadJson);
  return caseId;
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
