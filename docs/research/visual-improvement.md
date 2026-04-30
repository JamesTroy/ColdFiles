# Visual Improvement Brief — The Cold File (mobile)

**Status:** research, not implementation. Aesthetic-payoff-per-engineering-hour. Posture-respecting only.
**Constraint stack:** dark base, single amber accent, three-typeface system, ethical posture > consumer appeal, no traffic-light, no mascots, no decorative photography.

---

## Executive summary

The Cold File is already correctly *positioned*: editorial restraint, a locked palette, shape-first pins, serif-as-arrival. What's missing is the next typographic layer — the layer that separates "well-designed app" from "feels like a real case file." Five recommendations carry the most aesthetic payoff per engineering hour:

1. **Switch Newsreader to its variable optical-size axis (`opsz`)** so the case-detail H1 (28px) uses display-cut subtleties and peek titles (20px) use text-cut warmth. Free upgrade. (1h OTA)
2. **Tabular old-style figures in mono date strings, lining figures in case numbers.** Date `Oct 13, 1985` reads as prose; `LA-1985-0341` reads as catalog. Today both render identically. (1h OTA)
3. **Mid-rule separators (`·` for inline, `—` for block, `|` never)** as a global rule across mono-cap label rows. Cheap, distinctively editorial, already half-done in the spec. (15min OTA)
4. **Map style: replace OpenFreeMap dark with a Stamen-Toner-derived, near-black, type-led monochrome JSON.** Strips the basemap to roads + water + county lines so pins carry the entire visual weight. The single largest aesthetic lift in the app. (4h OTA — style JSON only, no native code)
5. **Ledger-block caption under PhotoFrame** — replace the single 28px caption strip with a two-line evidence tag: `PHOTO 01 / LASD HOMICIDE BUREAU` over `1985 · CONTACT SHEET 03 · FRAME 12`. Reads as a real evidence-room contact sheet. (1h OTA)

Texture, motion, and onboarding refinements come after. The first five are the brand-defining moves.

---

## 1. Aesthetic references

### 1.1 ProPublica article-layout framework

- **Reference:** [Inside ProPublica's Article Layout Framework](https://www.propublica.org/article/inside-propublicas-article-layout-framework) and [Design Principles for News Apps & Graphics](https://www.propublica.org/nerds/design-principles-for-news-apps-graphics).
- **Move:** Layouts modulate visual rhythm and contrast to determine emphasis. Inset character portraits at paragraph-starts when a cast is being introduced; large establishing photos signal a location/scene change. Built on `Column Setter` — a strict editorial grid, not a CSS framework.
- **Cold File application:** the **case detail screen** (`mobile/app/case/[slug].tsx`) currently flows hero photo → key-facts → narrative → sources as sequential cards. ProPublica's lesson is **rhythm**: introduce a column-rule (1px `border.subtle` vertical) between the key-facts table and narrative on screens ≥ 380dp, so the eye registers "facts column / narrative column" instead of "two cards stacked." On smaller screens, fall back to stacked.
- **Effort:** 4h OTA.

### 1.2 The Marshall Project — 1950s legal-document typography

- **Reference:** [SND World's Best Designed Website 2016](https://www.themarshallproject.org/2016/04/12/the-marshall-project-named-world-s-best-designed-website); [An Unbelievable Story of Rape — Fonts In Use](https://fontsinuse.com/uses/11297/an-unbelievable-story-of-rape).
- **Move:** Designer Andy Rossback explicitly mirrors fonts and forms found on legal documents and stationery from the 1950s and 1960s — Thurgood Marshall's era. The site reads as a sustained period-document evocation; mono-caps section labels, generous rule lines, justified body text in narrow measure.
- **Cold File application:** validates the existing direction (mono-caps section labels, evidence chrome, serif-as-arrival). The borrowable move is **rule-line discipline** — every section break in case detail (above `CASE FILE`, above `SOURCES · 3`, above the sticky bar) becomes a 0.5px `border.subtle` rule that runs the full content width with 16px label-side padding and *hangs* into the gutter on the right. Rule-lines that hang are document furniture; rule-lines that stop at the text margin are app furniture.
- **Effort:** 1h OTA.

### 1.3 Atavist — fixed serif headers in scrolly-tell

- **Reference:** Atavist Magazine's longform format (atavist.com). Web search did not surface a canonical writeup — direct fetch of an Atavist piece is the only confirmation, and editorial layouts shift per-story.
- **Move:** Fixed serif title bar that persists in the upper region as the reader scrolls; subtitle and byline collapse into a thin rule. The serif title carries the article identity through the entire vertical journey.
- **Cold File application:** **case detail screen** — when the user scrolls past the hero photo, the victim name (currently in the header card) collapses into a sticky 18px serif strip with a 0.5px bottom rule. The peek-sheet's "arrival" signal carries down the entire scroll. Implementation: a 56px sticky header with the serif name + mono-cap kind/year/location underneath; appears at `scrollY > heroHeight + 80px`.
- **Effort:** 4h OTA.

### 1.4 IA Writer — typographic restraint as voice

- **Reference:** [iA: Responsive Typography](https://ia.net/topics/responsive-typography-the-basics); [iA Writer Quattro](https://ia.net/topics/in-search-of-the-perfect-writing-font).
- **Move:** "The gutter is not an aesthetic matter — it lets the text breathe and helps the eye jump from line to line." Monospace says "this is in progress"; proportional says "this is done." Voice is encoded in font choice.
- **Cold File application:** reinforces the existing three-family rule. The borrowable move is **measure** — line-length on the case-detail narrative excerpt (`mobile/app/case/[slug].tsx`) should be capped at 60 characters via `maxWidth` in dp (~340dp at 13px Inter Regular). Currently it stretches edge-to-edge on phablets. Long line + small type is a "feed" tell; capped line + small type is an "essay" tell.
- **Effort:** 15min OTA.

### 1.5 Field Notes — single-typeface discipline

- **Reference:** [Field Notes brand site](https://fieldnotesbrand.com/) and [Field Notes guide on JetPens](https://www.jetpens.com/blog/Field-Notes-A-Comprehensive-Guide/pt/417). They use only the Futura family (Paul Renner, 1927) across the entire product line.
- **Move:** A single typeface family used across thirty-plus quarterly editions. The discipline is the brand. Variation comes from paper, ink, and printing technique, never from typeface swapping.
- **Cold File application:** validates the locked three-family stack. The borrowable move is **don't introduce a fourth face for "interest"** — when a future surface (the donate page, the press kit, the in-app changelog) asks for "something different," answer it with mono-cap tracking, not a new face. This is a *don't-do* lesson, recorded here so future-James doesn't add a fourth font when v1.0.5 needs a press page.
- **Effort:** n/a — discipline rule.

---

## 2. Typographic depth

The current stack ships three families. The next refinement layer:

### 2.1 Newsreader optical sizing (`opsz` axis)

- **Reference:** [Newsreader on Google Fonts](https://fonts.google.com/specimen/Newsreader); [Optical Size axis — Google Fonts Knowledge](https://fonts.google.com/knowledge/glossary/optical_size_axis); [Newsreader on GitHub](https://github.com/productiontype/Newsreader).
- **Move:** Newsreader is a variable font with `opsz` 6–72. Display sizes get more delicate stroke contrast and larger x-height; text sizes get less contrast and lower x-height; the smallest sizes get wider letters and looser spacing. At present the app loads `Newsreader_500Medium` as a static cut — the same metrics at 28px (case detail H1) and 20px (peek title), which means one of those is wrong.
- **Cold File application:**
  - `mobile/app/case/[slug].tsx` H1 (28px): load Newsreader variable, set `fontVariationSettings: { opsz: 28, wght: 500 }`.
  - peek-sheet title (20px) `mobile/components/peek-sheet.tsx`-equivalent: `opsz: 20`.
  - This is invisible at first glance and devastating in side-by-side. The display cut at 28px earns the serif — at the static 14px text cut Newsreader looks like any well-set web serif.
- **Effort:** 1h OTA (font load + style change; verify on Pixel 3a baseline).

### 2.2 Old-style vs lining figures

- **Reference:** [Text figures — Wikipedia](https://en.wikipedia.org/wiki/Text_figures); [Butterick on alternate figures](https://practicaltypography.com/alternate-figures.html); [Oldstyle Figures — Fonts.com](https://www.myfonts.com/pages/fontscom-learning-fontology-level-3-numbers-oldstyle-figures).
- **Move:** Old-style figures (text figures) have variable heights — 6 and 8 ascend, 3/4/5/7/9 descend, 0/1/2 sit at x-height — and blend with lowercase prose. Lining figures sit at cap height and read as cataloging/forensic. The pro move is to use both, intentionally:
  - **Old-style** in the narrative excerpt (prose context: "in 1985 the body was found...").
  - **Lining (tabular) figures** in mono case numbers and dates (catalog context).
  - **JetBrains Mono is monospaced and lining by design** — leave it. The split happens in Inter and Newsreader.
- **Cold File application:**
  - `mobile/app/case/[slug].tsx` narrative excerpt: `fontFeatureSettings: '"onum" on, "pnum" on'` on the body Text node.
  - Key-facts table values when rendered in Inter (e.g. `LOCATION: Claremont, CA`): default lining (no change).
  - Mono date row (`Oct 13, 1985` mono-Medium) keeps tabular lining for column alignment in lists.
- **Effort:** 1h OTA. Inter ships both; toggle via `fontFeatureSettings`.

### 2.3 Hanging punctuation + mid-rule separators

- **Reference:** [Butterick — alternate figures + hanging punctuation](https://practicaltypography.com/alternate-figures.html); editorial-typography conventions documented across the [Marshall Project SND piece](https://www.themarshallproject.org/2016/04/12/the-marshall-project-named-world-s-best-designed-website).
- **Move:** Hanging punctuation pulls opening quotes into the left margin so the optical alignment of the first letter matches surrounding lines. Mid-rule separators (`·` middot for tight inline, `—` em-dash for sentence-level breaks, `|` never — pipe is engineer punctuation) signal "this is set type, not concatenated strings."
- **Cold File application (per surface):**
  - **Map header** `mobile/app/(tabs)/index.tsx`: filter chip row separator already uses spacing. Use `·` between count and label: `327 · cases in view`.
  - **Case detail key-facts**: replace any `:` between label and value with rule-only separation (already specced). Reinforce — never `LABEL: value` inline; always rule-separated stacks.
  - **Peek-sheet kind line**: spec already uses ` / ` for `HOMICIDE / 1985 / CLAREMONT, CA`. Audit codepaths and confirm the slash is a true forward-slash with hair-spaces on either side, not a programmatic `.join('/')`. (Easy regression vector.)
- **Effort:** 15min OTA.

### 2.4 Mono-cap tracking refinement

- **Reference:** internal design system locks tracking at 0.10em for labels, 0.05em for chips. See `docs/04_DESIGN_SYSTEM.md` typography rule 5.
- **Move:** the existing rule is correct. The depth move is **size-relative tracking**: 9px mono-cap wants 0.12em, 11px wants 0.10em, 13px wants 0.06em. As size grows, tracking shrinks. The current static 0.10/0.05 is right at the median.
- **Cold File application:** add `tokens.tracking.labelTight: 0.06` and `tokens.tracking.labelExtra: 0.12`; use the wider value on PhotoFrame's 9px caption (`mobile/components/photo-frame.tsx`-equivalent), keep 0.10 on 11px section labels, drop to 0.06 on the 13px mono case-number in case-detail key-facts.
- **Effort:** 15min OTA.

---

## 3. Texture and paper

### 3.1 Grain-noise overlay on dark surfaces

- **Reference:** [Grainy Texture for Graphic Design — Peterdraw](https://peterdraw.studio/blog/grainy-texture-for-graphic-design); general editorial-noise conventions across recent design press.
- **Move:** A tiled SVG noise (`<feTurbulence baseFrequency="0.9" numOctaves="2" />` filter, masked at 3–5% alpha) over `bg.base` adds tactile depth. The trap is **OLED**: too much noise reads as compression artifact, not paper. Tuned correctly it reads as offset-printed black on uncoated stock; tuned wrong it reads as a broken display.
- **Cold File application:** apply only to `bg.base` (the map underlay and the case-detail background), never to elev1/elev2 (which would muddy contrast on the cards). 4% alpha, 200×200px tiled noise. Skip on Android `Build.VERSION.SDK_INT < 29` where the GPU compositor stutters on full-screen filtered surfaces.
- **Open question:** whether the noise should be **static SVG asset** (no GPU cost, perfectly stable, ships once) or generated per-render (zero asset weight, costs paint). Static SVG asset wins for v1 — the texture is a brand element, not a render-time effect.
- **Effort:** 4h OTA. Build a real prototype on a Pixel 3a before committing — the OLED-vs-noise question doesn't have a textbook answer.

### 3.2 Subtle watermark / file-stamp accent

- **Reference:** court-document and forensic-report archival conventions. No single named source — this is a category convention.
- **Move:** a faint mono-cap watermark string in the upper-right of the case detail screen — `CASE FILE / LA-1985-0341` at 8px JetBrains Mono, `evidence.chrome` at 30% alpha, rotated 0deg (NOT diagonal — diagonal is "DRAFT" and crosses into kitsch).
- **Cold File application:** case detail screen, top-right of the hero region, scrolls with content. Only on screens with a confirmed `external_id`. If case has no agency case number, omit the watermark entirely (don't fake it).
- **Effort:** 1h OTA.

### 3.3 What crosses into "noise"

The line is at **3–5% alpha for full-screen grain** and **20–30% alpha for type-shaped chrome elements**. Above those values the user reads "broken display"; at or below, the user reads "uncoated stock." Test on the lowest-spec target device (Pixel 3a / Galaxy A14) before locking — the cheap-OLED rendering threshold is the deciding factor.

---

## 4. Motion as restraint

### 4.1 What fits

- **Reference:** internal memory note `feedback_design_pulse_only_when_fresh.md` — pulse is reserved for live data; non-semantic indicators get wide-scale low-alpha breathing.
- **Move (additive):**
  - **Rule-line "tick down"** on case-detail scroll: as the user scrolls past each section header, the section's leading rule briefly extends 12px to the left (a 200ms ease-out tick). This evokes a typewriter advance line. Use sparingly — once per section per scroll-pass, not on every paint.
  - **Cluster expansion** is already specced at 200ms stagger. Confirm it lands.
  - **Selection halo** on pin tap: the existing amber halo at 1.6× should ease in over 120ms, not snap. The snap is the current default and reads as "tappable button," not "selected file."
- **Cold File application:**
  - `mobile/components/pin.tsx` (or wherever `accent.amber` halo renders): wrap halo opacity in a 120ms `withTiming` (Reanimated 3).
  - case detail rule-tick: a `useScrollViewOffset` hook + `useAnimatedStyle` per section header. Build once, reuse across `CASE FILE`, `SOURCES`, sticky-bar approach.
- **Effort:** 4h OTA.

### 4.2 What crushes the posture

- **Lottie animations of any kind.** Lottie is consumer-app DNA. The Cold File should never load a `.json` Lottie file.
- **Parallax scrolling** on the hero photo. Parallax says "magazine app." We're a case file — the photo should sit still on the page like a photograph in a folder.
- **Spring easing curves** with overshoot (`tension: 200, friction: 12` and similar). Springs are friendly. The Cold File is not friendly. Use ease-out cubic for arrival, ease-in cubic for dismissal, never spring.
- **Page-turn skeuomorphism** ([NN/G on skeuomorphism](https://www.nngroup.com/articles/skeuomorphism/) and [iBooks page-turn discussion](https://forums.macrumors.com/threads/books-new-page-turn-animation-is-disappointing.2347214/)). A literal 3D paper-turn between cases would crater the posture instantly. The serif-arrival pattern is doing this work already at the type level; don't double-tap it with motion.
- **Pull-to-refresh with a custom illustrative spinner.** Use the platform default. A custom amber-tinted spinner stops being "filing system furniture" and starts being branded delight, which is the wrong register.

---

## 5. Map style

### 5.1 Stamen-Toner-derived monochrome basemap

- **References:** [Stamen Toner](https://maps.stamen.com/toner/); [Stamen Toner-Lite](https://maps.stamen.com/toner-lite/); [Stamen "Dark (Map) Materials"](https://stamen.com/stamens-dark-map-materials/); [Carto Positron + Dark Matter](https://stamen.com/introducing-positron-dark-matter-new-basemap-styles-for-cartodb-d02172610baa/); [More ways to make your maps go Dark Mode](https://stamen.com/more-ways-to-make-your-maps-go-dark-mode/).
- **Move:** Toner is "all about simplicity and contrast, using black and white only and artfully inking the minimum amount of features onto the map." Carto's Dark Matter (Stamen-designed) is "a dark base map and good starting point for other darker designs" specifically tuned to *get out of the way* of overlay data. The Cold File needs exactly this: a monochrome dark basemap with stripped feature density so the pins carry 100% of the visual weight.
- **Cold File application:** the current `tokens.map.styleUrl: 'https://tiles.openfreemap.org/styles/dark'` is a serviceable Carto-derived dark style, but it still renders too many feature classes (commercial labels, secondary roads, parks). Author a custom MapLibre style JSON that:
  - keeps **water** (`#0a0a0a` slightly cooler — `#080a0c`) and **state/county boundaries** (1px `evidence.chrome` at 40% alpha)
  - keeps **primary and secondary roads** as 0.5px `border.subtle` lines (no fill, no casing)
  - **drops** all POI categories, all label classes except `place_city` and `place_town` (mono-cap, 9px, `text.disabled` at 60% alpha)
  - **drops** `landuse`, `building`, `landcover` (the OFM dark style still paints faint park polygons; remove them)
  - host the JSON in Supabase Storage or pinned CDN, point `tokens.map.styleUrl` at it
- **Effort:** 4h OTA — style authoring + hosting; no native build.
- **Reference for matching ambition:** the *Citizen* app is the cautionary opposite. Citizen uses red, urgency-coded basemap tinting, and broadcast-graphics motion. The Cold File map should read as the photographic negative of Citizen — same category, opposite posture.

### 5.2 Place-label typography on the basemap

The map is the only surface where Inter is used at sub-12px sizes. This is the right place to also load JetBrains Mono into the map style for `place_city` labels at 9px mono-caps with 0.10em tracking. Map-as-document. (1h OTA — handled by the same style JSON change.)

---

## 6. Photography presentation

### 6.1 Two-line ledger caption block

- **Reference:** evidence-room contact-sheet conventions (no single web reference; cross-referenced from [ProPublica's visual journalism review](https://features.propublica.org/2018-year-in-review/propublica-visual-journalism-data-design-photography-illustration-video/) which leans on the same period-vocabulary, and from analog photography contact-sheet practice).
- **Move:** real evidence tags carry two strata of metadata: identifier line (photo number / source) and contextual line (date / processing notes / frame number). The current PhotoFrame caption strip merges these into one line, which compresses the document signal.
- **Cold File application:** `mobile/components/photo-frame.tsx`-equivalent; replace the single 28px caption strip with a two-line block:
  - Line 1 (10px mono Medium tracking 0.10em, `evidence.chrome`): `PHOTO 01 / LASD HOMICIDE BUREAU`
  - Line 2 (8px mono tracking 0.12em, `evidence.chrome` 70% alpha): `1985 · CONTACT SHEET 03 · FRAME 12` — but only when `case_media` carries `frame_number` / `contact_sheet_id` (deferred fields). If those aren't present, render line 2 as just the year — never invent metadata.
- **Effort:** 1h OTA.

### 6.2 Source-attribution micro-stamp

- **Reference:** the memory note `feedback_photo_sourcing_policy.md` mandates per-photo `source_attribution` on `case_media`. This visual move surfaces what's already required by policy.
- **Move:** a 6px circular source-stamp in the lower-right corner, *inside* the corner brackets, carrying the source code (`NMS`, `LASD`, `FBI`, `DOE`). Outline only, 0.5px `evidence.chrome`. Reads as a darkroom processing stamp.
- **Cold File application:** PhotoFrame, lower-right interior. Skip on Doe-thumbnail dimming variant (per memory note `feedback_doe_thumbnail_fallback.md`, Doe thumbs already carry their own visual restraint).
- **Effort:** 1h OTA.

### 6.3 No-photo em-dash treatment — confirm restraint

The spec already nails this (`text.secondary` em-dash in the same frame). No change needed. Recording it here because the next-most-likely "improvement" proposal will be to add a generic silhouette icon — and the design doc's reasoning ("a generic silhouette reads as disrespectful for a victim") is correct and load-bearing. **Do not add a silhouette placeholder to PhotoFrame.**

---

## 7. Per-screen recommendations

| Screen | File | Recommendation | Effort |
|---|---|---|---|
| Map (home) | `mobile/app/(tabs)/index.tsx` | Author a custom MapLibre style JSON (Stamen-Toner-derived); strip POI/landuse/building, keep water + roads + boundaries + city labels only; mono-cap city labels. The single highest-leverage change in the app. | 4h OTA |
| Case detail | `mobile/app/case/[slug].tsx` | Newsreader variable + opsz (28 for H1, 20 for peek title); old-style figures in narrative; sticky 56px serif strip on scroll; rule-line tick-down on section enter; hanging punctuation on narrative excerpt. | 4h OTA |
| List | `mobile/app/(tabs)/list.tsx` | Cap row-text measure at 60ch; add 0.5px `border.subtle` rule between row meta and victim name (in-row, not between rows); tabular figures on the distance column for column-aligned alignment. | 1h OTA |
| Onboarding | `mobile/app/onboarding.tsx` | Open with a typewriter-tick stamp animation: `THE COLD FILE` types in JetBrains Mono 13px tracking 0.10em over 600ms, *then* the serif logo lock-up fades in beneath. Establishes the "filing system" voice in the first 1.2 seconds. No Lottie, no illustration. | 4h OTA |
| Peek sheet | `mobile/components/peek-sheet.tsx`-equivalent in `index.tsx` | Mid-rule `·` separators between SELECTED · DISTANCE · OPEN; serif title at `opsz: 20`; recompute the kind/year/place line as a single Text node with hair-spaces around `/` (regression-proof against `.join`). | 1h OTA |
| Photo frame | `mobile/components/photo-frame.tsx` (or component path) | Two-line ledger caption (PHOTO NN / SOURCE; YEAR · contact-sheet metadata when present); 6px source micro-stamp inside lower-right brackets. | 1h OTA |
| Tip flow | `mobile/app/tip/[slug].tsx` | No visual changes recommended — the flow is the load-bearing legal-posture surface and "stunning" is anti-fit here. Visual quietness *is* the trust signal. **Hands off.** | n/a |
| Me tab | `mobile/app/(tabs)/me.tsx` | Watermark string in upper-right (`THE COLD FILE / SESSION {hash6}`) at 30% alpha mono-caps. Frames the user's own activity in the same archival register as case files. | 15min OTA |

---

## 8. What NOT to do

Recorded so future-James can re-read this when the temptation arrives.

1. **Do not add cold-blue / steel-blue palette shifts to "modernize."** The amber is the ethical posture; cold-blue would correctly read as Citizen-coded. (Memory note: `feedback_amber_is_ethical_posture.md`.)
2. **Do not add a fourth typeface** for "press kit / changelog / about." Variation comes from tracking and figure-style, never from a new face. (See §1.5 — Field Notes uses *only* Futura across thirty quarterly editions.)
3. **Do not animate stale data.** Pulse is the live-data contract. (Memory note: `feedback_design_pulse_only_when_fresh.md`.)
4. **Do not add Lottie / spring-easing / parallax.** All three are consumer-app DNA. (See §4.2.)
5. **Do not add page-turn / paper-flip transitions.** Skeuomorphic motion is a different aesthetic register from skeuomorphic typography. The serif arrival already does this work. ([NN/G — Skeuomorphism](https://www.nngroup.com/articles/skeuomorphism/).)
6. **Do not add a generic silhouette placeholder to PhotoFrame.** Em-dash in a frame is honest; a silhouette of a person is disrespectful. (Already enforced in the design doc.)
7. **Do not introduce traffic-light pin colors** (red urgent, yellow stale, green resolved). Shape carries kind; the single sanctioned green is `status.resolved` and only for 30 days. (`docs/04_DESIGN_SYSTEM.md` pin system.)
8. **Do not custom-style the pull-to-refresh spinner.** Platform default. A branded spinner is delight; The Cold File trades delight for trust.
9. **Do not mascot, illustrate, or photograph people anywhere.** Decorative photography of any human (including stock-style "researcher at desk") is anti-fit. Documents, archives, and evidence chrome only.
10. **Do not broaden the Play Store store-listing visuals to widen reach.** Memory note: wider Play Store reach is anti-fit for this category. The narrow audience is the audience; visuals should pre-filter not pre-attract.
11. **Do not hot-pink, neon-cyan, or otherwise "highlight" featured cases.** A featured-case treatment would be a fifth amber use and dilute the four sanctioned uses. If editorial-feature ever ships, the answer is mono-cap kicker (`EDITOR'S NOTE`), not a color.
12. **Do not raise the grain-noise alpha above 5%.** Above that threshold the texture stops reading as paper and starts reading as a broken display.

---

## Sources

- [Inside ProPublica's Article Layout Framework](https://www.propublica.org/article/inside-propublicas-article-layout-framework)
- [ProPublica — Design Principles for News Apps & Graphics](https://www.propublica.org/nerds/design-principles-for-news-apps-graphics)
- [ProPublica's Year in (Mostly) Visual Journalism](https://features.propublica.org/2018-year-in-review/propublica-visual-journalism-data-design-photography-illustration-video/)
- [The Marshall Project Named World's Best Designed Website (SND 2016)](https://www.themarshallproject.org/2016/04/12/the-marshall-project-named-world-s-best-designed-website)
- [An Unbelievable Story of Rape — Fonts In Use](https://fontsinuse.com/uses/11297/an-unbelievable-story-of-rape)
- [Newsreader on Google Fonts](https://fonts.google.com/specimen/Newsreader)
- [Newsreader on GitHub (Production Type)](https://github.com/productiontype/Newsreader)
- [Optical Size axis — Google Fonts Knowledge](https://fonts.google.com/knowledge/glossary/optical_size_axis)
- [Text figures — Wikipedia](https://en.wikipedia.org/wiki/Text_figures)
- [Butterick — Alternate figures](https://practicaltypography.com/alternate-figures.html)
- [Oldstyle Figures — Fonts.com](https://www.myfonts.com/pages/fontscom-learning-fontology-level-3-numbers-oldstyle-figures)
- [iA — Responsive Typography](https://ia.net/topics/responsive-typography-the-basics)
- [iA — In Search of the Perfect Writing Font](https://ia.net/topics/in-search-of-the-perfect-writing-font)
- [Field Notes brand site](https://fieldnotesbrand.com/)
- [Field Notes — JetPens guide](https://www.jetpens.com/blog/Field-Notes-A-Comprehensive-Guide/pt/417)
- [Stamen Toner](https://maps.stamen.com/toner/)
- [Stamen — Dark (Map) Materials](https://stamen.com/stamens-dark-map-materials/)
- [Stamen — Introducing Positron & Dark Matter](https://stamen.com/introducing-positron-dark-matter-new-basemap-styles-for-cartodb-d02172610baa/)
- [Stamen — More ways to make your maps go Dark Mode](https://stamen.com/more-ways-to-make-your-maps-go-dark-mode/)
- [Mapbox — Custom map style generator and Monochrome Style](https://blog.mapbox.com/custom-map-style-generator-and-monochrome-style-c7baaa8822a1)
- [Mapbox Standard — Customizable 3D Style Updates](https://www.mapbox.com/blog/standard-style-updates-more-customization-options-to-personalize-the-map)
- [NN/G — Skeuomorphism](https://www.nngroup.com/articles/skeuomorphism/)
- [Peterdraw — Grainy Texture for Graphic Design](https://peterdraw.studio/blog/grainy-texture-for-graphic-design)
