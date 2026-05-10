/**
 * One-shot repair for state-mismatched cases.location_point coords.
 *
 * Background: the 2026-05-10 audit found ~159 city-precision rows
 * (~2.46% of the visible-pin set) where Mapbox-returned coords land
 * outside the source-supplied location_state's bbox. Class is the
 * dominant Mapbox failure mode for ambiguous county/city queries
 * ("Monroe County, FL" → central Missouri because Mapbox picks the
 * MO Monroe County without state context).
 *
 * The persist.ts state-validation guard (PR #97) future-proofs new
 * ingest. This script repairs the existing affected rows by routing
 * each through the same `validateGeocodeAgainstState` helper using
 * the row's CURRENT (wrong) coords as the synthesized initial result.
 * The validator detects the bbox mismatch, retries Mapbox once with
 * state-centroid proximity bias, and either (a) updates to the
 * retry's result if it lands in-state, or (b) falls back to the
 * state centroid with precision='state' (which the map renderer
 * filters out — better off-map than wrong place).
 *
 * Idempotent: re-running picks up only rows still mismatched. Safe
 * to interrupt and resume.
 *
 * Usage:
 *   npx tsx scripts/repair-state-mismatches.ts            # dry run
 *   npx tsx scripts/repair-state-mismatches.ts --apply    # writes
 *
 * Rate-limited at ~5 Mapbox calls/sec (200ms between calls). 159
 * rows ≈ 32 seconds. Mapbox standard plan caps at 600/min, this
 * stays comfortably under.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateGeocodeAgainstState } from '../supabase/functions/_shared/geocode-state-validation.ts';
import { inStateBbox, isKnownState } from '../supabase/functions/_shared/state-bbox.ts';
import type { GeocodeResult } from '../supabase/functions/_shared/geocode.ts';

// ── env ────────────────────────────────────────────────────────────
function loadEnv(): { url: string; key: string; mapbox: string } {
  const path = resolve(process.cwd(), '.env');
  const env = Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const mapbox = env.MAPBOX_ACCESS_TOKEN;
  if (!url || !key || !mapbox) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MAPBOX_ACCESS_TOKEN are required in .env');
  }
  return { url, key, mapbox };
}

const { url, key, mapbox } = loadEnv();
const supabase = createClient(url, key, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');

// ── 1. Re-derive mismatch list via cases_in_bbox quadrants ─────────
// Same quadrant scheme as the audit script. Self-contained so this
// repair tool doesn't depend on /tmp/cold-state-mismatch-list.json
// or any other intermediate artifact.
const QUADRANTS: [number, number, number, number, string][] = [
  [-125, 44, -100, 50, 'CONUS-NW'],
  [-100, 44, -85,  50, 'CONUS-NN'],
  [-85,  44, -65,  50, 'CONUS-NE'],
  [-125, 36, -100, 44, 'CONUS-MW'],
  [-100, 36, -85,  44, 'CONUS-MM'],
  [-85,  40, -65,  44, 'CONUS-ME-N'],
  [-85,  36, -65,  40, 'CONUS-ME-S'],
  [-125, 30, -112.5, 36, 'CONUS-SW-W'],
  [-112.5, 24, -100, 36, 'CONUS-SW-E'],
  [-125, 24, -112.5, 30, 'CONUS-SW-Sb'],
  [-100, 24, -85,  36, 'CONUS-SM'],
  [-85,  30, -75,  36, 'CONUS-SE-W-N'],
  [-85,  24, -75,  30, 'CONUS-SE-W-S'],
  [-75,  24, -65,  36, 'CONUS-SE-E'],
  [-180, 50, -130, 72, 'AK'],
  [-160, 18, -154, 22, 'HI'],
];

interface PointRow {
  id: string;
  slug: string;
  lat: number;
  lng: number;
  location_state: string | null;
  location_city: string | null;
  location_precision: string | null;
}

async function findMismatches(): Promise<PointRow[]> {
  const seen = new Set<string>();
  const mismatches: PointRow[] = [];
  for (const [minLng, minLat, maxLng, maxLat] of QUADRANTS) {
    const { data: rows, error } = await supabase.rpc('cases_in_bbox', {
      min_lng: minLng, min_lat: minLat, max_lng: maxLng, max_lat: maxLat,
      filter_kinds: null, filter_status: null, result_limit: 5000,
    });
    if (error) throw error;
    for (const r of (rows as PointRow[]) ?? []) {
      if (seen.has(r.slug)) continue;
      seen.add(r.slug);
      if (!isKnownState(r.location_state)) continue;
      if (!inStateBbox(r.lat, r.lng, r.location_state)) {
        mismatches.push(r);
      }
    }
  }
  return mismatches;
}

// ── 2. Repair each row ─────────────────────────────────────────────

interface SourceFields {
  id: string;
  location_text: string | null;
  location_city: string | null;
  location_county: string | null;
  location_state: string | null;
  location_precision: string | null;
}

async function fetchSourceFields(slug: string): Promise<SourceFields | null> {
  const { data, error } = await supabase
    .from('cases')
    .select('id, location_text, location_city, location_county, location_state, location_precision')
    .eq('slug', slug)
    .single();
  if (error || !data) return null;
  return data as SourceFields;
}

function buildQuery(row: SourceFields): string | undefined {
  if (row.location_text) return row.location_text;
  const parts = [row.location_city, row.location_county, row.location_state]
    .filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(', ') : undefined;
}

async function repair(mismatches: PointRow[]) {
  const stats: Record<string, number> = {
    passed: 0,
    retried: 0,
    fallback: 0,
    untouched: 0,
    error: 0,
    skipped_no_query: 0,
  };

  console.log('  slug | state | outcome  | from               | to                 | precision');
  console.log('  ' + '-'.repeat(120));

  for (const m of mismatches) {
    const src = await fetchSourceFields(m.slug);
    if (!src) {
      console.log(`  ${m.slug.padEnd(45)} | ?? | ERROR    | could not fetch source fields`);
      stats.error++;
      continue;
    }
    const query = buildQuery(src);
    if (!query) {
      console.log(`  ${m.slug.padEnd(45)} | ${src.location_state ?? '??'} | SKIP-NQ  | no query buildable`);
      stats.skipped_no_query++;
      continue;
    }

    // Synthesize an initial GeocodeResult from the row's CURRENT
    // (wrong) coords. The validator will detect the bbox mismatch
    // and route to the retry path.
    const initial: GeocodeResult = {
      lat: m.lat, lng: m.lng,
      precision: (src.location_precision ?? 'unknown') as GeocodeResult['precision'],
      raw: { source: 'backfill-synthesized' },
    };

    const validated = await validateGeocodeAgainstState(
      initial,
      query,
      src.location_state,
      mapbox,
    );
    stats[validated.outcome]++;

    const fromStr = `${m.lat.toFixed(2)},${m.lng.toFixed(2)}`;
    const toStr = `${validated.result.lat.toFixed(2)},${validated.result.lng.toFixed(2)}`;
    console.log(
      `  ${m.slug.padEnd(45)} | ${(src.location_state ?? '??').padEnd(2)} | ${validated.outcome.padEnd(8)} | ${fromStr.padEnd(18)} | ${toStr.padEnd(18)} | ${validated.result.precision}`,
    );

    // Apply the update only when --apply is set AND the validator
    // produced a different outcome than 'passed' / 'untouched'.
    // 'passed' shouldn't happen (we know these were mismatched), but
    // gate defensively so re-runs after a partial success don't try
    // to re-repair already-fixed rows.
    if (validated.outcome === 'passed' || validated.outcome === 'untouched') continue;
    if (!APPLY) continue;

    // geocoding_source taxonomy (mig 31):
    //   mapbox  — Mapbox-derived (retried = state-biased Mapbox call)
    //   unknown — reserved for repair scripts (fallback = state centroid)
    const geocoding_source =
      validated.outcome === 'retried' ? 'mapbox' : 'unknown';

    const { error: updErr } = await supabase
      .from('cases')
      .update({
        location_point: `SRID=4326;POINT(${validated.result.lng} ${validated.result.lat})`,
        location_precision: validated.result.precision,
        geocoding_source,
      })
      .eq('id', src.id);
    if (updErr) {
      console.log(`    ↳ UPDATE error: ${updErr.message}`);
      stats.error++;
    }

    // Rate limit (~5 Mapbox calls/sec). Mapbox standard plan caps at
    // 600/min; 200ms between calls = 5/sec, well under.
    await new Promise((r) => setTimeout(r, 200));
  }

  return stats;
}

// ── main ───────────────────────────────────────────────────────────
console.log(APPLY ? '=== APPLY MODE — writes will land in prod ===' : '=== DRY RUN (use --apply to write) ===\n');

const mismatches = await findMismatches();
console.log(`Found ${mismatches.length} state-mismatched rows across the visible-pin set.\n`);

if (mismatches.length === 0) {
  console.log('Nothing to repair. Exit.');
  process.exit(0);
}

const stats = await repair(mismatches);

console.log('\n=== Summary ===');
for (const [k, n] of Object.entries(stats)) {
  if (n > 0) console.log(`  ${k.padEnd(20)} ${n}`);
}
const wouldUpdate = stats.retried + stats.fallback;
console.log(`\n${APPLY ? 'Updated' : 'Would update'}: ${wouldUpdate} rows`);
console.log(`  → ${stats.retried} via state-biased Mapbox retry (precision unchanged)`);
console.log(`  → ${stats.fallback} via state-centroid fallback (precision='state', off-map)`);

if (!APPLY && wouldUpdate > 0) {
  console.log('\nRe-run with --apply to write changes.');
}
