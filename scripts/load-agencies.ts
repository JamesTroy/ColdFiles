#!/usr/bin/env tsx
// One-shot loader: reads data/agencies/{metro}.json files and upserts into the
// agencies table. Idempotent — slug is the conflict key, so re-running on the
// same file safely refreshes any field that changed.
//
//   npm run load:agencies
//
// Add a new metro by dropping data/agencies/{metro}.json into place and running
// again. The schema is locked; this is just data.

import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data/agencies');

interface AgencyRow {
  slug: string;
  name: string;
  short_name: string | null;
  agency_type: string;
  state: string | null;
  county: string | null;
  city: string | null;
  website_url: string | null;
  cold_case_url: string | null;
  phone_general: string | null;
  phone_tip: string | null;
  tip_url: string | null;
  tip_url_template: string | null;
  tip_route_kind: string | null;
  notes: string | null;
  routing_last_verified_at: string | null;
}

interface MetroFile {
  metro: string;
  comment?: string;
  agencies: AgencyRow[];
}

async function main() {
  // .trim() catches the GitHub Actions secret + trailing-newline footgun
  // that bit the scrape workflow's first run; same posture as the
  // sibling scrape-cli readEnv helper. See feedback_silent_whitespace_in_config.
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) {
    console.error(
      'NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required (whitespace-only values are treated as missing).',
    );
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const files = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.error(`no agency files found in ${DATA_DIR}`);
    process.exit(2);
  }

  let totalInserted = 0;
  let totalUpdated = 0;

  for (const file of files) {
    const path = resolve(DATA_DIR, file);
    const raw = readFileSync(path, 'utf8');
    let data: MetroFile;
    try {
      data = JSON.parse(raw) as MetroFile;
    } catch (err) {
      console.error(`[load-agencies] ${file} is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }

    console.log(
      `[load-agencies] ${file} — metro=${data.metro}, ${data.agencies.length} agencies`,
    );

    // Pre-fetch existing slugs so we can report inserted vs updated counts.
    const slugs = data.agencies.map((a) => a.slug);
    const { data: existing } = await supabase
      .from('agencies')
      .select('slug')
      .in('slug', slugs);
    const existingSlugs = new Set((existing ?? []).map((r) => r.slug as string));

    const rows = data.agencies.map((a) => ({ ...a, active: true }));
    const { error } = await supabase
      .from('agencies')
      .upsert(rows, { onConflict: 'slug' });

    if (error) {
      console.error(`[load-agencies] error on ${file}: ${error.message}`);
      process.exit(1);
    }

    for (const a of data.agencies) {
      if (existingSlugs.has(a.slug)) totalUpdated += 1;
      else totalInserted += 1;
    }

    // Per-row summary so day-2/3 verifications are easy to spot in the diff.
    for (const a of data.agencies) {
      const verified = a.routing_last_verified_at ? '✓' : ' ';
      const route = a.tip_route_kind ?? '—';
      console.log(`  ${verified} ${a.slug.padEnd(20)} route=${route.padEnd(20)} url=${a.tip_url ?? '—'}`);
    }
  }

  console.log(
    `\n[load-agencies] done — ${totalInserted} new, ${totalUpdated} updated, across ${files.length} metro file(s)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
