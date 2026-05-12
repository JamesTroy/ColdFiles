#!/usr/bin/env tsx
// Build a national ORI → centroid lookup from:
//   * Murder Accountability Project SHR CSV (for the set of ORIs that
//     actually appear in the homicide corpus, plus their agency names,
//     agency types, and CNTYFIPS labels).
//   * US Census Bureau 2024 Gazetteer (counties + places) for centroid
//     coordinates. Public-domain federal-government work — no license
//     gate.
//
// Strategy:
//   1. Counties gazetteer → map keyed by "<USPS>|<normalized county name>".
//      Used as the fallback centroid for sheriffs, tribal agencies, and
//      city PDs whose Agency name doesn't match a place.
//   2. Places gazetteer → map keyed by "<USPS>|<normalized place name>".
//      Used to upgrade municipal-police rows from county-precision to
//      city-precision when the Agency name matches a known place.
//   3. Walk every unique (ORI, Agency, Agentype, State, CNTYFIPS) tuple
//      in the MAP CSV; emit one JSON entry per ORI.
//
// Usage:
//   tsx scripts/build-ori-national.ts \
//     --csv data/map/shr_2026_03_22.csv \
//     --counties /tmp/2024_Gaz_counties_national.txt \
//     --places   /tmp/2024_Gaz_place_national.txt \
//     --out      data/map/agencies_ori_national.json
//
// Output: JSON in the shape `scripts/ingest-map-shr.ts` expects.
// Gitignored alongside the CSV — see data/map/README.md.

import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string, def?: string): string => {
    const i = argv.indexOf(flag);
    if (i === -1) {
      if (def !== undefined) return def;
      console.error(`[build-ori-national] ${flag} is required`);
      process.exit(2);
    }
    return argv[i + 1] ?? '';
  };
  return {
    csv: get('--csv', 'data/map/shr_2026_03_22.csv'),
    counties: get('--counties', '/tmp/2024_Gaz_counties_national.txt'),
    places: get('--places', '/tmp/2024_Gaz_place_national.txt'),
    out: get('--out', 'data/map/agencies_ori_national.json'),
  };
}

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
  PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'RHODES ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY',
};
function toUsps(stateRaw: string): string | null {
  const t = stateRaw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(t)) return t;
  return STATE_NAME_TO_CODE[t] ?? null;
}

// Match MAP Agentype labels to schema-friendly agency_type tokens.
// Per data dictionary §AGENTYPE: 1=Sheriff, 2=County Police,
// 3=Municipality, 5=Primary State Law Enforcement, 6=Special Police,
// 7=Constable, 8=Tribal Police, 9=Regional Police. CSV variant
// replaces codes with labels like "Sheriff", "Municipal police".
function mapAgentype(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes('sheriff')) return 'county_sheriff';
  if (t.includes('county police')) return 'county_police';
  if (t.includes('municipal') || t.includes('municipality')) return 'city_pd';
  if (t.includes('primary state') || t.includes('state pol')) return 'state_police';
  if (t.includes('special')) return 'special_police';
  if (t.includes('constable')) return 'constable';
  if (t.includes('tribal')) return 'tribal_police';
  if (t.includes('regional')) return 'regional_police';
  return raw || 'unknown';
}

// Minimal CSV split that handles quoted-comma fields. Same routine as
// the ingest script; duplicated rather than imported because this is a
// build-time util that should be runnable standalone.
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') inQ = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// Normalize a place/county name for lookup: strip "County", "Parish",
// "Borough", "Census Area", "Municipality", "city", "town", "village",
// "CDP", trailing punctuation, lowercase. Aggressive — sacrifices some
// disambiguation accuracy (e.g. "Hampton" matches both city and county
// in some states) in exchange for higher match rate.
function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(county|parish|borough|census area|municipality|city|town|village|cdp|township|consolidated government|metropolitan government|unified government|metro government)\b/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Centroid = { lat: number; lng: number };

function loadCountiesGazetteer(path: string): Map<string, Centroid> {
  const lines = readFileSync(path, 'utf8').split('\n');
  const header = lines[0].split('\t').map((s) => s.trim());
  const iState = header.indexOf('USPS');
  const iName = header.indexOf('NAME');
  const iLat = header.indexOf('INTPTLAT');
  const iLng = header.indexOf('INTPTLONG');
  if (iState < 0 || iName < 0 || iLat < 0 || iLng < 0) {
    throw new Error(`counties gazetteer missing expected columns: ${header.join('|')}`);
  }
  const m = new Map<string, Centroid>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split('\t').map((s) => s.trim());
    const usps = cols[iState];
    const name = normalizeName(cols[iName]);
    const lat = parseFloat(cols[iLat]);
    const lng = parseFloat(cols[iLng]);
    if (!usps || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    m.set(`${usps}|${name}`, { lat, lng });
  }
  return m;
}

function loadPlacesGazetteer(path: string): Map<string, Centroid> {
  const lines = readFileSync(path, 'utf8').split('\n');
  const header = lines[0].split('\t').map((s) => s.trim());
  const iState = header.indexOf('USPS');
  const iName = header.indexOf('NAME');
  const iLat = header.indexOf('INTPTLAT');
  const iLng = header.indexOf('INTPTLONG');
  if (iState < 0 || iName < 0 || iLat < 0 || iLng < 0) {
    throw new Error(`places gazetteer missing expected columns`);
  }
  const m = new Map<string, Centroid>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split('\t').map((s) => s.trim());
    const usps = cols[iState];
    const name = normalizeName(cols[iName]);
    const lat = parseFloat(cols[iLat]);
    const lng = parseFloat(cols[iLng]);
    if (!usps || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${usps}|${name}`;
    // Prefer the first match (alphabetic-leading dedup); if the place
    // collides with a CDP duplicate, keep the city/town first-write.
    if (!m.has(key)) m.set(key, { lat, lng });
  }
  return m;
}

async function main() {
  const args = parseArgs();
  console.log(`[build-ori] csv=${args.csv}`);
  console.log(`[build-ori] counties=${args.counties}`);
  console.log(`[build-ori] places=${args.places}`);
  console.log(`[build-ori] out=${args.out}`);

  const counties = loadCountiesGazetteer(args.counties);
  console.log(`[build-ori] loaded ${counties.size} counties`);
  const places = loadPlacesGazetteer(args.places);
  console.log(`[build-ori] loaded ${places.size} places`);

  type OriRow = {
    ori: string;
    agency_name: string;
    agency_type: string;
    state: string;
    city: string | null;
    county: string | null;
    centroid_lat: number | null;
    centroid_lng: number | null;
    centroid_source: string;
  };
  const oriMap = new Map<string, OriRow>();

  // Stats per resolution path so the run output makes the
  // coverage/precision tradeoff visible.
  const stats = {
    rowsRead: 0,
    uniqueOri: 0,
    matchedPlace: 0,        // city PD that matched a Census place
    matchedCounty: 0,       // any agency, fell back to county centroid
    noState: 0,             // state name unrecognized (shouldn't happen)
    noCounty: 0,            // county name didn't match gazetteer
    skipped: 0,
  };

  let header: string[] | null = null;
  const rl = createInterface({
    input: createReadStream(args.csv, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!header) {
      header = splitCsvLine(line);
      continue;
    }
    if (!line.trim()) continue;
    stats.rowsRead++;
    const cols = splitCsvLine(line);
    const getCol = (name: string): string => {
      const i = header!.indexOf(name);
      return i === -1 ? '' : cols[i] ?? '';
    };
    const ori = getCol('Ori').trim();
    if (!ori || oriMap.has(ori)) continue;

    const stateFullName = getCol('State');
    const usps = toUsps(stateFullName);
    if (!usps) {
      stats.noState++;
      stats.skipped++;
      continue;
    }
    const agencyRaw = getCol('Agency').trim();
    const agentypeRaw = getCol('Agentype').trim();
    const cntyfips = getCol('CNTYFIPS').trim(); // "<County>, <USPS>" in csv variant

    const agencyType = mapAgentype(agentypeRaw);

    // Parse county from CNTYFIPS. The format is "<county-name>, <USPS>"
    // when CSV is the label-replaced variant; occasionally agencies are
    // tagged to a county whose state doesn't match the row State —
    // accept either way and trust the CNTYFIPS state when present.
    let countyName: string | null = null;
    let cntyUsps = usps;
    const cm = /^(.+),\s*([A-Z]{2})$/.exec(cntyfips);
    if (cm) {
      countyName = cm[1].trim();
      cntyUsps = cm[2];
    }

    // Look up county centroid first (used as fallback + as the county
    // metadata regardless of whether we end up at city precision).
    let county_centroid: Centroid | null = null;
    if (countyName) {
      const key = `${cntyUsps}|${normalizeName(countyName)}`;
      county_centroid = counties.get(key) ?? null;
      if (!county_centroid) stats.noCounty++;
    } else {
      stats.noCounty++;
    }

    // For municipal/city PDs, try to upgrade to city precision by
    // matching the Agency name against places in the same state.
    // Sheriffs / tribal / state police skip this step.
    let lat: number | null = null;
    let lng: number | null = null;
    let centroidSource: string = 'state_fallback';
    let cityName: string | null = null;
    if (agencyType === 'city_pd') {
      const placeKey = `${usps}|${normalizeName(agencyRaw)}`;
      const placeMatch = places.get(placeKey);
      if (placeMatch) {
        lat = placeMatch.lat;
        lng = placeMatch.lng;
        centroidSource = 'census_place';
        cityName = agencyRaw;
        stats.matchedPlace++;
      }
    }
    if (lat === null && county_centroid) {
      lat = county_centroid.lat;
      lng = county_centroid.lng;
      centroidSource = 'census_county_centroid';
      stats.matchedCounty++;
    }

    oriMap.set(ori, {
      ori,
      agency_name: agencyRaw,
      agency_type: agencyType,
      state: usps,
      city: cityName,
      county: countyName,
      centroid_lat: lat,
      centroid_lng: lng,
      centroid_source: centroidSource,
    });
    stats.uniqueOri++;
  }

  const agencies = [...oriMap.values()].sort((a, b) =>
    a.state.localeCompare(b.state) || a.ori.localeCompare(b.ori),
  );

  const output = {
    comment:
      'Auto-generated national ORI → centroid lookup. ' +
      'Sources: MAP SHR CSV (agency name + ORI + CNTYFIPS) + ' +
      'US Census 2024 Gazetteer (county/place centroids, public domain per 17 USC §105). ' +
      'Build: scripts/build-ori-national.ts. ' +
      'Not committed because the agency-name × ORI pairing is derived from the gated MAP CSV.',
    source_release: 'map_shr_2026_03_22',
    generated_at: new Date().toISOString(),
    stats,
    agencies,
  };
  writeFileSync(args.out, JSON.stringify(output, null, 2));
  console.log(`[build-ori] wrote ${oriMap.size} ORIs to ${args.out}`);
  console.log(`[build-ori] stats:`, stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
