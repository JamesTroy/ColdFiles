# Visual System Audit — v1.0.0 (Google Play closed testing)

Auditor pass against `mobile/constants/theme.ts` and `docs/04_DESIGN_SYSTEM.md` as source of truth. Focus: dark-only visual hygiene before AAB upload.

Severity legend:
- SHIP-BLOCKER — closed-testing reviewer would flag, or visibly broken on real hardware.
- OTA POLISH — real issue, fixable via OTA push without rebuilding the AAB.
- V1.0.1+ — known limitation or larger refactor; non-blocking.

---

## 1. Design System

### SHIP-BLOCKER
None.

### OTA POLISH

- **`docs/04_DESIGN_SYSTEM.md:28` lies about `text.secondary`.** Doc says `#8a8580`; `mobile/constants/theme.ts:36` is `#a09b95` (with a comment explaining the AA bump). Doc snapshot at `docs/04_DESIGN_SYSTEM.md:552` also still has the old hex. Since the design doc is the contract for any new component author, drift here will silently regress the contrast fix on the next greenfield component. Fix: update the two table cells + the snapshot block. (Doc-only — no code change needed.)

- **`tokens.color.bg.infoTint`, `bg.resolvedTint`, `silhouette.bg/figure`, `photoFrame.bg`, `body.reading` are missing from the design doc.** They live in `theme.ts:24–26, 64–69, 71` and ship in production code (`trust-disclosure.tsx:31`, `pill.tsx:69`, `list.tsx:206–207`, `watch-zone.tsx:253`). The doc's "Open items" section never declares them, and the Surfaces / Stateful / Amber-tinted-bg tables in the doc are presented as exhaustive. A new contributor reading the doc would synthesize a tinted bg with arbitrary opacity — the exact failure mode the doc explicitly warns against. Document them or move them into the documented sections.

- **`UnsolvedPill` (`pill.tsx:25–38`) takes no `kind`/`status` argument and is hard-coded to render literally `UNSOLVED`.** The pill spec in `docs/04_DESIGN_SYSTEM.md:243–249` only ever defines this state, but the case-detail screen (`app/case/[slug].tsx:174`) renders it unconditionally for every case regardless of `c.status`. A `cleared_arrest` or `identified` case will today show `UNSOLVED` + `RESOLVED · YYYY` (when within 30 days) or just `UNSOLVED` next to a green pill. The closed-testing seed is all-open so this won't fire visibly, but it's a latent shipping bug.

- **`ResolvedPill` is defined (`pill.tsx:64–77`) but never imported anywhere.** `app/case/[slug].tsx` renders only `UnsolvedPill` + `ColdPill`. The recently-resolved pill is specced as load-bearing in `docs/04_DESIGN_SYSTEM.md:271–280` ("the only sanctioned use of green in the app"). Either wire it into case-detail or document that it's deferred to v1.0.1.

### V1.0.1+

- **`FilterChip` (`pill.tsx:86–117`) is colocated in `pill.tsx` even though the doc separates "filter chip" from "pills."** The file comment acknowledges it ("not technically a pill, same family"). Splitting into `cf/filter-chip.tsx` would let `pill.tsx` truly enforce the pill grammar.
- **No `cluster` renderer component exists.** Cluster styling lives only inside `leaflet-map.tsx:280–298` as injected CSS. When the native MapLibre path comes back online, this CSS block will need a sibling SVG/native renderer; lift it now into a `cf/cluster-bubble.tsx` token-driven primitive.
- **`tokens.tipFlow.disclosureSurfaces.modal` copy in `theme.ts:217` says "What you share with them is between you and the agency"; the doc snapshot at `docs/04_DESIGN_SYSTEM.md:646` and the doc body at `:436` say "tip content."** Two different shipping copies for the same load-bearing legal disclosure. Pick one and align all surfaces.
- **`tokens.cluster.zoomThreshold` in `theme.ts:132` is read by no consumer.** Per doc this should drive cluster-vs-pin switching per-metro; the Leaflet renderer hard-codes `maxClusterRadius: 50` (`leaflet-map.tsx:460`) instead.

---

## 2. Color & Typography

Contrast math (WCAG 2.1 normal-text AA threshold = 4.5:1; large-text AA = 3.0:1):

| Pair | FG | BG | Ratio | AA-normal |
|---|---|---|---|---|
| Primary CTA label `#1a1408` on `accent.amber` | `#1a1408` | `#c5a572` | 7.84:1 | PASS |
| Tab bar active label (amber on bg.base) | `#c5a572` | `#0a0a0a` | 8.48:1 | PASS |
| Tab bar inactive label (text.secondary on bg.base) | `#a09b95` | `#0a0a0a` | 7.18:1 | PASS |
| Body `text.primary` on `bg.base` | `#f5f1ea` | `#0a0a0a` | 17.59:1 | PASS |
| Body `text.secondary` on `bg.base` | `#a09b95` | `#0a0a0a` | 7.18:1 | PASS |
| `text.disabled` on `bg.base` | `#5a5550` | `#0a0a0a` | 2.69:1 | FAIL (intentional — disabled state is exempt) |
| `evidence.chrome` on `bg.base` | `#5a5550` | `#0a0a0a` | 2.69:1 | FAIL — see findings |
| `evidence.chrome` on `bg.elev1` | `#5a5550` | `#161616` | 2.46:1 | FAIL — see findings |
| `text.info` on `bg.infoTint` | `#b5d4f4` | `#0e1418` | 12.09:1 | PASS |
| `body.reading` on `bg.base` | `#d5cdbe` | `#0a0a0a` | 12.54:1 | PASS |
| UNSOLVED amber on `bg.amberTintPill` | `#c5a572` | `#2a2520` | 6.50:1 | PASS |
| RESOLVED green on `bg.resolvedTint` | `#6a8b6e` | `#1a201b` | 4.37:1 | LARGE-OK (just under normal AA, above large AA) |
| `tip.success` on `bg.elev1` | `#b04545` | `#161616` | 3.26:1 | LARGE-OK |
| Sign-in error red on `bg.base` | `#b04545` | `#0a0a0a` | 3.57:1 | LARGE-OK |
| Doe pin on `bg.base` | `#d5cdb8` | `#0a0a0a` | 12.50:1 | PASS |
| Homicide pin on `bg.base` | `#9a8569` | `#0a0a0a` | 5.59:1 | PASS |

### SHIP-BLOCKER
None. The CTA, tab bar, body text, and primary surfaces all clear AA comfortably. The amber-on-amberTintPill (UNSOLVED) clears 6.50:1, well above threshold.

### OTA POLISH

- **`evidence.chrome` (`#5a5550`) renders as a structural label in body copy at 2.46–2.85:1, below AA.** Hits at:
  - `case/[slug].tsx:196–199` — `CASE FILE` label, 11px on `bg.base`. (Doc Open Item #5 already flagged this for A/B testing — landing on the dim option is what shipped.)
  - `case/[slug].tsx:226–232` — `SOURCES · N` label, same surface.
  - `case/[slug].tsx:354–355` — `TIP ROUTED` label inside the receipt block, on `bg.amberTintCard` (~2.4:1).
  - `app/(tabs)/list.tsx:96–112` — `RECENTLY UPDATED` and `ALL CASES NEAR YOU` section labels.
  - `app/(tabs)/me.tsx:60–66, 149–155` — `ACCOUNT · SUBSCRIPTION · PRIVACY` and footer.
  - `components/cf/peek-sheet.tsx:75–81` — `SELECTED · X.X mi away` in the peek.
  - `components/cf/photo-frame.tsx:140–147, 256–266` — reconstruction pill + caption strip text.

  These are mono-cap section labels and are AA-exempt for "incidental decorative text" only if the user can derive the same information another way. For `CASE FILE` / `SOURCES · N` / `RECENTLY UPDATED` they're the only delivery of the section semantics, so a Play Console or partner accessibility scan will surface them. Recommend: swap `evidence.chrome` for `text.secondary` (`#a09b95`, 7.18:1) at every text-label site, keep `evidence.chrome` for non-text chrome (photo brackets `photo-frame.tsx:218`, source-chip border `source-chip.tsx:39`, framing only). This is exactly the resolution direction Open Item #5 in the design doc anticipated.

- **`tokens.size.monoCaption = 9px` ships in production at `evidence.chrome` color** (`peek-sheet.tsx:97` "Open →" is 11px so OK; but `photo-frame.tsx:140–147` reconstruction pill, and the `SAMPLE` tag at `app/(tabs)/index.tsx:383` and `list.tsx:264` are 9px monoCaption on `evidence.chrome`). At 9px `#5a5550` is below the legibility floor on a Pixel 3a. Either bump the size to 10px (`monoLabel`) or use `text.secondary` at 9px.

- **`SansBody` size in error message uses `tip.success` red as an error color.** `app/sign-in.tsx:178`, `app/delete-account.tsx:174` — the doc explicitly says (`:84`): "Using `tip.success` in any other context (a recently-updated ring, **an error toast**, a delete confirmation) erodes the moment." This violates the rule the doc declares load-bearing. Recommend: switch error text to `text.primary` plus a chevron or icon affordance, or to `text.secondary` italicized — anything but the alarm color.

- **`AmberCTA` letter-spacing is `0.1` (a literal pixel value)** at `cta-button.tsx:60`. Inter at 14px Medium with 0.1px tracking is essentially `letterSpacing: 0` — a no-op on most devices. The `tokens.tracking.label = 0.10` token is the *em-relative* tracking value the rest of the system uses (multiplied by font size). Given this is the primary CTA, the tracking is design-load-bearing — clarify intent: either drop the line, or use `tokens.size.body * tokens.tracking.label`. Same issue at `tip/[slug].tsx:360` "Copy link" sets `letterSpacing: 0` explicitly which contradicts the AmberCTA contract.

### V1.0.1+

- **No light-mode lint guard.** The doc states "Don't hard-code hex anywhere outside the token file" but `cta-button.tsx:43,54`, `pill.tsx:69, 110`, `tip/[slug].tsx:360`, `app/(tabs)/index.tsx:330`, `watch-zone.tsx:430`, `map-canvas.tsx:50–51, 59` all carry hex literals. They're correct values (`#1a1408` is the dark-on-amber CTA color which is referenced in the doc but missing from `theme.ts`), but they're undocumented and unenforced. Add `tokens.color.text.onAmber = '#1a1408'`, `tokens.color.bg.resolvedTint = '#1a201b'` (already exists), and an ESLint custom rule to ban inline `#` in component files.
- **Newsreader 18px+ rule (`docs/04_DESIGN_SYSTEM.md:107`) is well-enforced** — verified across `peek-sheet.tsx:91` (18px), `case/[slug].tsx:164` (h1 28px), `saved.tsx:138` (h2 20px), `legal-doc.tsx:76` (h2 20px). One subthreshold use: `tip/[slug].tsx:166` ships serif at 19px which is fine. Clean here.
- **`tip/[slug].tsx:255` `fontStyle: 'italic'` on a typed-in tip body** — applies italic to user input as well as to placeholder. Should be conditional on `!tipBody`. Cosmetic, low impact.

---

## 3. Dark Mode

App is dark-only by design. `app/_layout.tsx:4–7, 43–54` explicitly ignore `useColorScheme()` and pin a custom `DarkTheme` to `navTheme`. `StatusBar style="light"` is set globally (`_layout.tsx:126`).

### SHIP-BLOCKER
None.

### OTA POLISH
None.

### V1.0.1+

- **`accessibilityIgnoresInvertColors` only set on the hero photo (`photo-frame.tsx:87`).** When a user has Android's "Color inversion" accessibility filter on, every other surface in the app inverts — including the carefully-tuned amber tints, photo brackets, the `you.here` blue dot, etc. For a dark-only app this looks comically wrong (cream backgrounds, dark text, reversed pin colors). Apply the prop wholesale on the root `<View>` of each screen, or document that color inversion is unsupported.
- **`tokens.color.silhouette.bg/figure` (`#1f1a10`/`#3a3325`) palette is warm-amber-tinted** (`list.tsx:206–207`). For a Doe row that's already dimmed to 0.5 opacity (`list.tsx:201`), the silhouette comes out tinted dimensionally — but the doc forbids generic silhouette placeholders for victims (`docs/04_DESIGN_SYSTEM.md:293`). The current code uses the silhouette for *anyone with `has_photo: true`* — i.e. as a loading placeholder until image data lands, not as a no-photo treatment — which is consistent with the doc, but the rule is fragile. Document this clearly.
- **No dark-status-bar override on modal screens** (`tip/[slug].tsx`, `sign-in.tsx`, `search.tsx`). `_layout.tsx:126` sets it globally `light`, which is correct for the dark theme but if Android ever decides to tint the status bar per-route on a sliding modal, the tip flow could flash a light bar. Belt-and-suspenders: explicitly mount `StatusBar style="light"` inside each modal screen.

---

## 4. Icon Consistency

Icon set inventory:
- `Ionicons` (22 sites — `chevron-back`, `chevron-back`, `close`, `search`, `share-outline`, `star`, `star-outline`, `locate-outline`).
- `IconSymbol` via `MaterialIcons` Android shim (4 entries: `map`, `format-list-bulleted`, `bookmark`, `person` — used only by `cf/tab-bar.tsx`).
- Custom SVG via `react-native-svg` (`cf/pin.tsx`, `cf/photo-frame.tsx` brackets, `cf/map-canvas.tsx`, the inline SVG in WebView for Leaflet markers).

The recent fix added `'map.fill' / 'list.bullet' / 'bookmark.fill' / 'person.fill'` to `components/ui/icon-symbol.tsx:21–31`. All four tab-bar icons present.

### SHIP-BLOCKER
None.

### OTA POLISH

- **Icon size scale is inconsistent.** Sizes used across the app: `16` (share, save star), `18` (chevron-back, search, close), `20` (locate-outline, onboarding chevron-back), `22` (tab bar IconSymbol). No documented scale, no token. The 18px back-chevron versus 20px back-chevron in onboarding (`onboarding.tsx:201`) versus 22px tab icon is a visible jitter when swapping screens. Recommend: introduce `tokens.icon.size = { sm: 16, md: 18, lg: 22 }` and standardize.

- **Stroke-width inconsistency between Ionicons and MaterialIcons.** Ionicons line variants (`chevron-back`, `close`, `share-outline`, `locate-outline`, `star-outline`) draw at a thinner default stroke than MaterialIcons filled glyphs (`bookmark`, `person`, `map`, `format-list-bulleted`). The tab bar therefore feels visually heavier than the rest of the chrome. The Material `*-outlined` variants are available on the same import; for parity with the case-file aesthetic, switch the tab bar mapping to `map-outlined`, `format-list-bulleted` (already line), `bookmark-border`, `person-outline`. Tab-bar redesign already amber-dot-indicates active state, so the active distinction doesn't need filled vs outline.

### V1.0.1+

- **`IconSymbol` Android shim silently drops unmapped names** (`components/ui/icon-symbol.tsx:14–20` — comment acknowledges this). The MAPPING object is also typed `as IconMapping` which casts the partial object to a full record, so TypeScript can't catch a missing entry. Recommend: change the type to `Partial<IconMapping>` and have the renderer log/fallback when `MAPPING[name]` is undefined.
- **`paperplane.fill` and `house.fill` mappings exist in `icon-symbol.tsx:22–23` but no consumer uses them.** Dead entries. Trim or use them where appropriate (e.g. tip CTA could use a paperplane glyph in a v2 mockup).
- **No icon for `chevron-right` on the case-detail back button anywhere; right-chevron only used as a literal `→` mono character** (`me.tsx:81–139`, `case/[slug].tsx:217`). Strings vs glyphs is fine for the case-file aesthetic but document it as a deliberate choice: arrows are typewriter glyphs, not icons.

---

## 5. Spacing & Layout

### SHIP-BLOCKER
None.

### OTA POLISH

- **Card and chrome corner radii are inconsistent.** Tokens declare `radius.card = 8`, `radius.chip = 14`, `radius.sheet = 16`, `radius.pill = 12`. Concrete violations:
  - `app/(tabs)/me.tsx:172` — `borderRadius: 6` for cards (should be `tokens.radius.card`).
  - `app/(tabs)/me.tsx:171, watch-zone.tsx:147` — `borderRadius: 6` for cards.
  - `app/sign-in.tsx:165, watch-zone.tsx:128, search.tsx:88` — `borderRadius: 6` for inputs.
  - `app/(tabs)/list.tsx:194` — thumbnail uses `borderRadius: 4`.
  - `components/cf/source-chip.tsx:38` — chip `borderRadius: 4`.
  - `components/cf/photo-frame.tsx:135, 218` — reconstruction pill `borderRadius: 3`, sample tag `borderRadius: 3`.
  
  This is OTA-fixable; the doc never declares anything below 4px. Either add `tokens.radius.input = 6, thumbnail = 4, microPill = 3` or tighten everything to the existing token set. The visible inconsistency: the Me-tab card (6px) sits above source chips (4px) sits above SAMPLE pill (3px), and the eye reads gradient noise rather than a deliberate hierarchy.

- **Horizontal padding is inconsistent.** Header padding is 16 in most screens (`index.tsx:86`, `list.tsx:47`), but list rows pad 18 (`list.tsx:139`), me-tab rows pad 13 (`me.tsx:184`), peek pads 18 (`peek-sheet.tsx:45`), photo-frame margin is 16 (`photo-frame.tsx:73`), narrative section pads 16. No clear rhythm: some surfaces start at 16, others at 18. Recommend: standardize on 16 for screen edges and 18 only inside row-content blocks where touch targets need extra room.

- **Tab bar `paddingBottom: insets.bottom > 0 ? insets.bottom : 12`** (`cf/tab-bar.tsx:47`). On a Pixel without a gesture nav inset (`insets.bottom === 0`), the tab bar gets only 12px bottom padding while the icon (22px) + label (11px) + indicator (4px) + gaps (12px+) total ~50px. This is fine; but on an Android device with a 3-button nav and `insets.bottom > 0` of e.g. 8px, the tab bar will compress vs. on a Pixel 7 with 24px gesture inset. Test on a real Galaxy A14 before lock; if it compresses, set `paddingBottom: Math.max(insets.bottom, 12)`.

### V1.0.1+

- **`peek-sheet.tsx` doesn't use `tokens.radius.sheet`** — sets `borderTopLeftRadius: 16, borderTopRightRadius: 16` literally. Functionally identical (token is also 16) but textually drifts from the system.
- **`watch-zone.tsx:271, 322` — "42 cases inside" floating chip** uses inline `borderRadius: 12` (matches `tokens.radius.pill` but isn't named).
- **Case-detail key-facts table padding** (`key-facts.tsx:30–32`) is `paddingHorizontal: 14, paddingVertical: 12`; doc spec at `docs/04_DESIGN_SYSTEM.md:306` says "12×14px padding" — match (14h × 12v vs spec 12×14). Worth confirming the spec's axis convention.
- **`tokens.color.bg.elev2` is declared (`theme.ts:18`) and documented but ships with no consumer.** The pill spec at `docs/04_DESIGN_SYSTEM.md:275` says cleared-status pills use `text.secondary on bg.elev2`; since the cleared-status pill itself is unimplemented this token has no rendering proof. Will surface when ResolvedPill follow-up lands.
- **`SectionLabel` in `app/(tabs)/list.tsx:96–113` and `watch-zone.tsx:368–378` and the inline mono-cap section labels in `case/[slug].tsx:193–200, 226–233`, `tip/[slug].tsx:203–209, 224–230` are all duplicated copies of the same pattern.** Promote to a shared `<SectionLabel>` primitive in `cf/text.tsx`.

---

## Summary tally

| Audit | SHIP-BLOCKER | OTA POLISH | V1.0.1+ |
|---|---|---|---|
| Design System | 0 | 3 | 4 |
| Color & Typography | 0 | 3 | 3 |
| Dark Mode | 0 | 0 | 3 |
| Icon Consistency | 0 | 2 | 3 |
| Spacing & Layout | 0 | 3 | 5 |
| **Total** | **0** | **11** | **18** |

No SHIP-BLOCKERS. The visual system is shippable for closed testing. OTA polish list is tractable in a single afternoon push.
