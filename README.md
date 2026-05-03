# The Cold File — Foundations

Map-first directory of cold cases (unsolved homicides, long-term missing, unidentified persons) with one-tap routing of tips to the agency that owns the case.

**Owner:** Matte Black Dev LLC
**Distribution:** Android (Google Play) primary, iOS later. Public web at `coldfile.app`.
**Stack:**
- **Mobile (Play Store / App Store):** Expo (React Native) + Supabase JS + Mapbox native + Expo Notifications (FCM) + EAS Build *(BarkPark Mobile shape)*
- **Web (`coldfile.app`):** Next.js App Router — marketing site + read-only case viewer + shareable case URLs for SEO and press
- **Backend (shared):** Supabase (Postgres 15 + PostGIS + RLS) + Supabase Edge Functions (Deno) + Mapbox geocoding
- **Payments:** Google Play Billing (mobile premium) + Stripe (web premium)

**Architecture rule:** Two thin frontends, one Supabase backend. All reads must be callable from a bare Supabase JS client — Postgres functions or RLS-gated table reads, never Next.js route handlers. The only valid Next.js route handlers are Stripe webhooks, admin moderation UI, and OG-image / sitemap generation. Everything else lives in Postgres or in an Edge Function so the mobile app and the web app share the same data contract with zero divergence.

## Layout

```
coldfile/
├── app/                          Next.js App Router (UI, API routes)
├── data/
│   └── agencies/                 Per-metro agency JSON. Loaded via npm run load:agencies.
├── mobile/                       Expo (React Native) app — Play Store / App Store target. See mobile/README.md.
├── docs/
│   ├── 00_DECISIONS.md           Architecture decision log
│   ├── 01_DATA_SOURCES.md        Tiered source strategy + state-by-state matrix
│   ├── 02_SCRAPER_ARCHITECTURE.md Config-driven scraper, dedupe, trust merge, cron
│   ├── 04_DESIGN_SYSTEM.md       Locked v1 design tokens, typography, pin system, clustering
│   ├── 05_TIP_ROUTING.md         Per-agency tip-routing verification log + research checklist
│   └── 07_ABUSE_SIGNALS.md       Stub — schema columns we collect, alerting we will wire post-launch
├── migrations/
│   └── 01_schema.sql             PostGIS schema, RLS, RPCs (drop-in for Supabase)
├── scripts/
│   └── scrape-cli.ts             Local dryrun + run CLI
├── sources/                      One file per source — config-driven
├── supabase/functions/
│   ├── ingest-source/            Single runner. Takes ?source=namus
│   ├── ingest-tick/              Cron entrypoint
│   ├── geocode-pending/          Geocodes cases that came in without coords
│   ├── photo-cache/              Downloads media to Supabase Storage
│   ├── dedupe-resolver/          Background dedupe re-checker
│   └── _shared/                  Shared utilities (fetcher, extractor, dedupe, ...)
└── types/                        Shared TypeScript types
```

## Strategy in one screen

1. **Federal-first ingestion.** Four national sources (Charley Project, Doe Network — missing, Doe Network — unidentified, Project: Cold Case) cover the corpus across all 50 states. NamUs is wired into the pipeline but dormant pending API access (see `sources/namus.ts` for the wake-up procedure).
2. **State-level scrapers only for the four strong states.** FL, NJ, OR, TX.
3. **Agency-direct for the launch metro.** LA County: LAPD per-bureau pages + LASD homicide blog + LA Crime Stoppers P3 as default tip route.
4. **Dedupe is the moat.** A single `cases` row backed by N `case_sources`. Trust-weighted field merge handles conflicts.
5. **Tip routing, not tip ownership.** All tips go directly to the agency's existing public infrastructure.

## Build sequence (six weeks to LA County beta)

- **Week 1:** Schema + shared utilities (fetcher, extractor, dedupe) ← *you are here*
- **Week 2:** Charley Project, Doe Network, Project: Cold Case scrapers
- **Week 3:** NamUs + photo cache + geocode + spatial RPCs
- **Week 4:** LAPD + LASD scrapers + tip-routing
- **Week 5:** Expo mobile app — list + map + case detail screens, Mapbox native, Expo Notifications. Next.js web — marketing + shareable case URLs.
- **Week 6:** Privacy/Terms/Takedown + launch — TestFlight-equivalent (Internal Testing on Play Console) → Play Store closed track → public

## Local dev

```bash
# Install deps
npm install

# Apply schema to local Supabase
supabase start
supabase db reset

# Dry-run a scraper (no DB writes)
npm run scrape:dryrun -- --source=charley_project --limit=5

# Run for real against the local DB
npm run scrape -- --source=charley_project --limit=50

# Run all sources whose next_run_at is due
npm run scrape:tick
```

## Decisions still open

1. **Domain.** `coldfile.app` vs `thecoldfile.com` vs `coldfile.io` — trademark check first.
2. **LLC structure.** Under Matte Black Dev LLC or a separate sensitive-content vehicle.
3. **NamUs posture.** Email `namus@unt.edu` before any production-volume scraping to ask about an aggregator/research agreement.
4. **First metro press partner.** LA Times Metro desk has covered this exact gap.
