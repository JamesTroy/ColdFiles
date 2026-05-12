# NARA Civil Rights Cold Case Records (RG 612) Probe — Phase 2.4

Reconnaissance for the Civil Rights-era cold case records portal. Result: **structurally viable as per-case ingest with a dedicated UI filter; build deferred until the catalog crosses ~300 records.** This is the best of the three Phase 2 probes (MAP, ViCAP, NARA) — the only one with stable per-case IDs AND structured export AND a clean public-domain posture. The block on shipping today is volume, not access shape.

Probed: 2026-05-12. Re-probe quarterly until the catalog crosses the 300-record threshold or NARA publishes a release-cadence commitment.

---

## What this is

The **Civil Rights Cold Case Records Collection Act of 2018** ([S.3191, 115th Congress](https://www.congress.gov/bill/115th-congress/senate-bill/3191)) mandates declassification of federal investigative records related to racially-motivated crimes from **1 January 1940 — 31 December 1979**. Records assemble under [Record Group 612](https://www.archives.gov/findingaid/stat/discovery/612) at NARA. A dedicated public portal launched in 2025:

- **Portal:** [crcca.archives.gov](https://crcca.archives.gov/)
- **Cases index:** [crcca.archives.gov/case](https://crcca.archives.gov/case)
- **Program homepage:** [coldcaserecords.gov](https://www.coldcaserecords.gov/) (Review Board)
- **Contact:** `ColdCaseRecordsCollection@nara.gov`

Total released as of 2026-05-12: **76 case files**. Estimated catalog ceiling per the Review Board FAQ: *"hundreds, perhaps thousands."* Release is rolling — Board notifies next-of-kin before each case goes public, then digitization staff stage to the portal.

---

## Why this is structurally viable (unlike the prior two probes)

| Factor | MAP | ViCAP | **NARA RG 612** |
|---|---|---|---|
| Per-case stable ID | ❌ | ❌ (title slug only) | ✅ **Numeric ID** (`/case/507463400`) |
| Victim names | ❌ | ✅ | ✅ |
| Structured metadata fields | ✅ (31 cols) | partial | ✅ (date, state, location, type, demographics, identifier, restriction status) |
| Machine-readable export | ✅ (CSV/SPSS) | ❌ | ✅ **CSV / JSON / XML built into the portal** |
| Robots-friendly | n/a (Dropbox) | ❌ (fbi.gov 403s) | ✅ |
| License posture | unspecified | unspecified | ✅ Federal works → public domain by default (17 USC §105) |
| Per-case URL probed | n/a | ⚠ slug-derived | ✅ stable |

It's the cleanest target shape we've seen. The portal looks built for exactly this — a third party that wants to consume the records programmatically.

---

## Case-detail probed example

[crcca.archives.gov/case/507463400](https://crcca.archives.gov/case/507463400) — John Rulse, 3 August 1940, Colbert County, Alabama.

Captured fields:
- `name`: "Rulse, John"
- `dates`: "?-1940"
- `incident_date`: "3 August 1940"
- `state`: "Alabama"
- `location`: "Colbert County and Barton, Alabama"
- `type_of_violation`: "Death"
- `incident_identifier`: "CRCCRCA-2024002047"
- `restriction_status`: "Unrestricted"
- `material_type`: "Textual Records"
- 1 linked PDF: `Rulse_Bulse_158260_NARA_Released.pdf` (NARA Object ID 518258331)

**No prose narrative on the case detail page.** The story lives inside the PDF(s) — investigative reports, memorandums, photographs, newspaper clippings, telegrams (per the [About page](https://crcca.archives.gov/about)). Means an extractor would need a PDF-text-extraction path for any narrative content, OR we can ship a metadata-only surface that deep-links the user to the official PDF (preferred — see "Recommended UX" below).

Index filters available: incident date range, location (city/county/state/zip), type of violation (Death, Assault), victim's gender/race/age. Sortable by date, location, name, details.

---

## Why "build deferred" despite the structural fit

**76 cases is too few to invest a dedicated extractor on.** Per the comparison with our existing corpus:

- Doe Network UID alone: 3,738 case_sources
- Charley + Doe missing + PCC: thousands more
- NARA RG 612 today: **76**

Investing the engineering to add a 76-case source — with a separate editorial register, separate UX filter requirement, separate takedown contact, separate dedupe consideration — is poor ROI on the cases-shipped axis.

But the records ARE editorially distinctive. They aren't redundant with our existing sources. The Civil Rights register is a different audience hook than the Doe Network / Charley register, and the **briefing predicted this would fit best as "its own 'Civil Rights' filter rather than mixed into the main map"** — which means the ingest cost is paired with UX work, not just an extractor.

The honest call: **wait for the catalog to grow to a point where the integrated experience justifies the engineering**. Suggested threshold: **300 cases**. At 300, the ingest is ~4× today's volume, the editorial filter has enough density to scroll meaningfully, and the program has hit a release rhythm worth committing UX surface to.

---

## Recommended UX (when build unblocks)

Per the existing memory:
- `feedback_community_features_guardrail` — read-only, no UGC, no theorization
- `feedback_amber_is_ethical_posture` — dignified visual register
- `feedback_photo_legal_posture` — tolerance, not license; takedown path mandatory

The Civil Rights records add their own posture concerns. **My recommendation:**

1. **Dedicated section in the app**, not mixed into the main map / list. Example surface: a "Civil Rights Records (1940–1979)" entry under the About or Resources screen, opening into a list / filter UI scoped to RG 612 cases only.
2. **Deep-link to NARA PDFs**, do not mirror or re-render them. The portal is the canonical source; Cold File adds case-card metadata + a "View on the National Archives portal" CTA. Same posture as our hot-link policy for NamUs/FBI/LASD photos per `feedback_photo_sourcing_policy`.
3. **Surface the next-of-kin context.** Each case card includes a one-line disclosure: "Released by the National Archives under the Civil Rights Cold Case Records Collection Act of 2018, with next-of-kin notification." Builds trust and honors the program's own process.
4. **Takedown path** lists `ColdCaseRecordsCollection@nara.gov` as the primary contact, with our own takedown form as the backstop. We're republishing NARA's release; families' first stop should be NARA.
5. **No proximity-alert tie-in.** These are historical records, not live cases. They don't get the alert-loop treatment. The watch-zone moat applies to the homicide track.

---

## Schema sketch (when build unblocks)

A new source row for NARA RG 612 with `kind = 'federal'`, plus minor schema additions to keep the editorial register separated:

```sql
-- Hypothetical mig 5x (future):
alter table public.cases
  add column if not exists editorial_register text;
-- 'standard' (default) | 'civil_rights_historical' (NARA RG 612)
```

Or — possibly cleaner — a `case_collection` enum so future register expansions (e.g. NamUs partnership, NARA RG XYZ) don't keep adding columns. Schema decision deferred to build time; the probe just notes that the register dimension needs to exist before ingest.

---

## Re-probe triggers

Re-evaluate quarterly. Build when ANY of these flip:

1. **Catalog crosses 300 released cases** on the portal (`crcca.archives.gov/case` count). Today it's 76.
2. **NARA publishes a release-cadence commitment** (e.g., "X cases per quarter through 2030"). Quarterly volume estimate would unblock investment planning even before the absolute threshold is hit.
3. **An advocacy partner asks for the integration**. Civil Rights advocacy orgs (Equal Justice Initiative, Southern Poverty Law Center, CRRJ at Northeastern) might want a mobile-accessible surface. Partnership-driven build inverts the ROI calc.
4. **A v2-tier feature ships that needs editorial-register variety** (e.g., the "Civil Rights cold case" filter becomes part of a "Discover by historical period" surface).

---

## What this probe is NOT

Same caveats as the prior two probes: no code written, no migration scaffolding, no schema commits. The probe is its own deliverable. When build unblocks, the gates still apply — 100-URL editorial sample (easy here since the portal has only 76), 5-case dedupe-risk check against existing sources, PDF-extraction smoke test, takedown-flow design.

---

## Adjacent observations

- The portal's **CSV / JSON / XML export buttons** mean NARA effectively ships a free API. Even at deferred-build status, the export endpoint format is worth recording when re-probing — it's the path of least engineering resistance and might invert the ROI calc earlier than the catalog-size trigger.
- The **Civil Rights Cold Case Records Review Board** is mid-mandate. Its work continues through 2027 or later. The program will keep releasing for years; the catalog is not a snapshot.
- **CRRJ Investigation at Northeastern** ([law.northeastern.edu/crrj](https://law.northeastern.edu/crrj-investigation-of-jim-crow-era-murder-is-first-case-in-nation-to-be-released-under-the-civil-rights-cold-case-records-collection-act/)) is the academic / advocacy partner that drove the first case release. Worth noting for any future Phase 4 partnership outreach in the Civil Rights register.
