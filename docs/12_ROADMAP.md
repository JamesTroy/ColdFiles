# The Cold File — Post-Launch Roadmap

Live state (2026-05-12):

- **v1.0.4** on Play Store internal track (versionCode 5). Push-notifications blocker on v1.0.2 still open (Firebase Android-app registration + native rebuild pending).
- **Ingest fleet (live):** Charley Project, Doe Network missing, Doe Network UID, Project: Cold Case. NamUs wired but dormant pending API. FBI Wanted retired per 2026-05-03 decision.
- **Tip routing:** P3 Tier-1/2 templates shipped (mig 47, PRs #116–#121); LA-county affiliate IDs backfilled; prefill verified.
- **Map:** SVG `MapCanvas` placeholder (real basemap deferred per 2026-04-28 decision).
- **TAM context:** ~230M US true-crime consumers; mobile app-store category is empty of dignified aggregators. Whitespace is real.

This roadmap sequences post-launch work by dependency and risk. Each phase is independently shippable. Phases are not calendar-bound — they're ordered.

---

## Phase 1 — Close v1 blockers + the obvious extension of P3

Foundational. Nothing here is speculative; each item resolves an existing gap or extends a pattern that's already proven in this codebase.

### 1.1 — v1.0.2 push-notifications fix → v1.0.5 native rebuild

- Register the Cold File Android app in Firebase Console; download `google-services.json` into `mobile/`; verify config plugin picks it up; native rebuild via EAS.
- Follows the release sequence in CLAUDE.md: cut release branch → bump version + versionCode → tag → build → merge → upload.
- After AAB rollout, push the deferred OTA against the new runtime (otherwise it lands on zero devices — see `feedback_ota_runtime_orphan`).
- **Why first:** alerts are the product moat per `feedback_alerts_are_the_moat`; the loop is broken in prod today.

### 1.2 — DNA funding externalize (Othram DNA Solves / Season of Justice)

Direct mirror of the P3 routing pattern that just shipped — same shape, different destination.

- Mig 48: add `dna_funding_url_template` columns to `case_external_ref` (or a parallel table if attribution differs per case). Template format mirrors `tip_url_template` from mig 47.
- Add a `constructDnaFundingUrl` helper alongside `constructTipUrl` in the same module.
- Case-detail screen: add "Fund DNA work on this case" CTA below the existing tip CTA. Same visual weight, amber palette, dignified copy.
- Audit-only telemetry: log case_id + timestamp on tap. **No** donor identity, amount, card data, or held funds — the same posture as `feedback_tip_route_externalize`.
- Edge Function callback log (mirror of tip-route day-N tables) to track which cases get funded externally — useful for advocacy partnerships in Phase 4.
- **Why second:** muscle memory from the P3 ship; the case detail screen is the moment of intent for both tip submission AND DNA funding; donor moves are documented in the briefing (CrimeCon, Othram $7K precedent).

### 1.3 — Saved-case + proximity alert hardening

Alerts are already designated the moat. Surface area to harden before promoting them in any growth comms:

- Audit `notify-fanout` Edge Function end-to-end against a fresh prod codepath (lesson from `feedback_silent_whitespace_in_config`: a Vault secret with a trailing space broke watch_zone_hit silently for an entire migration cycle).
- Add a synthetic ingest-alive alert on `last_changed_at` union `created_at` per `feedback_ingest_metric_axis`.
- E2E receipt: register a watch zone, ingest a test case inside it, confirm notification arrives. Do this on a real device against the real prod codepath.

---

## Phase 2 — Probe-first data expansion

Each candidate is in the inventory memory but unprobed. Per `feedback_source_search_broken_detail_live`: 5 minutes of curl saves a day of dead extractor work. Per `feedback_extractor_editorial_noise`: 100-URL editorial-sample is the gate before any integration.

### 2.1 — [DONE 2026-05-12] MAP probed → routed to Phase 3 (not per-case)

Probe captured in [docs/research/map-probe.md](research/map-probe.md). Decisive structural mismatch with per-case ingest:

- MAP's SHR does not carry victim names ("Victim names are not reported to the SHR"). Our case rows are name-keyed.
- No stable per-case primary key — only aggregate-fingerprint columns (agency ORI + month + year + demographics + weapon).
- ~39K of the records are FOIA-acquired by MAP, not in the FBI public set; redistribution norms unspecified — operator-side follow-up to `hargrove@murderdata.org` before any prod use.

The dataset is wrong for per-case ingest and right for the Phase 3 aggregate pattern view (geography × time × demographics × weapon × clearance). The probe doc carries the Phase 3 entry-point checklist.

**Implication for this phase:** ViCAP (2.2) moves up — it might fit per-case OR also route to Phase 3. State DBs (2.3) become the next per-case candidates if ViCAP also routes aggregate-only.

### 2.2 — FBI ViCAP probe

Editorially rich for the pattern/serial view. Must stay aggregate-only — no POI naming per `feedback_community_features_guardrail`.

Probe gates:
- Confirm public-data scope (which fields are public vs LE-restricted).
- Sample editorial fit: is the public-facing slice rich enough to support a pattern view, or is it sparse summary text?
- If thin, deprioritize behind MAP.

### 2.3 — Phase 2 state DBs (deferred behind LA-county product-market fit)

Virginia State Police cold-case DB, Colorado CBI, WaPo 50-city. Don't probe until LA-county engagement signals are in (saved-case rate, alert-tap rate, tip-route attribution). Geographic expansion before product-market fit is premature.

### 2.4 — NARA Civil Rights Cold Case Records (RG 612)

Niche but editorially powerful. Worth a half-day probe after ViCAP — different editorial register, different audience hook. Could be its own "Civil Rights" filter rather than mixed into the main map.

### 2.5 — NamUs server-to-server API (track, don't build)

In development per NamUs. Re-check quarterly. Until then, the existing scraper-fixtures path is sufficient.

---

## Phase 3 — Pattern/serial view (depends on Phase 1.3 shipping)

Read-only geographic + MO clustering. **Aggregate-only**, no POI/suspect naming, no comments, no theories. Editorially rich and shareable; defensibility against the inevitable AI-slop "solve a case" apps.

Primary data source: **MAP SHR** (routed here from Phase 2.1 — see [docs/research/map-probe.md](research/map-probe.md) for the full probe). ViCAP may supplement once probed. Phase 3 entry-point checklist lives in the probe doc.

When unblocked:

- Data shape: per-region clusters by victim demographic × time-window × weapon × clearance, surfaced as visual heatmap or small-multiple grid.
- Storage: new aggregate table (`map_homicide_aggregates` or similar) — NOT inserts into `cases`. Keeps the per-case model clean and makes the "pattern view = different table" boundary explicit.
- Strict guardrails per `feedback_community_features_guardrail`: no user input on this surface beyond filter selection. Each cluster is read-only context, not an invitation to investigate.
- UI: amber palette, Newsreader headers, shape-first iconography per `feedback_amber_is_ethical_posture`.
- Editorial sample: 5 clusters reviewed by operator for dignified framing before ship. The cluster that reads as "look at this serial killer" is the wrong framing; "this is what happened in this region" is the right one.
- Operator-side: email Hargrove + agree on attribution before publishing the view.

---

## Phase 4 — Distribution + growth (parallel track to engineering)

Per `project_audience_growth_playbook`, ranked by ROI. This is a comms/PR track — not engineering — but the engineering surface needs to be ready before each lever is pulled.

### 4.1 — Nonprofit cross-promotion (highest ROI)

Outreach targets, in order:
1. **Project: Cold Case** (Jacksonville, runs annual Cold Case Symposium w/ Purdue/ASU/UNF). Already partnered with WaPo 50-city. Best-fit because the editorial posture matches.
2. **Season of Justice** (501c3 funding cold-case forensic work). Natural alignment with the DNA funding CTA from Phase 1.2.
3. Cold Case Foundation, Cold Case Advocacy, Carolinas Cold Case Coalition.

Engineering prerequisites before outreach:
- Phase 1.1 done (push works).
- Phase 1.2 done (DNA funding CTA visible, Season of Justice as a destination).
- Family-submitted case-intake decision made (see 4.3).

### 4.2 — Podcast partnerships

- audiochuck (Crime Junkie) is highest-density — they commissioned the Edison study and treat advocacy as core mission. "Case of the week" feature fits the case-detail screen + share extension.
- Smaller hosts will trade promo for early access (e.g. early access to a regional saved-case alert, a per-podcast badge on cases they cover).
- Engineering prerequisite: case-share deeplink that opens directly to the case detail in-app (or web fallback to coldfile.app/c/:slug).

### 4.3 — Family-submitted case intake (deliberate product decision required)

Project: Cold Case accepts these directly; adopting that flow makes Cold File a participation surface, not just an aggregator, and brings families in as evangelists.

But — this brushes the UGC guardrail. Decision needed before scoping:
- Is the family the rights-holder, with a signed attribution + takedown agreement at submission time? (If yes, this is OK — it's licensed content from a verified rights-holder, not anonymous UGC.)
- What's the moderation flow? Single-operator review before publish, no public preview, full takedown affordance.
- Is the submission form on-app (more friction) or web-only (lower mobile lift)?

Recommend web-only intake at coldfile.app/submit, operator-moderated, no on-device UI surface for v1. Revisit on-app intake only after volume validates the operator load.

### 4.4 — CrimeCon presence

Annual convention; the $7K Othram donation happened there. Booth or sponsored-case sponsorship is the highest-density audience touch in the genre. Defer until Phase 1 + Phase 2.1 are done (need both the alert loop and at least one new data source landed to have a story).

### 4.5 — Websleuths / Reddit as link-target (not competitor)

Goal: be the canonical map/case layer they link to. Practical work:
- Stable, indexable case-detail URLs at coldfile.app/c/:slug with rich OG/Twitter meta.
- "View on Cold File" embeddable badge (per case).
- Don't propose competing with their forum structure. The forum is theirs; the map is ours.

### 4.6 — LE agency-direct expansion (after LA county validates)

Replicate the LA County cold-case-review-team model in CO / VA / FL. Reach out to bureau commanders directly via Project: Cold Case's network. Defer until LA-county tip-route callback log shows real per-agency attribution per `docs/05_TIP_ROUTING.md`.

---

## Phase 5 — Discipline items (continuous)

Not phases — ongoing constraints. Listed here so they don't get re-litigated.

- **No UGC, no comments, no theories, no POI tagging.** Per `feedback_community_features_guardrail`. Push back on any feature ask that brushes this line.
- **No in-app tip intake; no in-app DNA donation processing.** Externalize per `feedback_tip_route_externalize` and `feedback_dna_funding_externalize`.
- **Photo sourcing posture is tolerance, not license.** Per `feedback_photo_legal_posture` + `feedback_photo_sourcing_policy`. TOS must include rights-holder takedown contact at all times.
- **Amber + Newsreader + shape-first pins is the visual contract.** Per `feedback_amber_is_ethical_posture`. Reject cold-blue / traffic-light / sans-only requests.

---

## Out of scope (explicitly)

- AI / LLM "solve a case" features. Anti-fit, see Phase 5.
- Reddit-style community discussion threads. Anti-fit, see Phase 5.
- Cold-blue forensic visual register. Anti-fit per amber posture.
- Re-activating FBI Wanted. Decided 2026-05-03; corpus is editorially wrong for homicide track.
- Geographic expansion beyond LA county before saved-case + alert-tap rates validate product-market fit.
- Building MAP / ViCAP into ingest before probe gates in Phase 2.1 / 2.2 pass.

---

## What's next this week

Recommended single next action: **Phase 1.1 (push notifications fix).** It unblocks the moat, it has a clear gating step (Firebase Console registration + google-services.json), and it follows the documented release sequence. Phase 1.2 (DNA funding externalize) is the natural follow-up — same release cycle if the operator is willing to ship both in the same versionCode bump.

Probe items in Phase 2 can happen in parallel as no-code research — they don't block Phase 1.
