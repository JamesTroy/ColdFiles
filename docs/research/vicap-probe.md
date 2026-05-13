# FBI ViCAP Probe — Phase 2.2

Reconnaissance for the second Phase 2 candidate. Result: **defer indefinitely.** Different reasoning than MAP — ViCAP is per-case-rich (it could fit) but the catalog is too small, anti-bot defenses raise extractor cost, and overlap with existing sources is likely high. Worth a re-probe in ~12 months if an FBI-direct partnership opens up.

Probed: 2026-05-12.

---

## What ViCAP is

Two-tier program inside the FBI's Critical Incident Response Group:

1. **The internal database** — accessed by LE agencies via [LEEP](https://www.cjis.gov/) (Law Enforcement Enterprise Portal) since 2008. Carries detailed crime-scene descriptions, narratives, lab reports, criminal history, court records, photos, statements. **Not accessible to The Cold File.**
2. **The public alerts pages** at [fbi.gov/wanted/vicap](https://www.fbi.gov/wanted/vicap) — a small curated subset of cases the FBI / contributing agencies want federally distributed for tip-generation. Three categorical buckets:
   - [Homicides and Sexual Assaults](https://www.fbi.gov/wanted/vicap/homicides-and-sexual-assaults) — **261 entries**
   - [Unidentified Persons](https://www.fbi.gov/wanted/vicap/unidentified-persons) — **55 entries**
   - [Missing Persons](https://www.fbi.gov/wanted/vicap/missing-persons) — **159 entries**
   - **Total public catalog: 475 alerts.**

Sources:
- [ViCAP landing](https://www.fbi.gov/wanted/vicap)
- [Wikipedia](https://en.wikipedia.org/wiki/Violent_Criminal_Apprehension_Program)
- [Office of Justice Programs — multiagency serial-murder role](https://www.ojp.gov/ncjrs/virtual-library/abstracts/vicaps-role-multiagency-serial-murder-investigations)
- [FBI Privacy Impact Assessment for ViCAP](https://www.fbi.gov/how-we-can-help-you/more-fbi-services-and-information/freedom-of-information-privacy-act/department-of-justice-fbi-privacy-impact-assessments/vicap)

---

## Per-case structure (probed via search-engine snippets — fbi.gov 403s WebFetch directly)

URL pattern is title-derived slug, not a stable ID:

```
/wanted/vicap/homicides-and-sexual-assaults/victim---lily-ann-prendergast---sacramento-california
/wanted/vicap/homicides-and-sexual-assaults/unknown-suspects---unsolved-homicide---missouri
/wanted/vicap/unidentified-persons/jane-doe---st-clair-township-michigan
/wanted/vicap/unidentified-persons/john-doe-21
```

Each detail page contains victim name (when known), age, sex, race, date, location, narrative summary, and one or more photos / sketches. A material fraction of entries are **PDF alert bulletins** rather than structured HTML — e.g.:

```
/wanted/vicap/unidentified-persons/john-doe-20/johndoe_immokalee_fl_1980.pdf
/wanted/vicap/homicides-and-sexual-assaults/evonitz_rm.pdf
/file-repository/ip/vicap-alert-2018-01-02-sacramento2.pdf
```

So an extractor would need both an HTML detail-page parser AND a PDF-text-extraction path.

---

## Why this probe routes to "defer," not "ingest" or "Phase 3"

| Factor | Reading |
|---|---|
| **Catalog size: 475 total** | ~8× smaller than Doe Network UID alone (3,738 case_sources rows in our corpus today). Adding ViCAP gives at most +5–10% volume — and that's before dedupe against existing sources. |
| **Per-case quality is high** | FBI-curated, named victims where known, narratives, photos. NOT the FBI Wanted editorial-misfit problem (this corpus IS cold-case-relevant by design). Could theoretically work as a per-case source. |
| **Overlap risk with existing sources is high** | The same UID + missing-persons cases the FBI wants federally distributed are typically already in NamUs / Doe Network / agency listings we already ingest. Net-new value after dedupe is probably 50% or less of the catalog — call it 200–250 net new cases on top of ~7K we already have. |
| **fbi.gov returns 403 to WebFetch** | Real anti-bot defense (UA filtering, possibly geo). An extractor would need careful UA spoofing, request pacing, retry logic, and might still get throttled. Adds 2–3× the engineering cost of an HTML-friendly source. |
| **PDF bulletin parse path** | A separate, more fragile extraction surface than HTML. Doubles the parser surface area. |
| **Geographic spread is national, not LA-county** | The roadmap explicitly defers state DBs (2.3) behind LA-county PMF for the same reason. ViCAP is the same shape — national scope, premature for the current launch metro. |
| **Phase 3 pattern view requires thousands of records** | 475 is too sparse for cluster/heatmap analysis. MAP (Phase 3 primary source) has ~39K records for a reason. |
| **The "rich" version is LE-only via LEEP** | We can never get the structured database. The public alerts are the ceiling. |

ViCAP isn't the wrong corpus the way FBI Wanted was. It's just the wrong size + wrong cost + wrong timing.

---

## Re-probe trigger

Re-evaluate ViCAP under any of these conditions:

1. **FBI opens machine-readable access.** The [2026-05 lawsuit win](https://www.murderdata.org/2026/05/fbi-now-reports-homicides-following.html) (MAP v. FBI on UCR reporting) signals federal data policy is loosening. A bulk-API or sanctioned-mirror release would change the cost calculus.
2. **LE-direct partnership becomes available.** If The Cold File ever gets a sanctioned data-sharing arrangement with FBI CIRG / ViCAP staff (unlikely in v1, possible after CrimeCon-tier visibility), the LEEP-tier catalog opens up and the ROI inverts.
3. **LA-county PMF is in.** Once geographic expansion gates open, ViCAP's national spread becomes useful rather than premature.

Until one of those flips, ViCAP stays out of the ingest plan.

---

## Adjacent things that came up

- **FBI Wanted (retired)** — same surface; different reason for the no. ViCAP isn't editorially mismatched the way FBI Wanted was — the corpus IS cold-case-relevant. So if scope-and-cost ever flips, this is a different decision than re-activating FBI Wanted (which was rejected on editorial fit, not ROI).
- **The "VICAP Alerts" page on LEB FBI** ([leb.fbi.gov/vicap-alerts](https://leb.fbi.gov/vicap-alerts)) is a separate publication channel that posts PDF alert bulletins for LE consumption. Same data shape as the public alerts; same constraints; same routing.
- **Texas DPS regional ViCAP** ([dps.texas.gov/section/crime-records/vicap-violent-criminal-apprehension-program](https://www.dps.texas.gov/section/crime-records/vicap-violent-criminal-apprehension-program)) — state-level mirror. State equivalents likely exist for CA, FL, etc. Worth checking under 2.3 (state DBs) when that phase unblocks, NOT as an extension of this probe.

---

## What this probe is NOT

Same caveats as the MAP probe: no code written, no extractor scaffolding. The probe is its own deliverable. If ViCAP ever comes back into scope, the gates from the roadmap still apply — 100-URL editorial sample, 5-case dedupe-risk check against existing case_sources, index-and-detail probe, anti-bot smoke test.
