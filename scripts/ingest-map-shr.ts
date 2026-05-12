#!/usr/bin/env tsx
// MAP (Murder Accountability Project) SHR ingest.
//
// Reads a MAP SHR CSV, filters to a single state, resolves each row's
// ORI to a centroid via the supplied agencies_ori_*.json lookup, and
// bulk-loads into the homicide_aggregates table created by migration 47.
//
// Per docs/integrations/map-ingestion-plan.md §3 ("Option C: Postgres
// COPY FROM STDIN"), this script connects to Postgres directly (NOT via
// PostgREST / the Supabase JS client) so it can use COPY for the bulk
// path. The Supabase JS client doesn't expose COPY; the existing
// load-agencies.ts pattern is fine for the ~4-row ORI lookup but is
// the wrong shape for an ~800k-row CSV.
//
// Usage:
//   npm run ingest:map -- \
//     --state MT \
//     --source-release fixture_2026_05_11 \
//     --csv data/map/montana_sample.csv \
//     --ori-map data/map/agencies_ori_montana_sample.json
//
// Reads DATABASE_URL from env (a direct Postgres connection string, NOT
// the Supabase REST URL). Local dev: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
// when running `supabase start`. Remote: the project's session-pooler URL.
//
// Idempotency:
//   Re-running with the same --source-release deletes that release's
//   prior rows in a transaction, then re-COPYs. Different
//   source_release values coexist (plan §3: each release is its own
//   immutable snapshot).
//
// Deps:
//   pg + pg-copy-streams. Both need to be installed before first run:
//     npm install pg pg-copy-streams @types/pg
//   The script does not auto-install; that's a per-machine operator step.

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

// `pg` + `pg-copy-streams` are runtime deps; they're resolved at the top so
// a missing-install fails fast with a clear message instead of mid-COPY.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pgModule: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let copyStreamsModule: any;
try {
  pgModule = await import('pg');
  copyStreamsModule = await import('pg-copy-streams');
} catch (err) {
  console.error(
    "[ingest-map-shr] missing dep: `pg` and `pg-copy-streams` aren't installed.\n" +
      'Run: npm install pg pg-copy-streams @types/pg',
  );
  console.error('Underlying error:', (err as Error).message);
  process.exit(2);
}
const { Client } = pgModule.default ?? pgModule;
const { from: copyFrom } = copyStreamsModule.default ?? copyStreamsModule;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── argv parsing ────────────────────────────────────────────────────────────
// Tiny hand-rolled flag parser; the repo already pulls in `tsx` but no
// argv-parser dep, and adding one for four flags is overkill.
type Args = {
  state: string | null;        // null = --all-states (no per-state filter)
  sourceRelease: string;
  csvPath: string;
  oriMapPath: string;
  dryRun: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) {
      console.error(`[ingest-map-shr] ${flag} requires a value`);
      process.exit(2);
    }
    return v;
  };
  const has = (flag: string) => argv.includes(flag);

  // --all-states disables the per-state filter for full-national runs.
  // When set, --state is ignored; idempotency-delete switches from
  // (source_release, state) to (source_release) alone, so re-running
  // a full-national ingest cleans up the prior release's full set.
  const allStates = has('--all-states');

  // --state accepts either a 2-letter USPS code ("MT") or full name
  // ("Montana"); the actual CSV column carries the full name. We
  // normalize to USPS so the schema's char(2) state column gets a
  // consistent value regardless of what the operator typed.
  const stateRaw = get('--state') ?? 'MT';
  const state = allStates ? null : normalizeStateToCode(stateRaw);
  if (!allStates && !state) {
    console.error(
      `[ingest-map-shr] --state must be a USPS code or US state name (got: ${stateRaw})`,
    );
    process.exit(2);
  }
  const sourceRelease = get('--source-release');
  if (!sourceRelease) {
    console.error(
      '[ingest-map-shr] --source-release is required (e.g. fixture_2026_05_11 or map_shr_2026_03_22)',
    );
    process.exit(2);
  }
  const csvPath = resolve(ROOT, get('--csv') ?? 'data/map/montana_sample.csv');
  const oriMapPath = resolve(
    ROOT,
    get('--ori-map') ?? 'data/map/agencies_ori_montana_sample.json',
  );
  return { state, sourceRelease, csvPath, oriMapPath, dryRun: has('--dry-run') };
}

// ─── ORI lookup ──────────────────────────────────────────────────────────────
type OriRow = {
  ori: string;
  agency_name: string;
  agency_type: string | null;
  state: string;
  city: string | null;
  county: string | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  centroid_source: string | null;
};

function loadOriMap(path: string): Map<string, OriRow> {
  if (!existsSync(path)) {
    console.error(`[ingest-map-shr] --ori-map file not found: ${path}`);
    process.exit(2);
  }
  const raw = readFileSync(path, 'utf8');
  const data = JSON.parse(raw) as { agencies: OriRow[] };
  if (!Array.isArray(data.agencies)) {
    console.error('[ingest-map-shr] ori-map JSON missing top-level "agencies" array');
    process.exit(2);
  }
  return new Map(data.agencies.map((a) => [a.ori, a]));
}

// ─── CSV row normalization ───────────────────────────────────────────────────
//
// Header positions are looked up by name once so MAP-side rearrangements
// don't silently mis-map columns. If a column the script needs is missing,
// fail loudly at parse-time, not mid-COPY.
//
// The CSV variant of MAP's release replaces coded values with display
// labels (per MAPdefinitionsSHR.pdf): Weapon "11"→"Handgun - pistol,
// revolver, etc", Month "03"→"March", Agentype "3"→"Municipal police",
// State "MT"→"Montana", Source "1"/"0"→"FBI"/"MAP", Solved "1"/"0"→
// "Yes"/"No". The synthetic fixture uses similar text values so the
// schema + RPCs work end-to-end; the normalizer below handles either
// form so the same script reads both.

// Column name canonical form lowercased — observed real-CSV headers
// (`Ori`, `Subcircum`) and historical fixture headers (`ORI`,
// `Subcircumstance`) resolve through getColumn().
const EXPECTED_COLUMNS = [
  'Ori',
  'Agency',
  'State',
  'Year',
  'Month',
  'VicAge',
  'VicSex',
  'VicRace',
  'VicEthnic',
  'OffAge',
  'OffSex',
  'OffRace',
  'OffEthnic',
  'Weapon',
  'Relationship',
  'Circumstance',
  'VicCount',
  'OffCount',
  'Solved',
];

// Aliases tolerated for column lookup. First name in each group is the
// canonical EXPECTED_COLUMNS entry; the rest match against the real
// header case-insensitively.
const COLUMN_ALIASES: Record<string, string[]> = {
  Ori: ['ORI', 'Ori', 'ori'],
  Subcircum: ['Subcircum', 'SUBCIRCUM', 'Subcircumstance'],
  Incident: ['Incident', 'Incident#', 'INCIDENT'],
  VicEthnic: ['VicEthnic', 'VICETHNIC', 'VicEthnicity'],
  OffEthnic: ['OffEthnic', 'OFFETHNIC', 'OffEthnicity'],
};

// US state full-name → USPS code. Used to normalize MAP's full-name
// `State` column to the schema's char(2) code. Both directions are
// also accepted on --state so callers can pass either "MT" or
// "Montana".
const STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR',
  CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME',
  MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE',
  NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR',
  // 'RHODES ISLAND' is a real typo in the 2026-03-22 MAP CSV — 1,606
  // rows have this misspelling. Aliasing it back keeps those rows
  // visible instead of silently dropping them from state filters.
  PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'RHODES ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY',
};

function normalizeStateToCode(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(t)) return t;
  return STATE_NAME_TO_CODE[t] ?? null;
}

// Month name (with optional abbreviated form) → 1-12. The CSV uses
// full month names like "March"; the script fixture used integers
// like "7". Both pass through.
const MONTH_NAME_TO_NUM: Record<string, number> = {
  JANUARY: 1, JAN: 1, FEBRUARY: 2, FEB: 2, MARCH: 3, MAR: 3,
  APRIL: 4, APR: 4, MAY: 5, JUNE: 6, JUN: 6, JULY: 7, JUL: 7,
  AUGUST: 8, AUG: 8, SEPTEMBER: 9, SEP: 9, SEPT: 9, OCTOBER: 10, OCT: 10,
  NOVEMBER: 11, NOV: 11, DECEMBER: 12, DEC: 12,
};

function parseMonth(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const t = raw.trim();
  if (t === '') return null;
  // Try numeric first.
  const n = parseInt(t, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= 12) return n;
  return MONTH_NAME_TO_NUM[t.toUpperCase()] ?? null;
}

// Source values in the real CSV come in as 'FBI' / 'MAP' (per data
// dictionary, this is the label-replaced form of `1`/`0`). The schema
// + RPCs key off 'fbi_reported' / 'foia_obtained' literals — normalize
// at ingest so the FOIA filter in homicide_counts_in_polygon /
// homicide_density_for_bbox actually matches.
function normalizeSourceFlag(raw: string | null): string | null {
  if (raw === null) return null;
  const t = raw.trim().toUpperCase();
  if (t === 'FBI' || t === '1' || t === 'FBI_REPORTED') return 'fbi_reported';
  if (t === 'MAP' || t === '0' || t === 'FOIA_OBTAINED') return 'foia_obtained';
  // Unknown value (the real CSV has stray 'Primary state LE' / 'Special
  // police' tokens, but per inspection those are quoted-comma artifacts
  // of awk-style parsers, not the actual Source column). Pass through
  // so a downstream audit query surfaces it.
  return t.toLowerCase();
}

// Minimal CSV parser — handles unquoted + double-quoted fields with
// commas-in-quotes. Avoids pulling in a CSV dep for the one place we
// need parsing. Doesn't handle escaped newlines inside fields, which
// the MAP SHR doesn't appear to use.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = '';
      } else if (ch === '"') {
        inQ = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

function toIntOrNull(v: string | undefined, sentinel999AsNull = false): number | null {
  if (v === undefined) return null;
  const trimmed = v.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'unknown') return null;
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n)) return null;
  if (sentinel999AsNull && n === 999) return null;
  return n;
}

function toBoolOrNull(v: string | undefined): boolean | null {
  if (v === undefined) return null;
  const t = v.trim().toUpperCase();
  if (t === 'Y' || t === 'YES' || t === 'TRUE' || t === '1') return true;
  if (t === 'N' || t === 'NO' || t === 'FALSE' || t === '0') return false;
  return null;
}

function emptyToNull(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

// ─── COPY row encoding ───────────────────────────────────────────────────────
// PostgreSQL text-mode COPY: tab-separated, \N for null, escape \t \n \\ \r.
// We use the explicit text encoding rather than CSV-mode COPY because the
// SHR has rows that need surgical null handling (vic_age=999 → null) that
// is messier to express as a CSV with explicit empty fields.
function copyEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
function copyFieldText(v: string | null): string {
  return v === null ? '\\N' : copyEscape(v);
}
function copyFieldNum(v: number | null): string {
  return v === null ? '\\N' : String(v);
}
function copyFieldBool(v: boolean | null): string {
  return v === null ? '\\N' : v ? 't' : 'f';
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log(`[ingest-map-shr] state=${args.state ?? 'ALL'} source-release=${args.sourceRelease}`);
  console.log(`[ingest-map-shr] csv=${args.csvPath}`);
  console.log(`[ingest-map-shr] ori-map=${args.oriMapPath}`);
  if (args.dryRun) console.log('[ingest-map-shr] DRY RUN — no DB writes');

  if (!existsSync(args.csvPath)) {
    console.error(`[ingest-map-shr] CSV not found: ${args.csvPath}`);
    process.exit(2);
  }

  const oriMap = loadOriMap(args.oriMapPath);
  console.log(`[ingest-map-shr] loaded ${oriMap.size} ORI → centroid mappings`);

  // ── Pre-pass: read + normalize all rows in memory.
  // For the MT pilot (~hundreds of rows) this is fine. For the full
  // ~800k-row ingest, switch to a streaming Transform — the COPY stream
  // is already streaming-capable on the sink side.
  type NormalizedRow = {
    source_release: string;
    shr_row_key: string;
    ori: string;
    agency_name: string | null;
    state: string;
    county: string | null;
    city: string | null;
    year: number;
    month: number;
    vic_age: number | null;
    vic_sex: string | null;
    vic_race: string | null;
    vic_ethnicity: string | null;
    off_age: number | null;
    off_sex: string | null;
    off_race: string | null;
    off_ethnicity: string | null;
    weapon: string | null;
    relationship: string | null;
    circumstance: string | null;
    subcircumstance: string | null;
    vic_count: number | null;
    off_count: number | null;
    solved: boolean | null;
    source_flag: string | null;
    location_lat: number | null;
    location_lng: number | null;
    location_precision: string | null;
  };
  const rows: NormalizedRow[] = [];
  // Tracks (ORI, year, month, incident_no) → next victim ordinal for
  // CSVs that don't carry an explicit VicOrdinal. Plan §4f flags this
  // as release-dependent; we sequence within each release at ingest
  // time so re-ingest is stable.
  const ordinalSeq = new Map<string, number>();
  const stats = {
    seen: 0,
    skippedNotState: 0,
    skippedNoOri: 0,
    accepted: 0,
    stateCentroidFallback: 0,
  };

  let header: string[] | null = null;
  const stream = createReadStream(args.csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = splitCsvLine(line);
      const missing = EXPECTED_COLUMNS.filter((c) => !header!.includes(c));
      if (missing.length) {
        console.error(
          `[ingest-map-shr] CSV header missing required columns: ${missing.join(', ')}\n` +
            `Header observed: ${header.join(', ')}`,
        );
        process.exit(2);
      }
      continue;
    }
    const cols = splitCsvLine(line);
    // Column lookup is alias-aware (case + spelling drift between the
    // synthetic fixture and the real CSV). Falls back to direct header
    // match when no alias group is defined.
    const get = (name: string): string | undefined => {
      const aliases = COLUMN_ALIASES[name] ?? [name];
      for (const alias of aliases) {
        const i = header!.indexOf(alias);
        if (i !== -1) return cols[i];
      }
      return undefined;
    };

    stats.seen += 1;

    const rowStateCode = normalizeStateToCode(get('State') ?? '');
    // Skip if state didn't normalize at all (territory, typo not in
    // our map, etc.) — those rows can't be schema-stored as char(2).
    if (rowStateCode === null) {
      stats.skippedNotState += 1;
      continue;
    }
    // When --state is set, filter to that single state. --all-states
    // sets args.state = null and lets every row through.
    if (args.state !== null && rowStateCode !== args.state) {
      stats.skippedNotState += 1;
      continue;
    }
    const ori = (get('Ori') ?? '').trim();
    if (!ori) {
      stats.skippedNoOri += 1;
      continue;
    }

    const year = toIntOrNull(get('Year'));
    const month = parseMonth(get('Month'));
    if (year === null || month === null) {
      stats.skippedNoOri += 1; // bucket — same "row unusable" outcome
      continue;
    }

    // Incident number is per-incident, per-month.
    const incidentRaw = get('Incident') ?? '1';
    const incident = parseInt(incidentRaw, 10) || 1;
    const vicOrdinalCol = get('VicOrdinal');
    let vicOrdinal: number;
    if (vicOrdinalCol !== undefined && vicOrdinalCol.trim() !== '') {
      vicOrdinal = parseInt(vicOrdinalCol, 10) || 1;
    } else {
      const seqKey = `${ori}|${year}|${month}|${incident}`;
      const next = (ordinalSeq.get(seqKey) ?? 0) + 1;
      ordinalSeq.set(seqKey, next);
      vicOrdinal = next;
    }
    const shrRowKey = `${ori}|${year}|${month}|${incident}|${vicOrdinal}`;

    const oriEntry = oriMap.get(ori);
    let lat: number | null = null;
    let lng: number | null = null;
    let precision: string | null = null;
    if (oriEntry && oriEntry.centroid_lat != null && oriEntry.centroid_lng != null) {
      lat = oriEntry.centroid_lat;
      lng = oriEntry.centroid_lng;
      // city_pd → 'city', county_sheriff/county → 'county', tribal_police →
      // 'county' (tribal jurisdictions are at least county-scoped, often larger).
      // Anything else (state police etc.) → 'state'. The 2026-05-11 MT
      // ingest surfaced MTDI050 (Crow Agency, tribal) silently falling
      // to state-precision and being excluded from polygon/bbox RPCs
      // despite having a real centroid; the tribal branch fixes that.
      const at = (oriEntry.agency_type ?? '').toLowerCase();
      if (at.includes('city')) precision = 'city';
      else if (at.includes('county') || at.includes('sheriff')) precision = 'county';
      else if (at.includes('tribal')) precision = 'county';
      else precision = 'state';
    } else {
      // No centroid for this ORI. Plan §4e: long-tail merged/dissolved
      // agencies fall through to state-precision so the row counts in
      // aggregate totals but stays out of map-rendered queries.
      precision = 'state';
      stats.stateCentroidFallback += 1;
    }

    rows.push({
      source_release: args.sourceRelease,
      shr_row_key: shrRowKey,
      ori,
      agency_name: emptyToNull(get('Agency')) ?? oriEntry?.agency_name ?? null,
      state: rowStateCode,
      county: oriEntry?.county ?? null,
      city: oriEntry?.city ?? null,
      year,
      month,
      vic_age: toIntOrNull(get('VicAge'), true),
      vic_sex: emptyToNull(get('VicSex')),
      vic_race: emptyToNull(get('VicRace')),
      vic_ethnicity: emptyToNull(get('VicEthnic')),
      off_age: toIntOrNull(get('OffAge'), true),
      off_sex: emptyToNull(get('OffSex')),
      off_race: emptyToNull(get('OffRace')),
      off_ethnicity: emptyToNull(get('OffEthnic')),
      weapon: emptyToNull(get('Weapon')),
      relationship: emptyToNull(get('Relationship')),
      circumstance: emptyToNull(get('Circumstance')),
      subcircumstance: emptyToNull(get('Subcircum')),
      vic_count: toIntOrNull(get('VicCount')),
      off_count: toIntOrNull(get('OffCount')),
      solved: toBoolOrNull(get('Solved')),
      source_flag: normalizeSourceFlag(emptyToNull(get('Source'))),
      location_lat: lat,
      location_lng: lng,
      location_precision: precision,
    });
    stats.accepted += 1;
  }

  console.log(
    `[ingest-map-shr] read ${stats.seen} rows — ` +
      `${stats.accepted} accepted, ${stats.skippedNotState} skipped (state filter / unrecognized state), ` +
      `${stats.skippedNoOri} skipped (no ORI / missing year-month), ` +
      `${stats.stateCentroidFallback} fell back to state-precision (no centroid).`,
  );

  if (args.dryRun) {
    console.log('[ingest-map-shr] --dry-run set, exiting before DB writes.');
    if (rows.length) {
      console.log('[ingest-map-shr] sample normalized row:', JSON.stringify(rows[0], null, 2));
    }
    return;
  }

  const databaseUrl = (process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    console.error(
      '[ingest-map-shr] DATABASE_URL is required (postgresql://...). The Supabase REST URL (NEXT_PUBLIC_SUPABASE_URL) is not a Postgres connection string and will not work.',
    );
    process.exit(2);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // ── Idempotency
    // Wrap the whole ingest in a single transaction. Re-runs with the
    // same source_release: delete prior rows, COPY the fresh batch,
    // commit. If anything fails the rollback restores the prior state.
    await client.query('begin');

    // 1. Upsert ORI lookup rows.
    //    Done in-transaction so a partial ingest doesn't leave a
    //    half-populated agencies_ori behind.
    const oriEntries = Array.from(oriMap.values());
    for (const entry of oriEntries) {
      await client.query(
        `insert into agencies_ori (
            ori, agency_name, agency_type, state, city, county,
            centroid_lat, centroid_lng, centroid_source, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         on conflict (ori) do update set
            agency_name = excluded.agency_name,
            agency_type = excluded.agency_type,
            state = excluded.state,
            city = excluded.city,
            county = excluded.county,
            centroid_lat = excluded.centroid_lat,
            centroid_lng = excluded.centroid_lng,
            centroid_source = excluded.centroid_source,
            updated_at = now()`,
        [
          entry.ori,
          entry.agency_name,
          entry.agency_type,
          entry.state,
          entry.city,
          entry.county,
          entry.centroid_lat,
          entry.centroid_lng,
          entry.centroid_source,
        ],
      );
    }
    console.log(`[ingest-map-shr] upserted ${oriEntries.length} ORI rows`);

    // 2. Delete prior rows for this source_release × (state | all).
    //    Idempotency hinge: re-running with the same --source-release
    //    truncates that slice and re-inserts. --all-states scopes to
    //    just the release so we don't accidentally wipe a different
    //    state's prior single-state run.
    const del = args.state === null
      ? await client.query(
          `delete from homicide_aggregates where source_release = $1`,
          [args.sourceRelease],
        )
      : await client.query(
          `delete from homicide_aggregates
            where source_release = $1 and state = $2`,
          [args.sourceRelease, args.state],
        );
    console.log(
      `[ingest-map-shr] deleted ${del.rowCount} existing rows for source_release=${args.sourceRelease} state=${args.state ?? 'ALL'}`,
    );

    // 3. COPY FROM STDIN.
    //    Column order MUST match the COPY statement's column list.
    //    location_point is built from (location_lng, location_lat) by
    //    a separate UPDATE step so the COPY payload stays plain
    //    scalar columns — encoding PostGIS geography into COPY-text
    //    is error-prone and ST_MakePoint inside an UPDATE is cheap.
    const copyColumns = [
      'source_release',
      'shr_row_key',
      'ori',
      'agency_name',
      'state',
      'county',
      'city',
      'year',
      'month',
      'vic_age',
      'vic_sex',
      'vic_race',
      'vic_ethnicity',
      'off_age',
      'off_sex',
      'off_race',
      'off_ethnicity',
      'weapon',
      'relationship',
      'circumstance',
      'subcircumstance',
      'vic_count',
      'off_count',
      'solved',
      'source_flag',
      'location_precision',
      // location_lat/lng land in a temp table on a side path; see below.
    ];

    // Create a temp staging table so we can land location_lat/lng as
    // plain columns then ST_MakePoint into the real table. This keeps
    // the COPY payload free of geography binary encoding.
    await client.query(
      `create temp table homicide_aggregates_stg (
         like homicide_aggregates including defaults,
         location_lat double precision,
         location_lng double precision
       ) on commit drop`,
    );
    // location_point is a generated column on the real table — drop it
    // from the staging table so the COPY doesn't try to populate it.
    // (`like ... including defaults` doesn't carry GENERATED expressions
    // forward in some PG versions, but it does carry the column itself.
    // Drop defensively.)
    await client.query(
      `alter table homicide_aggregates_stg drop column if exists location_point`,
    );

    const copyCols = [...copyColumns, 'location_lat', 'location_lng'];
    const stream2 = client.query(
      copyFrom(
        `copy homicide_aggregates_stg (${copyCols.join(', ')}) from stdin with (format text)`,
      ),
    );

    const payload = new Readable({
      read() {
        for (const r of rows) {
          const line =
            [
              copyFieldText(r.source_release),
              copyFieldText(r.shr_row_key),
              copyFieldText(r.ori),
              copyFieldText(r.agency_name),
              copyFieldText(r.state),
              copyFieldText(r.county),
              copyFieldText(r.city),
              copyFieldNum(r.year),
              copyFieldNum(r.month),
              copyFieldNum(r.vic_age),
              copyFieldText(r.vic_sex),
              copyFieldText(r.vic_race),
              copyFieldText(r.vic_ethnicity),
              copyFieldNum(r.off_age),
              copyFieldText(r.off_sex),
              copyFieldText(r.off_race),
              copyFieldText(r.off_ethnicity),
              copyFieldText(r.weapon),
              copyFieldText(r.relationship),
              copyFieldText(r.circumstance),
              copyFieldText(r.subcircumstance),
              copyFieldNum(r.vic_count),
              copyFieldNum(r.off_count),
              copyFieldBool(r.solved),
              copyFieldText(r.source_flag),
              copyFieldText(r.location_precision),
              copyFieldNum(r.location_lat),
              copyFieldNum(r.location_lng),
            ].join('\t') + '\n';
          this.push(line);
        }
        this.push(null);
      },
    });

    await pipeline(payload, stream2);
    console.log(`[ingest-map-shr] copied ${rows.length} rows to staging`);

    // 4. INSERT … SELECT from staging into the real table, building
    //    location_point from (location_lng, location_lat) along the way.
    const insertCols = copyColumns.join(', ');
    const ins = await client.query(
      `insert into homicide_aggregates (${insertCols}, location_point)
       select ${insertCols},
              case
                when location_lat is null or location_lng is null then null
                else ST_SetSRID(ST_MakePoint(location_lng, location_lat), 4326)::geography
              end
         from homicide_aggregates_stg`,
    );
    console.log(`[ingest-map-shr] inserted ${ins.rowCount} rows into homicide_aggregates`);

    await client.query('commit');

    // ── Post-commit verification queries (read-only)
    const verifyParams: (string | null)[] = args.state === null
      ? [args.sourceRelease]
      : [args.sourceRelease, args.state];
    const verifyWhere = args.state === null
      ? `source_release = $1`
      : `source_release = $1 and state = $2`;
    const totalRes = await client.query(
      `select count(*) as n from homicide_aggregates where ${verifyWhere}`,
      verifyParams,
    );
    const solvedRes = await client.query(
      `select
         count(*) filter (where solved is true) as solved,
         count(*) filter (where solved is false or solved is null) as unsolved,
         count(*) filter (where source_flag = 'foia_obtained') as foia
       from homicide_aggregates
       where ${verifyWhere}`,
      verifyParams,
    );
    console.log(
      `[ingest-map-shr] verify — total=${totalRes.rows[0].n} ` +
        `solved=${solvedRes.rows[0].solved} ` +
        `unsolved=${solvedRes.rows[0].unsolved} ` +
        `foia_obtained=${solvedRes.rows[0].foia}`,
    );
  } catch (err) {
    await client.query('rollback').catch(() => {
      /* connection may already be dead */
    });
    console.error('[ingest-map-shr] ingest failed, rolled back:', (err as Error).message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
