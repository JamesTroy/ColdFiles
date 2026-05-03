# The Cold File — Scraper Architecture

**Pattern:** Config-driven, single-runner-per-source, all running on Supabase Edge Functions (Deno) with cron triggers — same shape as the SafeRadius 50-state scraper. One unified pipeline, per-source configs do the heavy lifting.

## Why config-driven (again)

You proved with SafeRadius that the right abstraction for "ingest the same kind of data from many awkwardly-different public websites" is one runner + N configs, not N hand-written scrapers. Same logic applies here: every cold case source has the same shape (list page → detail page → fields → photos → agency contact). The differences are selectors, URL patterns, pagination, and a few field-by-field quirks. Configs handle all of that.

---

## High-level pipeline

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐     ┌─────────────┐     ┌──────────┐
│ SOURCE      │     │ FETCH +      │     │ NORMALIZE  │     │ DEDUPE +    │     │ PERSIST  │
│ CONFIG      │ ──▶ │ EXTRACT      │ ──▶ │ + ENRICH   │ ──▶ │ MERGE       │ ──▶ │          │
│ (sources/*) │     │ (worker)     │     │ (pipeline) │     │ (resolver)  │     │ (db)     │
└─────────────┘     └──────────────┘     └────────────┘     └─────────────┘     └──────────┘
                          │                     │                  │
                          ▼                     ▼                  ▼
                    raw HTML/JSON          geocoder            fuzzy match
                    + media downloads      photo cache         on dedupe_keys
                    to Supabase Storage    age normalize       trust-weighted
                                            agency lookup       field merge
```

Each source goes through the exact same pipeline. Only the **fetch + extract** stage knows about source-specific HTML.

---

## Edge Functions layout

```
supabase/functions/
├── ingest-source/              # The single runner. Takes ?source=namus
│   └── index.ts
├── ingest-tick/                # Cron entrypoint. Decides which sources are due.
│   └── index.ts
├── geocode-pending/            # Geocodes cases that came in without coords
│   └── index.ts
├── photo-cache/                # Downloads media to Supabase Storage, computes hashes
│   └── index.ts
├── dedupe-resolver/            # Background job: re-checks dedupe across cases
│   └── index.ts
└── _shared/
    ├── extract.ts              # Cheerio-based extraction helpers
    ├── normalize.ts            # Name/age/date/location normalization
    ├── dedupe.ts               # Generates and matches dedupe keys
    ├── trust-merge.ts          # Field-conflict resolution by source weight
    ├── geocode.ts              # Mapbox geocoding wrapper with cache
    ├── http.ts                 # Polite fetcher with rate-limit + UA
    └── types.ts                # Shared types
```

---

## Source config shape

Every source is a TS file in `sources/`. The runner imports them and dispatches by slug.

```ts
// sources/types.ts
export interface SourceConfig {
  slug: string;
  name: string;
  kind: 'federal' | 'state' | 'agency' | 'aggregator' | 'nonprofit';
  baseUrl: string;
  rateLimitMs: number;
  userAgent?: string;            // override if a source needs a specific UA
  scheduleCron: string;           // standard cron, e.g. '0 5 * * 1' for Monday 05:00
  attribution: { html: string; linkBackRequired: boolean };

  // The strategy that yields a list of detail-page URLs
  list: ListStrategy;

  // The strategy that turns one detail page into a normalized CaseRecord
  detail: DetailStrategy;

  // Defaults applied to every case from this source
  defaults?: Partial<CaseRecord>;

  // Trust weight 0-100 used in field-conflict resolution
  trustWeight: number;
}

export type ListStrategy =
  | { kind: 'state_index_pagination'; statePath: (state: string) => string; pageParam: string; states: string[] }
  | { kind: 'sitemap'; sitemapUrl: string; urlPattern: RegExp }
  | { kind: 'json_api'; endpoint: string; pageSize: number; cursorPath: string }
  | { kind: 'alpha_index'; indexUrl: string; letterParam?: string };

export interface DetailStrategy {
  kind: 'cheerio';
  selectors: {
    name?: string;
    age?: string;
    sex?: string;
    race?: string;
    incidentDate?: string;
    locationText?: string;
    locationCity?: string;
    locationState?: string;
    narrative?: string;
    photoUrls?: string;            // selector matching <img>; href[src] auto-extracted
    agencyName?: string;
    agencyPhone?: string;
    caseNumber?: string;
    namusNumber?: string;
    ncicNumber?: string;
  };
  // For dates that need parsing — e.g. 'June 1985' vs 'June 13, 1985 12:00 AM'
  dateFormats?: string[];
  // Per-field transforms when selectors aren't enough
  transforms?: {
    [field: string]: (raw: string, $: cheerio.CheerioAPI) => string | undefined;
  };
  // Inferred case kind if not derivable from URL/selectors
  inferKind?: (record: Partial<CaseRecord>) => 'homicide' | 'missing' | 'unidentified' | 'unclaimed';
}
```

See `types/case-record.ts` for the full `CaseRecord` shape.

---

## Dedupe strategy

The bedrock function. A case can show up in NamUs, Charley Project, Doe Network, and the LASD blog — we want one `cases` row, with four `case_sources` rows pointing to it.

We generate dedupe keys from each new record and look them up in the `case_dedupe_keys` table.

Resolution rules:
1. If a `namus_number` or `ncic_number` matches → same case, certain.
2. If `name_state_year` matches → same case, treat as certain unless other fields conflict (e.g. different sex).
3. If only `lastname_age_sex` matches → candidate. Run additional checks: trigram similarity on first name (>= 0.6), location overlap. If two of those hold, treat as same case. Otherwise create new case + log to a `dedupe_review_queue` for human review.

---

## Trust-weighted field merge

When two sources disagree on a field, the higher trust weight wins. Equal weights — keep current (stability).

Trust weights (initial):
- **NamUs:** 90 (federal, vetted) — wired but dormant pending API access; see `sources/namus.ts`
- **Investigating agency direct (LAPD, LASD):** 95 — they own the case (deferred — no live agency-direct source today)
- **Charley Project:** 75 — researched but not authoritative
- **Doe Network (missing):** 70 — researched, sometimes outdated
- **Doe Network (unidentified):** 70 — sibling source, same posture as the missing track
- **Project: Cold Case:** 50 — known data quality issues
- **Media reports:** 40 — useful for narrative color, low for facts (no live source today)

Sources retired or never built (kept here as a back-pointer so the trust-weight conversation stays honest):
- **FBI Wanted:** retired in migration 15 — editorially mis-fit for the cold-case track; corpus was tip-line bulletins not unsolved-homicide posters. See `docs/00_DECISIONS.md` (2026-05-03 entry) and the `feedback_fbi_wanted_editorial_misfit` memory note.
- **Solve the Case:** never built — scoped in the original strategy as a supplementary fifth source but no extractor was written. Deferred indefinitely.

The narrative field is special: instead of merge-by-trust, store all source narratives and pick the longest from the highest-trust source for display. Show others as "Read more from [source]" links.

---

## Geocoding pipeline

`location_text` from sources is human-readable: "15400 block of Temple Ave., La Puente, CA". We:

1. Normalize ("15400 Temple Ave, La Puente, CA, USA")
2. Geocode via Mapbox (you already have this set up for BarkPark)
3. Cache results in a `geocode_cache` table keyed on the normalized string
4. Store the result with a `location_precision` flag:
   - `address` if Mapbox returns an address-level result
   - `street` if intersection or block
   - `city` if only city-level
   - `county`, `state`, or `unknown` for fall-throughs
5. For privacy, snap addresses to the **block** (round to nearest 0.001° ≈ ~100m) so we don't pinpoint a private residence.

The Cold File map only ever displays the snapped point. The case detail screen shows the textual location, never a pinpoint address.

---

## Photo caching

```
Source page has <img src="https://lasd.org/.../victim.jpg">
  ↓
photo-cache function:
  1. Fetch the image (politely, with referer)
  2. Compute sha256 → content_hash
  3. Check case_media for existing row with this hash → if exists, link to existing media
  4. Otherwise upload to Supabase Storage at: cases/{case_id}/{kind}/{hash[0:2]}/{hash}.jpg
  5. Insert case_media row
```

Storage convention: `cases/{case_id}/{kind}/{hash_prefix}/{hash}.{ext}`. Hash-based naming makes deduplication automatic and makes URL prediction impossible (privacy plus).

---

## Cron schedule

Single cron entrypoint `ingest-tick` runs every hour. It checks each source's `next_run_at` and dispatches due ones to `ingest-source` (one HTTP call per source, parallel-safe).

After a run, `next_run_at` is bumped per the source's cron expression.

---

## Error handling

- **Network errors:** retry once after 30s, then bail and record in `source_runs.errors`.
- **Selector misses (parser broken):** log first 5 occurrences with the raw HTML, continue. If miss rate >20% on a run, mark run as `failed` and pause auto-publish for that source until reviewed.
- **Geocoding failures:** mark `location_precision = 'unknown'`, leave `location_point` null. Case still ingests. Geocode worker retries nightly.
- **Photo fetch failures:** log, no row inserted, retry next run.

---

## Local dev workflow

```bash
# Add a new source
$ npm run scrape:dryrun -- --source=charley_project --limit=5

# Output:
# [charley] Fetching index... 1 page
# [charley] 5 detail URLs queued
# [charley] Detail 1/5: https://charleyproject.org/case/jane-doe-1985
#   victim_name=Jane Doe age=23 state=CA date=1985-06-13
#   3 photos
#   2 dedupe keys: name_state_year=jane_doe_ca_1985, lastname_age_sex=doe_23_female
# ...
# [charley] Would insert 5 cases, 0 already exist (dryrun)

# Run for real
$ npm run scrape -- --source=charley_project --limit=50

# Run all due sources
$ npm run scrape:tick
```

---

## Build sequence (recommended order)

**Week 1 — foundation**
1. Schema migration (`migrations/01_schema.sql`)
2. `_shared/http.ts`, `_shared/extract.ts`, `_shared/normalize.ts`, `_shared/dedupe.ts`
3. `ingest-source` runner skeleton with fake-config tests
4. Local CLI (`npm run scrape:dryrun`) for offline iteration

**Week 2 — first three sources**
5. `sources/charley.ts` — easiest to scrape, single-flat HTML
6. `sources/doe_network.ts` — similar shape
7. `sources/project_cold_case.ts` — similar shape, flag the 1970-01-01 bug
8. Run all three end-to-end on the dev DB. Verify dedupe collapses correctly.

**Week 3 — federal weight + media**
9. `sources/namus.ts` — handle React-rendered state, may need Puppeteer for first version
10. `photo-cache` function
11. `geocode-pending` function
12. `cases_within_radius` and `cases_in_bbox` RPCs

**Week 4 — launch metro**
13. `sources/lapd_unsolved.ts` (per-bureau)
14. `sources/lasd_homicide.ts` (blog-format, RSS where available)
15. Tip-routing logic: per-case agency phone/url with fallback to LA Crime Stoppers P3
16. `takedown_requests` flow + admin UI

**Week 5 — UI**
17. The map and case detail screens (Next.js App Router)
18. Subscribe + watch zones (Stripe + push)

**Week 6 — launch**
19. Privacy policy + terms + takedown form
20. Beta with 30 LA-county true-crime accounts on Twitter/Reddit
21. Press outreach: LA Times, LAist, Crime Junkie, Murder Squad

---

## Open questions to resolve before building

1. **NamUs scraping vs. waiting for a research data agreement.** They have a "limitations on use of NamUs data for research purposes" disclaimer. Worth reading carefully and possibly emailing namus@unt.edu to ask about a research/aggregator agreement before scraping at any volume. Don't want to be the reason they tighten access.
2. **Children's cases (NCMEC).** Apply for partner status before launch — the public posters are fine, but partner status gives cleaner data and shows we're operating in good faith. Without it, gate child cases behind a stricter UI warning.
3. **CalDOJ.** Check whether CA DOJ now publishes a unified cold case database — it's been talked about for years. If yes, that supersedes per-county scraping in CA.
4. **Trademarks.** Check `coldfile.app`, `thecoldfile.com`, `coldfile.io`. Also check trademark database for "Cold File" in the technology / mobile-app classes.
