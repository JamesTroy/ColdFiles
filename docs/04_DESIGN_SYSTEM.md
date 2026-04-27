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
| `accent.amber` | `#c5a572` | Primary CTA, user's own selection (chip, halo, icon) |
| `accent.amberHot` | `#e3c485` | Recently-updated case ring (only) |

The amber is the only accent color in the system. It is reserved for **two and only two** roles: primary calls-to-action, and any state that represents *the user's own choice*. If a third use shows up, the design has drifted.

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
| `you.here` | `#5b8fb0` | "You are here" location dot. Intentionally outside the case-color family — it represents the user, not a case, and must not compete with cases visually |
| `tip.success` | `#b04545` | The flash that confirms a tip was successfully routed to the agency. Only this. Do not use this color anywhere else in the app. |

`#b04545` is the alarm-color affordance. It exists in the system because tip-routed-success is a moment the user *should* feel. Using it in any other context (a recently-updated ring, an error toast, a delete confirmation) erodes the moment. Reach for `text.secondary` or `accent.amber` for those.

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
- Section label: `SELECTED · {distance} away`, mono 10px tracking 0.10em, `text.secondary`
- Section label right-aligned: `Open →`, mono 10px, `accent.amber`
- Title: serif 20px, `text.primary` — the victim name
- Meta: sans 12px, `text.secondary` — `{Kind} · {Date} · {Location}`

The serif on the peek title is the only place serif appears outside the case detail page itself — and it appears here because the act of tapping a pin *is* arrival at that case.

---

## "You are here"

The user-location dot is `you.here` (#5b8fb0), with a soft outer ring at 50% alpha and a faint outer halo at 10% alpha. **Never tinted with the case palette.** The user is not a case; the dot must not compete with cases visually. Cool blue is the system's signal that "this is about you, not about a case."

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
  },
  font: {
    serif: 'Newsreader_500Medium',          // 18px+ only — case detail + sheet title
    sans: 'Inter_400Regular',
    sansMedium: 'Inter_500Medium',
    sansSemibold: 'Inter_600SemiBold',
    mono: 'JetBrainsMono_500Medium',
  },
  size: {
    serifH1: 28, serifH2: 20,
    h3: 18, body: 14, meta: 12,
    rowName: 16,
    monoLabel: 10, monoData: 12,
  },
  tracking: {
    label: 0.10,
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
} as const;
```

---

## Open items (resolve before Week 5)

1. **Filter chip behavior with shape encoding.** When a user activates a "Homicide" chip, do remaining pins fade or disappear? Recommend fade (50% alpha) so the user keeps spatial context, but verify with a low-fi mock before locking.
2. **Selected-pin layering with recency.** The treatment is specced, but render-order on Mapbox needs verification — selection halo must render *outside* the recency ring. Empirically this means selection layer above recency layer.
3. **Tip-success animation.** The `#b04545` flash needs duration + curve. Stub: 600ms total, 200ms in / 100ms hold / 300ms out, ease-out. Confirm in Week 5 with a real prototype before locking.
4. **Cluster threshold per metro.** Initial values in the token snapshot are guesses. Calibrate on a real LA County dataset before launch.
