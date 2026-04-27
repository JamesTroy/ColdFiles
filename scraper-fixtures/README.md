# Scraper Fixtures

This directory holds **vendored HTML responses** from each source we scrape. Tests in `supabase/functions/_shared/__tests__/extract*.test.ts` parse these fixtures with the same Cheerio extractor used in production — so a selector regression fails locally before it touches the dataset.

## Layout

```
scraper-fixtures/
├── README.md                       (this file)
├── charley/
│   ├── index_letter_a.html         list page
│   ├── case_jane_doe_synthetic.html one synthetic detail page (do not scrape from this)
│   └── case_*.html                  real responses, vendored via tools/vendor-fixture.ts
├── doe_network/
│   └── ...
└── project_cold_case/
    └── ...
```

## How fixtures are vendored

```bash
# One-off fetch of a real detail page. Respects rate limits per source config.
npm run vendor:fixture -- --source=charley_project --url=https://charleyproject.org/case/<slug>

# What this does:
#  1. Loads the SourceConfig for the slug
#  2. Uses PoliteFetcher with the source's rate limit + UA
#  3. Saves the response to scraper-fixtures/<slug>/case_<derived_id>.html
#  4. Strips analytics scripts and inlined cookies before saving (privacy + small commits)
```

Always vendor a fixture before changing a selector. Don't write tests against synthetic HTML alone — synthetic fixtures (`*_synthetic.html`) catch *structural* regressions but not the live-site quirks (extra wrapper `<div>`s, lazy-loaded images, conditionally-rendered fields) that real responses surface.

## Synthetic fixtures (`*_synthetic.html`)

A synthetic fixture is a hand-written approximation of the source's structure. They exist so the extractor + dedupe pipeline can be unit-tested *immediately* during development — before you've vendored any real response. Treat them as scaffolding, not as the ground truth.

When a real response is vendored, the synthetic should stay (it documents the structural assumption) but the real fixture is the one that pins production behavior in CI.

## Don't commit PII beyond what's already published

These pages are public — vendoring them is fine. But scrub any analytics IDs, CSRF tokens, or session cookies that may have leaked into the response before checking in. The `tools/vendor-fixture.ts` script does the basic stripping, but eyeball the diff on first commit per source.
