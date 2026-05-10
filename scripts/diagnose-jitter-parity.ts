/**
 * Jitter parity diagnostic.
 *
 * Mirrors the client-side `applyImpreciseSpread` from
 * mobile/app/(tabs)/index.tsx (FNV-1a 32-bit on slug → angle/radius
 * polar offset; range 0.02–0.045°) and either:
 *
 *   --mode=pre   (default if mig 43 not yet applied)
 *     Pull a sample of imprecise rows via `cases_in_bbox` (continental
 *     US bbox), compute expected displayed coords client-side, emit a
 *     reference set + non-ASCII-slug audit. No DB column to compare
 *     against yet — this mode produces the "what mig 43 must
 *     reproduce" expected values.
 *
 *   --mode=post  (after mig 43 lands)
 *     Pull raw + displayed coords via the diagnostic RPC
 *     `_diag_displayed_point_sample` (added in mig 43). Compute
 *     expected client-side. Assert |displayed - expected| < 1e-6
 *     (~10 cm at mid-latitudes) for every sampled row. Exit 1 on any
 *     mismatch so the script is CI-friendly.
 *
 * Run:
 *   npx tsx scripts/diagnose-jitter-parity.ts --mode=pre
 *   npx tsx scripts/diagnose-jitter-parity.ts --mode=post
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from
 * .env. Read-only against prod; safe to run any time.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------
// Mirror of the client-side jitter polynomial.
//
// SOURCE: mobile/app/(tabs)/index.tsx:86-135 (verbatim semantics).
// If you change the function below, you are claiming the client has
// changed too — re-read the source before editing.
// ---------------------------------------------------------------------

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

function applyImpreciseSpread(
  slug: string,
  lat: number,
  lng: number,
  precision: string | null,
): { lat: number; lng: number } {
  if (precision === 'address' || precision === 'street') {
    return { lat, lng };
  }
  const h = fnv1a(slug);
  const angle = ((h & 0xffff) / 0xffff) * Math.PI * 2;
  const radius = 0.02 + ((h >>> 16) / 0xffff) * 0.025;
  return {
    lat: lat + Math.cos(angle) * radius,
    lng: lng + Math.sin(angle) * radius,
  };
}

// ---------------------------------------------------------------------
// Env + tiny PostgREST client.
// ---------------------------------------------------------------------

function loadEnv(): { url: string; key: string } {
  const path = resolve(process.cwd(), '.env');
  const env = Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [
          l.slice(0, i).trim(),
          l.slice(i + 1).trim().replace(/^["']|["']$/g, ''),
        ];
      }),
  );
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in .env',
    );
  }
  return { url, key };
}

async function rpc<T>(url: string, key: string, fn: string, args: object): Promise<T[]> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`rpc ${fn} ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------
// Mode A — pre-mig-43.
//
// Pull imprecise rows via cases_in_bbox over a continental-US bbox
// (the result_limit=2000 caps the sample but state-precision rows are
// already excluded by the RPC; we filter the rest client-side to
// city/county/null/unknown). For each row, compute expected jitter
// and report. Also flag any non-ASCII slugs as a divergence risk
// (UTF-16 charCodeAt vs UTF-8 byte values diverge for non-ASCII).
// ---------------------------------------------------------------------

type BboxRow = {
  slug: string;
  lat: number;
  lng: number;
  location_precision: string | null;
};

async function modePre(url: string, key: string): Promise<void> {
  const rows = await rpc<BboxRow>(url, key, 'cases_in_bbox', {
    min_lng: -180,
    min_lat: 15,
    max_lng: -65,
    max_lat: 72,
    filter_kinds: null,
    filter_status: null, // include all statuses for sample size
    result_limit: 2000,
  });

  const imprecise = rows.filter(
    (r) =>
      r.location_precision !== 'address' && r.location_precision !== 'street',
  );

  const nonAscii: BboxRow[] = [];
  // eslint-disable-next-line no-control-regex
  const asciiRe = /^[\x00-\x7F]*$/;
  for (const r of imprecise) {
    if (!asciiRe.test(r.slug)) nonAscii.push(r);
  }

  console.log('# Mode: pre-mig-43 (reference set)');
  console.log(`Total rows from cases_in_bbox       : ${rows.length}`);
  console.log(`Imprecise (city/county/null/unknown): ${imprecise.length}`);
  console.log(`  Non-ASCII slugs (parity risk)     : ${nonAscii.length}`);
  if (nonAscii.length > 0) {
    console.log('  Non-ASCII slug examples (first 5):');
    for (const r of nonAscii.slice(0, 5)) console.log(`    ${r.slug}`);
    console.log(
      '  → These slugs produce different fnv1a outputs in JS (UTF-16)',
    );
    console.log(
      '    vs PG (UTF-8). Mig 43 must explicitly handle this — either',
    );
    console.log(
      '    reject non-ASCII slugs at ingest, or hash UTF-16 code units',
    );
    console.log('    on the SQL side (more complex).');
  }
  console.log('');

  // Reference sample — first 20 imprecise rows with computed expected.
  console.log('Sample (first 20):');
  console.log(
    '  slug | precision | raw_lat | raw_lng | expected_displayed_lat | expected_displayed_lng | Δlat (km) | Δlng (km)',
  );
  for (const r of imprecise.slice(0, 20)) {
    const exp = applyImpreciseSpread(r.slug, r.lat, r.lng, r.location_precision);
    const dLat = (exp.lat - r.lat) * 111; // ~111 km/deg lat
    const dLng = (exp.lng - r.lng) * 111 * Math.cos((r.lat * Math.PI) / 180);
    console.log(
      `  ${r.slug.padEnd(40)} | ${(r.location_precision ?? 'null').padEnd(7)} | ${r.lat.toFixed(5)} | ${r.lng.toFixed(5)} | ${exp.lat.toFixed(5)} | ${exp.lng.toFixed(5)} | ${dLat.toFixed(2).padStart(6)} | ${dLng.toFixed(2).padStart(6)}`,
    );
  }
  console.log('');

  // Sanity: radius distribution. Should be uniformly distributed in
  // [0.02, 0.045] degrees by polynomial design.
  const radii = imprecise.map((r) => {
    const exp = applyImpreciseSpread(r.slug, r.lat, r.lng, r.location_precision);
    return Math.hypot(exp.lat - r.lat, exp.lng - r.lng);
  });
  const min = Math.min(...radii);
  const max = Math.max(...radii);
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  console.log(`Radius distribution (deg): min=${min.toFixed(5)} max=${max.toFixed(5)} mean=${mean.toFixed(5)}`);
  console.log(`Expected by polynomial   : min=0.02000 max=0.04500 mean≈0.03250`);
  if (min < 0.0199 || max > 0.0451) {
    console.log('  WARNING: radius outside polynomial bounds — bug in this script.');
    process.exit(1);
  }
  console.log('');
  console.log('Mode A complete. Mig 43 must reproduce the expected coords above');
  console.log('byte-identically. Run --mode=post after mig 43 applies.');
}

// ---------------------------------------------------------------------
// Mode B — post-mig-43.
//
// Compares actual cases.location_point_displayed against client-side
// expected. Uses the diagnostic RPC _diag_displayed_point_sample
// added in mig 43 (returns slug, raw lat/lng, displayed lat/lng,
// precision for a sample of imprecise rows).
// ---------------------------------------------------------------------

type ParityRow = {
  slug: string;
  raw_lat: number;
  raw_lng: number;
  displayed_lat: number;
  displayed_lng: number;
  location_precision: string | null;
};

const TOLERANCE_DEG = 1e-6; // ~10 cm at mid-latitudes

async function modePost(url: string, key: string): Promise<void> {
  const rows = await rpc<ParityRow>(
    url,
    key,
    '_diag_displayed_point_sample',
    { sample_size: 200 },
  );

  console.log('# Mode: post-mig-43 (parity assertion)');
  console.log(`Sampled imprecise rows: ${rows.length}`);
  console.log('');

  let mismatches = 0;
  let maxDelta = 0;
  const examples: string[] = [];

  for (const r of rows) {
    const exp = applyImpreciseSpread(
      r.slug,
      r.raw_lat,
      r.raw_lng,
      r.location_precision,
    );
    const dLat = Math.abs(exp.lat - r.displayed_lat);
    const dLng = Math.abs(exp.lng - r.displayed_lng);
    const delta = Math.max(dLat, dLng);
    if (delta > maxDelta) maxDelta = delta;
    if (delta > TOLERANCE_DEG) {
      mismatches++;
      if (examples.length < 10) {
        examples.push(
          `  ${r.slug}: expected (${exp.lat.toFixed(8)}, ${exp.lng.toFixed(8)}) got (${r.displayed_lat.toFixed(8)}, ${r.displayed_lng.toFixed(8)}) Δ=${delta.toExponential(2)}`,
        );
      }
    }
  }

  console.log(`Max coord delta observed: ${maxDelta.toExponential(2)} deg`);
  console.log(`Tolerance               : ${TOLERANCE_DEG.toExponential(2)} deg (~10 cm)`);
  console.log(`Mismatches              : ${mismatches} / ${rows.length}`);
  console.log('');

  if (mismatches === 0) {
    console.log('PASS — server-side jitter is byte-identical to client-side');
    console.log('       applyImpreciseSpread to within numeric tolerance.');
    console.log('       Mig 44 (RPC) safe to draft + apply.');
    return;
  }

  console.log('FAIL — server-side jitter diverges from client-side. Examples:');
  for (const ex of examples) console.log(ex);
  console.log('');
  console.log('Action: do NOT proceed to mig 44. Revert mig 43, fix the');
  console.log('PG fnv1a / polar polynomial, re-apply, re-run this script.');
  console.log('Common divergence sources:');
  console.log('  - cos/sin swap (TS uses lat += cos*r, lng += sin*r)');
  console.log('  - bit-mask off-by-one in fnv1a (must mask to uint32 each step)');
  console.log('  - radius range mismatch (must be 0.02 + (high16/65535)*0.025)');
  console.log('  - non-ASCII slug — confirm with --mode=pre first');
  process.exit(1);
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

async function main(): Promise<void> {
  const modeArg = process.argv.find((a) => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.slice('--mode='.length) : 'pre';
  if (mode !== 'pre' && mode !== 'post') {
    console.error(`Unknown --mode=${mode}. Use --mode=pre or --mode=post.`);
    process.exit(2);
  }
  const { url, key } = loadEnv();
  if (mode === 'pre') await modePre(url, key);
  else await modePost(url, key);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
