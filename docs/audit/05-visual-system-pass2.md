# Visual System Audit — v1.0.0 Pass 2

Re-audit after `dd718ec476` ("fix(mobile): address ship-blockers and polish from UX audit pass") landed. Same 5 audits, same severity legend, scoped to (a) verifying prior fixes, (b) surfacing new findings, (c) flagging regressions.

Severity legend:
- 🔴 SHIP-BLOCKER
- 🟡 OTA POLISH
- 🔵 V1.0.1+
- ✅ VERIFIED (prior finding fixed clean)

---

## 1. Design System

### ✅ VERIFIED
- **List-header copy fix landed** — `mobile/app/(tabs)/list.tsx:54-60` now reads `${rows.length} CASE(S) · SORTED BY RECENCY` with proper singular/plural, and color swapped from `evidence.chrome` → `text.secondary`. The `WITHIN 25 MI` misclaim is gone. Clean.
- **`UnsolvedPill` is now status-gated** — `mobile/app/case/[slug].tsx:174` reads `c.status === 'open' ? <UnsolvedPill /> : null`. Latent bug from pass-1 closed. Comment block `:175-177` explicitly defers `ResolvedPill` to v1.0.1 with rationale (no `resolved_at` column yet). Clean.
- **Me-tab destructive arrows desaturated** — `mobile/app/(tabs)/me.tsx:81, 87` now route through `tokens.color.text.secondary` instead of `tokens.color.tip.success`. Red is back inside its `SuccessFlash`-only fence. Clean.
- **Me-tab footer copy + color** — `mobile/app/(tabs)/me.tsx:151, 154` now reads `THE COLD FILE · v1.0.0` in `text.secondary` (7.18:1 AA). The "(prototype)" tag is gone. Clean.
- **Photo-caption fallback** — `mobile/app/case/[slug].tsx:478` now renders `ATTRIBUTION PENDING` instead of the silent `CASE FILE` papering. Honest about seed gaps. Clean.
- **Sign-in / delete-account error red** — `mobile/app/sign-in.tsx:193`, `mobile/app/delete-account.tsx:174` both now use `text.secondary`. The doc's "tip.success in any other context erodes the moment" rule holds. Clean.

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH
- **`evidence.chrome` is still the dominant section-label color across the app.** Pass-1 flagged the contrast issue (2.46–2.85:1) for text labels and recommended swap-to-`text.secondary`. Only three sites flipped (`me.tsx:151`, `list.tsx:56`, `me.tsx` row arrows). The other ~22 sites still ship `evidence.chrome` on text:
  - `app/(tabs)/list.tsx:107` (`SectionLabel` body — `RECENTLY UPDATED` / `ALL CASES NEAR YOU`)
  - `app/(tabs)/list.tsx:159` (per-row kindline)
  - `app/(tabs)/index.tsx:107` (header sub-label `LOADING` / `N CASES NATIONWIDE`)
  - `app/(tabs)/saved.tsx:43, 92` (`CASES YOU'RE FOLLOWING`, per-row kindline)
  - `app/case/[slug].tsx:199, 232` (`CASE FILE`, `SOURCES · N`)
  - `app/sign-in.tsx:109, 161` (`NO PASSWORD · MAGIC LINK`, `EMAIL`)
  - `app/delete-account.tsx:123` (`PERMANENT · CANNOT BE UNDONE`)
  - `app/watch-zone.tsx:108, 379` (`TAP THE MAP TO DRAW…`, `SectionLabel`)
  - `app/onboarding.tsx:172` (eyebrow)
  - `app/search.tsx:121` (`RESULTS · N`)
  - `components/cf/peek-sheet.tsx:112` (`SELECTED · X.X mi away`)
  - `components/cf/photo-frame.tsx:143, 263` (reconstruction pill, caption strip)
  - `components/cf/legal-doc.tsx:81, 101, 122` (`LAST UPDATED`, all section headings, footer)
  
  That's the bulk of the user's read-time. The fix that landed is partial — pick a finish line: keep `evidence.chrome` for non-text chrome only (brackets, source-chip border, sample-tag border) and globally swap text labels to `text.secondary`. **This is a regression risk on the partial migration: the eye now reads three different secondary-label tones in the Me-tab → list-tab traversal (`text.secondary` on Me, `evidence.chrome` on list section labels, `evidence.chrome` on row sub-line). The mixed state is worse than either pure state.**

- **`docs/04_DESIGN_SYSTEM.md:28` still lies about `text.secondary`** — pass-1 finding unchanged. The doc table still shows `#8a8580`; theme.ts ships `#a09b95`. Doc snapshot at `:552` also still has the old hex. Pass-1 listed this as OTA POLISH; it's still outstanding (doc-only).

- **`peek-sheet.tsx:73-98` X-button — new dismiss affordance lacks a stroke contract.** The `Ionicons name="close" size={18}` color is `text.secondary` (`#a09b95`). Read against `bg.elev1` (`#161616`) at 18px sans-stroke icon, the close glyph clears AA but its visual weight differs from the `chevron-back size={18}` in `text.primary` used everywhere else for chrome-buttons. Two close-icons of different prominence (peek = 18px secondary, tip-modal `[slug].tsx:206` = 18px secondary) are aligned to each other — but pair-mismatched against every back-chevron in the app (`text.primary`). Either shift peek-X to `text.primary` for chrome consistency, or fix the close-glyph contract for both X uses (and document it).

### 🔵 V1.0.1+
- **`tokens.color.bg.infoTint`, `bg.resolvedTint`, `silhouette.bg/figure`, `photoFrame.bg`, `body.reading` are still missing from the design doc.** Pass-1 finding unchanged.
- **`ResolvedPill` (`pill.tsx:64-77`) is wired to `'#1a201b'` literal instead of `tokens.color.bg.resolvedTint` (`theme.ts:26`).** Now that the case-detail call-site explicitly defers it (`case/[slug].tsx:175-177`), the dead-code path is at least documented — but the literal vs token drift inside the pill itself still violates the no-hex rule.
- **`FilterChip` colocation** — pass-1 V1.0.1+ finding, unchanged.
- **`tokens.cluster.zoomThreshold` unused** — pass-1 finding, unchanged.
- **Dual disclosure-modal copy** (`theme.ts:217` vs doc `:436`/`:646`) — pass-1 finding, unchanged.

---

## 2. Color & Typography

### ✅ VERIFIED
- **All `tip.success` uses outside `SuccessFlash` are now eliminated.** Audit run: `grep tip.success` returns only `_layout.tsx:52` (navTheme `notification` slot — RN-Navigation API binding, not user-facing), `case/[slug].tsx:346` (the `borderLeftColor` accent on the receipt block — load-bearing 2px stripe, doc-sanctioned), the `success-flash.tsx` file itself, and doc/comment strings. Red is properly fenced.

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

- **`AmberCTA` letterSpacing pass-1 finding still unfixed.** `cta-button.tsx:59` still ships `letterSpacing: 0.1` (literal pixels — 0.7% tracking at 14px, sub-perceptual). The system token `tokens.tracking.label = 0.10` is em-relative (10% ≈ 1.4px at 14px). The fix is one line: `letterSpacing: tokens.size.body * tokens.tracking.label`. Same issue at `tip/[slug].tsx:368` (`letterSpacing: 0` on Copy-link). Primary CTA is the highest-load typographic surface in the app; this still ships flat.

- **`watch-zone.tsx:365` PremiumPill ships `letterSpacing: 9 * 0.1`** — that's `0.9px`, which is correct intent (em-relative at 9px) but it bypasses the `tokens.tracking.label` token by inlining the multiplier `0.1`. If the global label-tracking ever shifts, this site won't follow. Use `9 * tokens.tracking.label` to bind it.

- **NEW: `MonoLabel` default tracking is `tokens.tracking.label = 0.10` (em-relative).** Several sites pass `tracking={tokens.tracking.chip}` (0.05, smaller) — `peek-sheet.tsx:111`, `case/[slug].tsx:198, 231`, `sign-in.tsx:160`, `tip/[slug].tsx:213, 235`, `legal-doc.tsx:100`, `onboarding.tsx:171`. There is no documented rule for label-vs-chip tracking and the choice is inconsistent: `RECENTLY UPDATED` on list uses `tracking.label` (`list.tsx:106`) while `CASE FILE` on case-detail uses `tracking.chip` — same role (mono section heading), two trackings. Promote a rule into the design doc or unify call-sites.

- **NEW: `borderLeftColor: tokens.color.tip.success` on the receipt block** (`case/[slug].tsx:346`) — this is the second sanctioned use of red, but it isn't fenced inside `SuccessFlash`. The doc allows the 2px stripe (load-bearing receipt accent) but it's not in `theme.ts` "only sanctioned use" comment block (`theme.ts:57`: "The only sanctioned use of red in the entire app"). The comment is now technically wrong; either update the comment to "sanctioned uses" (plural) and list both, or hoist the stripe color to a dedicated `tokens.color.receipt.stripe` so the contract reads true. Doc-debt risk only.

### 🔵 V1.0.1+
- **No light-mode lint guard / hex literals** — pass-1 finding unchanged. New literals introduced by recent commits: none beyond the existing `'#1a1408'` and `'#1a201b'` pair.
- **`tip/[slug].tsx:263` italic now conditional** — pass-1 V1.0.1+ finding addressed (already shipping `fontStyle: tipBody ? 'normal' : 'italic'`). Move to ✅ when verified, but it was already this state before dd718ec — no commit credit, just clarifying the audit baseline.

---

## 3. Dark Mode

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH
None.

### 🔵 V1.0.1+
- **`accessibilityIgnoresInvertColors` still only on the hero photo** — pass-1 finding unchanged.
- **`silhouette.bg/figure` palette still amber-warm** — pass-1 finding unchanged.
- **Modal status bar override still missing** — pass-1 finding unchanged.

No dark-mode-specific findings introduced or addressed by dd718ec.

---

## 4. Icon Consistency

### ✅ VERIFIED
- **Tab-bar haptics moved to `onPressIn`** — `tab-bar.tsx:55-62, 83`. Snappier tactile cue lands at press-in, navigation still fires on press-up. Clean.
- **Peek-sheet X glyph added cleanly** — `peek-sheet.tsx:92-97`, `Ionicons name="close" size={18}`, `e.stopPropagation()` on press handler so the X doesn't also fire `onOpen`. No regression.

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

- **Icon size inconsistency from pass-1 unchanged.** Sizes used: 16 (share, save star at case detail), 18 (chevron-back, search, close X, save star — except case detail), 20 (locate-outline, onboarding back chevron), 22 (tab bar). Pass-1 OTA finding still outstanding. Notably the new peek-sheet X (`size={18}`) and tip-modal X (`size={18}`) are aligned to each other — that part is good. But onboarding back-chevron is still `size={20}` (`onboarding.tsx:130`) when every other back-chevron is `size={18}`. **Onboarding is the user's first three screens — the size mismatch is the first thing they see vs. the rest of the chrome.**

- **NEW: `MaterialIcons name="bookmark"` on the Saved tab differs from the Saved tab's empty-state em-dash treatment.** The active-tab icon is a filled MaterialIcons bookmark (filled glyph at 22px). The Saved tab's own empty-state shows a 28px serif em-dash circled — completely different visual language for the same conceptual surface ("things you've saved"). When the tab is empty, the user-perceptible mismatch between the inbound tab-icon glyph and the on-screen content motif is a small but real disconnect. V1.0.1+ if you accept it.

### 🔵 V1.0.1+
- **`paperplane.fill` and `house.fill` mappings remain unused** — pass-1 unchanged.
- **`Partial<IconMapping>` type tightening** — pass-1 unchanged.

---

## 5. Spacing & Layout

### ✅ VERIFIED
- **Onboarding back-chevron in flex top-row** — `onboarding.tsx:113-157` lays back-chevron, progress-dots, and SKIP in a single `justifyContent: 'space-between'` row with reserved 32px spacers. No more dot-collision. Clean.
- **`KeyboardAvoidingView` + scroll on sign-in / delete-account / watch-zone / tip-flow** — verified at `sign-in.tsx:68`, `tip/[slug].tsx:145`, `watch-zone.tsx:66`. CTAs survive the soft keyboard. Note: `delete-account.tsx` does NOT have KeyboardAvoidingView — but it also has no input fields (only an Alert dialog and an AmberCTA), so the omission is intentional. Clean.
- **Onboarding step-3 location CTA loading state** — `onboarding.tsx:194` passes `loading={isLast && acquiring}` to the AmberCTA. The "Use my location" CTA dims + spinners during permission acquisition. Clean.

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

- **Pass-1 borderRadius inconsistency unfixed.** Concrete violations:
  - `me.tsx:171` Card: `borderRadius: 6` (vs `tokens.radius.card = 8`)
  - `sign-in.tsx:180`, `watch-zone.tsx:134, 151`, `search.tsx:88` inputs: `6`
  - `list.tsx:194` thumbnail: `4`
  - `source-chip.tsx:38`: `4`
  - `photo-frame.tsx:134, 218`: `3`
  - `list.tsx:228` SampleTag inner: `3` (yes this is a Pin radius btw — `list.tsx:228` is FreshDot at `borderRadius: 3` for a 6×6 dot, that's fine)
  - `list.tsx:259`, `index.tsx:388` SampleTag border-box: `3`
  - `watch-zone.tsx:355` PremiumPill: `11` (no token; should be `radius.pill = 12` or near-pill)
  - `watch-zone.tsx:426` Toggle track: `10`
  - `watch-zone.tsx:435` Toggle thumb: `8`
  - `legal-doc.tsx:63`, `delete-account.tsx:105`, `sign-in.tsx:91`, `search.tsx:63`, `watch-zone.tsx:90, 215`, `tip/[slug].tsx:196` back-chevron buttons: `18` (custom 36×36 button half-radius)
  - `case/[slug].tsx:348` receipt block: `4` (vs `radius.card`)
  - `peek-sheet.tsx:54-55` sheet: `16` (matches `radius.sheet` numerically but uses literal)

  Pass-1 already named most of these. dd718ec didn't address any. The cumulative effect is the same eye-fatigue gradient pass-1 named: 18→16→14→12→11→10→8→6→4→3 in unsanctioned mix.

- **Tab bar `paddingBottom: insets.bottom > 0 ? insets.bottom : 12`** (`tab-bar.tsx:47`) — pass-1 OTA POLISH unchanged. Recommendation `Math.max(insets.bottom, 12)` still applies.

- **NEW: 36×36 back-chevron button is duplicated 7 times.** `sign-in.tsx:88-102`, `delete-account.tsx:101-116`, `watch-zone.tsx:86-101, 211-226`, `search.tsx:59-74`, `legal-doc.tsx:59-74`, `tip/[slug].tsx:192-208`. Each is a `Pressable` with the same 36×36 dimensions, `borderRadius: 18`, `bg.elev1` background, `border.strong` border, identical pressed-opacity. The case-detail circle button at `case/[slug].tsx:506-523` is a `CircleButton` component but the 36×36 variant ships nowhere as a primitive. Pass-1 didn't catch this — it's a duplicated chrome element across 7 sites. Promote to `cf/circle-button.tsx` with a `size: 36 | 40 | 44` prop.

- **NEW: Premium-pill on watch-zone (`watch-zone.tsx:349-372`) ships its own padding (`paddingVertical: 3, paddingHorizontal: 8`) that doesn't match `pill.tsx`'s pillBase (`paddingVertical: 4, paddingHorizontal: 10`).** PremiumPill is colocated in `watch-zone.tsx` rather than promoted to `pill.tsx`. Two pill grammars in the app (`UnsolvedPill`/`ColdPill`/`ResolvedPill` vs `PremiumPill`) for what's conceptually the same visual primitive.

### 🔵 V1.0.1+
- Pass-1 findings around `peek-sheet.tsx` literal `16` radius, `42 cases inside` chip token-naming, key-facts axis convention, `bg.elev2` no-consumer all unchanged.
- Pass-1 promote-`SectionLabel` recommendation gains a new duplicate (`watch-zone.tsx:374-385`) — now 5 implementations of the same primitive across the app.

---

## Regressions

**None confirmed as breaking.** One soft-regression worth naming:

- 🟡 **Partial `evidence.chrome → text.secondary` migration creates a tone-mismatch in the section-label vocabulary.** Three sites fixed (`me.tsx:62, 151`, `list.tsx:56`), ~22 sites unchanged. The user traversing Me → List now reads two different secondary tones for visually-equivalent mono-cap section labels. A pure-state in either direction is fine; the half-state is worse than the original. See OTA POLISH item under §1.

- 🟡 **`tokens.color.tip.success` comment in `theme.ts:57` is now factually wrong.** The receipt block at `case/[slug].tsx:346` reads tip.success for the 2px borderLeftColor — that's a sanctioned use, but the theme comment still says "the only sanctioned use is in `SuccessFlash`." Comment-vs-reality drift; will mislead the next contributor reading the token file.

---

## Summary tally

| Audit | SHIP-BLOCKER | OTA POLISH | V1.0.1+ | ✅ VERIFIED |
|---|---|---|---|---|
| Design System | 0 | 3 | 5 | 6 |
| Color & Typography | 0 | 3 (1 NEW) | 2 | 1 |
| Dark Mode | 0 | 0 | 3 | 0 |
| Icon Consistency | 0 | 2 (1 NEW) | 2 | 2 |
| Spacing & Layout | 0 | 4 (2 NEW) | 4 | 3 |
| **Total** | **0** | **12 (4 NEW)** | **16** | **12** |

No SHIP-BLOCKERS introduced or remaining. dd718ec landed 6 high-confidence verified fixes (`✅`) and addressed two of pass-1's three highest-value Color/Typography findings (the `tip.success` red de-fanging, the destructive-arrow swap). The big remaining OTA cluster is the half-finished `evidence.chrome` migration; finishing it is a single afternoon of grep-and-replace.
