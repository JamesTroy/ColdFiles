# Audit 07 — Flows & States, second pass

Scope: re-audit of v1.0.0 user flows/UI states after fix commit `dd718ec`.
Reference: pass-1 at `docs/audit/03-flows-states.md`.
Date: 2026-04-29.

Severity legend:
- 🔴 SHIP-BLOCKER — closed-testing reviewer would flag, or visibly broken on real hardware. Fix before AAB upload.
- 🟡 OTA POLISH — real user-facing issue. Fixable via OTA push without rebuilding the AAB.
- 🔵 V1.0.1+ — known limitation or larger refactor. Non-blocking.
- ✅ VERIFIED — pass-1 finding now resolved.

---

## 1. Onboarding UX

`mobile/app/onboarding.tsx` · `mobile/app/_layout.tsx:137-148` · `mobile/lib/hooks/use-onboarding.ts`

### ✅ VERIFIED

- **Back chevron / progress dots collision** (was 🔴 in pass-1). Chevron + dots + SKIP now share a single `flexDirection: 'row'` top bar with `space-between`, `minHeight: 32`, and 32px reserved spacers on both sides so dot-centering is preserved across step changes (`mobile/app/onboarding.tsx:113-157`). No overlap on any step.
- **Step 3 location-CTA loading state** (was 🟡). `loading={isLast && acquiring}` is now passed to `<AmberCTA>` (`mobile/app/onboarding.tsx:194`). `AmberCTA` already disables itself while `loading` is true (`cta-button.tsx:26`), so the double-tap race is closed for the primary path.
- **SKIP gating to step > 0** (was 🟡). `showSkip = stepIndex > 0` (`mobile/app/onboarding.tsx:83`); SKIP is hidden on step 0, forcing the 17+ disclosure on step 1 to be reached before the user can opt out. The reserved 32px width keeps dot centering stable.

### 🔴 SHIP-BLOCKER

No findings.

### 🟡 OTA POLISH

- **"Maybe later" / SKIP / back-chevron still have no transient debounce.** `void finish()` is fired from two paths (SKIP at line 140, secondary CTA at line 199) and back-chevron at line 124 just calls `setStepIndex`. The shared `useOnboarding` store dedupes the AsyncStorage write so the user can't double-complete, but a fast double-tap on "Maybe later" while AsyncStorage is mid-write still calls `router.replace('/')` twice. Expo Router collapses the second replace, so this is not catastrophic — but the same hygiene that landed on the primary CTA (the `loading={…}` disable) should apply to the secondary too. Single-line fix: `disabled` flag flipped on first press. Pass-1's "step 0/1 transient disabled" item is still not addressed for the primary chevron-forward step transitions either.
- **Step-3 secondary "Maybe later" still fires during `acquiring`.** While the primary CTA is correctly disabled by `loading={acquiring}`, the secondary `Pressable` on line 197-219 has no `disabled` linkage. A user who taps "Use my location", waits 2s as the OS dialog comes up, then taps "Maybe later" can have the system permission dialog land on a stack where `complete()` already fired — the dialog still resolves and `requestAndAcquire()` runs in the background after onboarding closes, then sets state on an unmounted screen (no crash, but a "can't update state on unmounted component" warning in dev builds, and a wasted GPS fix). Disable the secondary while `acquiring` true.

### 🔵 V1.0.1+

- **First-launch flash of the map tab before the gate redirects** (carry-over from pass-1, unaddressed). `OnboardingGate` (`mobile/app/_layout.tsx:137-148`) returns null while state is `'loading'`; the Stack falls through to `(tabs)` for one or two frames before `router.replace('/onboarding')` fires.
- **No in-onboarding affordance for "Maybe later" → location prompt later.** The `LocationFAB` on the map (`mobile/app/(tabs)/index.tsx:182-184`) is the recovery surface but is undocumented from inside onboarding. Same as pass-1.

---

## 2. Empty States

`mobile/components/cf/empty-state.tsx` · consumers in `(tabs)/index.tsx:177-181`, `(tabs)/list.tsx:271-293`, `(tabs)/saved.tsx:108-153`, `search.tsx:104-115`.

### ✅ VERIFIED — none

(Pass-1 had no SHIP-BLOCKERs in this section.)

### 🔴 SHIP-BLOCKER

No findings.

### 🟡 OTA POLISH

- **Bespoke empty-state divergence is unchanged from pass-1.** `(tabs)/list.tsx:271-293`, `(tabs)/saved.tsx:108-153`, and `search.tsx:104-115` each still ship their own implementation rather than the shared `<EmptyState variant=…>` component. Same recommendation as pass-1: adopt the shared component for visual + copy consistency. Reviewers won't flag — design debt.
- **Saved-tab empty state still advertises a feature that v1.0 does not ship.** `mobile/app/(tabs)/saved.tsx:148-150`: `"Save a case to follow updates. Premium users get push notifications when a saved case has movement."` Watch-zones are gated to authenticated users with the entry point only on `/watch-zone` (which is not even linked from `/me` per the deferral comment at `me.tsx:105-106`). Promising "premium users get push notifications" on the empty state is small honesty debt. Either drop the second sentence OR re-add a linked Premium row to `/me`. *This is exactly the same finding as pass-1, still not addressed.*
- **List-tab empty state still says "No cases match the current filters" when zero filters are applied.** `(tabs)/list.tsx:289`. The List tab has no filter UI surface (the chip row only lives on the map). When `useCaseList` returns `[]`, the message implies the user did something, when in fact there is nothing to show. Should say "No cases yet." — a passive acknowledgement, not a false-cause attribution. Same as pass-1, unaddressed.

### 🔵 V1.0.1+

- **Map's `EmptyState` overlay still intercepts touches over the centered card** (`empty-state.tsx:36-94`). The wrapper has `pointerEvents="box-none"` (passes through to the map) but the inner card is opaque and absorbs touches. With the 5000mi seed, this is rare in production. Same as pass-1.
- **Search-tab empty state when query is empty isn't an `EmptyState` at all** (`search.tsx:99-103`). It's a primary `NarrativeText` "Start typing…" prompt rendered inline. This is correct UX (not actually an empty state — it's a primer), but if a copy alignment pass happens, it's worth touching.

---

## 3. Loading & Skeleton States

### ✅ VERIFIED — none

(Pass-1 had no SHIP-BLOCKERs.)

### 🔴 SHIP-BLOCKER

No findings.

### 🟡 OTA POLISH

- **Inconsistent loading patterns are unchanged from pass-1.**
  - Map's `UPDATING` chip only fires when `loading && cases.length > 0` (`(tabs)/index.tsx:185-211`). Cold-start still relies on the `LOADING` text in the sub-header (`(tabs)/index.tsx:415-418`).
  - List tab still binary spinner-or-content (`(tabs)/list.tsx:63-66`).
  - Saved tab still binary (`(tabs)/saved.tsx:50-53`).
  - Case detail still full-page spinner blocking the entire screen for the duration of the parallel reads (`case/[slug].tsx:88-90`); the comment at `use-case-detail.ts:7` still claims progressive but the consumer doesn't honor it.
- **NEW: List tab's loading branch hides any error state until the first successful load.** `(tabs)/list.tsx:63-72` — the error branch is *only reachable when `loading === false`*. If the user is offline and `useCaseList` is in `loading: true` while the RPC is in flight, the screen shows the spinner; when the request errors, `loading` flips false and `error` is set, and the user sees the proper `<ErrorState onRetry={refetch} />`. So far correct. But on cold start with a healthy network plus a *transient* network blip, the same flow flashes through `error` then back to data when refetched. Acceptable for v1, but skeleton would help.
- **NEW: List tab's "Couldn't load cases." `<ErrorState>` does not show under the header** — it replaces the entire body, so the eyebrow `"X CASES · SORTED BY RECENCY"` (`list.tsx:54-60`) keeps painting `0 CASES` (the default-state of `rows.length`) above the error overlay. Reviewer-visible inconsistency: error text says "Couldn't load cases," eyebrow says "0 CASES." Either suppress the eyebrow on error, or show `—` instead of `0` when error is present.

### 🔵 V1.0.1+

- **No skeleton screens anywhere in the app.** Same as pass-1.
- **`SuccessFlash` is the only motion language for state-change feedback.** Same as pass-1 — every other state transition is instant.

---

## 4. Error UX

`mobile/components/cf/error-state.tsx` · consumers: `(tabs)/index.tsx`, `(tabs)/list.tsx`, `case/[slug].tsx`, `tip/[slug].tsx`.

### ✅ VERIFIED

- **Map silently swallowing RPC errors** (was 🔴). `useCasesNear` now exposes `error` and `refetch` (`use-cases-near.ts:42-90`); the map screen consumes both (`(tabs)/index.tsx:68-80`) and renders `<ErrorState ... onRetry={refetch} />` when `error && cases.length === 0` (`(tabs)/index.tsx:171-176`). Wiring is correct: error wins over empty state in the conditional.
- **Sign-in / delete-account error text used `tip.success` red** (was 🟡). Both screens now use `tokens.color.text.secondary` for the error `<SansBody>` (`sign-in.tsx:189-198`, `delete-account.tsx:170-180`). Token policy preserved.

### 🔴 SHIP-BLOCKER

No findings.

### 🟡 OTA POLISH

- **NEW (regression-class): the map's `<ErrorState>` is rendered as a sibling sized via `ErrorState`'s default `flex: 1`, but it's a *child of a `<View>` that already contains the map renderer*.** `(tabs)/index.tsx:155-181` — the parent is `<View style={{ flex: 1 }}>` containing the renderer, then the `error ? <ErrorState ... />` block. `ErrorState` (`error-state.tsx:36-44`) uses `flex: 1` with no `position: 'absolute'`, so it lays out *inline below* the map renderer, pushing the renderer up and letting the error card stack at the bottom of the available space. The intended behavior — overlay on top of the map — is not what happens. Either wrap `<ErrorState>` in `<View style={{ position: 'absolute', inset: 0 }}>` or have `ErrorState` accept an `overlay` variant. Cross-check against the `<EmptyState>` wrapper on line 178-180 (which DOES use `position: 'absolute'` internally — see `empty-state.tsx:39-50`). This regression came in with the fix for the silent-error pass-1 finding.
- **Sign-in error message still has no `accessibilityRole="alert"` / `accessibilityLiveRegion="polite"`** (`sign-in.tsx:189-198`). Same as pass-1, unaddressed.
- **Tip-modal fallback path still locks the textarea.** `mobile/app/tip/[slug].tsx:254` — `editable={phase === 'idle'}` means once the user enters `'fallback'` they can't edit before the FallbackBar's "Try again" path. The "Try again" path explicitly walks back to `setPhase('idle')` first (line 290-293), so the user *can* recover, but they have to tap "Try again" before they can edit. Same as pass-1, still unaddressed.
- **NEW: tip-modal placeholder uses `fontStyle: 'italic'` on an empty `tipBody`** (`tip/[slug].tsx:263`). On Android Fabric there's a known bug where italic style applied to a `TextInput` with no `value` can render the cursor at the wrong x-offset on first focus. Low-impact; closed-testing won't flag.
- **NEW: case-detail "This case is no longer available." path passes `onRetry={undefined}` so the user is stranded.** `case/[slug].tsx:92-112` — when `c` is null but `error` is also null (case row genuinely missing — soft-delete or malformed deep-link), the screen renders an `<ErrorState>` with the wrong title ("no longer available") AND no retry button AND a tiny `← Back` mono link below. The back link is functional but visually out-of-pattern with the rest of the app's CTAs. Low priority — only fires on a malformed link.

### 🔵 V1.0.1+

- **Email validation is still "must contain @"** (`sign-in.tsx:51`). Same as pass-1.
- **Tip-route catch-all error path still renders pre-flight selection name when `submit()` throws** (`tip/[slug].tsx:139-141`). Same as pass-1.

---

## 5. Notification UX

In-app feedback canonical pattern: the "TIP ROUTED" `ReceiptBlock` at `case/[slug].tsx:326-375` driven by `useFreshReceiptCount` + `<SuccessFlash>` at `components/cf/success-flash.tsx`.

### ✅ VERIFIED

- **`Me` tab footer "v0.1.0 (prototype)"** (was 🟡). Now reads `THE COLD FILE · v1.0.0\nMATTE BLACK DEV LLC · VENTURA, CA` (`me.tsx:148-156`). Color is `tokens.color.text.secondary` (AA contrast on `bg.base`) — the pass-1 `evidence.chrome` contrast concern is also addressed.
- **`Me` tab destructive-action arrows in `tip.success` red** (was 🔵 / token-policy violation). Sign-out / delete-account / about / takedown rows now all use `tokens.color.text.secondary` for the arrow color (`me.tsx:81,87`). Tip.success red is now strictly fenced inside `<SuccessFlash>` and the `<ReceiptBlock>` left edge — token policy holds.
- **Tab-bar haptic on `onPressIn` instead of `onPress`** (was a pass-2 implicit polish item). `tab-bar.tsx:55-62` — confirmed.
- **`PeekSheet` X button to dismiss** (was a pass-2 implicit polish). `peek-sheet.tsx:73-98` — wired with `e.stopPropagation()` so the X doesn't fire `onOpen` underneath.

### 🔴 SHIP-BLOCKER

No findings.

### 🟡 OTA POLISH

- **Sign-in success ("link sent") still has no flash, no auto-back, no "use a different email."** `sign-in.tsx:133-150` — same static panel as pass-1. The user has to tap the back arrow manually after seeing "Check your email." Same as pass-1, unaddressed.
- **Saved-case star toggle still has no haptic / no flash.** `case/[slug].tsx:273-283` — `void toggleSave()` is silent. Single-line fix: wrap with `Haptics.impactAsync(Light)`. Same as pass-1, unaddressed.
- **NEW: tab-bar `onPressIn` haptic fires *every* press, including the press on the *currently active* tab.** `tab-bar.tsx:55-62` — there's no guard on `isFocused`. So a user tapping the Map tab while already on the Map gets a haptic that signals "navigation happened" when it didn't (line 64-73's `onPress` correctly skips `navigation.navigate` when `isFocused`, but the haptic already fired in `onPressIn`). Add an `if (isFocused) return;` to `onPressIn`. Minor regression introduced by the haptic timing change.
- **NEW: peek-sheet X button has small hitSlop relative to its visual hit-area** (`peek-sheet.tsx:81`). hitSlop is 12, but the visual is a 28×28 square inside an 18px Ionicon. Net hit-target is ~52×52 which is fine, but on a narrow phone the X button sits 12px from the right edge — close to the edge-swipe gesture region. On a 360dp Android phone this can collide with the system back-gesture. Move the X 16px from the right (currently 12) for safety.

### 🔵 V1.0.1+

- **No "tip routed" notification surface outside of case detail.** Same as pass-1.
- **`Me` tab's "ACCOUNT · SUBSCRIPTION · PRIVACY" eyebrow still advertises Subscription with only "FREE" and no upgrade path.** `(tabs)/me.tsx:65,103-107`. Same as pass-1 — drop "SUBSCRIPTION" from the eyebrow OR restore a "Premium · coming soon" disabled row.

---

## 6. Multi-step Flows

### ✅ VERIFIED

- **Onboarding double-tap on primary CTA, step 3** (was 🟡). `loading={isLast && acquiring}` lands the disable. Earlier-step double-tap (step 0/1 chevron-forward) still has no transient disable, but the impact is `setStepIndex(i => i + 1)` race which React idempotently collapses — no real-world bug.
- **List header "WITHIN 25 MI" misclaim** (was implicit pass-1 polish). Header now reads `${count} CASE(S) · SORTED BY RECENCY` (`list.tsx:54-60`), matching the actual sort order. The map's sub-header (`(tabs)/index.tsx:415-418`) is also honest — "X CASES NATIONWIDE" with the 5000mi reasoning documented inline.

### 🔴 SHIP-BLOCKER

No findings.

### 🟡 OTA POLISH

- **Tip-flow `phase === 'anticipating'` re-entrance race from `'fallback'`.** `tip/[slug].tsx:96-101` — `setFallbackResult(null)` is fired *before* `setPhase('anticipating')` (line 98-99). React batches these in the same render, so the order is fine. Pass-1's batch-ordering nit is now moot — the FallbackBar `phase === 'fallback'` branch is gone before the anticipation paint starts. ✅ effectively addressed by the natural ordering change in the fix commit, even though the prior fix wasn't explicit about it.
- **NEW: the FallbackBar's "Try again" pathway calls `setPhase('idle'); handleSubmit();` synchronously** (`tip/[slug].tsx:290-293`). `handleSubmit` reads `phase` via the closure-captured value (still `'fallback'` at this exact instant), and the `if (phase !== 'idle' && phase !== 'fallback') return;` guard at line 96 means the fallback->idle transition followed by re-submit works. But the `setFallbackResult(null)` at line 99 happens AFTER `Haptics.impactAsync(...)` at line 100, which means the FallbackBar still paints with stale `fallbackResult` data for ~16ms before clearing. Move `setFallbackResult(null)` up *above* the haptic. Minor.
- **Tip-modal still has no draft persistence.** `tipBody` is local state only (`tip/[slug].tsx:81`). Same as pass-1 V1.0.1+ — but this is now closer to a 🟡 because closed-testing reviewers spending 5+ minutes drafting a tip and having Android background it on memory pressure will lose the draft. Recommend AsyncStorage-backed draft per `caseSlug` with 24h TTL.

### 🔵 V1.0.1+

- **Onboarding back-navigation doesn't preserve location-grant intent.** Same as pass-1.

---

## Cross-cutting summary — pass 2

### Regressions introduced by the dd718ec fix commit

1. 🟡 **Map `<ErrorState>` overlay layout is wrong** — sibling layout under `<View flex:1>` causes inline stacking instead of overlay. The `<EmptyState>` it sits beside DOES overlay correctly because EmptyState wraps in `position: 'absolute'` internally. This is a real regression — pass-1 said "wire the error" but the wiring landed without the same overlay semantics as the empty-state pattern. Fix: wrap `<ErrorState>` in `position:'absolute'` shell, OR add an `overlay` prop to ErrorState mirroring EmptyState's internal pattern.
2. 🟡 **Tab-bar haptic now fires on already-active tab** — the `onPressIn`/`onPress` split moved the haptic earlier but didn't carry the `isFocused` guard from the navigation step. One-line fix.
3. 🟡 **Onboarding step-3 "Maybe later" can fire while `acquiring` is true** — the primary CTA was correctly gated but the secondary wasn't, creating a new edge case (post-unmount setState warnings, wasted GPS fix) that didn't exist in pass-1's variant.

### Pass-1 items still unaddressed

- Empty-state divergence (list/saved/search bespoke vs shared component)
- Saved-tab empty-state copy advertises premium notifications not shipped
- List-tab empty-state copy implies filters that don't exist
- Sign-in success has no flash / no "use different email" affordance
- Saved-case star has no haptic
- Sign-in error has no `accessibilityRole="alert"`
- Tip-modal fallback locks textarea
- Inconsistent loading surfaces across read screens
- Case-detail full-page spinner ignores progressive-render contract

### New findings (not in pass-1)

- 🟡 List-tab eyebrow shows "0 CASES" above the error state (visible inconsistency)
- 🟡 Map ErrorState layout regression (above)
- 🟡 Tab-bar haptic on already-active tab (above)
- 🟡 Onboarding step-3 secondary fires during acquiring (above)
- 🟡 Tip-modal FallbackBar paints stale data for ~16ms on retry
- 🟡 Tip-modal lacks draft persistence (was 🔵 in pass-1, escalated given closed-testing reviewer behavior)
- 🟡 PeekSheet X is too close to edge-swipe gesture region on narrow Androids
- 🟡 Case-detail "no longer available" path strands user with no retry + tiny back link

### Files most relevant

- `mobile/app/(tabs)/index.tsx:155-181` — ErrorState overlay regression
- `mobile/app/(tabs)/list.tsx:63-72` — eyebrow + error layout
- `mobile/app/(tabs)/saved.tsx:108-153` — empty-state copy + bespoke
- `mobile/app/onboarding.tsx:197-219` — secondary CTA disable during acquiring
- `mobile/app/tip/[slug].tsx:96-141` — fallback retry batch ordering, draft persistence
- `mobile/app/case/[slug].tsx:92-112` — no-longer-available retry path
- `mobile/components/cf/tab-bar.tsx:55-62` — onPressIn isFocused guard
- `mobile/components/cf/peek-sheet.tsx:73-98` — X button edge-gesture safety
- `mobile/components/cf/error-state.tsx:36-44` — add overlay variant
