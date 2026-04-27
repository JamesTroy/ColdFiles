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
| `you.here` | `#5b8fb0` | "Map: you are here" dot, "Search: your last viewed" indicator, "Watch zones: your zones" affordance, profile tab. Intentionally outside the case-color family — represents the user, never a case. |
| `tip.success` | `#b04545` | The flash that confirms a tip was successfully routed to the agency. Only this. Do not use this color anywhere else in the app. |
| `status.resolved` | `#6a8b6e` | Recently-resolved case pill (status changed `open → identified` or `→ cleared_arrest` within the last 30 days). The only sanctioned use of green in the entire app. |
| `evidence.chrome` | `#5a5550` | Filing-system furniture: photo corner brackets, photo caption strip, source-chip borders. Optionally section labels (CASE FILE, SOURCES · 3) — see typography note. Anything that's structural, not content. |

The blue stays clean for "the user, not a case." Reuse it anywhere a screen is communicating user-state — last-viewed, my-zones, profile — and leave it out of anything that's about cases themselves.

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

---

## "You are here"

The user-location dot is `you.here` (#5b8fb0), with a soft outer ring at 50% alpha and a faint outer halo at 10% alpha. **Never tinted with the case palette.** The user is not a case; the dot must not compete with cases visually. Cool blue is the system's signal that "this is about you, not about a case."

The token covers more than the map dot — see the palette table for the full scope (last-viewed indicator, my-zones affordance, profile tab). The principle is the same everywhere: blue means user-state, never case-state.

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
    bg: { base: '#0a0a0a', elev1: '#161616', elev2: '#2a2a2a' },
    border: { subtle: '#1f1f1f', strong: '#2a2a2a' },
    text: { primary: '#f5f1ea', secondary: '#8a8580', disabled: '#5a5550' },
    accent: { amber: '#c5a572', amberHot: '#e3c485' },
    pin: { homicide: '#9a8569', missing: '#c5a572', doe: '#d5cdb8' },
    cluster: { fill: '#3a3a3a', text: '#f5f1ea' },
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
} as const;
```

---

## Open items (resolve before Week 5)

1. **Filter chip behavior with shape encoding.** When a user activates a "Homicide" chip, do remaining pins fade or disappear? Recommend fade (50% alpha) so the user keeps spatial context, but verify with a low-fi mock before locking.
2. **Selected-pin layering with recency.** The treatment is specced, but render-order on Mapbox needs verification — selection halo must render *outside* the recency ring. Empirically this means selection layer above recency layer.
3. **Tip-success animation.** The `#b04545` flash needs duration + curve. Stub: 600ms total, 200ms in / 100ms hold / 300ms out, ease-out. Confirm in Week 5 with a real prototype before locking.
4. **Cluster threshold per metro.** Initial values in the token snapshot are guesses. Calibrate on a real LA County dataset before launch.
5. **`evidence.chrome` for text section labels — A/B.** The token covers non-text chrome unambiguously (photo brackets, caption strips, source-chip borders). For *text* labels (`CASE FILE`, `SOURCES · 3`, `DATE` / `LOCATION` / `AGENCY`), it may read too dim against `bg.base` at 10–11px. A/B against `text.secondary` (#8a8580) in the next mockup pass — if it holds, use `evidence.chrome` everywhere for the unified "filing system furniture" story; if it doesn't, keep `text.secondary` for text labels and reserve `evidence.chrome` strictly for non-text chrome.
6. **Photo `taken_year` field.** The hero-photo caption strip currently falls back to incident year because `case_media` has no `taken_year`. For evidence photos taken months/years before the incident (a victim's portrait taken in 1980, incident in 1985), the fallback misleads. Schema add for v2: `case_media.taken_year integer null` with extraction logic per-source where available.
7. **Doe-case detail header.** The case-detail spec assumes a victim name in serif. Doe cases (`kind = 'unidentified'`) have no name. Spec stub: serif `Unidentified Female, est. 18–25` with the demographic estimate; if no demographic, just `Unidentified`. Mono-cap label above changes from `MISSING / 1985 / CLAREMONT, CA` to `UNIDENTIFIED / RECOVERED 2003 / MIAMI-DADE, FL` (recovery date, not disappearance). Settle in next mockup pass.
