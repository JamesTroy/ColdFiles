# UX & Content Audit — The Cold File mobile v1.0.0

Audit run: 2026-04-29 against `/Users/jtroy/Desktop/ColdFiles/mobile`.
Severity legend: SHIP-BLOCKER (closed-test reviewer flag or visibly broken),
OTA POLISH (real issue, fixable via OTA push without rebuilding the AAB),
V1.0.1+ (known limitation or larger refactor; non-blocking).

---

## 1. UX Review (general)

Walked the first-time path: cold launch → splash holds for fonts → `OnboardingGate` redirects to `/onboarding` → 3-step onboarding (welcome / content notice / location) → location prompt fires on step-3 "Use my location" → `router.replace('/')` → Map tab → tap pin → `PeekSheet` opens → tap "Open →" → case detail → AmberCTA "Submit a tip" → modal → radio-card route picker → optional tip body → anticipation → deep-link handoff → return to case detail with receipt block.

The choreography is well-thought through. Most friction sits in two areas: the trust contract is repeated in the right places, and the empty/error/loading states are consistently rendered. Specific findings:

### SHIP-BLOCKER

1. **Sign out / Delete account use `tip.success` red as the arrow color.** `app/(tabs)/me.tsx:81` and `app/(tabs)/me.tsx:87` both pass `valueColor={tokens.color.tip.success}` for the `→` arrow. Per `constants/theme.ts:58`, `tip.success` is "the only sanctioned use of red in the entire app" and is reserved for the TIP ROUTED success flash. Using bright red for an arrow next to "Delete account" is also a UX false-alarm (red = danger sign in user's mental model, but it's the same red used for SUCCESS). This double-violates the design system and conflates red-as-warning with red-as-success. Closed-testing reviewer will not flag, but a designer-reviewer of the repo will. Fix: use `tokens.color.text.secondary` (neutral arrow) or `tokens.color.accent.amber` (consistent with the unauthenticated "Continue with email" row at me.tsx:95).

### OTA POLISH

2. **Me-tab footer still says "v0.1.0 (prototype)"** — `app/(tabs)/me.tsx:154`. The AAB ships `version: '1.0.0'` (`app.config.ts:16`). A closed-testing tester scrolling to the footer will see a version mismatch and "(prototype)" in a v1.0.0 build. Should read the actual `Constants.expoConfig.version` or be hard-set to `1.0.0`.
3. **Map header dishonesty trade-off.** `app/(tabs)/index.tsx:407` renders `{N} CASES NATIONWIDE` regardless of the user's actual radius. The author already disclosed this as deliberate (radius is 5000mi for V1; LA-county scraper isn't seeded yet — see comment at lines 62–66 and 396–404). It's an honest workaround. But "NATIONWIDE" is technically true while "CASES NEAR YOU" (List header) at `app/(tabs)/list.tsx:59` says `{N} WITHIN 25 MI · SORTED BY RECENCY`. The List header is lying — there's no 25mi filter actually applied. Fix List header to match the Map header's honesty: drop "WITHIN 25 MI" until the radius semantics are real.
4. **Sign-in error message renders in `tip.success` red** — `app/sign-in.tsx:178`. Same theme misuse as #1 — Cold File has no sanctioned red-for-error color. The error string is also tonally fine ("That doesn't look like an email address.") but the red text on dark bg fights the amber palette. Fix: render at `tokens.color.text.info` or `text.primary` with a small "ERROR" mono-cap label above for the typewriter/evidence-register signal.
5. **Delete-account error message renders in `tip.success` red** — `app/delete-account.tsx:174`. Same as #4. Same fix.
6. **Tip-flow CTA disabled state during anticipation.** `app/tip/[slug].tsx:288–293` shows `loading={submitting || phase === 'anticipating'}`, which on the AmberCTA disables the press handler but doesn't visibly distinguish loading from idle besides the spinner. With a 200ms anticipation pause + network round-trip, the user gets a brief no-op tap window. The current spinner appears, but the optimistic-vs-real-network race could let a tester double-tap. `AmberCTA` already has `disabled={loading}` (cta-button.tsx:26) — this is correct. Verify on slow network: optionally darken the button bg by ~25% during loading to reinforce the "in progress" state.
7. **Search empty-result string uses HTML entities.** `app/search.tsx:113` renders `No matches for &quot;{query}&quot;.` This works (JSX escapes), but mixes encoded quotes with the rest of the app's typography. Replace with curly quotes: `No matches for "{query}".` or just plain quotes — readability over correctness.

### V1.0.1+

8. The Saved tab empty-state copy promises "Premium users get push notifications when a saved case has movement" (`app/(tabs)/saved.tsx:149`), but there's no entry point to Premium because the row was deferred (`app/(tabs)/me.tsx:105–106`). User reads about a feature that has no path. Either remove the Premium clause from the empty state or add a small "Coming in v1.0.1" footnote.
9. Map tab's UPDATING toast (`app/(tabs)/index.tsx:176–202`) sits at top center; on Pixel 6+ it's near the status bar. Consider anchoring 16px below the filter chip row so it doesn't compete with system chrome.
10. Onboarding step 3 has no explicit "Use this device only / no account needed" reassurance. The user is told location stays on-device, but isn't told an account isn't required to use the app. First-time conversion may dip if users assume sign-in is mandatory.
11. Case detail "Read full file →" toggle (`app/case/[slug].tsx:213–218`) is at the end of a truncated paragraph — fine, but the inverse "Show less ←" arrow direction reads as "back" in a stack-nav context. Consider `^ Show less` or a chevron-up symbol instead of `←`.

---

## 2. Content Design

Content tone is consistent. Mono-cap labels for filing furniture work. Newsreader serif is reserved correctly to victim names, hero titles, and section anchors. The recently-applied "Continue with email" rename is propagated cleanly: `app/(tabs)/me.tsx:93`, `app/sign-in.tsx:99`, `app/watch-zone.tsx:236`. Trust-disclosure surfaces (`components/cf/trust-disclosure.tsx`) and `tokens.tipFlow.disclosureSurfaces` (`constants/theme.ts:214`) carry the no-store contract correctly across the modal, the case-detail caption, and the success state.

### SHIP-BLOCKER

No findings.

### OTA POLISH

12. **"Premium · watch zones" entry point is dead in v1.0.0.** `app/(tabs)/me.tsx:103–107` ships only the `Subscription · FREE` row; the Watch Zone row is commented-out with the rationale that the drawing UI isn't interactive. Yet `app/watch-zone.tsx` is still routable (the Stack registers it at `app/_layout.tsx:113–117`). If any tester finds it via a stale link or build artifact, they'll see fully-styled but non-functional UI. Two options: (a) remove the `watch-zone` Stack screen registration, or (b) gate the screen with a "Coming in v1.0.1" message when accessed without a referrer. Cheaper: comment the Stack registration too. Worth a check before AAB ship.
13. **"SAMPLE" tag rendered on Map and List headers when `source === 'sample'`** (`app/(tabs)/index.tsx:100`, `app/(tabs)/list.tsx:52`). For closed testing this is fine. But the tag is inline next to "The Cold File" / "Cases" titles in 9px chrome with a 0.5px border; on a Pixel 6 it can easily be missed. If the closed-test build ships with sample data (likely, since the LA scraper isn't seeded yet), bump SAMPLE to a more visible chrome — outline color from `tokens.color.evidence.chrome` is intentionally muted, but a `tokens.color.accent.amber` outline would still respect the palette while signaling clearly. Otherwise testers may file "this case data is wrong" tickets against rows you intentionally seeded.
14. **Photo caption fallback says "CASE FILE"** when no source attribution is present (`app/case/[slug].tsx:469`). Per the photo-sourcing policy memory note, *every* photo must carry per-photo `source_attribution` — the fallback to "CASE FILE" is the silent-failure case. That's a content-policy bug. Either: (a) treat missing attribution as a render-block (don't display the photo), or (b) render "ATTRIBUTION PENDING" so the gap is visible during seed-data review. Today's behavior makes a missing attribution invisible.
15. **Narrative truncation at 40 words is hardcoded twice** — `app/case/[slug].tsx:300–310`. `tokens.caseDetail.narrativeWords` exists at `constants/theme.ts:187` (= 40) and is *not consumed*. The 40 lives in the source twice. Wire `truncateNarrative` and `needsTruncation` to read the token. (Content-design relevance: tuning the truncation length post-launch via OTA requires editing two places instead of one.)
16. **Tip-modal placeholder leaks a real-feeling story.** `app/tip/[slug].tsx:247` placeholder reads `e.g. "I knew David through PFF Bank in 1983–85. There was a colleague who…"` This is good copy from a usability standpoint (concrete, evocative, sets the right level of detail) — but "PFF Bank" + "David" + "1983–85" is specific enough that a paranoid reviewer could read it as a real case reference. Soften to a clearly-fictive name and bank: `"I knew K. through Acme Co. in the late 80s. There was a coworker who…"` or just drop the institution entirely.
17. **Onboarding step 1 secondary path is invisible.** Step 1 ("CONTENT NOTICE") has no `secondaryLabel`, only a primary "I understand". Users with a content-warning sensitivity have only the top-right "SKIP" path, which silently completes onboarding (skipping the location rationale). Consider adding a "Not for me" secondary that finishes — same effect as SKIP but discoverable from the body.

### V1.0.1+

18. Source-chip text is `SOURCE / lasd.org` (`components/cf/source-chip.tsx:52`); the slash + lowercase domain reads scrappy next to the rest of the typography hierarchy. Consider `SOURCE · LASD.ORG` so the separator matches the rest of the app's `·`-delimited mono labels.
19. List-row `agencyShortName` heuristic (`app/(tabs)/list.tsx:236–242`) extracts `^[A-Z]{2,5}\b` then falls back to truncating to 24 chars. For agencies whose names start with "The" or a county name (e.g. "Los Angeles Sheriff's Department"), the regex hits "L" as a 1-letter match (fails) and falls through to slicing — yielding "Los Angeles Sheriff's De". Acceptable for v1, but worth a curated dictionary mapping in the lib eventually.

---

## 3. Responsive Design

The app is phone-portrait-locked (`app.config.ts:17 — orientation: 'portrait'`). On a Galaxy Tab S11 Ultra (~14.6" screen, ~3120×2080 native), Android still respects `orientation: portrait` at the Activity level — the app will be letter-boxed or scaled. The bigger risk is content reflow on tablets that *aren't* locked (some manufacturer skins ignore the manifest hint).

### SHIP-BLOCKER

No findings — the manifest portrait lock prevents any catastrophic break in landscape, and Tab S11 Ultra in portrait will run at ~1440px width which all relative layouts handle.

### OTA POLISH

20. **No `useWindowDimensions()` adaptation anywhere.** `grep` shows zero use of the hook across `/app` and `/components/cf`. Most layouts are flex-column with `paddingHorizontal: 16`, which scales fine to 1440dp. But:
    - `components/cf/empty-state.tsx:59` uses `minWidth: 240` for the centered box — fine.
    - `app/(tabs)/saved.tsx:146` uses `maxWidth: 280` for the empty-state body — *too narrow* on a tablet, the body line will look stranded. Bump to `maxWidth: '70%'` or apply only when window width < 600.
    - `components/cf/photo-frame.tsx:65` defaults `height = 200` — fixed pixel height. On a tablet (more vertical room), the photo will be a strip relative to the surrounding content. Make it relative: `height = Math.round(width * 0.66)` or pass an aspect ratio.
    - `app/watch-zone.tsx:248` and `:297` both use a fixed `height: 240` for the map preview. On tablet, the map looks postage-stamp small. Same fix.

### V1.0.1+

21. Tab-bar (`components/cf/tab-bar.tsx:36–125`) uses `flex: 1` per tab, so on a Tab S11 Ultra each tab gets ~360dp wide and the labels look isolated in a sea of black. Consider centering the row with a max-width on the bar itself or rendering inline icon+label on screens > 600dp.
22. Photo gallery / multi-photo case (when the gallery feature lands post-v1) will need `useWindowDimensions` to swap from single-column to side-by-side on width > 700dp.
23. The List tab (`app/(tabs)/list.tsx`) is single-column. On tablet it will be one row per ~10mm of horizontal space — wasteful. v1.0.1 candidate: two-column grid above 600dp.

---

## 4. Settings & Preferences

Me tab is the de facto settings page. Card-stack pattern is clean: Account → Subscription → Counts → About/legal → footer. Sign-out and Delete-account flows both use system `Alert.alert` for confirmation, which is the right pattern for mobile.

### SHIP-BLOCKER

24. **Same finding as #1.** `app/(tabs)/me.tsx:81` and `:87` — Sign out and Delete account use `tokens.color.tip.success` (red) as the arrow color, violating the design-token contract. Listed here too because the Settings audit is the surface where it bites hardest: red right-arrows next to destructive items invent a "danger zone" affordance the design system explicitly didn't sanction. Fix: amber (`tokens.color.accent.amber`) for nav arrows, and let the system Alert dialog carry the danger semantics (which it already does — `style: 'destructive'` on the Delete button at `app/(tabs)/me.tsx:46` and `app/delete-account.tsx:60`).

### OTA POLISH

25. **No "danger zone" visual grouping.** Sign out and Delete account share the Account card with the email row. Per Material guidelines + iOS HIG, destructive actions should be visually separated (a divider or its own card at the bottom). Today they read as equivalents of "Continue with email". Move Delete account into its own card after the About/legal block, or add a `borderTopWidth: 0.5` + `marginTop: 8` separator above it within the Account card.
26. **Sign-out copy is good but Sign-out *button* copy is just "→".** `app/(tabs)/me.tsx:80`. The Alert that follows is articulate ("Saved cases on this device stay where they are. Watch zones and synced data go away until you sign back in." — me.tsx:39). The row itself just shows an arrow. Consider showing "SIGN OUT" in mono-cap on the right instead of `→` so the user reads the action before tapping.
27. **No "Crash reports opt-out" toggle**, despite the privacy policy promising it (`app/privacy.tsx:45 — "Opt out of crash reports: in-app via Me → Privacy"`). The Me tab has no Privacy submenu. Either remove the promise from the privacy policy, or add a `Card` between Subscription and Counts with the toggle.
28. **No "App language" or "Theme" preference** — fine for v1 (dark IS the design per `app/_layout.tsx:6`), but worth surfacing intent in the footer copy: "Theme · DARK (system override ignored)" so users who try to switch don't think the app is broken.

### V1.0.1+

29. Watch Zone settings are inside `app/watch-zone.tsx` (toggles for new/updated/resolved). When v1.0.1 ships Premium, those settings should be promoted to a top-level Settings → Notifications section in Me, not buried inside the per-zone editor.
30. There's no "Email support" entry in the Me tab. The privacy/terms/takedown screens all reference `support@coldfile.app`, but there's no tap-to-mailto. Add a `Help → Email support` row in the About/legal card.

---

## 5. Breadcrumb & Wayfinding

Stack registry (`app/_layout.tsx:90–125`):
- `(tabs)` is the root anchor.
- `case/[slug]` slides from right (correct).
- `tip/[slug]` is a modal sliding up (correct).
- `sign-in` and `search` are modals (correct).
- `about / privacy / terms / takedown / delete-account / watch-zone` slide from right (correct).
- `onboarding` fades, gestures disabled (correct — can't dismiss accidentally).

Back-chevron is consistently a 36×36 circle at top-left across `app/sign-in.tsx:96`, `app/delete-account.tsx:115`, `app/watch-zone.tsx:97`, `components/cf/legal-doc.tsx:73`, `app/search.tsx:73`. Case detail uses a 40×40 variant (`app/case/[slug].tsx:484–516`). Onboarding uses an icon-only 20px chevron (`app/onboarding.tsx:201`).

### SHIP-BLOCKER

No findings.

### OTA POLISH

31. **Onboarding "Back" chevron is inconsistent.** `app/onboarding.tsx:193–203` renders a bare `chevron-back` icon at `top: insets.top + 8, left: 0`, no circle background, 20px glyph. Every other screen in the app uses a 36×36 circle with `border` + `bg.elev1`. Either add the circle (consistency), or document it as intentionally lighter for onboarding context. As-is, a tester comparing screens will read it as a different system.
32. **Tip modal close button is `X` (top-right), case detail back button is chevron-back (top-left).** `app/tip/[slug].tsx:179–199` uses `Ionicons name="close"` because it's a modal. That's correct iOS-modal behavior. Just verify the test plan covers Android back-gesture: the tip modal must dismiss on Android system-back, which it does because `expo-router` modals respond to back. No fix required, but worth a manual smoke test on a Pixel.
33. **No breadcrumb / location label inside Case Detail.** The top chrome shows `case_number_primary ?? slug.toUpperCase()` (`app/case/[slug].tsx:148`), which is great for scanning and also doubles as the "where am I" cue. But once the user scrolls past the photo, that breadcrumb scrolls away and there's no sticky chrome reminding them what case they're in. The sticky bottom bar mentions "Submit a tip" but not the case. Consider a thin sticky header (24px) with the case number when scrolled past the photo. (V1 acceptable as-is; flag for v1.0.1.)

### V1.0.1+

34. Search modal back button (`app/search.tsx:54–74`) closes the modal. Acceptable, but the search query state is lost on dismissal. v1.0.1 should preserve last-search across modal opens for the session.
35. The receipt-state CTA on case detail says "Send another tip" (`app/case/[slug].tsx:399`) — fine — but the screen no longer offers a clear path to "View my submitted tips list" because the Saved tab is bookmark-only and there's no "Submitted tips" tab. Counts row shows `Tips submitted: N` (me.tsx:113) but isn't tappable. Make it tappable to a future tip-history screen.

---

## 6. Table & List Design

`app/(tabs)/list.tsx` is functional. Two sections (RECENTLY UPDATED / ALL CASES NEAR YOU), 56×56 thumbnail with silhouette or em-dash, serif name with optional `FreshDot`, mono kindline, distance + update-age line. No filtering, no sorting controls (sort is fixed: `last_changed_days asc`).

### SHIP-BLOCKER

36. **List header lies about radius**, also reported as #3. `app/(tabs)/list.tsx:59` — `${rows.length} WITHIN 25 MI · SORTED BY RECENCY`. There is no 25-mile filter. The `useCaseList` hook (per the Map-tab comment at `index.tsx:62–66`) effectively returns all seeded cases. Fix to match the Map tab's honest copy: `${rows.length} CASES · SORTED BY RECENCY` until the LA-county scraper densifies the seed.

### OTA POLISH

37. **No filter or kind-toggle on List tab.** The Map tab has `All / Homicide / Missing / Doe` chips (`app/(tabs)/index.tsx:128–148`) but the List tab doesn't surface them. A user filtering Doe-only on the map then switching to the List sees the unfiltered list. Filter state isn't shared. v1 acceptable but jarring.
38. **`agencyShortName` is the line-3 fallback** — when a case is older than 10 days (`app/(tabs)/list.tsx:131`), the row shows agency-short-name instead of "updated this week". The format is then `1.2 mi · LASD` — reads OK, but for cases where the regex falls through (see #19), it's `1.2 mi · Los Angeles Sheriff's De`. Truncate at the rendered string level: ellipsize line 3 to ~28 chars regardless of source.
39. **List rows have no visual hierarchy for "case number".** The case detail's chrome shows `CASE-LASD-1985-0413`, but the list row never surfaces it. For users who came from a news article mentioning "case 1985-0413," there's no scan path back. Optional: add a 9px mono case-number caption to the right of the kindline.

### V1.0.1+

40. Two-column grid on tablet (cross-ref #23).
41. Pull-to-refresh isn't wired on the List tab `<ScrollView>`. Refetch is only triggered by the hook's auto-fetch. Add `RefreshControl` so users can manually reload.
42. Recency sort is the only sort. v1.0.1 should add: distance-asc, kind-grouped, agency-grouped.
43. Doe thumbnail dims at `opacity: 0.5` (`app/(tabs)/list.tsx:201`) — per the photo-policy memory, this is intentional and should NOT preemptively gain a "RESTRICTED" caption; only deploy the caption if surprise-tap analytics show parity with non-Doe rates.

---

## Summary table

| Audit | SHIP-BLOCKER | OTA POLISH | V1.0.1+ |
|---|---|---|---|
| 1. UX | 1 | 6 | 4 |
| 2. Content | 0 | 6 | 2 |
| 3. Responsive | 0 | 1 (rolled-up #20 with 4 sub-items) | 3 |
| 4. Settings | 1 (dup of #1) | 4 | 2 |
| 5. Wayfinding | 0 | 3 | 2 |
| 6. List | 1 (dup of #3) | 3 | 4 |

Distinct ship-blockers: **2** (#1 / #24 are the same issue, #3 / #36 are the same issue).
Distinct OTA polish items: **23**.
Distinct v1.0.1+ items: **17**.
