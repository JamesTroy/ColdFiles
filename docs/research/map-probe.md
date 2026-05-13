# Murder Accountability Project (MAP) Probe — Phase 2.1

Reconnaissance for the highest-leverage candidate in the roadmap's Phase 2 data expansion. Result: **route to Phase 3 (pattern/serial view), not Phase 2 per-case ingest.** The structural mismatch is decisive — the rest of this doc is the evidence trail so the routing decision doesn't get re-litigated and so Phase 3 work starts from a known map of the dataset.

Probed: 2026-05-12. Re-probe annually or when MAP redesigns the site.

---

## What MAP is

Nonprofit founded 2015 by Thomas K. Hargrove (former Scripps Howard journalist). Aggregates FBI homicide data plus tens of thousands of FOIA-acquired records the FBI never published. Distributes the assembled dataset publicly. Sources:

- [murderdata.org](https://www.murderdata.org/) — landing
- [murderdata.org/p/data-docs.html](https://www.murderdata.org/p/data-docs.html) — dataset index
- [murderdata.org/p/how-to.html](https://www.murderdata.org/p/how-to.html) — usage briefing
- Wikipedia: [Murder Accountability Project](https://en.wikipedia.org/wiki/Murder_Accountability_Project)
- 2026-05 FBI lawsuit win: [murderdata.org/2026/05/fbi-now-reports-homicides-following.html](https://www.murderdata.org/2026/05/fbi-now-reports-homicides-following.html)

## Datasets available (probed 2026-05-12)

Hosted on Dropbox (raw links may rotate; the index page at `/p/data-docs.html` is the durable entry point).

| Dataset | Coverage | Formats | Notes |
|---|---|---|---|
| **UCR Aggregate** | 1965 → present (last update 2026-03-22) | SPSS `.sav`, CSV | All homicides + clearances at agency-month-state level. Aggregate counts, not per-case rows. |
| **MAP SHR Case-Level** | 1976 → present | SPSS `.sav`, CSV | 31 variables per case. **~39,000 cases are FOIA-acquired and NOT in the official FBI release.** Updated 2026-03-22. |
| **Original FBI SHR** | 1976 → present | ZIP (137 MB) | Reference copy of the official files, no FOIA additions. |
| **Original FBI Return A** | 1960 → present | ZIP (6.8 GB) | Full historical homicide-summary archive. |
| **Data dictionary** | SHR fields | PDF | `MAPdefinitionsSHR.pdf` — Dropbox-hosted; not WebFetch-readable, operator must download. |

License / attribution / redistribution: **unspecified.** The page provides no license terms and no redistribution restrictions. The data itself is FBI-originated (public record) plus FOIA-acquired records (also public record once released). Operator should email `hargrove@murderdata.org` before any production use to confirm attribution preferences and any unwritten norms — friendly outreach is the right move regardless of legal posture.

---

## Why this isn't a per-case ingest source

Three structural facts make MAP unsuitable for the per-case ingest path (Charley / Doe / Project: Cold Case style):

### 1. No victim names

> "Victim names are not reported to the SHR, requiring supplementary research to confirm specific cases."
> — [How To Use](https://www.murderdata.org/p/how-to.html)

The SHR codes victim demographics (age, race, sex, ethnicity) but not the victim's name. Our existing case rows are name-keyed for dedupe, slug, share copy, photo attribution, and editorial framing. A nameless ingest can't produce the surface The Cold File is built around. Compare: Charley Project's defining feature is a victim's name and photo; MAP's defining feature is a 31-field row that says "homicide of a 27-year-old white male in Allegheny County, January 1982, firearm, unsolved."

### 2. No stable per-case ID

The MAP / SHR record doesn't carry a per-case primary key that survives across reloads. Available "fingerprint" columns are agency (ORI), month, year, victim demographics, weapon, circumstance. That's enough to dedupe at aggregate granularity but not enough to track a specific case through the row's lifecycle the way our `source_external_id` model assumes.

### 3. ~39,000 records are FOIA-only, sitting alongside the FBI public set

If we ingested only the FBI-published subset we'd miss the most editorially distinctive material; if we ingested the FOIA superset we'd be redistributing FOIA-acquired records sourced by MAP, which sharpens the case for an explicit attribution / permission conversation before going live.

---

## Why this IS the right source for Phase 3 (pattern/serial view)

Phase 3 of [docs/12_ROADMAP.md](../12_ROADMAP.md) calls for a read-only geographic + MO pattern view, strict aggregate-only with no POI/suspect naming. MAP's SHR is _designed_ for exactly that read:

- Geography (state, agency, county derivable from agency ORI)
- Time (month, year)
- Victim demographics (age, race, sex, ethnicity)
- Weapon
- Circumstance (relationship of victim-to-offender when known)
- Clearance status (the "this case is unsolved" signal)

That's the slice the briefing called out — "MAP's killer feature is letting you slice by MO + geography to spot potential serial offenders. A consumer-grade version (read-only, no naming of POIs) is editorially rich and shareable." The probe confirms that framing is correct AND that the per-case-ingest framing is wrong. Same dataset, different consumer.

---

## What Phase 3 needs from this probe

When Phase 3 work starts, this checklist is the entry point. **Do not start it until Phase 1.3 has shipped + been smoke-tested in prod** (per roadmap dependency).

- [ ] Download `SHR76_24a.csv` and `MAPdefinitionsSHR.pdf` to a working dir under `data/research/map/` (gitignored — operator's machine only).
- [ ] Decode the 31 SHR columns; pin the column names + types in this doc.
- [ ] Aggregate by (state, year, victim_age_bucket, victim_sex, weapon, circumstance) — confirm the aggregate row counts are large enough per bucket to display without re-identifying individuals.
- [ ] Decide presentation: heatmap (geography × time), small-multiple grid (weapon × decade), or both.
- [ ] Decide ingest cadence: snapshot-on-MAP-update (annual or quarterly) vs CSV-pull-on-demand. Given the dataset's update cadence (annual-ish per the last-update dates), one-shot snapshots stored as a static asset are likely correct.
- [ ] Decide storage: new aggregate table (e.g. `map_homicide_aggregates` with the bucketed counts) — NOT inserts into `cases`. Keeps the per-case model clean and makes the "pattern view = different table" boundary explicit.
- [ ] Email `hargrove@murderdata.org` before publishing. Brief Cold File, mention the intended pattern view, ask for attribution preference. The norm in this space is grateful nonprofits + attribution-with-link.
- [ ] Editorial review of 5 sample buckets: do they read as "what happened in this region" (dignified) or "look at this serial killer" (anti-fit)? See `feedback_community_features_guardrail`.

---

## Routing recommendation (locked-in)

- **Phase 2.1 per-case ingest:** Not MAP. Strike from the Phase 2.1 candidate list.
- **Phase 2 next candidate:** ViCAP probe (per the roadmap's existing 2.2 entry), then state DBs / NARA. ViCAP has the same aggregate-only constraint as MAP and might also route to Phase 3 — worth probing before committing to it as per-case either.
- **Phase 3 pattern view:** MAP is the primary data source. ViCAP could supplement once probed.

---

## What this probe is NOT

Not an editorial decision on whether to build the pattern view at all. The roadmap already says Phase 3 is blocked on Phase 2 — the routing call here just says "when Phase 3 unblocks, this is the dataset." If we decide to defer Phase 3 indefinitely, MAP's data simply doesn't get used. No code was written; no migrations were added; no extractor scaffolding exists. The probe is its own deliverable.
