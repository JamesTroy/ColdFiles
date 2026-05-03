# The Cold File — Design System

**Aesthetic:** Case file, not crime app. Near-black surfaces under a desk lamp. Manila paper text. One disciplined accent — desaturated amber, the color of an old folder. The audience is true-crime users; the subject is unsolved cases. The design should feel investigative, never alarmist.

**Status:** Locked for v1 mobile (Expo) and v1 web (`coldfile.app`). Light mode is **deferred** — dark mode is not a setting, it's the design. Revisit only after launch and only if accessibility audits force it.

---

## Palette

All values are token names, not raw hex. Implementations import these from `theme.ts` (mobile) or CSS custom properties (web). Don't hard-code hex anywhere outside the token file.

### Surfaces

| Token | Hex | Use |
|-------|-----|-----|
| `bg.base` | `#0a0a0a` | Map canvas, app background |
| `bg.elev1` | `#161616` | Bottom sheet, cards, modals |
| `bg.elev2` | `#2a2a2a` | Filter chips, input fields, secondary buttons |
| `border.subtle` | `#1f1f1f` | Sheet top edge, divider lines |
| `border.strong` | `#2a2a2a` | Card outlines, chip outlines (unselected) |

### Text

| Token | Hex | Use |
|-------|-----|-----|
| `text.primary` | `#f5f1ea` | Body text, victim names in detail, primary headings |
| `text.secondary` | `#8a8580` | Section labels, meta lines, "1.4 mi away" |
| `text.disabled` | `#5a5550` | Inactive tab labels, time-stamps under threshold |

### Accent

| Token | Hex | Use |
|-------|-----|-----|
| `accent.amber` | `#c5a572` | Primary CTA, user's own selection, premium identity, active filter chip |
| `accent.amberHot` | `#e3c485` | Recently-updated case ring (only) |

The amber is the only accent color in the system. **Four sanctioned uses, no more:**

1. Primary CTA (`Submit a tip`, `Open →`, `Read full file →`)
2. User selection on the map (selected-pin halo)
3. Premium identity (the watch-zone `PREMIUM` pill border, premium-tier upsell affordance)
4. "This filter chip is active" state

That's the ceiling. Every one of these is genuinely about the user's intent. If a fifth use shows up — a "verified by us" badge, a featured-case marker, an editorial highlight — the design has drifted and the amber's signal weight is being diluted. Push it back to a neutral or `evidence.chrome` first.

### Status / Pin colors

| Token | Hex | Use |
|-------|-----|-----|
| `pin.homicide` | `#9a8569` | Homicide pins, "Homicide" tag |
| `pin.missing` | `#c5a572` | Missing-person pins, "Missing" tag (matches `accent.amber` deliberately — missing-person cases are the most emotionally proximate, hence carrying the same warmth as user-selection) |
| `pin.doe` | `#d5cdb8` | Unidentified-person pins, "Doe" tag |
| `cluster.fill` | `#3a3a3a` | Cluster bubble background — neutral, never tinted with case-kind color (a cluster doesn't have a case kind) |
| `cluster.text` | `#f5f1ea` | Cluster count integer |

### Stateful

| Token | Hex | Use |
|-------|-----|-----|
| `you.here` | `#5b8fb0` | Saturated mid blue for edge accents and dot fills: map "you are here" dot, last-viewed indicator, my-zones affordance, profile tab, the 2px left edge on a trust-disclosure callout. |
| `text.info` | `#b5d4f4` | Desaturated light blue for sustained reading at 11–13px on near-black: trust-disclosure callout body text, future "your data" prose. Not interchangeable with `you.here` — the saturated mid is unreadable as body copy at small sizes; the light is invisible as an edge accent. Edge accents go saturated; prose goes light. |
| `tip.success` | `#b04545` | The flash that confirms a tip was successfully routed to the agency. Only this. Do not use this color anywhere else in the app. |
| `status.resolved` | `#6a8b6e` | Recently-resolved case pill (status changed `open → identified` or `→ cleared_arrest` within the last 30 days). The only sanctioned use of green in the entire app. |
| `evidence.chrome` | `#5a5550` | Filing-system furniture: photo corner brackets, photo caption strip, source-chip borders. Optionally section labels (CASE FILE, SOURCES · 3) — see typography note. Anything that's structural, not content. |

### Amber-tinted backgrounds

Two prebaked tints, each tuned for a specific affordance ratio. Don't synthesize tinted backgrounds with arbitrary opacity — use these tokens.

| Token | Hex | Use | Affordance ratio |
|-------|-----|-----|------------------|
| `bg.amberTintCard` | `#161208` | Selected radio cards, full-card selection states (recommended-route card in the submit-tip modal). | **Border carries selection, bg reinforces.** The 1px `accent.amber` border survives across themes and accessibility settings; the dim amber bg is supporting evidence. A future "selected card" pattern that's bg-only without border violates this contract — push back. |
| `bg.amberTintPill` | `#2a2520` | Small amber affordances: UNSOLVED pill, active filter chip. | **Bg carries the affordance alone**, because pill geometry is too small for a useful border without crowding the text. Different element, different ratio, both correct. |

### Blue rule (load-bearing)

> **Blue means user-state OR user-trust contract. Never case-state.**

The trust contract is specifically *the product's promises to the user* — privacy posture, data handling, what the app does and doesn't do with what the user sends. **Third-party trust signals are not the user's trust contract.** A future `Verified by LASD` badge on a case is *about the case*, not about the user — it does not get blue. It gets `text.secondary` or a neutral. The principle preserves blue's signal weight by keeping it tightly bound to the user-relationship.

The `you.here` ↔ `text.info` split is a separate operational rule inside the same family: edge accents and dot fills use the saturated mid; body and prose-length content use the desaturated light. Two tokens, two contexts.

`#b04545` is the alarm-color affordance. It exists in the system because tip-routed-success is a moment the user *should* feel. Using it in any other context (a recently-updated ring, an error toast, a delete confirmation) erodes the moment. Reach for `text.secondary` or `accent.amber` for those.

`#6a8b6e` is the only green in the system. It earns its keep on a case that genuinely just resolved — a user who's been following the case for years sees the resolution as the first thing on the screen, and the muted green is the right register (institutional, not celebratory). After 30 days the case folds back into the standard `cleared_arrest` / `cleared_other` status pill (`text.secondary` on `bg.elev2`); the green doesn't linger.

`#5a5550` is the structural-chrome neutral. Photo brackets, caption strips, source-chip borders. **Do not** use `accent.amber` on the photo frame or any other always-on chrome — it steals the amber's signal weight and the eye stops reading amber as "this is the action."

---

## Typography

Three families, each with a clearly-bounded job. The mono carries the "file" identity more than any decorative element does.

### Families

| Family | Stack | Role |
|--------|-------|------|
| Serif | Newsreader (preferred), Source Serif 4 | Arrival signal — case detail header, bottom-sheet selected-case title |
| Sans | Inter | Body, UI, list rows, navigation, chips, controls |
| Mono | JetBrains Mono | Case numbers, dates, IDs, section labels with letter-spacing |

### Hard rules

1. **Serif is reserved for arrival.** Use the serif only when the user has actively opened or selected a case. That means: case detail page header, bottom-sheet title for the selected case. Do **not** use serif in list rows, map labels, or ambient text. The serif does real work as an "I have arrived at this case" signal, not as decorative texture.
2. **Serif never goes below 18px.** Newsreader regular at 14px gets gummy on cheap-Android subpixel rendering (Pixel 3a / Galaxy A14 — squarely in the true-crime user base). Above 18px it's beautiful. Below, switch to Inter.
3. **List-row victim names are Inter Medium 16px, not serif.** This is a deliberate departure from the original mockup. It makes the serif do real work on arrival rather than being constant ambient texture, and it ships type that renders cleanly on the floor of our device base.
4. **Mono runs Medium, not Regular, at small sizes.** JetBrains Mono Regular at 10–12px goes thin on Android; Medium retains weight without crossing into bold. Case numbers, dates, and the dense key-facts block in case detail all use Medium.
5. **Mono section labels track wide.** Letter-spacing 0.08–0.10em with uppercase. This is the typewriter signal — it's what makes a screen read as "from a file."

### Scale

| Role | Family | Size | Weight | Tracking |
|------|--------|------|--------|----------|
| Case detail header (victim name) | Serif | 28px | 500 | normal |
| Sheet selected-case title | Serif | 20px | 500 | normal |
| Section heading | Sans (Inter) | 18px | 600 | -0.01em |
| List row victim name | Sans (Inter) | 16px | 500 | normal |
| Body | Sans (Inter) | 14px | 400 | normal |
| Meta / "1.4 mi away" | Sans (Inter) | 12px | 400 | normal |
| Section label / chip | Mono (JetBrains) | 10–11px | 500 | 0.08–0.10em uppercase |
| Case number / date | Mono (JetBrains) | 11–13px | 500 | normal |

---

## Pin system

Pins encode case kind through **shape first, color second.** Color alone is fragile at 12px, doubly so for users with color-vision differences. Shape carries the kind; color carries the warmth.

### Shape progression

| Kind | Shape | Color |
|------|-------|-------|
| Homicide | Filled circle | `pin.homicide` (#9a8569) |
| Missing | Ring + inner dot | `pin.missing` (#c5a572) |
| Unidentified (Doe) | Open ring | `pin.doe` (#d5cdb8) |

### Geometry rules

- **Stroke scales with diameter, never fixed.** `stroke = round(diameter / 8)`, minimum **1.5px**. At 8px diameter (small-zoom) a 1px stroke disappears; at 14px (selected) a 1px stroke looks anemic. The /8 ratio keeps the visual weight consistent.
- **Inner-dot proportion is fixed at 40% of outer diameter.** The ring-plus-dot pin reads correctly across the 8px ↔ 14px range because the proportions don't deform.

### States

| State | Treatment |
|-------|-----------|
| Default | Base shape + base color |
| Selected (user tapped this pin) | Base shape, plus an `accent.amber` halo at 1.6× diameter, 50% stroke alpha. For the **open-ring** (Doe) shape, also add a solid amber inner dot — without the inner fill, the open ring + halo reads as "loading" (two concentric rings). The inner amber dot resolves the ambiguity. |
| Recently updated | Outer ring at 1.4× diameter, `accent.amberHot` (#e3c485), with an alpha decay curve (see below). |
| Recently updated **and** selected | Both rings render. The hot ring sits inside the selection halo. |

### Recency decay

The recently-updated indicator decays so a daily-active user doesn't stare at a wall of "fresh" pins for two weeks while a once-a-month user still gets a clean "what changed since I last looked" signal.

| Days since update | Ring stroke alpha |
|---|---|
| 0–3 | 1.00 |
| 4–10 | 0.50 |
| 11+ | 0 (no ring) |

Stepwise, not gradient. Compute on render against `last_changed_at` from the cases table; no scheduled job required.

---

## Map & clustering

LA County at zoom 10 puts ~1,500 cases inside the viewport. `cases_in_bbox` returns up to 500. Without clustering the screen reads as a noise field.

### Zoom thresholds

- **Below cluster-threshold:** render clusters only.
- **Cluster-threshold to zoom 14:** render individual pins via `cases_in_bbox`.
- **Above zoom 14:** render every pin in viewport, including overlap. The user has zoomed in for a reason; respect their intent.

The cluster-threshold is **per-metro**, not global. LA County saturates at zoom 11; rural Nevada doesn't until zoom 14. Store thresholds as a config map keyed by metro/state. Default to 11 when no override is set.

### Cluster bubble

Color: always `cluster.fill` (#3a3a3a) with `cluster.text` (#f5f1ea) count. Never tint with case-kind color — a cluster has no kind, and using amber here would muddy the user-selection meaning of amber.

### Cluster size bins

| Cluster count | Diameter |
|---|---|
| 2–9 | 24px |
| 10–49 | 32px |
| 50+ | 40px |

Three discrete sizes, not continuous scaling. A "12" and a "284" cluster must look different so the user can preview density before zooming. Continuous scaling produces clusters that all look the same and defeats the purpose.

### Expansion animation

Tapping a cluster expands it outward into its constituent pins with a **200ms stagger** so the user sees *where* the cases were inside the cluster, not just *that* they were. Use Mapbox's native cluster expansion — don't write it from scratch.

---

## Bottom sheet (peek)

Tapping a pin slides a peek-style sheet up from the bottom. Swiping the sheet up — or tapping it — opens the full case detail screen.

**Map state is preserved underneath.** Users will be tapping pin → peek → close → next pin in rapid sequence. Any transition that loses map context (zoom level, pan position, filter chips) breaks that flow.

### Peek sheet contents

- 36×3px grab handle, `border.strong`
- Section label row, mono 10px tracking 0.10em:
  - Left: `SELECTED · {distance} away`, `text.secondary`
  - Right: `Open →`, `accent.amber`
- **Kind label above name**, mono 11px Medium tracking 0.10em, `evidence.chrome` (uppercase, slash-separated): `HOMICIDE / 1985 / CLAREMONT, CA`
- Title: serif 20px, `text.primary` — the victim name (and only the victim name — no comma-age)

The kind/year/place line goes **above** the name, not below. This is the same treatment used on the map list-row, deliberately. It enforces the pill grammar: kind is *case data* (filing-system furniture, mono caps) — pills are *user-relationship data* (state + urgency, only on the detail screen). See "Pill grammar" under the case-detail section.

The serif on the peek title is one of only two places the serif appears outside the case detail page itself — list-row victim names use Inter Medium 16px, not serif. The serif here marks "you've selected this one" — arrival begins at the peek, not at the detail page.

---

## Case detail screen

The destination from every map peek and list row. The screen earns the design's most deliberate decisions because it's where the user spends real time with one case.

### Pill grammar

This is the meta-rule that makes the rest of the screen possible to design without ad-hoc decisions every time a new field shows up:

> **Pills carry the user's relationship to the case (state + urgency).
> Key-facts table carries verifiable case data.**
>
> When a new field appears, ask: *does this describe the case, or my relationship to it?* Case data goes in the key-facts table; user-relationship data goes in a pill. There is no third bucket.

Concrete consequences of the rule:
- `UNSOLVED`, `40y cold`, `RESOLVED · 2025` → pills (each is about *how the user should attend to* this case)
- `Homicide`, `Oct 13, 1985`, `Claremont, CA`, `LASD Homicide Bureau` → key-facts table rows (each is a verifiable fact)
- The case kind specifically does **not** get a pill on the detail page. It belongs in the key-facts table as a `TYPE: Homicide` row.
- On the **map list row** and **map sheet peek** (where there's no key-facts table), case kind appears as a mono-caps label above the victim name, not as a pill. Pills only ever exist on the detail screen.

### Pill specification

Three pill types, each with a tightly-scoped trigger.

#### `UNSOLVED` — status pill

| Property | Value |
|---|---|
| Shows when | `cases.status = 'open'` and case is not in the recent-resolution window |
| Color | `accent.amber` text on amber-tinted bg `#2a2520` |
| Format | `UNSOLVED`, mono 11px Medium, tracking 0.05em |

#### `40y cold` — urgency pill

| Property | Value |
|---|---|
| Shows when | See edge-case table below |
| Color | `text.secondary` on `bg.elev1` (#161616) — neutral, descriptive register |
| Format | `Ny cold` (no tilde) for `incident_date_quality = 'exact'`; `~Ny cold` (tilde explicit) for `year_only` or `approximate` |
| Computation | `floor((today - incident_date) / 365.25)` |
| Anchor | `cases.incident_date` always — for missing-person cases too. One anchor, one rule. The consistency is more valuable than the technical accuracy of `last_seen_date`. |

Edge cases:

| `incident_date_quality` | Years since incident | Treatment |
|---|---|---|
| `exact` / `approximate` / `year_only` | `< 365 days` | **Don't render.** A sub-1-year unsolved case is "active," not "cold." Anchor on actual incident date — a case that went cold on Dec 28 must not flip to `1y cold` on Jan 1. |
| `exact` | `≥ 1 year` | `Ny cold` |
| `approximate` or `year_only` | `≥ 1 year` | `~Ny cold` (tilde explicit; the approximation is a meaningful signal we shouldn't hide) |
| `suspect` | any | **Don't render.** Computing `55y cold` against the Project: Cold Case 1970 import bug is worse than no pill. |
| `unknown` | n/a | **Don't render.** |

#### `RESOLVED · 2025` — recently-resolved pill

| Property | Value |
|---|---|
| Shows when | `cases.status` changed to `identified`, `cleared_arrest`, or `cleared_other` within the last 30 days. After 30 days it folds back into the standard cleared-status pill (`text.secondary` on `bg.elev2`, no special treatment). |
| Color | `status.resolved` (#6a8b6e) on a tinted bg (`#1a201b`) |
| Format | `RESOLVED · {YYYY}`, mono 11px Medium, tracking 0.05em |
| Replaces | The `40y cold` pill. A user who's been following a case sees the resolution as the first thing on the screen — the recency-of-trail signal becomes irrelevant the moment the trail ends. |

The recently-resolved pill is the only sanctioned use of green in the app. It earns its keep because the moment it appears is genuinely worth feeling — a case the user has been watching just resolved.

### Hero photo frame

Real cold-case photos are often grainy 1980s portraits, evidence shots, or forensic reconstructions — they don't survive glossy iOS-style overlays. The frame establishes the evidence register so any image inside reads as case-file material rather than illustration.

| Element | Treatment |
|---|---|
| Corner brackets (4 corners) | `evidence.chrome` (#5a5550), 1px stroke, 14px arms |
| Caption strip (bottom) | Black 65%-alpha bar, 28px tall, mono 9px `evidence.chrome` text, tracking 0.05em |
| Caption format | `PHOTO {NN} · {SOURCE_NAME} · {YEAR}` — e.g. `PHOTO 01 · LASD HOMICIDE BUREAU · 1985` |
| Year in caption | The case incident year. We don't yet have a `taken_year` on `case_media` (open item below); falls back to incident year as a deliberate approximation. |
| Multi-photo behavior | Swipe horizontally to step through; caption strip updates per swipe (`PHOTO 02 · NAMUS · 1985`). Source comes from `case_media.source_id → sources.name`. |
| **No-photo treatment** | Same frame, same brackets, same caption strip text (`PHOTO UNAVAILABLE · {AGENCY}`). Inside: a centered serif `—` (em-dash) at 48px, `text.secondary`. **Never** a generic silhouette placeholder — that reads as disrespectful for a victim. The em-dash reads as "we don't have one yet," which is honest. |

### Key-facts table

Verifiable case data, vertical layout, separated by 0.5px `border.subtle` rules.

| Row | Format |
|---|---|
| `TYPE` | `Homicide` / `Missing` / `Unidentified` / `Unclaimed` (sans 12px, `text.primary`) |
| `DATE` | `Oct 13, 1985` (mono 12px Medium, `text.primary`) |
| `LOCATION` | `Claremont, CA` (sans 12px, `text.primary`) |
| `AGENCY` | `LASD Homicide Bureau` (sans 12px, `text.primary`) |

Labels are mono 11px Medium tracking 0.05em uppercase, `text.secondary`. Values are right-aligned. The container is `bg.elev1` with a 0.5px `border.subtle` outline and 12×14px padding.

### Narrative excerpt

| Property | Value |
|---|---|
| Section label | `CASE FILE`, mono 11px Medium tracking 0.10em, `text.secondary` |
| Body | Sans 13px Regular, `#d5cdbe` (warm reading off-white between primary and secondary), line-height 1.65 |
| Truncation | First ~40 words. Last word ends with `…` |
| Read-more affordance | `Read full file →`, mono 12px Medium, `accent.amber` |

The truncation is non-negotiable. The full narrative is often long, sometimes graphic, and almost always written in police-report cadence. Truncating respects the user (no scroll wall on the entry screen) and the subject (no graphic detail surfaced before consent). The full text lives behind the `Read full file →` tap.

### Sources

A horizontal row of mono chips immediately under the narrative excerpt. **Always visible on the same screen as the narrative — non-negotiable.**

| Property | Value |
|---|---|
| Chip format | `SOURCE / {source.slug}` (e.g. `SOURCE / lasd.org`), mono 10px Medium, `text.secondary` text on `bg.base`, 0.5px `evidence.chrome` border, 4px radius, 4×8px padding |
| Tap behavior | Opens `case_sources.source_url` in the platform browser (web) / system browser (native). No interstitial. |
| Sort order | `case_sources.trust_weight` DESC, then `case_sources.last_ingested_at` DESC as tiebreaker (freshest data wins leftmost on ties — comes up on multi-jurisdiction cases with two agency-direct sources) |

The legal posture argument is the reason this is non-negotiable: a skeptical user's first tap on a source chip should land on the **agency-direct** source (trust 95) — LASD's own page, not Project: Cold Case. That's what makes the aggregator framing defensible. We're not the source of truth; we're a directory pointing at the source of truth, and the trust-weighted left-to-right order makes that explicit. Aggregators that hide their sources eventually lose trust (the OpenRecord lesson); we ship that lesson into the layout.

### Sticky bottom bar

| Element | Treatment |
|---|---|
| Container | `bg.base`, top 0.5px `border.subtle`, 12px top / 16px sides padding, 28px bottom padding (home-indicator safe area on iOS / nav-bar safe area on Android) |
| Tip CTA (left, ~80% width) | `accent.amber` background, dark text (`#1a1408`), 14px sans Medium, 8px radius, 14px tall padding, label `Submit a tip` |
| Save button (right, 48px square) | Transparent background, 0.5px `border.strong`, `text.primary` glyph (★ outline when unsaved, ★ filled `accent.amber` when saved), 16px |

The 80/20 split is intentional. For a true-crime user opening a case page, the dominant action — by an order of magnitude — is "submit a tip" (the user opened the app *because* they have something to say or are testing whether they recognize anything). The save is there for the genuine bookmark case but doesn't compete for attention. Heavy save users live in the dedicated `Saved` tab.

The save button has two visual states:
- Unsaved: outline star, `text.primary`
- Saved: filled star, `accent.amber` (this is the "user selection" amber use — the user just chose to bookmark)

No confirmation tap on save/unsave. Single tap toggles, with a 200ms haptic + 600ms toast (`Saved to your list` / `Removed from saved`).

#### Trust-disclosure caption (required, not optional)

Directly below the sticky bar buttons, on the case detail screen:

| Property | Value |
|---|---|
| Copy | `Tips route to the agency · The Cold File never stores them` |
| Style | Mono 10px Medium, `text.secondary`, tracking 0.05em |
| Padding | 8px top, 0 sides (sits inside the sticky-bar container so it scrolls with the home-indicator safe area) |

This caption is **non-negotiable.** A user on the case-detail screen who taps `Submit a tip` is in the highest-confidence moment of the flow — they've decided to act. They will skim the modal that opens and tap the bottom button. The disclosure inside the modal is read by users who hesitate, not by users who proceed. The caption-under-button gives the contract to the user who'd otherwise skip — which is exactly the user the disclosure exists for.

It's also the cheapest legal-posture surface in the app: caption text under a button is approximately free in attention budget; the user who needs it gets it without looking, and the user who doesn't filters it out. Same promise, four placements (case-detail caption + modal disclosure + success screen + FAQ), redundancy is the point.

See "Trust-disclosure surfaces" under the Submit-tip flow section for the full list and copy variants.

---

## Submit-tip flow

The highest-stakes surface in the app from a "design carrying legal weight" perspective. Case detail respects the case; submit-tip is what keeps the product from getting sued and what keeps users trusting it. Every rule below is load-bearing, not stylistic.

### Routing logic — which route gets RECOMMENDED

The recommended route is the agency's own anonymous tip pipeline. For most US cases that's the local Crime Stoppers P3 affiliate covering the case-owning agency's jurisdiction (LASD → LA Crime Stoppers, NYPD → NYC Crime Stoppers, etc.). The user is sending a tip exactly as they would have if they'd called the agency's own hotline directly — with the convenience of one tap from a case they were already looking at.

**Resolution order (per-case, not per-agency):**

1. `cases.tip_route_kind` + `cases.tip_url` / `cases.tip_phone` — case-specific override (e.g. an FBI field office has taken the lead on a case the local agency would otherwise own)
2. `cases.primary_agency.tip_route_kind` + `agencies.tip_url` / `agencies.phone_tip` — agency default
3. FBI tip line — federal jurisdiction or no agency-level route exists

The recommended badge attaches to whichever route resolves at the highest priority above. The other routes still appear (different jurisdictions or specific-detective relationships matter) but only one card carries the `RECOMMENDED` mono-cap label.

The per-metro agency-to-P3 mapping is **operational data, not design data.** It lives in `agencies.tip_route_kind` + `agencies.tip_url`. About 40 P3 affiliates nationally cover most of the US population; populating them for the launch metros is its own week of research. See `docs/05_TIP_ROUTING.md` for the operational mapping.

### Modal layout

| Region | Treatment |
|---|---|
| Grab handle | 36×4px, `border.strong`, centered |
| Title row | Serif 19px `text.primary` `Submit a tip` left, sans 12px `text.secondary` `re: {Victim Name} · {Month YYYY}` underneath. 28px circular close button right (`bg.elev1`, 0.5px `border.strong`, ×). |
| `ROUTE TO` section label | Mono 11px Medium tracking 0.05em, `text.secondary` |
| Route cards | Stacked, 8px gap. See radio-card spec below. |
| `YOUR TIP · OPTIONAL` section label | Mono 11px Medium tracking 0.05em, `text.secondary` |
| Tip composer | `bg.base` (`#0e0e0e`-ish; use `bg.base` token) with 0.5px `border.strong`, 8px radius, 12px padding, 70px min-height, sans 13px italic `#4a4a4a` placeholder text |
| Trust callout | `bg.base` with 2px `you.here` left edge, 10×12px padding, sans 11px `text.info`, line-height 1.6. See "Trust-disclosure surfaces" below for copy. |
| Sticky CTA | Full-width `accent.amber` button, dark text (`#1a1408`), 14px sans Medium, 8px radius, 14px tall padding. Copy follows the CTA-copy precedence chain below. |

### Radio-card pattern

Each route is a card. **Border carries selection, bg reinforces.** A bg-only selection state without border violates the system — push back if proposed.

| State | Treatment |
|---|---|
| Selected (recommended OR user-picked) | `bg.amberTintCard` (#161208), 1px `accent.amber` border, 8px radius, 14px padding. 16px circular radio with 1.5px `accent.amber` ring + 8px solid `accent.amber` inner dot. |
| Unselected | `bg.elev1` (#161616), 0.5px `border.strong`, 8px radius, 14px padding. 16px circular radio with 1.5px `border.strong` ring, no inner dot. |
| Card title | Sans 14px Medium, `text.primary` |
| Card meta line | Sans 12px Regular, `text.secondary`, line-height 1.5. Describes the route's properties: `Anonymous · routes to {agency} on this case · reward eligible` |
| `RECOMMENDED` badge | Mono 9px Medium tracking 0.08em, `accent.amber`, right-aligned on the title row |

The meta-line grammar is structured: `{anonymity} · {routing} · {reward}` where each segment may be omitted if not applicable. For an FBI tip card: `Federal jurisdiction or interstate` (no anonymity claim, no reward affordance). For a direct-line phone card: `{phone} · direct line` (mono for the number).

### CTA-copy precedence chain

The button names the receiving agency, never bare "Submit." This is a trust-contract requirement: the user must see *who they're sending to* before they tap.

```ts
function ctaCopy(agency: { name: string; short_name?: string }): string {
  const short = agency.short_name;
  if (short && short.length <= 18) return `Send to ${short}`;
  // Match a leading acronym ("FBI Albuquerque Field Office" → "FBI")
  const acronymMatch = agency.name.match(/^[A-Z]{2,5}\b/);
  if (acronymMatch && acronymMatch[0].length <= 18) return `Send to ${acronymMatch[0]}`;
  return 'Send to the agency';
}
```

Disclosure copy always uses the full `agency.name` — the trust contract is that the user always sees the receiver's full name *somewhere* on the screen. The button can be terse; the disclosure right above it is exhaustive.

The `'Send to the agency'` fallback is rare (both `short_name` is too long and no acronym at the start of `name`). It's better than truncating mid-name with an ellipsis, which feels sloppy on a legal-stakes button.

### Trust-disclosure surfaces

Same promise, four placements, three lengths. The redundancy is the point — the privacy posture being repeated until it's load-bearing in the user's understanding of the product.

| Surface | Length | Copy |
|---|---|---|
| Case detail (caption under sticky bar) | Short | `Tips route to the agency · The Cold File never stores them` |
| Submit-tip modal (blue callout above CTA) | Full | `Routes directly to {agency.name}. The Cold File never reads, holds, or stores tip content.` |
| Tip-success screen | Full | Same as modal |
| FAQ "How does The Cold File handle tips?" | Expanded | Same as modal, plus: tips are submitted as opaque content directly to the agency's intake (Crime Stoppers P3, agency form, agency phone). The Cold File logs only that a tip was routed (timestamp, target agency, content hash for abuse rate-limiting). The content itself is never stored, read, or shared. |

The disclosure formatting is the same in every surface that uses the full version: 2px `you.here` left edge, sans 11px `text.info`, line-height 1.6, on `bg.base`. That visual consistency makes the disclosure recognizable across the product — a user who sees it once on a case detail screen recognizes it immediately when it appears in the success screen.

### Tip-flow choreography (the redirect handoff)

The submit-tip flow doesn't end inside The Cold File. The user taps `Send to LA Crime Stoppers`, and the actual tip-form lives on the agency's existing public infrastructure (P3 portal, agency form, agency phone). That handoff has design implications the modal copy alone doesn't carry.

**Sequence on submit:**

```
T+0ms      User taps the AmberCTA.
           Optimistic tip_routings insert fires (don't block on it).
           UI enters "anticipation" state: CTA dims slightly, no spinner.
T+200ms    Attempt the deep-link / external browser open.
                ├─ success → fire success flash, close modal,
                │            return to case detail (now in receipt state).
                └─ failure → cancel the flash, replace the CTA with the
                              fallback affordance (see below).
```

The anticipation pause (`tokens.tipFlow.anticipationMs`) is what gives the success flash room to read as the success signal it was specced to be. Without it, the flash collides with the modal-dismiss animation and reads as a glitch. The current value is 200ms — **tune it on a real device prototype**. Build it, feel it, adjust the token. The value lives in `tokens.tipFlow.anticipationMs` rather than as a screen-local constant because product-feel timing belongs with the rest of the design rules.

**What the success flash is:**

A 600ms flash on the agency name as the success copy renders, then settles to `text.primary`:

> Tip sent to **LA Crime Stoppers**. They'll review it and contact LASD if it's actionable.

Timing locked in `tipFlow.successFlashMs` (200/100/300, ease-out). This is the only sanctioned use of `tip.success` (#b04545) in the entire app. The flash is the moment the alarm-color affordance earns its keep — it tells the user, viscerally, that something just happened that matters. Using `#b04545` anywhere else dilutes the moment.

**What the success flash is *not*:**

The flash does **not** assert that the user *completed* a tip on the agency's site. We routed the user; they may or may not have filled out the receiving form. The trust contract holds: "tips route to the agency · The Cold File never stores them" is honest because we routed and walked away. The flash celebrates the routing, not the completion.

### Tip-flow failure state

When the deep link / browser open fails (P3 portal down, no network, deep-link malformed), the success flash never fires. Instead the CTA is replaced in place with a fallback affordance that lets the user finish the routing manually:

| Property | Value |
|---|---|
| Container | Same sticky-bar geometry as the original CTA |
| Two side-by-side affordances | `Copy link` (left, ~50% width, accent.amber) + `{tip phone}` (right, mono Medium 14px on `bg.elev1`, tappable to dial) |
| Helper line above | Mono 10px `text.info` on a 2px `you.here` left edge (matches the trust-callout treatment): `Couldn't open the LA Crime Stoppers form. You can still route the tip manually.` |
| Recovery duration | The fallback persists until the user navigates away. No auto-dismiss. |

The blue helper line is a deliberate use of the user-trust-contract surface: the app is talking to the user about *their* routing problem, not about the case. Per the blue rule, that's allowed.

### Receipt state — "you submitted a tip on this case"

When the user returns to a case-detail screen after a successful routing handoff, the sticky bar shows a different shape: the Submit-a-tip CTA is replaced with a desaturated variant indicating they've already tipped this case. They can still tap to submit another tip — new info, follow-up — but the visual weight tells them they've already routed once.

| Property | Value |
|---|---|
| Background | `bg.amberTintCard` (#161208) — barely amber, mostly bg.base |
| Border | 1px `evidence.chrome` (#5a5550) — receipt register |
| Label | `Send another tip`, sans Medium 14px, `text.primary` |
| Receipt caption (above the button) | Mono 10px tracking 0.05em, `evidence.chrome`: `✓ TIP SUBMITTED · {relative date, e.g. "TODAY", "OCT 27", "MAR 2024"}` |

The receipt state is **device-local** until auth lands — driven by an AsyncStorage record `{caseSlug → {submittedAt, agencyName}}` keyed off the device. When auth lands, the same query also checks `tip_routings.user_id = auth.uid()` so a user signed in across devices sees the receipt consistently.

The "✓" character is the only sanctioned check in the app's UI surface — it stays scoped to the receipt state. A second usage somewhere would dilute the signal.

The trust-disclosure caption beneath the bar is unchanged — same copy regardless of whether the user has tipped before. The disclosure is about the product's promise, not the user's history.

### Content hash

The `tip_routings.content_hash` field exists in the schema for abuse rate-limiting (the same content submitted across many cases is a signal). The hash must actually be populated for the lever to work; an empty column is decorative.

| Property | Value |
|---|---|
| Algorithm | SHA-256 of `${COLD_FILE_TIP_HASH_SALT_V1}${user_text}` |
| Where computed | On the device, in the mobile / web client. Never round-trips the plaintext. |
| What gets sent | The hex digest only. Server never sees the plaintext. |
| Empty tip body | `null` — don't hash the empty string. |
| Salt | A constant baked into the client (`COLD_FILE_TIP_HASH_SALT_V1`). Not a security boundary; pepper to prevent commodity rainbow-table lookups against known phrases. Bump to `_V2` if rotation is ever needed (write a migration to recompute existing rows). |

The hash never reverses to content. Even an internal observer with the salt can only check candidate plaintexts ("does this exact tip appear in the row set?") — they cannot recover any user's text.

---

## "You are here"

The user-location dot uses `you.here` (#5b8fb0), with a soft outer ring at 50% alpha and a faint outer halo at 10% alpha. **Never tinted with the case palette.** The user is not a case; the dot must not compete with cases visually.

The blue rule is fully specified in the palette section above (user-state OR user-trust contract; never case-state). The map dot is the canonical instance, but `you.here` extends to the last-viewed indicator, my-zones affordance, profile tab, and the trust-disclosure callout edge. `text.info` carries the prose-length variant of the same family for sustained reading.

---

## Light mode

Deferred indefinitely. Dark mode is the design — not a preference, not a `prefers-color-scheme` switch. The audience and the subject matter both expect dark.

If, post-launch, accessibility audits or Play Store reviewer feedback force a light variant, the approach is to **invert surfaces and text only, keeping accents and pin colors untouched.** A white-paper variant of the case-file aesthetic is plausible; a "bright crime app" is not. Revisit only with cause.

---

## Token snapshot

When the Expo scaffold lands in Week 5, this gets exported from `theme.ts` and imported wherever a token is needed. Everything else is derivable from these.

```ts
// theme.ts — drop-in for the Week 5 Expo scaffold (and the Next.js web property).
export const tokens = {
  color: {
    bg: {
      base: '#0a0a0a', elev1: '#161616', elev2: '#2a2a2a',
      /** Selected radio cards — border carries selection, this bg reinforces. */
      amberTintCard: '#161208',
      /** Small amber affordances (UNSOLVED pill, active filter chip) — bg carries the affordance alone. */
      amberTintPill: '#2a2520',
    },
    border: { subtle: '#1f1f1f', strong: '#2a2a2a' },
    text: {
      primary: '#f5f1ea', secondary: '#8a8580', disabled: '#5a5550',
      /** Desaturated light blue for prose-length user-trust copy at 11–13px on near-black. NOT interchangeable with you.here. */
      info: '#b5d4f4',
    },
    accent: { amber: '#c5a572', amberHot: '#e3c485' },
    pin: { homicide: '#9a8569', missing: '#c5a572', doe: '#d5cdb8' },
    cluster: { fill: '#3a3a3a', text: '#f5f1ea' },
    /** Saturated mid blue for edge accents and dot fills — never used as body text. */
    you: { here: '#5b8fb0' },
    tip: { success: '#b04545' },
    status: { resolved: '#6a8b6e' },
    evidence: { chrome: '#5a5550' },
    /** Reading off-white for the narrative body — sits between text.primary and text.secondary. */
    body: { reading: '#d5cdbe' },
  },
  font: {
    serif: 'Newsreader_500Medium',          // 18px+ only — case detail + peek-sheet title
    sans: 'Inter_400Regular',
    sansMedium: 'Inter_500Medium',
    sansSemibold: 'Inter_600SemiBold',
    mono: 'JetBrainsMono_500Medium',
  },
  size: {
    serifH1: 28, serifH2: 20,
    h3: 18, body: 14, meta: 12, narrative: 13,
    rowName: 16,
    monoLabel: 10, monoData: 12, monoChip: 11, monoCaption: 9,
  },
  tracking: {
    label: 0.10,
    chip: 0.05,
    heading: -0.01,
  },
  pin: {
    /** stroke = max(1.5, round(diameter / 8)) */
    strokeForDiameter: (d: number) => Math.max(1.5, Math.round(d / 8)),
    /** inner dot is 40% of outer diameter for ring-plus-dot pins */
    innerDotRatio: 0.4,
    selected: { haloScale: 1.6, haloAlpha: 0.5 },
    recent: { ringScale: 1.4, alphaByAge: (days: number) => (days <= 3 ? 1 : days <= 10 ? 0.5 : 0) },
  },
  cluster: {
    diameterFor: (count: number) => (count >= 50 ? 40 : count >= 10 ? 32 : 24),
    /** Per-metro override; default 11. Below this zoom, cluster instead of pins. */
    zoomThreshold: { default: 11, 'la-county': 11, 'nv-rural': 14 },
    expandStaggerMs: 200,
  },
  map: {
    /**
     * Basemap style URL for the native renderer. The original spec called
     * for a custom Mapbox Studio style (water + primary roads + county
     * lines only). The mobile basemap has since flipped to MapLibre +
     * OpenFreeMap public tiles (no API key, no Mapbox account); see the
     * `2026-04-28` entry in `docs/00_DECISIONS.md` for the V1 SVG-canvas
     * placeholder and the path back to a real basemap. This token is
     * deferred until the upstream MapLibre Fabric measurement bug is
     * fixed and `isNativeMapAvailable()` flips to true.
     */
    styleUrl: 'mapbox://styles/mapbox/dark-v11',
    /** Debounce between viewport pan/zoom and the cases_in_bbox refetch. */
    viewportDebounceMs: 200,
    /** First-launch camera before location permission. */
    defaultCenter: { lat: 34.275, lng: -119.229, zoomLevel: 10 },
  },
  caseDetail: {
    /** Cold-pill computation. Returns the rendered string or null (don't render). */
    coldPill: (
      incidentDate: Date | null,
      quality: 'exact' | 'approximate' | 'year_only' | 'suspect' | 'unknown',
      now: Date = new Date(),
    ): string | null => {
      if (!incidentDate || quality === 'suspect' || quality === 'unknown') return null;
      const days = Math.floor((now.getTime() - incidentDate.getTime()) / 86_400_000);
      if (days < 365) return null;
      const years = Math.floor(days / 365.25);
      return quality === 'exact' ? `${years}y cold` : `~${years}y cold`;
    },
    /** Recently-resolved pill: shown when status flipped to identified/cleared within this window. */
    resolvedWindowDays: 30,
    /** Narrative truncation target on the case-detail entry screen. */
    narrativeWords: 40,
    /** Source-chip ordering: sort by trust_weight DESC, then last_ingested_at DESC as tiebreaker. */
    sourceSortOrder: ['trust_weight desc', 'last_ingested_at desc'] as const,
  },
  tipFlow: {
    /**
     * CTA copy precedence: agency.short_name (≤18 chars) → leading acronym → 'the agency' fallback.
     * The full agency.name always appears in the disclosure callout right above the button —
     * the user never taps a button without seeing the receiver's full name on the same screen.
     */
    ctaCopy: (agency: { name: string; short_name?: string }): string => {
      const short = agency.short_name;
      if (short && short.length <= 18) return `Send to ${short}`;
      const acronym = agency.name.match(/^[A-Z]{2,5}\b/);
      if (acronym && acronym[0].length <= 18) return `Send to ${acronym[0]}`;
      return 'Send to the agency';
    },
    /** Per-case override beats agency default beats federal fallback. See "Routing logic" in the doc. */
    routeResolutionOrder: ['case', 'agency', 'fbi'] as const,
    /** Trust-disclosure surfaces — required, not optional. The redundancy is the point. */
    disclosureSurfaces: {
      caseDetailCaption: 'Tips route to the agency · The Cold File never stores them',
      modal: (agencyName: string) =>
        `Routes directly to ${agencyName}. The Cold File never reads, holds, or stores tip content.`,
      success: (agencyName: string) =>
        `Routes directly to ${agencyName}. The Cold File never reads, holds, or stores tip content.`,
    },
    /** Tip-success animation: 600ms total, ease-out — the only sanctioned use of tip.success in-app. */
    successFlashMs: { in: 200, hold: 100, out: 300 },
    /**
     * Anticipation pause between user tap and deep-link attempt. A value that
     * controls product feel lives in tokens, never as a screen-local constant.
     * 200ms is the starting estimate — tune on a real device.
     */
    anticipationMs: 200,
  },
} as const;
```

---

## Open items (resolve before Week 5)

1. **Filter chip behavior with shape encoding.** When a user activates a "Homicide" chip, do remaining pins fade or disappear? Recommend fade (50% alpha) so the user keeps spatial context, but verify with a low-fi mock before locking.
2. **Selected-pin layering with recency.** The treatment is specced, but render-order on Mapbox needs verification — selection halo must render *outside* the recency ring. Empirically this means selection layer above recency layer.
3. **Tip-success animation duration.** Locked in `tipFlow.successFlashMs` (200/100/300, ease-out) — re-verify with a device prototype in Week 5; the haptic should fire on the in-edge of the flash, not the out-edge.
4. **Cluster threshold per metro.** Initial values in the token snapshot are guesses. Calibrate on a real LA County dataset before launch.
5. **`evidence.chrome` for text section labels — A/B.** The token covers non-text chrome unambiguously (photo brackets, caption strips, source-chip borders). For *text* labels (`CASE FILE`, `SOURCES · 3`, `DATE` / `LOCATION` / `AGENCY`), it may read too dim against `bg.base` at 10–11px. A/B against `text.secondary` (#8a8580) in the next mockup pass — if it holds, use `evidence.chrome` everywhere for the unified "filing system furniture" story; if it doesn't, keep `text.secondary` for text labels and reserve `evidence.chrome` strictly for non-text chrome.
6. **Photo `taken_year` field.** The hero-photo caption strip currently falls back to incident year because `case_media` has no `taken_year`. For evidence photos taken months/years before the incident (a victim's portrait taken in 1980, incident in 1985), the fallback misleads. Schema add for v2: `case_media.taken_year integer null` with extraction logic per-source where available.
7. **Doe-case detail header.** The case-detail spec assumes a victim name in serif. Doe cases (`kind = 'unidentified'`) have no name. Spec stub: serif `Unidentified Female, est. 18–25` with the demographic estimate; if no demographic, just `Unidentified`. Mono-cap label above changes from `MISSING / 1985 / CLAREMONT, CA` to `UNIDENTIFIED / RECOVERED 2003 / MIAMI-DADE, FL` (recovery date, not disappearance). Settle in next mockup pass.
8. **Per-metro agency-to-P3 mapping.** Operational data, not design data — but the design assumes it exists. About 40 Crime Stoppers P3 affiliates nationally cover most of the US population. The mapping lives in `agencies.tip_route_kind` + `agencies.tip_url`, but populating it is its own week of research before launch. Track in `docs/05_TIP_ROUTING.md`; seed the LA-county subset (LA Crime Stoppers, OC Crime Stoppers, San Bernardino) before the v1 LA beta.
