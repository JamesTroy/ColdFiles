# Audit 03 — Flows & States

Scope: closed-testing audit of v1.0.0 user flows and UI states for The Cold File mobile (Expo SDK 54, React Native).
Date: 2026-04-29.
Severity legend:
- 🔴 SHIP-BLOCKER — closed-testing reviewer would flag, or visibly broken on real hardware. Fix before AAB upload.
- 🟡 OTA POLISH — real user-facing issue. Fixable via OTA push without rebuilding the AAB.
- 🔵 V1.0.1+ — known limitation or larger refactor. Non-blocking for closed testing.

---

## 1. Onboarding UX

Three-screen first-launch flow at `mobile/app/onboarding.tsx`. Gate at `mobile/app/_layout.tsx:137-148`. State at `mobile/lib/hooks/use-onboarding.ts`.

### 🔴 SHIP-BLOCKER

- **Back chevron overlaps the progress dots on steps 1 and 2.** The chevron is `position: 'absolute', top: insets.top + 8, left: 0, padding: 16` (`mobile/app/onboarding.tsx:194-202`). The progress-dots row sits inside the same column at `paddingTop: insets.top + 16, paddingHorizontal: 16` (`mobile/app/onboarding.tsx:98-131`). The chevron's icon center lands at roughly x=26 / y=insets.top+24; dot 0 starts at x=16 and the active dot extends to ~x=46. They visibly collide on every device. A reviewer screenshotting onboarding will see the icon stamping the dots.

### 🟡 OTA POLISH

- **Step 3 "Use my location" CTA has no loading state during permission prompt + GPS acquire.** `handlePrimary` does `await requestAndAcquire(); await finish();` (`mobile/app/onboarding.tsx:87-95`) but never passes `loading` to the `<AmberCTA>`. On Android, dismissing the system dialog and waiting for `getCurrentPositionAsync` (Balanced accuracy) can take 3–8s in low-signal. The button stays tappable and re-firing it queues a second `requestForegroundPermissionsAsync` + GPS fix. The hook's `acquiring` state is already exposed by `useHere()` (`mobile/lib/hooks/use-here.ts:57,111`) but not consumed. Wire it: `loading={acquiring}` on the AmberCTA.
- **Skip / Maybe later have no debouncing.** Same class of issue as above. `void finish()` is called from two paths; double-tap during the AsyncStorage write could race the `router.replace('/')`. The shared store at `mobile/lib/hooks/use-onboarding.ts:34-37` makes this safe in practice, but adding `disabled` once the press fires is correct hygiene.

### 🔵 V1.0.1+

- **First-launch flash of the map tab before the gate redirects.** OnboardingGate (`mobile/app/_layout.tsx:137-148`) returns `null` while `state === 'loading'`; the Stack falls through to the `(tabs)` anchor and the map renders for one or two frames before `router.replace('/onboarding')` fires. Add a base-color splash overlay while `state === 'loading'`.
- **The "Maybe later" path leaves location ungranted with no in-app affordance to retry inside onboarding itself.** This is by design — the LocationFAB on the map (`mobile/app/(tabs)/index.tsx:173-175,309-341`) is the recovery surface — but it isn't documented anywhere onboarding-side, so a user who taps "Maybe later" then immediately wonders "where's the prompt?" has to discover the map FAB on their own.

---

## 2. Empty States

`EmptyState` shipped at `mobile/components/cf/empty-state.tsx` with two variants. Map screen wires it at `mobile/app/(tabs)/index.tsx:168-172`.

### 🔴 SHIP-BLOCKER

No findings.

### 🟡 OTA POLISH

- **`(tabs)/list.tsx` and `(tabs)/saved.tsx` and `search.tsx` each ship their own bespoke empty-state implementation, ignoring the new `EmptyState` component.** Local implementations:
  - `mobile/app/(tabs)/list.tsx:271-293` — local `EmptyState()` with em-dash + "No cases match the current filters." Copy is wrong: when `useCaseList` returns 0 rows on a fresh DB the message implies the user applied filters they didn't apply. The `no-cases-in-region` variant of the shared component would be more honest.
  - `mobile/app/(tabs)/saved.tsx:108-153` — bespoke nothing-saved-yet treatment with a 64px circle. Promotional copy (`"Premium users get push notifications when a saved case has movement"`) advertises a feature that v1.0.0 doesn't ship — the watch-zone entry point was deferred per `mobile/app/(tabs)/me.tsx:105-106`.
  - `mobile/app/search.tsx:104-115` — inline "No matches" without using the `no-matches` variant.

  Reviewers won't flag any of these, but the divergence is quiet design-debt and the saved-tab promotional line is a small honesty issue.

### 🔵 V1.0.1+

- **Map's `EmptyState` overlay sits on top of the Leaflet/Mapbox WebView with `pointerEvents="box-none"`.** That works for pan-through (`mobile/components/cf/empty-state.tsx:40`) but the centered card itself is opaque and intercepts touches. On a tiny viewport / sparse seed, the user can't pan from underneath the card. Acceptable for v1 since the 5000mi radius means the empty state is rare in production.

---

## 3. Loading & Skeleton States

### 🔴 SHIP-BLOCKER

No findings.

### 🟡 OTA POLISH

- **Inconsistent loading surfaces across read screens.**
  - Map's `UPDATING` chip at `mobile/app/(tabs)/index.tsx:176-202` only renders when `loading && cases.length > 0` — i.e., on refetch when stale data is showing. Cold-start renders a static map with no loading indicator at all (the header label shows `"LOADING"` per `headerSubLabel`, which is the only signal).
  - List tab shows a centered `ActivityIndicator` only when `loading && rows.length === 0` (`mobile/app/(tabs)/list.tsx:63-66`). On refetch the list flashes through stale rows with no signal.
  - Saved tab is binary loading vs. content (`mobile/app/(tabs)/saved.tsx:50-53`).
  - Case detail full-page spinner at `mobile/app/case/[slug].tsx:88-90` covers the entire screen for the duration of the parallel reads — no progressive render despite the hook supporting it (the comment at `use-case-detail.ts:8` claims progressive but the consumer doesn't honor it).

  Pick one pattern (recommend the small `UPDATING` chip on every list-bearing screen) and apply uniformly via OTA.

### 🔵 V1.0.1+

- **No skeleton screens anywhere in the app.** The case-detail screen is the highest-value place for one — three parallel reads, hero photo + serif name + facts are all known sizes and would benefit from a placeholder grid. Below the bar for v1.0.0 closed testing (the dark theme + small dataset means the spinner duration is sub-second on a healthy connection); becomes worth shipping when live data + thumbnails land.
- **`SuccessFlash` is the only motion language for state-change feedback.** Outside the tip-routed flash, every state transition is instant. A 100ms cross-fade on filter chip changes / list re-renders would help perceived performance without crossing into the design system's "pulse implies live data" rule.

---

## 4. Error UX

`ErrorState` at `mobile/components/cf/error-state.tsx`. Consumers: `mobile/app/(tabs)/list.tsx:67-72` and `mobile/app/case/[slug].tsx:92-112`.

### 🔴 SHIP-BLOCKER

- **The map screen swallows RPC errors silently.** `mobile/app/(tabs)/index.tsx:67-77` destructures `{ data: cases, loading, source }` from `useCasesNear` — `error` is intentionally unused. When `cases_within_radius` returns an error, `setData([])` runs (`mobile/lib/hooks/use-cases-near.ts:71-73`), `loading` flips false, and the user sees the `EmptyState "No cases in this view"` overlay. A reviewer who triggers a network failure (airplane-mode toggle) sees a fake empty state with no retry. Wire `error` into the map screen with `<ErrorState onRetry={refetch} />` rendered in the same overlay slot.

### 🟡 OTA POLISH

- **Sign-in error message paints itself in `tokens.color.tip.success` (the agency-routed red).** `mobile/app/sign-in.tsx:178`. The token is documented as the ONLY sanctioned use of red anywhere in the app outside `<SuccessFlash>` (`mobile/components/cf/success-flash.tsx:4-5`, `mobile/constants/theme.ts:57-58`). Same sin in `mobile/app/delete-account.tsx:174`. Rename to a generic `text.warning` token or use `text.secondary` until then; do not co-opt the tip-success red for arbitrary errors.
- **Tip modal error path locks the textarea.** When `submit()` throws, `phase = 'fallback'` and the `<TextInput editable>` flag goes false (`mobile/app/tip/[slug].tsx:246`). The user can't edit their tip body before retrying. Allow editing in the fallback phase.
- **Sign-in error styling is not labeled as an error to a screen reader.** No `accessibilityRole="alert"` or `accessibilityLiveRegion="polite"` on the error `<SansBody>` at `mobile/app/sign-in.tsx:174-184`. Accessibility-strict reviewers may flag.

### 🔵 V1.0.1+

- **Email validation is "must contain @" only.** `mobile/app/sign-in.tsx:48`. Acceptable for closed testing — Supabase will reject malformed addresses server-side — but a stricter regex would cut the round-trip on common typos.
- **Tip-route error path always shows `selected.agency.name` even if the submission resolved to a different agency.** When `submit()` succeeds and the deep link fails, `fallbackResult.agency_name` is used (correct). When `submit()` throws, the code falls back to `selected.agency.name` — which is the user's pre-flight selection, not what the server would have routed to. Minor; only affects the catch-all error path.

---

## 5. Notification UX

In-app feedback canonical pattern: the "TIP ROUTED" `ReceiptBlock` at `mobile/app/case/[slug].tsx:323-372` driven by `useFreshReceiptCount` + `<SuccessFlash>` at `mobile/components/cf/success-flash.tsx`.

### 🔴 SHIP-BLOCKER

No findings.

### 🟡 OTA POLISH

- **Sign-in success ("link sent") has no flash or affordance to advance.** `mobile/app/sign-in.tsx:118-135` swaps the form for a static "Check your email" panel. There's no auto-back, no "I sent it to the wrong email — try again" link, no toast/flash on the email mono. The user is stuck on a static modal until they kill it. Add a "Use a different email" pressable that resets to `status: 'idle'`, and consider applying the `<SuccessFlash>` mechanic to the email mono on first render.
- **Saved-case star toggle has no haptic / no flash.** `mobile/app/case/[slug].tsx:271-280` toggles state silently. The Tip flow uses `Haptics.impactAsync(Medium)` (`mobile/app/tip/[slug].tsx:98`); save/unsave should use `Light`. Single-line OTA fix.
- **`Me` tab shows "v0.1.0 (prototype)" in the footer.** `mobile/app/(tabs)/me.tsx:154`. The app ships v1.0.0 (`mobile/app.config.ts:16`). A closed-testing reviewer who opens Me sees "prototype" — not a blocker for the *flow*, but it's text-content fixable via OTA. Surface the real version (read from `expo-application` or hardcode `v1.0.0`) and drop the "(prototype)" qualifier. *Note: `package.json` is also stuck at `0.1.0` — separate v1.0.1+ cleanup.*

### 🔵 V1.0.1+

- **No "tip routed" notification surface outside of case detail.** Currently the receipt only renders if the user re-enters the same case. A user who tips on case A and then opens case B has no global "1 tip routed today" surface. Defer; out of scope for v1.0.
- **`Me` tab's "ACCOUNT · SUBSCRIPTION · PRIVACY" header (`mobile/app/(tabs)/me.tsx:65`) advertises a Subscription section that only ever shows "FREE" with no upgrade path** (the watch-zone entry was deliberately removed per the comment at `me.tsx:105-106`). Either drop "SUBSCRIPTION" from the eyebrow, or restore a "Premium · coming soon" disabled row.
- **`tokens.color.tip.success` leaks into Me tab as the destructive-action arrow color** (`mobile/app/(tabs)/me.tsx:81,87`). Same red-token policy violation as the sign-in errors but here it's deliberate as a destructive-action cue. Decide whether to add a `text.destructive` token or accept the cross-use.

---

## 6. Multi-step Flows

The onboarding flow is the only true multi-step in v1.0. The tip submission has a 200ms anticipation → success-flash → deep-link choreography that's stepper-adjacent (`mobile/app/tip/[slug].tsx:93-140`).

### 🔴 SHIP-BLOCKER

No findings.

### 🟡 OTA POLISH

- **Onboarding double-tap risk on the primary CTA on every step (covered in §1 above)** — same `loading={acquiring}` fix on step 3 and a transient disabled flag on steps 0/1.
- **Tip flow's `phase === 'anticipating'` state can be re-entered from `'fallback'`.** `mobile/app/tip/[slug].tsx:94` — the guard `if (phase !== 'idle' && phase !== 'fallback') return;` allows re-submission from fallback, but `setPhase('anticipating')` is fired before `setFallbackResult(null)` is committed in React batch. There's a brief window where the stale FallbackBar is on screen with the next anticipation already running. Move the `setFallbackResult(null)` into a `setPhase` callback or above the phase change.

### 🔵 V1.0.1+

- **No state persistence in the tip modal.** If the user backgrounds the app mid-tip-typing (e.g. to look up a fact in another app), iOS may unmount the modal on memory pressure. The `tipBody` is local state only. Consider `AsyncStorage`-backed draft per `caseSlug` with a 24h TTL.
- **Onboarding back-navigation doesn't preserve location-grant intent.** If the user backs out from step 2 → step 1 → step 0, `handlePrimary` re-walks the steps and re-prompts the OS for location at the end (the OS dedupes if the user already granted, but the screen doesn't read that state and skip forward). Acceptable for v1; revisit if anyone reports the loop.

---

## Cross-cutting summary

Files touched by these findings:
- `mobile/app/onboarding.tsx` — chevron z-order, CTA loading state.
- `mobile/app/(tabs)/index.tsx` — wire `error` from `useCasesNear`; add `<ErrorState>` overlay.
- `mobile/app/(tabs)/list.tsx`, `mobile/app/(tabs)/saved.tsx`, `mobile/app/search.tsx` — adopt shared `EmptyState`.
- `mobile/app/(tabs)/me.tsx` — version string and SUBSCRIPTION eyebrow.
- `mobile/app/sign-in.tsx`, `mobile/app/delete-account.tsx` — drop `tokens.color.tip.success` for error text.
- `mobile/app/tip/[slug].tsx` — fallback editability, batch ordering of `setPhase`/`setFallbackResult`.
- `mobile/app/case/[slug].tsx` — haptic on save toggle.
