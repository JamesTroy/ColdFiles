# MAP (Murder Accountability Project) — Integration Plan

**Status:** Scoping draft, no code yet
**Author:** Claude (research pass)
**Date:** 2026-05-11
**Owner:** Matte Black Dev LLC

This document scopes an integration of Tom Hargrove's Murder Accountability
Project (MAP) dataset into ColdFiles. The plan is research-only — no
schemas, code, or migrations have been written. The conclusion is that
MAP is **not a case-feed source** in the sense the existing source
extractors (NamUs, Charley, Doe, PCC) are; it is a parallel
**aggregate corpus** that belongs in its own table and its own UI
surface. Detail follows.

The existing `docs/01_DATA_SOURCES.md` already calls this out at L81:

> Murder Accountability Project (MAP) — Statistical dataset of US
> homicides 1965–present from FBI Uniform Crime Report SHR data.
> Aggregate, not case-level — useful as a denominator / context layer
> ("X unsolved in this county since 1980") rather than a case feed.

This plan agrees with that prior scoping call, with one refinement:
MAP's SHR is technically **row-per-victim** (case-level in shape), but
it is **anonymous** case-level (no victim names, no street address,
no exact date) — so it cannot populate the existing `cases` table
without breaking the identity-grain of every other source. The right
home is a separate table.

---

## 1. What MAP actually distributes

### Files

Source: `https://www.murderdata.org/p/data-docs.html` (probed 2026-05-11).
Last refresh date on the page: 2026-03-22.

| File | Format | Granularity | Volume | Source |
|---|---|---|---|---|
| **MAP Supplementary Homicide Report (SHR)** 1976–present | SPSS `.sav` + CSV (Dropbox) | Row per victim | ~800k FBI rows + ~39k FOIA-augmented rows MAP added that the FBI never reported | FBI SHR submissions + MAP FOIA suits against state agencies |
| MAP Uniform Crime Report (UCR) 1965–present | SPSS `.sav` + CSV | Agency-month aggregates | Counts only (homicides committed, homicides cleared) | FBI UCR |
| FBI master "Return A" UCR | ZIP, 6.8 GB | Agency-month aggregates | Same as above, raw FBI form | FBI |
| FBI original SHR | ZIP, 137 MB | Row per victim | FBI's own records (no FOIA additions) | FBI |
| Data dictionary | PDF | — | — | `https://www.dropbox.com/s/lo6tgo8nnbpqeru/MAPdefinitionsSHR.pdf?dl=1` |

**Distribution mechanism:** static Dropbox download links. No REST API.
No webhook. No incremental delta feed. Each "release" is a full
re-download.

**Update cadence:** ad-hoc; the page footer shows it was refreshed
2026-03-22 from a presumed prior release earlier that year or in 2025.
Treat as **annual, with off-cycle releases when MAP wins a FOIA suit**.
Monitor by checking the last-modified timestamp on the Dropbox links
or by polling the page text for the "Last update" string.

### SHR columns (the 31 variables)

Sourced from `https://www.murderdata.org/p/how-to.html` and
`https://ucrbook.com/shr.html`. The exact field list is in the
`MAPdefinitionsSHR.pdf` data dictionary (verify before implementation).
What's documented externally:

**Agency / geography (5):**
- `ORI` — FBI alphanumeric agency identifier
- `Agency` — agency name
- `State`
- `Region` — FBI census region code
- `Agentype` — agency type (city PD, county sheriff, state police…)
- `Population` — agency-served population

**Time (2):**
- `Year`
- `Month` (1–12 — **no day**)

**Incident (up to 11 victims, up to 11 offenders):**
- `VicAge`, `VicSex`, `VicRace`, `VicEthnic` — per-victim demographics
- `OffAge`, `OffSex`, `OffRace`, `OffEthnic` — per-offender demographics
  (where reported — `Age=999` is the "unknown" sentinel)
- `Weapon` — 1 of 19 codes (handgun, knife, "firearm type not stated", etc.)
- `Relationship` — victim → offender relation (1 of 29 codes)
- `Circumstance` — 1 of 33 codes (felony murder, argument, justifiable, …)
- `Subcircumstance` — only populated for justifiable homicides
- `VicCount`, `OffCount` — total victims / offenders in the incident

**MAP-augmented (in MAP's CSV, NOT in raw FBI SHR):**
- `Solved` — Y/N flag MAP derives from offender info. **Raw FBI SHR has
  no clearance variable; MAP computes it.** This is one of MAP's two
  killer features (the other being the FOIA-additional rows). Confirm
  the exact derivation rule with hargrove@murderdata.org or the data
  dictionary — likely "offender demographics present and non-sentinel."
- `Source` — likely flags FBI-reported vs. FOIA-obtained.

### What is **not** in SHR

- **No victim name.** SHR is statistical; per MAP's "How To" page,
  "victims' names are not reported to the SHR."
- **No address.** Geographic granularity is the agency (ORI). For most
  cities the ORI = the city PD; for unincorporated areas it = the county
  sheriff. There is no street, no neighborhood, no lat/lng.
- **No exact date.** Month-and-year only.
- **No NCIC number, no NamUs number, no agency case number.**
- **No narrative.**
- **No photos.**
- **No tip routing info.**
- **No "did the FBI/agency later update this record" trail** — arrests
  made after the SHR row was filed are rarely reported back, per the
  documentation.

This is the central fact that determines everything else in this plan.

### License posture

Source: `https://www.murderdata.org/p/data-docs.html` footer.

> Copyright 2019 by Murder Accountability Project.

**No explicit license terms, no Creative Commons, no redistribution
clause, no commercial-use clause.** Contact is `hargrove@murderdata.org`.

Two competing legal facts:

1. **The underlying SHR is FBI government-work** — 17 U.S.C. § 105
   puts US-federal-government works in the public domain. Anyone can
   re-distribute the FBI's own SHR submissions.
2. **MAP's added value (the FOIA-augmented rows + the derived `Solved`
   flag + the cleaning passes) is MAP's own work product.** The
   copyright notice plausibly covers that.

The practical posture: before ingesting MAP's CSV directly, send Tom
Hargrove an email — single paragraph, what we are, what we'd surface,
attribution we'd display. MAP's mission is "make this data visible";
historical precedent (the IRE tipsheet, the Wikipedia article, the R
package `murderdata`) suggests they license freely with attribution.
The cost of a 24-hour email exchange is nil; the cost of a cease-and-
desist 6 months in is high.

If the email response is permissive, attribute prominently. If we want
to skip the email entirely, we can technically ingest the raw FBI SHR
(public domain) and forgo MAP's FOIA additions + `Solved` derivation —
but that throws away the two things that make MAP differentiating, so
this is not the recommended path.

---

## 2. Schema comparison — MAP SHR vs. ColdFiles `cases`

ColdFiles `cases` (per `migrations/01_schema.sql:143`) is **identity-rich
and tip-routable**:

- `victim_name`, `victim_first_name`, `victim_last_name` (NOT NULL for
  named cases; null only for Doe-type unidentifieds)
- `slug` — unique, human-readable, derived from name + place + year
- `incident_date` (DATE, exact)
- `location_point` (PostGIS geography Point) — used by **every** map RPC
  (`cases_in_bbox`, `cases_within_radius`, `cases_grid_in_bbox`, …)
- `primary_agency_id` → `agencies` (FK)
- `tip_phone`, `tip_url`, `tip_route_kind` — for the "Submit a Tip"
  button
- `narrative`, `narrative_short` — required for the case-detail UI

The extractor pipeline lands data here via `CaseRecord`
(`supabase/functions/_shared/types.ts:74`) — the canonical record shape
every source produces. Dedupe runs on
`{ namus_number, ncic_number, name_state_year, lastname_age_sex,
agency_case_number }` (per `dedupe.ts:11`). All five keys require a
victim name or an agency case number, **both of which MAP lacks**.

### Field-by-field mapping

Legend: ✅ direct, ⚠️ degraded fit, ❌ no fit.

| ColdFiles `cases` column | MAP SHR | Fit |
|---|---|---|
| `victim_name`, `victim_first_name`, `victim_last_name` | — (anonymized) | ❌ NULL forever |
| `slug` | — | ⚠️ must be synthetic, e.g. `shr-{ORI}-{year}-{month}-{rownum}` |
| `victim_age` | `VicAge` | ✅ |
| `victim_sex` | `VicSex` | ✅ |
| `victim_race` | `VicRace` | ✅ |
| `victim_ethnicity` | `VicEthnic` | ✅ |
| `victim_height_cm`, `victim_weight_kg` | — | ❌ |
| `incident_date` | `Year`, `Month` | ⚠️ month-only; have to set to `YYYY-MM-01` with `incident_date_quality = 'approximate'` |
| `location_text` | — | ❌ no specific location |
| `location_city`, `location_county`, `location_state` | derive from ORI lookup | ⚠️ requires ORI→jurisdiction mapping |
| `location_point` | derive from ORI agency centroid | ❌ critical — see Section 4 |
| `location_precision` | always `'city'` or worse | ⚠️ |
| `kind` | always `'homicide'` | ✅ |
| `status` | from MAP `Solved` flag | ⚠️ `Solved=N` → `'open'`; `Solved=Y` → `'cleared_arrest'` (probably) — but no per-case nuance |
| `narrative`, `narrative_short` | — | ❌ |
| `primary_agency_id` | match `ORI` against new `agencies.ori` column | ⚠️ requires schema add OR a lookup table |
| `case_number_primary`, `ncic_number`, `namus_number` | — | ❌ |
| `reward_amount_usd`, `tip_phone`, `tip_url` | — | ❌ no tip target — case is 1976–present, often 30–50 years old; the original detective may be dead |
| `has_photo`, `has_sketch`, `has_reconstruction` | — | ❌ always false |

**Result:** ~6 of the ~40 substantive `cases` columns get populated.
Most user-facing UI on a case-detail screen would show "—" or
"unknown".

### Dedupe key collision

`generateDedupeKeys` in `dedupe.ts:11` would produce **zero keys** for
a typical MAP row:

- `namus_number` — null
- `ncic_number` — null
- `name_state_year` — requires `victim_first_name + victim_last_name`,
  both null
- `lastname_age_sex` — requires `victim_last_name`, null
- `agency_case_number` — requires `case_number_primary`, null

A MAP-derived `CaseRecord` therefore could not match against any
existing ColdFiles case (Charley, NamUs, PCC, Doe). Every MAP row
would land as a new case **even if** the same incident is already in
the corpus from another source. That's not a bug to fix — it's a
direct consequence of SHR's anonymized design. No regex, no
fuzzy-match, no clever join recovers an identity that was never
recorded.

Two practical implications:

1. **Cannot dedupe MAP against existing cases.** A famous case in
   Charley (with name) and the same incident in MAP (anonymized) are
   structurally invisible to each other.
2. **Within MAP, every row is its own incident.** SHR is filed per
   victim per incident at the time of the report. Multi-victim
   incidents already appear as multiple rows. Re-ingestion of the
   next annual MAP release would re-emit every row — there's no
   stable per-row external ID (the closest is `ORI + year + month +
   victim ordinal`, which is **not** a documented MAP key and may
   shift across releases as MAP cleans data). Confirm with Hargrove.

This is the second hard structural problem in the integration. The
first is geographic granularity (Section 4).

---

## 3. Proposed ingestion architecture

### Recommendation: separate table, separate RPC, separate UI surface

Do **not** route MAP through `persistRecord` and the `cases` table.
The persist path enforces an identity-rich grain (slug, name, agency,
tip routing, photo policy) that MAP cannot satisfy. Fighting that
mismatch in-band would either bloat `cases` with millions of mostly-
empty rows (breaking `cases_in_bbox` performance — see Section 4) or
require a parallel "anonymized cases" flag that complicates every
existing RPC and UI surface.

Concrete shape (sketched, not finalized — that's the next deliverable
when this plan is approved):

#### New table `homicide_aggregates`

```
homicide_aggregates
├── id                  uuid PK
├── source_release      text       — e.g. 'map_shr_2026_03'  (which MAP release this row came from)
├── shr_row_key         text       — synthetic key: ORI||year||month||victim_ordinal
├── ori                 text       — FBI agency identifier
├── agency_name         text
├── state               char(2)
├── county              text       — from ORI lookup, nullable
├── city                text       — from ORI lookup, nullable
├── year                smallint
├── month               smallint
├── vic_age             smallint
├── vic_sex             text
├── vic_race            text
├── vic_ethnicity       text
├── off_age             smallint   — null if unknown / age=999
├── off_sex             text
├── off_race            text
├── off_ethnicity       text
├── weapon              text
├── relationship        text
├── circumstance        text
├── subcircumstance     text
├── vic_count           smallint
├── off_count           smallint
├── solved              boolean    — MAP-derived flag
├── source_flag         text       — 'fbi_reported' | 'foia_obtained'
├── location_point      geography(Point, 4326)  — agency centroid, NOT incident location
├── location_precision  text       — always 'city' or 'county'
├── ingested_at         timestamptz
└── UNIQUE (source_release, shr_row_key)
```

Key choices to call out:

- **`source_release` in the primary uniqueness key.** Every annual
  re-ingest gets a new `source_release` value (`map_shr_2026_03`,
  `map_shr_2027_xx`). We keep the prior release as historical truth
  and don't try to incrementally update — the cost is 2× storage,
  the upside is a clean diff between releases (which is itself a
  feature: "what did the 2027 FOIA add?"). When MAP corrects an old
  row in a future release, the new row sits alongside the old; a
  `current_release_id` view selects the latest. This is the same
  pattern `case_sources` uses (immutable raw_payload + payload_hash).
- **`location_point` is an agency centroid, not an incident point.**
  Computed once at ETL time from an ORI → coordinate lookup table.
  See Section 4 — this is the central honesty problem.
- **No `case_id` foreign key to `cases`.** MAP rows are not cases in
  the ColdFiles sense. They're aggregate evidence.

#### New lookup `agencies_ori`

A mapping `ORI → { agency_name, city, county, state, centroid_lat,
centroid_lng }`. Populated once from one of:

1. FBI's published ORI directory (downloadable from the FBI's Crime
   Data Explorer).
2. The MAP CSV itself, which already contains ORI + agency name + state.
   The centroid is the hard part — typically each agency's HQ
   coordinate or the city's population-weighted centroid.

This is its own ~20k-row table and can be wired to the existing
`agencies` table by ORI when ColdFiles eventually adds an `ori`
column there (separate, opt-in migration).

#### New RPCs

These are **aggregate-shaped**, not list-shaped:

- `homicide_counts_in_polygon(polygon, year_range, filters)` — total
  count, solved/unsolved split, optionally grouped by year /
  weapon / circumstance.
- `homicide_density_for_bbox(bbox, year_range)` — for a heatmap
  layer. Returns hex bins or county-level counts, not point rows.
- `homicide_context_for_case(case_id)` — given an existing case,
  pull the SHR baseline for the same county + the surrounding ±5
  years. The denominator widget. **This is the most product-
  differentiated of the three.**

#### Ingestion worker — where transformation runs

Three options, in increasing operational weight:

| Option | Where | Pros | Cons |
|---|---|---|---|
| **A. Local CLI one-shot, like `scrape-cli`** | Existing TS CLI under `tools/` or `sources/`, writing direct to Supabase | Reuses existing PoliteFetcher/persist plumbing, runs from a laptop, easy to iterate | Operator-driven; no scheduled refresh; ~800k-row INSERT from a laptop is slow over Supabase REST |
| **B. Supabase Edge Function** | New `supabase/functions/ingest-map/` | Fits the existing Edge runtime pattern (`ingest-source`, `ingest-tick`) | 50MB+ CSV download in a 6-min Edge timeout is impractical; would require chunked-S3-staging |
| **C. Postgres `COPY FROM STDIN`** via a one-shot Node script | Direct Postgres connection (not PostgREST), bulk COPY into `homicide_aggregates_staging` then INSERT...SELECT into main | Fast (seconds for 800k rows). The right shape for a once-a-year operation. | Requires service-role direct Postgres credentials, not used by any other ingest path today |

**Recommended: Option C** for the once-a-year bulk drop, with a small
TS preflight that re-downloads the CSV, sha256s it against the
prior release, and short-circuits if unchanged. The "scheduled
refresh" doesn't have to live in Edge / cron — it's an annual operator
action with a one-line script. We log it the same way migrations are
logged (the migration log is the source of truth for "what state is
the DB in").

#### Namespacing

`homicide_aggregates` lives entirely separately from `cases`. Three
small UI rules keep the line clear:

- MAP-derived counts never appear in `cases_in_bbox` or the map's pin
  layer.
- The case-detail "Context" band (proposed new section) is the **only**
  place a user encounters MAP data directly attached to a ColdFiles
  case.
- A standalone "Statistics" view (Premium-gated candidate) is the
  other place MAP data lives — county / state-level browsing,
  filtering by demographics and weapon and decade.

This is exactly the OpenRecord pattern (`docs/01_DATA_SOURCES.md` L13):
multiple authoritative sources backing one identity surface for
identified cases, plus a separate aggregate surface where identity
doesn't exist.

---

## 4. Hard problems, called out specifically

### 4a. Geocoding — MAP gives agency, ColdFiles needs lat/lng

**The single biggest fit problem.** ColdFiles' map UI is built on
point pins. `cases_in_bbox` returns `(lat, lng)` from
`location_point`. The new `cases_grid_in_bbox` (mig 44) tile-grid
aggregator also depends on point input.

MAP gives us agency. Most ORIs map to a city PD (Los Angeles Police
Department, ORI `CA0194200`). A naive "agency centroid = LAPD HQ at
100 W 1st St, LA" pin would dump every LAPD-jurisdiction homicide
on one downtown coordinate. The 2026-05-10 incident (mig 42)
documents what that looks like — coincident-coordinate stacking
makes pins illegible. For LASD or a county sheriff covering 4,000 sq
mi, the centroid is even less honest.

**Three honest approaches, none perfect:**

1. **Jitter to the agency's jurisdiction polygon.** Use
   `ST_GeneratePoints(agencies.jurisdiction_geom, n)` and assign one
   to each row. Mathematically random within the boundary, never
   honest about the actual incident location. Acceptable for a heatmap
   layer; misleading for a pin layer.
2. **Aggregate at low zoom, suppress at high zoom.** Show MAP data
   only via a county-shaded choropleth + hex-bin heatmap. Never as
   individual pins. The user sees "47 unsolved homicides in this
   county since 1980," never a clickable victim-less pin. This is
   the *most honest* and aligns with the amber-palette / shape-first
   ethical posture (memory:
   `feedback_amber_is_ethical_posture.md`).
3. **Don't put MAP on the map at all.** Keep MAP entirely in the
   case-detail "Context" band and a separate "Statistics" view.
   Map remains identified-cases-only. This is the **most conservative
   first pass** and the recommended MVP.

The recommendation: **start with (3), evolve to (2) only after
operator-confirming the choropleth doesn't read as
"a pin for every incident."** Skip (1) entirely — pin-jitter is a
trust hit waiting to happen and contradicts the
`feedback_amber_is_ethical_posture.md` directive on what the visual
vocabulary should signal.

### 4b. Privacy and attribution

- **The data itself is already anonymized.** SHR drops names by design.
  No PII concerns about ingest. This is the easy case.
- **MAP's licensing posture is informal.** The site has no explicit
  redistribution clause. Email Hargrove before launch — see Section 1.
- **Attribution on every surface that touches MAP data.** Two lines
  visible on the case-detail Context band, the Statistics view, and
  any aggregate display: "Source: Murder Accountability Project,
  derived from FBI Supplementary Homicide Report data and FOIA
  records. murderdata.org" + linked back. This matches the existing
  `sources.attribution_html` pattern for every other ingest source.
- **The FOIA-obtained rows are higher-stakes than the FBI rows.** MAP
  obtained them precisely because the originating agency *didn't*
  report them voluntarily. Family members of those victims may not
  know the case is publicly indexed. The aggregate-only surface
  (no names, no addresses, no photos) limits the harm surface
  significantly; we are not adding identifying information they
  didn't already release. But it's worth flagging in `11_LEGAL_COPY_POLICY.md`.
- **Takedown SLA still applies** — see `docs/01_DATA_SOURCES.md` L204.
  Any complaint about a specific aggregate row (rare, given the
  anonymization) routes through the same `takedown_requests` flow.

### 4c. The "unreported to DOJ" subset

This is **the most editorially interesting** part of MAP, per the
project mission ("homicides police failed to report"). ~22,000 rows
in the FOIA-augmented set (one of the IRE tipsheet figures cites
~39,000; the user prompt cites 22,000 — confirm the current count
in the 2026-03-22 CSV).

Three product framings, increasing editorial weight:

1. **Hide the distinction.** All MAP rows get the same treatment in
   the UI. Simpler. Throws away the differentiator.
2. **Flag in the Context band.** "12 of the 47 unsolved homicides in
   this county between 1980–2024 were obtained by MAP via FOIA
   suits, not reported to the FBI by the originating agency." This
   surfaces the MAP mission honestly.
3. **A dedicated "Hidden Homicides" view.** A list view of the
   FOIA-only rows by state / decade, with a piece of explainer copy.
   This is editorial — MAP's mission is exactly to make these visible.
   Highest engagement potential, most editorially aligned with the
   ColdFiles tone, also the most stick-out feature.

The recommendation: **(2) for the v1 launch, (3) as the Phase 4
editorial expansion.** (2) is a small UI addition on existing
surfaces; (3) is its own screen and merits its own RFC.

### 4d. Performance impact on `cases_in_bbox`

**Zero impact under the recommended architecture** (separate table).
`cases_in_bbox` queries only `cases` — MAP rows never touch it.

If someone proposes merging MAP into `cases` (don't), the impact
would be severe:

- Today: ~6,547 visible cases (per the migration-42 audit) →
  `cases_in_bbox(USA bbox, limit=500)` returns 500 rows.
- After MAP: ~6,547 + 800,000 = ~806,500 rows in `cases`. The bbox
  GiST index still narrows the candidate set fast, but the
  `result_limit=500` cap becomes meaningless at low zoom — 500
  pins out of ~800k is 0.06% of the corpus. Every pin is a die roll.
  The state-skew problem migration 42 fixed (`ORDER BY id` + UUIDv4
  → uniform random distribution) would still hold, but the
  *editorial* problem returns in a different shape: pre-2000 data
  drowns out the post-2020 active investigations the user actually
  wants to see.
- The current `cases_grid_in_bbox` tile aggregator (mig 44) would
  also degrade; it counts every row passing the bbox predicate, and
  a 100× row-count multiplier on the input is a 100× cost
  multiplier on the count query at every viewport refresh.

In short: **putting MAP in `cases` is the wrong shape and breaks the
map.** Don't.

`homicide_aggregates` queries from the new RPCs are a different cost
profile — count-shaped, not list-shaped, served from county-level
or hex-bin aggregations that pre-aggregate. They don't compete with
`cases_in_bbox` for the same indexes.

### 4e. ORI → coordinate lookup is non-trivial

Two practical sub-problems:

- **ORI churn.** Agencies merge, dissolve, re-form. An ORI from a
  1985 row may be an agency that no longer exists in the FBI's 2025
  ORI directory. The MAP CSV is the source of truth for the agency's
  *historical* state name + state — but the geocoordinate has to
  come from somewhere.
- **Bbox-validation precedent.** The geocode-state-validation flow
  (`supabase/functions/_shared/geocode-state-validation.ts`, memory:
  `feedback_geocoder_ambiguous_queries.md`) already exists for
  ambiguous Mapbox returns. The same pattern applies here: for each
  agency, geocode `<agency_name>, <city>, <state>`, bbox-validate
  the result against the state polygon, fall back to the state
  centroid on failure, log the failures in a one-shot ETL audit so
  we can hand-correct the long tail.

Expected hit rate from prior geocode work on this codebase: ~90%
clean hits, ~7% need a proximity= bias retry, ~3% fall back to
state-centroid. The 3% are the rural / merged-agency tail and they
hit the `location_precision='state'` filter which `cases_in_bbox`
already drops (mig 42 L124). For the separate `homicide_aggregates`
table the rule is the same: don't render state-precision points
on the map; surface them only in count-shaped queries.

### 4f. SHR multi-victim rows + the `shr_row_key`

A multi-victim incident appears as multiple rows in SHR (one per
victim, sharing `ORI + Year + Month + Incident#`). The MAP CSV may
or may not expose `Incident#` as a column — confirm in the data
dictionary. If it does, `shr_row_key = ORI||year||month||incident||victim_ord`.
If it doesn't, the only stable composite is `ORI||year||month||row_num`
which is **release-dependent** (re-ordering between MAP releases
shifts row_num).

The mitigation is the same as the `source_release` design: keep
each release as immutable history; don't try to track row identity
across releases. The user-facing query layer doesn't need cross-
release tracking — it queries the latest release's snapshot.

---

## 5. Phased rollout

Five phases. Each phase delivers something user-visible (or
operator-visible) and is independently shippable.

### Phase 0 — Legal + sample inspection (1–2 days)

- Email Hargrove (`hargrove@murderdata.org`): one paragraph, project
  context, attribution we'd display, ask about redistribution and
  re-distribution-of-derivatives posture.
- Download the latest MAP SHR CSV (`https://www.murderdata.org/p/data-docs.html`)
  + the `MAPdefinitionsSHR.pdf` data dictionary.
- Spot-check: 100-row sample, every column populated check, exact
  column names, presence of `Solved` flag, presence of `Source`
  flag, presence of `Incident#`. Update Sections 1 + 2 of this doc
  with whatever the actual CSV header reveals.
- Decide go/no-go.

**Output:** an updated version of this plan, with confirmed column
list and licensing posture; or a no-go memo.

### Phase 1 — Schema + ETL for one state (1 week)

- Migration: `homicide_aggregates` table + `agencies_ori` lookup.
  Schema as sketched in Section 3.
- ETL script: Node CLI, reads MAP CSV, filters to **one state** (suggest
  Louisiana or Montana — small population, manageable row count, and
  underrepresented in the existing case corpus so the addition is
  visible). Resolves ORI → coordinates against the FBI ORI directory.
  `COPY FROM STDIN` into staging, then INSERT...SELECT with the
  geocode joined in.
- One RPC: `homicide_counts_for_state(state, year_range)`. No UI yet.
- Verify with a hand query: "did we get the same total count for LA
  county 2010–2015 that MAP's web search returns?" — sanity-check the
  ingest didn't drop a column or misassign a state.

**Output:** ~20k rows in `homicide_aggregates`, all from one state,
verifiable count against MAP's own search tool. Migration applied,
script checked in. No user-visible change yet.

### Phase 2 — Full SHR ingest + aggregate RPCs (1 week)

- ETL re-runs for all states. ~800k rows total.
- Build the three RPCs: `homicide_counts_in_polygon`,
  `homicide_density_for_bbox`, `homicide_context_for_case`.
- Add an audit pass: for every existing `cases` row, compute the
  `homicide_context_for_case` baseline and confirm the numbers are
  internally consistent (no county returns "0 SHR homicides 1980–2024"
  when we know LA County has thousands).

**Output:** full corpus ingested, RPCs ready. Still no UI.

### Phase 3 — UI: Case-detail Context band (1 week)

- New section on the case-detail screen: "**Context**." Three or four
  rows of plain prose:
  - "47 unsolved homicides in [County] between 1980–2024."
  - "12 of those were not reported to the FBI by the originating
    agency."
  - "[Weapon mix bar — handgun 60%, knife 18%, …]"
  - Attribution line: "Source: Murder Accountability Project."
- Tap → opens a state-level Statistics view (Phase 4 stub).
- Per `feedback_amber_is_ethical_posture.md`: stay in the amber
  palette, Newsreader heading + Inter body. The Context band is
  editorial, not a dashboard — no aggressive vis, no colored
  gauges, no traffic-light "high crime area" affordances. Numbers
  in prose.

**Output:** users see MAP data attached to every existing case where
the county has any SHR rows. This is the **smallest viable user-
visible deliverable** and a defensible "ship MAP integration" line
in release notes.

### Phase 4 — Statistics view + Hidden Homicides editorial (2 weeks)

- Standalone "Statistics" tab or sub-tab: filter SHR by state /
  county / decade / demographics / weapon / circumstance. Renders
  prose summaries + simple histograms; no choropleth in this phase
  (deferred to Phase 5 if it earns its keep).
- "Hidden Homicides" editorial — a curated view of the FOIA-only
  subset, filtered by state, with explainer copy on MAP's mission.
  This is the editorial differentiator and likely the press-release
  artifact when shipped.
- Premium-tier candidate? Open question for the user — Section 6.

**Output:** the full MAP integration is live with both surfaces.

### Phase 5 (optional, post-launch) — Choropleth heatmap (1–2 weeks)

- Add a county-level choropleth on the map as a *toggleable* overlay
  (default off). Tints counties by their SHR unsolved-density per
  100k population. **Aggregate-only**, no pins. Honest about
  granularity. Disabled by default per the conservative posture in
  Section 4a.

---

## 6. Open questions for the user

These need a call before Phase 1 starts.

1. **Premium tier or free?** The Statistics view is a strong premium
   candidate — it's not the core "case finder" loop, it's analytical.
   Argument for free: more press, more goodwill with MAP, more
   "social value" defensibility. Argument for premium: it's a real
   piece of product surface that costs money to build and aligns with
   the Premium subscription's "convenience features for users who
   care" framing (`docs/01_DATA_SOURCES.md` L217). My weak lean is
   **free** — the integration is editorially load-bearing and
   gating it makes ColdFiles look like a different kind of product
   than it is.

2. **Email Hargrove or skip and ingest raw FBI SHR only?** Email is
   the right move. The 24-hour delay is nil cost and we lose the FOIA
   additions + the derived `Solved` flag without MAP — that's 22k+
   rows of data that no one else has and arguably the entire reason
   to do this integration.

3. **Editorial framing of the FOIA-only rows.** Section 4c laid out
   three options ranging from "hide the distinction" to a dedicated
   "Hidden Homicides" view. The recommendation in this plan is
   Phase 3 = subtle flag in the Context band, Phase 4 = dedicated
   editorial view. Confirm or push back.

4. **One-state pilot — which state?** Louisiana, Montana, and New
   Mexico are all underrepresented in the current corpus and small
   enough to spot-check by hand. LA is the launch metro and would
   be the most visually compelling for an internal demo but the
   row count is much bigger (~150k SHR rows). My lean is **Montana**
   — smallest, simplest validation, also gives an honest read on the
   rural / merged-agency geocoding tail.

5. **MAP-only homicide pins on the map, ever?** Section 4a recommends
   "never" for v1, with the option to evolve to a county-shaded
   choropleth in Phase 5. Confirm — or if the editorial direction is
   to surface individual MAP-only homicides as pins (with strong
   precision/honesty UI cues), say so now because it changes Phase 1's
   schema decisions (we'd want `incident_ordinal` as a stable column
   for slug derivation and `cases_in_bbox`-compatible point queries).

6. **Update cadence — is "once a year, when MAP refreshes" enough?**
   MAP refreshes roughly annually plus off-cycle when they win a FOIA
   suit. Polling the data-docs page weekly for a content-hash change
   is trivial; the *re-ingest* itself is the operator-action that
   could be scheduled or kept manual. My lean is **manual**, with a
   weekly check-page-for-changes cron that emails an alert when the
   Dropbox link content-hash shifts. No autopilot bulk-replacement of
   ~800k rows.

7. **Should `agencies` get an `ori` column now, opportunistically?**
   It would let MAP rows soft-link to existing investigating-agency
   rows where the ORI matches (LAPD, LASD, NYPD, etc. all have
   well-known ORIs). This is a small migration (`alter table agencies
   add column ori text` + a one-time backfill from the FBI ORI
   directory). My lean is **yes, in Phase 1**, because it's small
   and unblocks better case-detail Context-band UX.

---

## 7. References

- **Murder Accountability Project — Data & Docs.**
  `https://www.murderdata.org/p/data-docs.html` — file inventory,
  download links, contact info (probed 2026-05-11).
- **Murder Accountability Project — How To Use.**
  `https://www.murderdata.org/p/how-to.html` — column overview,
  geographic granularity, attribution disclaimers (probed 2026-05-11).
- **MAP SHR data dictionary.**
  `https://www.dropbox.com/s/lo6tgo8nnbpqeru/MAPdefinitionsSHR.pdf?dl=1`
  — PDF, not yet inspected by this plan. Required reading before Phase
  1 starts.
- **Decoding FBI Crime Data — Chapter 6 (SHR).**
  `https://ucrbook.com/shr.html` — independent reference for what's
  in raw FBI SHR vs. what MAP adds; confirms there is no `Solved`
  column in raw SHR.
- **Wikipedia — Murder Accountability Project.**
  `https://en.wikipedia.org/wiki/Murder_Accountability_Project` —
  background, FOIA history.
- **IRE tipsheet 5194.**
  `https://www.ire.org/wp-content/uploads/protected-files/tipsheets/5194.pdf`
  — investigative-journalism-flavored summary of MAP's data products.
- **GitHub mirror — bctyner/MurderAccountabilityProject.**
  `https://github.com/bctyner/MurderAccountabilityProject` —
  third-party mirror of a prior MAP SHR release (2014-vintage). Use
  to sanity-check column names if Hargrove email is slow.
- **In-repo prior scoping.**
  `docs/01_DATA_SOURCES.md` L81 — pre-existing one-line MAP scoping
  call that this document expands on.
- **Schema, RPC, and dedupe surface.**
  `migrations/01_schema.sql` (cases, case_sources, case_dedupe_keys),
  `migrations/42_cases_in_bbox_stable_ordering.sql` (current bbox
  RPC + state-skew lesson), `supabase/functions/_shared/types.ts:74`
  (CaseRecord shape), `supabase/functions/_shared/dedupe.ts:11`
  (dedupe key generation).
