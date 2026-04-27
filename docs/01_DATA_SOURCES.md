# The Cold File — Data Source Scoping

**Project:** The Cold File (working title)
**Owner:** Matte Black Dev LLC
**Approach:** Federal-first ingestion. State and agency layers stack on top of a federal core that already gives ~80% of nationwide coverage.

---

## Strategic principles

1. **Public data only.** Everything ingested is already published on a public-facing web page or open dataset. No NCIC, no NamUs professional-tier data, no scraping behind logins. This is the exact same posture that kept SafeRadius defensible.
2. **Federal-first.** Three or four national sources cover the long tail of all 50 states. Build those first. Add state and agency feeds only where they materially improve coverage in the launch geography.
3. **Multi-source per case is a feature, not a bug.** The same case appears in NamUs + Charley Project + LASD blog + Doe Network. Dedupe + multi-source linking is the moat — it's exactly the OpenRecord pattern (one entity, multiple authoritative sources).
4. **Tip routing, not tip ownership.** Every case ends with a one-tap "Submit a Tip" that hits the **investigating agency's existing public tip line** (Crime Stoppers P3, agency form, phone number). The Cold File never holds tips, never moderates evidence. This is what keeps the legal surface clean.
5. **No PII beyond what's already published.** Victim names, last-seen photos, sketches — fine, they're already public. Witness identities, family addresses, anything not on the agency's own page — never.

---

## Tier 1 — National sources (build first, weeks 1–4)

These five sources, fully ingested and deduped, give launch-quality coverage in every state.

### 1. NamUs (National Missing and Unidentified Persons System)
- **URL:** https://namus.gov
- **Operator:** US DOJ National Institute of Justice (federal)
- **Coverage:** Missing persons, unidentified decedents, unclaimed persons. National. Public-facing search interface; sensitive case data restricted to vetted law enforcement.
- **Volume:** Tens of thousands of long-term missing + ~1,000 unidentified added per year. ~90% of NamUs missing person cases are >180 days old.
- **Access:** Public web search. No public API for general developers. Server-to-server import is for trusted agency partners only — not relevant for ingestion.
- **Strategy:** HTML scrape against the public search results pages with a state-level iteration. Respect robots.txt and rate-limit aggressively (1 req / 2 sec).
- **Fields available on public records:** Case number, name (where published), age at disappearance, sex, race, height/weight, date last seen, last seen location (city, county, state — not full address for missing), circumstances narrative, photos, dental info presence flag, DNA presence flag, investigating agency, contact phone.
- **Update frequency:** Cases trickle in continuously. Re-scrape weekly per state.
- **Gotchas:** Some cases have public restrictions; respect them. They've published a "limitations on use of NamUs data for research" disclaimer — review before launch and link it from credits.
- **Data.gov entry:** https://catalog.data.gov/dataset/national-missing-and-unidentified-persons-system-namus — confirms public dataset status.

### 2. The Charley Project
- **URL:** https://charleyproject.org
- **Operator:** Independent, run by Meaghan Good. Operating since 2004.
- **Coverage:** ~16,000+ profiles of long-term missing persons, primarily US.
- **Access:** HTML scrape. Site has alphabetical and chronological indexes, individual case pages with rich narrative.
- **Strategy:** Crawl alphabetical index, fetch each case page, extract structured data + narrative.
- **Fields:** Name, alt names, missing since, missing from, age at disappearance, sex, race, height, weight, distinguishing features, clothing, jewelry, medical conditions, last seen circumstances, narrative, photos, agency contact, NCIC #, NamUs #.
- **Update frequency:** Active (case of the month + ongoing additions). Re-scrape monthly.
- **Gotchas:** Single-operator site — be exceptionally polite (1 req / 5 sec, off-peak hours). Site explicitly asks for back-links if used as a resource — credit prominently in case detail UI.

### 3. The Doe Network
- **URL:** https://www.doenetwork.org
- **Operator:** International volunteer non-profit.
- **Coverage:** Missing persons + unidentified decedents (matching). Cases organized by state and chronologically. International cases also present.
- **Access:** HTML scrape.
- **Strategy:** State-indexed crawl.
- **Fields:** Case file number, victim demographic estimate, circumstances of recovery (for unidentifieds), forensic facial reconstructions, age progressions, jewelry/clothing/effects descriptions, agency contact.
- **Update frequency:** Quarterly re-scrape sufficient.
- **Gotchas:** Older site, inconsistent formatting across decades of cases. Strong overlap with NamUs — the dedupe layer earns its keep here.

### 4. Project: Cold Case
- **URL:** https://database.projectcoldcase.org and https://projectcoldcase.org
- **Operator:** Florida-based 501(c)(3) non-profit.
- **Coverage:** Unsolved homicides only (not missing persons). Database covers 46 US states + 50 Florida counties + 3 international. Many records originally seeded from a 2018 Washington Post investigation of unsolved murders in 50 large US cities.
- **Access:** HTML scrape.
- **Strategy:** State-by-state index → individual case pages.
- **Fields:** Victim name, age, date, agency contact, brief narrative.
- **Update frequency:** Project notes the database **is not regularly updated due to cost and manpower** and has known data quality issues (some dates reset to 1970-01-01 from a bad import). Treat their data as a seed pass for the homicide layer, then layer agency-direct sources on top for freshness.
- **Gotchas:** The 1970 date bug is a known issue — flag any case with `incident_date = 1970-01-01` as `date_quality = 'suspect'` and either omit the date in the UI or surface a "date unknown" treatment.

### 5. Solve the Case
- **URL:** https://www.solvethecase.org
- **Operator:** Non-profit, agency-organized.
- **Coverage:** Unsolved homicides + missing + serial offenses. Indexed by agency.
- **Access:** HTML scrape.
- **Strategy:** Agency-by-agency crawl. Useful as a *secondary* enrichment source — pages often have cleaner formatting than the agency's own site.
- **Update frequency:** Quarterly re-scrape.
- **Gotchas:** Smaller than the others; treat as supplementary.

### Federal Tier 1 supplements

These ride along with the Tier 1 build for free or near-free:

- **FBI Most Wanted / Seeking Information** — `https://www.fbi.gov/wanted` and `https://www.fbi.gov/wanted/seeking-info`. Fugitives + cold cases the FBI is publicizing. Has a stable URL pattern, scrape weekly.
- **FBI Kidnappings / Missing Persons** — `https://www.fbi.gov/wanted/kidnap`. Subset of above with structured pages.
- **NCMEC (National Center for Missing & Exploited Children)** — `https://www.missingkids.org`. Children only. Has a public poster API for partners — apply for partner access; otherwise scrape the public posters.
- **Murder Accountability Project (MAP)** — `https://www.murderdata.org`. Statistical dataset of US homicides 1965–present from FBI Uniform Crime Report SHR data. Aggregate, not case-level — useful as a denominator/context layer ("X unsolved in this county since 1980") rather than a case feed.

---

## Tier 2 — State-level sources (build for launch states only)

State coverage is wildly uneven. Only a handful of states maintain a centralized public cold case database. The rest defer to agencies.

| State | State-level resource | Quality | Notes |
|-------|---------------------|---------|-------|
| AL | None centralized | — | Agency pages only |
| AK | Alaska State Troopers Cold Case Investigations | Mid | Web list, low volume |
| AZ | AZ DPS Cold Case page | Mid | Web list, agency contact |
| AR | None centralized | — | Agency pages only |
| **CA** | CA DOJ Unsolved Cases (limited) + CalDOJ COFI program | **Mid-low** | No clean public DB; LASD/LAPD do the heavy lifting |
| CO | CBI Cold Case page | Mid | Web list |
| CT | CT State Police Cold Case Unit | Mid | PDF-heavy, awkward to scrape |
| DE | DE State Police Cold Case | Mid | Web list |
| **FL** | **FDLE Unsolved Cases** — `web.fdle.state.fl.us/unsolvedcases/` + AG Cold Case Investigations Unit | **Excellent** | Submission-based, well-structured, statewide |
| GA | GBI Cold Case Files | Mid | Web list |
| HI | None centralized | — | HPD does its own |
| ID | ISP Cold Case page | Mid | Limited |
| IL | ISP Cold Case page | Mid | Chicago PD is the real volume — agency-direct |
| IN | ISP Cold Case page | Mid | Limited |
| IA | DCI Cold Case page | Mid | Limited |
| KS | KBI Cold Case page | Mid | Web list |
| KY | KSP Cold Case page | Mid | PDFs |
| LA | LSP Cold Case page | Mid | Web list |
| ME | MSP Cold Case page | Mid | Web list |
| MD | MSP Cold Case page | Mid | Web list |
| MA | MSP Cold Case page | Mid | Strong DA-county sites in some counties |
| MI | MSP Cold Case page | Mid | Detroit PD agency-direct is critical |
| MN | BCA Cold Case page | Mid | Web list |
| MS | MBI Cold Case page | Low | Sparse |
| MO | MSHP Cold Case page | Mid | Web list |
| MT | DCI Cold Case page | Low | Sparse |
| NE | NSP Cold Case page | Mid | Web list |
| NV | NV DPS Cold Case page | Low | Vegas Metro is the real volume |
| NH | NH AG Cold Case Unit | Mid | AG-run, well-publicized |
| **NJ** | **NJ State Police Cold Case Network** | **Strong** | Long-running, structured, includes Most Wanted |
| NM | NMSP Cold Case page | Mid | Web list |
| **NY** | NYS Police Cold Case Files + NYC DA cold cases | **Mid-strong** | NYPD agency-direct critical for NYC |
| NC | NC SBI Cold Case page | Mid | Web list |
| ND | BCI Cold Case page | Low | Sparse |
| OH | OH AG Cold Case Project | Mid | Has a program, less searchable DB |
| OK | OSBI Cold Case page | Mid | Web list |
| **OR** | **OR State Police Cold Case Database** | **Strong** | Searchable, structured |
| PA | PSP Cold Case page | Mid | Web list, Philadelphia PD agency-direct |
| RI | RISP Cold Case page | Mid | Small state, low volume |
| SC | SLED Cold Case page | Mid | Web list |
| SD | DCI Cold Case page | Low | Sparse |
| TN | TBI Cold Case page | Mid | Web list |
| **TX** | **TX DPS Cold Case Clearinghouse** | **Strong** | Statewide repository, well-publicized |
| UT | UT BCI Cold Case page | Mid | Web list |
| VT | VSP Cold Case Unit | Mid | Small state |
| VA | VSP Cold Case page | Mid | Web list |
| **WA** | **WSP Cold Case Unit** + Seattle PD strong agency pages | **Mid-strong** | Decent statewide |
| WV | WVSP Cold Case page | Low | Sparse |
| WI | DCI Cold Case page | Mid | Web list |
| WY | DCI Cold Case page | Low | Sparse |
| DC | MPDC Cold Case Unit | Mid | Agency-direct |

**Strong states (build state-level scrapers in v1):** FL, NJ, OR, TX. These four cover ~90M residents and have well-structured public DBs that meaningfully add to the federal tier.

**Mid-strong (v2 priority):** CA (via LAPD/LASD agency-direct rather than state), NY (NYPD agency-direct), WA, IL.

**Mid/low states:** Tier 1 federal sources cover them adequately. Skip state-level scraping until after launch.

---

## Tier 3 — Agency-level sources (launch-state metros only)

Most cases live with the investigating agency. For the launch metro (LA County), agency-direct beats every aggregator on freshness and detail.

### Los Angeles launch (v1 must-haves)

- **LAPD Robbery-Homicide Division** — `https://www.lapdonline.org` — Unsolved homicide pages per bureau (Central, South, Valley, West), Cold Case Homicide Special Section list, Unsolved LAPD Officer Murders.
- **LASD Homicide Bureau** — `https://lasd.org/category/homicide-bureau/` — Blog-format announcements of unsolved cases, often with reward amounts and family appeals. Less structured than LAPD, more story-driven (good for the case detail UI).
- **LA County DA Cold Case Unit** — Cases the DA's office has prioritized.
- **City of Long Beach PD** — Independent of LASD, has its own cold case page.
- **Glendale, Pasadena, Santa Monica, Beverly Hills PDs** — Independent; some publish cold cases, most don't.
- **LA Crime Stoppers** — `lacrimestoppers.org` — Universal tip-routing partner. Use their P3 platform as the default tip submission target for LASD-owned cases.

### v2 metros (in priority order)
1. New York City — NYPD + Brooklyn DA + Manhattan DA + Bronx DA + Queens DA
2. Chicago — CPD Bureau of Detectives + Cook County Sheriff
3. Houston — HPD Homicide + Harris County Sheriff
4. Philadelphia — PPD Homicide
5. Phoenix — PPD + MCSO

---

## Coverage estimate after each tier

- **Tier 1 only (federal):** ~70% of nationally-known cold cases. Strong on missing/unidentified, weaker on homicides outside the 50 cities the WaPo dataset covered.
- **Tier 1 + Tier 2 strong states (FL, NJ, OR, TX):** ~80%.
- **Tier 1 + 2 + Tier 3 launch metro (LA County):** ~85% with launch metro at 95%+.
- **Tier 1 + 2 + Tier 3 top-5 metros:** ~90% nationally with top metros at 95%+.

---

## Update cadence (cron schedule)

| Source | Frequency | Why |
|--------|-----------|-----|
| NamUs | Weekly per state | Active intake, but cases vetted before publication slows pure new-case rate |
| Charley Project | Monthly | Single operator, courteous frequency |
| Doe Network | Quarterly | Slow-moving |
| Project: Cold Case | Quarterly | Acknowledged not actively maintained |
| Solve the Case | Quarterly | Supplementary |
| FBI Wanted / Seeking Info | Weekly | Active feed |
| NCMEC | Weekly | Active feed |
| FDLE | Weekly | State-active feed |
| NJ / OR / TX state | Weekly | State-active feeds |
| LAPD / LASD / metro agencies | Daily | Press releases come out frequently, freshness is the user-facing differentiator |

---

## Legal & ethical guardrails (codify in CONTRIBUTING.md)

1. **Robots.txt is law.** Honor it on every source. If a source says no, don't.
2. **Rate-limit conservatively.** Default 1 req / 2s. Single-operator sites (Charley) get 1 req / 5s and only 02:00–05:00 local time of the source.
3. **Identify the bot.** `User-Agent: ColdFileBot/1.0 (+https://coldfile.app/about; contact@coldfile.app)` — link explains what we do and how to reach us. Most operators of sites like these are happy to be aggregated; they want the cases visible.
4. **Takedown SLA.** Public takedown form. 48-hour SLA for victim family takedown requests. Audit log of every takedown and reason. This is what protects against inevitable family pushback on individual cases.
5. **No tip ingestion.** Tips go straight to the agency. Cold File never holds, stores, or moderates evidence.
6. **No facial recognition.** Photos are displayed for human pattern matching only. No FR on user-uploaded photos. Don't even ship the SDK.
7. **Children: extra care.** NCMEC posters are public, but display them with stricter UI gating (interstitial warning, no auto-load).
8. **Source attribution always visible.** Every case detail screen shows the source(s) the data came from with a link out. This is legally protective and ethically right.

---

## What we're not doing (and why)

- **Not building a "case forum."** The internet sleuth subreddit ecosystem already exists. Wading into that means moderating false accusations of innocent people, which is the single biggest legal risk in this category. Cold File is a directory + tip-router, not a discussion platform.
- **Not surfacing suspect information.** Even when agencies publish person-of-interest sketches, we display them as "person investigators want to identify" — never as "suspect." Defamation is a real risk.
- **Not running our own DNA / forensic genealogy hooks.** That's NamUs's mandate; we link to it.
- **Not paywalling tip submissions.** Solving cases is the mission. The premium tier is convenience features for users who care, not gating on the public good.
