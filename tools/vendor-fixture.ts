#!/usr/bin/env tsx
// Vendor a single real detail page from a source into scraper-fixtures/<slug>/.
// Uses the source's own PoliteFetcher rate-limit + UA, so this script honors the
// same politeness rules as the scraper itself. Strips analytics scripts and
// inlined session cookies before saving.
//
//   npm run vendor:fixture -- --source=charley_project --url=https://charleyproject.org/case/<slug>
//
// Use this BEFORE editing a selector against an unfamiliar real-world response.
// The fixture lives in version control as the production behavior pin.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PoliteFetcher } from '../supabase/functions/_shared/http.ts';
import { getSourceOrThrow } from '../sources/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = resolve(ROOT, 'scraper-fixtures');

interface Args {
  source: string;
  url: string;
  outName?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--source=')) args.source = a.slice('--source='.length);
    else if (a.startsWith('--url=')) args.url = a.slice('--url='.length);
    else if (a.startsWith('--out=')) args.outName = a.slice('--out='.length);
  }
  if (!args.source || !args.url) {
    console.error('usage: npm run vendor:fixture -- --source=<slug> --url=<detail-url> [--out=name.html]');
    process.exit(2);
  }
  return args as Args;
}

function deriveFilename(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop() ?? 'page';
    return `case_${seg.replace(/[^a-z0-9_-]/gi, '_')}.html`;
  } catch {
    return `case_${Date.now()}.html`;
  }
}

/** Strip noise (analytics, session cookies, base64 inlined trackers) before checkin. */
function scrub(html: string): string {
  return (
    html
      // Inline scripts (analytics, GTM bootstrap, etc.)
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      // <link> preconnects/preloads to analytics
      .replace(
        /<link[^>]+(google-analytics|googletagmanager|facebook|hotjar|segment|amplitude)[^>]*>/gi,
        '',
      )
      // <meta http-equiv="set-cookie">
      .replace(/<meta[^>]+set-cookie[^>]*>/gi, '')
      // Trim runs of empty lines we just created
      .replace(/\n{3,}/g, '\n\n')
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const source = getSourceOrThrow(args.source);
  const dir = resolve(FIXTURES_DIR, source.slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const fileName = args.outName ?? deriveFilename(args.url);
  const outPath = resolve(dir, fileName);
  if (existsSync(outPath)) {
    console.error(`refusing to overwrite ${outPath}; pass --out=<other-name>.html to vendor a second copy`);
    process.exit(2);
  }

  const fetcher = new PoliteFetcher(source.rateLimitMs, source.userAgent);
  console.log(`[vendor] fetching ${args.url} (rateLimitMs=${source.rateLimitMs}, ua=${source.userAgent ?? 'default'})`);
  const html = await fetcher.getText(args.url);
  const scrubbed = scrub(html);
  writeFileSync(outPath, scrubbed, 'utf8');
  console.log(`[vendor] saved ${outPath} (${scrubbed.length} bytes after scrub)`);
  console.log(`[vendor] reminder: eyeball the diff before committing — first vendor per source.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
