# Audit 02 — Interaction Patterns

Scope: Cold File mobile (Expo SDK 54, RN 0.81, Reanimated 4) — closed-testing build v1.0.0.
Method: Static read of every screen + all interactive `cf/*` primitives. Heuristics tied to Material 3 + iOS HIG touch-target / dismissal / keyboard-hygiene baselines. No on-device verification — findings reasoned from code only.

Severity legend:
- 🔴 SHIP-BLOCKER — closed-testing reviewer would flag, or visibly broken on real hardware.
- 🟡 OTA POLISH — real issue, fixable via OTA push without rebuilding the AAB (JS-only changes).
- 🔵 V1.0.1+ — known limitation or larger refactor; non-blocking.

---

## 1. Mobile UX

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **Peek sheet has no dismiss affordance.**
   `mobile/components/cf/peek-sheet.tsx:34-105` — the entire sheet is one `Pressable` whose `onPress` opens the case. There is no close button, no swipe-down handler, and no parent tap-to-deselect on the map view (`mobile/app/(tabs)/index.tsx:205-212` only re-renders when `selectedSlug` changes; nothing clears it). A user who taps a pin by accident is forced to either open the case or pick a different pin. Add an X button in the top-right of the sheet, or wire a tap-on-map-background handler that calls `setSelectedSlug(null)`.

2. **Tip modal sticky CTA has no error visibility on submit failure.**
   `mobile/app/tip/[slug].tsx:135-139` — the catch swallows the exception and just flips to `phase = 'fallback'`. The FallbackBar copy says "Couldn't open the {agency} form" (line 333) which is *deep-link* failure phrasing, not *submit* failure phrasing. If the Edge Function 500s the user sees deep-link copy that lies. Branch the FallbackBar message off `fallbackResult` presence: when null, say "Couldn't reach the routing service. Try again."

3. **Custom grab handle inside the tip modal duplicates iOS native sheet handle.**
   `mobile/app/tip/[slug].tsx:145-155` — the modal is presented with `presentation: 'modal'` (`app/_layout.tsx:108`), which on iOS gives a native sheet-pull handle. Drawing a second 36×4 bar 4px below the system one looks like a layout bug. Drop the custom handle on iOS or condition it on `Platform.OS === 'android'`.

4. **Watch-zone toggle row is announced as a button, not a switch.**
   `mobile/app/watch-zone.tsx:392-411` — `<Pressable>` wraps the row but no `accessibilityRole="switch"` and no `accessibilityState={{ checked: value }}`. TalkBack/VoiceOver will say "double-tap to activate" instead of "switch, on / off". Add the role + state.

### 🔵 V1.0.1+

- **PhotoFrame warning gate has no haptic feedback on reveal** (`components/cf/photo-frame.tsx:166`). A medium impact when the gate dissolves would reinforce that revealing sensitive content is a deliberate act. Defer until after closed testing.
- **Tab-bar press-state opacity 0.6 on Android-with-ripple is double feedback** (`components/cf/tab-bar.tsx:89` + `:80-84`). Android Material spec is ripple-only; iOS-style opacity press over a ripple feels unidiomatic on Pixel hardware.

---

## 2. Navigation UX

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **Onboarding `Skip` button bypasses the content-warning step on a 17+ app.**
   `mobile/app/onboarding.tsx:117-130` — the SKIP affordance sits in the top-right on every step including step 0 (welcome) and step 1 (CONTENT NOTICE). A reviewer or user can skip the rated-mature disclosure entirely. Either (a) hide SKIP on step 1 specifically, or (b) require passing through step 1 (skip is allowed only on step 2 — the location step). The Play Store IARC flow assumes the user has *seen* the content notice they later opt past.

2. **Sign-in modal back button competes with iOS swipe-to-dismiss.**
   `mobile/app/sign-in.tsx:76-96` — the screen draws a custom 36×36 back button at the top-left, but the screen is presented as `presentation: 'modal'` (`app/_layout.tsx:122`) so iOS already gives a swipe-down gesture and the system back chrome treats this as a sheet. The custom back button calls `router.back()` which is correct; the issue is visual — the screen looks like a stack screen with a back arrow, not a modal. Either (a) drop the back arrow and lean on swipe-to-dismiss, or (b) replace the chevron with an X to signal modal-close semantics. Same comment applies to `mobile/app/search.tsx:54-74`.

### 🔵 V1.0.1+

- **`unstable_settings.anchor = '(tabs)'`** (`app/_layout.tsx:40`) is correct but Expo Router's anchor is unstable — track upgrade notes between SDK bumps.
- **No deep-link handler for `coldfile://case/{slug}`** — only `coldfile://auth-callback` is handled (`lib/hooks/use-auth-callback.ts:26`). Sharing a case via the system share-sheet (`app/case/[slug].tsx:71`) yields an `https://coldfile.app/case/{slug}` URL that won't reopen the app to that case if the user already has it installed. Wire universal links + deep link route in v1.0.1.

---

## 3. Forms & Validation

### 🔴 SHIP-BLOCKER

1. **No `KeyboardAvoidingView` on any form.**
   - `mobile/app/sign-in.tsx:64-208` — email input sits ~70% down the screen on a small phone (Pixel 4a / 5.8"). When the keyboard pops, the "Send link" CTA gets covered and the user can't reach it. This is a closed-testing reproducer on every Android device.
   - `mobile/app/watch-zone.tsx:114-166` — zone-name input is mid-screen but the Save CTA (line 178) is sticky-bottom; on focus the bottom bar gets pushed up but the underlying ScrollView doesn't scroll the input into view because there's no `automaticallyAdjustKeyboardInsets` and no `KeyboardAvoidingView`.
   - `mobile/app/tip/[slug].tsx:242-258` — the multi-line tip body is the most exposed: focus the body, type three lines, the textarea is fully covered by the keyboard with no scroll-into-view.
   Wrap each form screen in `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>` and add `keyboardShouldPersistTaps="handled"` to the ScrollViews.

### 🟡 OTA POLISH

1. **Sign-in error message uses `tip.success` red as the error color but has no `accessibilityRole="alert"`.**
   `mobile/app/sign-in.tsx:174-184` — screen readers won't announce the new error when it appears. Add `accessibilityLiveRegion="polite"` (Android) and `accessibilityRole="alert"` so the message is read on render. Same fix at `mobile/app/delete-account.tsx:170-179`.

2. **Email TextInput missing `returnKeyType` / `onSubmitEditing` and `textContentType`.**
   `mobile/app/sign-in.tsx:151-172` — has `autoComplete="email"` and `keyboardType="email-address"` (good) but no `returnKeyType="send"`, no `onSubmitEditing={handleSubmit}`, and no `textContentType="emailAddress"` (iOS QuickType bar). Adding these three is one OTA push and a measurable conversion bump on the magic-link flow.

3. **Sign-in "sending" state hides the entire CTA, replacing it with just a centered spinner.**
   `mobile/app/sign-in.tsx:187-192` — there's no label, no disabled-button affordance, no way to know the action is in flight other than a small amber spinner where the button used to be. The AmberCTA already supports a `loading` prop (`components/cf/cta-button.tsx:42-44`); use `<AmberCTA label="Send link" loading={status === 'sending'} onPress={handleSubmit} />` so the surface stays consistent.

4. **No `maxLength` on tip body or zone name.**
   `mobile/app/tip/[slug].tsx:242` and `mobile/app/watch-zone.tsx:119` — neither input enforces a length cap. The tip body in particular feeds an Edge Function and a content-hash insert — at 64KB+ paste, this becomes a backend / network surprise. Cap at e.g. `maxLength={4000}` on tip body and `maxLength={60}` on zone name.

### 🔵 V1.0.1+

- **No client-side email regex beyond `.includes('@')`** (`mobile/app/sign-in.tsx:48`) — the server validates anyway, so this is fine for v1.0, but a friendlier client-side check (e.g., simple regex, `/.+@.+\..+/`) shortens the round-trip on typos.

---

## 4. Modal & Dialog

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **Tip modal close button has the wrong `accessibilityLabel` for screen-reader users in the fallback state.**
   `mobile/app/tip/[slug].tsx:179-200` — the X button always announces as "Close". When the FallbackBar is up (line 277) the X still closes, but if the user got here after a deep-link failure they may have a half-routed tip on the audit table. Add an `accessibilityHint` like "Closes without finishing routing" so the consequence is announced.

2. **Sign-in + search modals slide from bottom but have no swipe-down dismiss handler on Android.**
   `mobile/app/_layout.tsx:122-123` — Android doesn't honor iOS sheet swipe gestures for `presentation: 'modal'`; the user must use the on-screen back button or system back. The custom back chevron (`mobile/app/sign-in.tsx:76`, `mobile/app/search.tsx:54`) is the only exit path on Android, and as noted above (Audit 2 §2) the chevron iconography reads as stack-back not modal-close. Convert to `Ionicons name="close"` for these two modal screens.

3. **Tip modal `Pressable` close hit area is 36×36 + hitSlop:12 = 60×60.**
   `mobile/app/tip/[slug].tsx:179-200` — fine on its own. But the X sits 16px from the right edge and 8px from the top inset; a user sweeping a thumb in from the right edge can accidentally trigger system gesture areas (back-from-edge on Android 10+). Move the X 4px further inward, or add a `marginRight: 4`.

### 🔵 V1.0.1+

- **No focus management on modal mount** — when the tip modal opens, the radio cards aren't auto-focused for screen readers, so VoiceOver users have to scroll up to find the title. Consider `accessibilityViewIsModal` on the root container and an `accessibilityElementsHidden` on the underlying tab content.
- **PhotoFrame warning gate is a `Pressable` with no `accessibilityRole`** (`components/cf/photo-frame.tsx:166`) — TalkBack reads "Sensitive content. This image may be difficult to view." but the tap affordance isn't announced. Add `accessibilityRole="button"` and `accessibilityLabel="Reveal image"`.

---

## 5. Micro-interactions

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **Tab-bar haptic fires on press, not press-in — feels laggy on Android.**
   `mobile/components/cf/tab-bar.tsx:55-67` — the new `CFTabBar` calls `Haptics.selectionAsync()` inside `onPress`, which fires after release. The deprecated `HapticTab` (`mobile/components/haptic-tab.tsx:14-20`) used `onPressIn` — the right hook for "feels like the tap registered". Switch CFTabBar to `onPressIn` (still emit the navigation event in `onPress`).

2. **AmberCTA "loading" state shows a spinner with no copy.**
   `mobile/components/cf/cta-button.tsx:42-44` — when `loading`, the button is just a spinner against amber. There's no "Sending..." label and no transition between states. For tip-flow usage this is fine because the anticipation pause is only 200ms (`tokens.tipFlow.anticipationMs`), but for sign-in (where the network round-trip is 1–3s) this reads as a stalled button. Add an optional `loadingLabel` prop and use `<ActivityIndicator size="small" />` inline next to the label.

3. **SuccessFlash has no pre-flash haptic pairing.**
   `mobile/components/cf/success-flash.tsx:55-89` — visual flash is locked at 600ms total but no `Haptics.notificationAsync(NotificationFeedbackType.Success)` fires on the same beat. The tip-flow hook does fire a `Haptics.impactAsync(Medium)` at submit (`app/tip/[slug].tsx:98`) but that's at T+0; the flash visualizes at T+700-1300ms (after deep-link return). Add a Success notification haptic inside the SuccessFlash effect right when `flashKey` changes — pairs the visual signal with a tactile one.

### 🔵 V1.0.1+

- **No press-state for the share button** in the case-detail circle button (`app/case/[slug].tsx:150-152`) beyond the wrapper `CircleButton`'s opacity 0.7. Fine as-is; if the share sheet is slow to open, a transient "preparing" state would help.

---

## 6. Motion & Interaction

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **No `AccessibilityInfo.isReduceMotionEnabled()` checks anywhere.**
   `mobile/components/cf/brand-mark.tsx:36-47` — pulses forever via `withRepeat(..., -1)`. `mobile/components/cf/success-flash.tsx:65-74` — runs a sequenced color animation. Neither honors the user's reduce-motion setting. iOS users with vestibular disorders set this in Settings → Accessibility → Motion. The fix is one hook used in both: `const reduce = useReducedMotion()` (Reanimated 4 ships this), then early-return without `withRepeat` / skip the sequence and snap to the end frame. The MapLibre/Leaflet "you here" pulse halo (referenced in feedback_design_pulse_only_when_fresh.md but rendered inside the WebView at `components/cf/leaflet-map.tsx`) also runs without a reduce-motion check; that one is HTML/CSS so the fix is to inject the `prefers-reduced-motion` query on Leaflet HTML build.

2. **Onboarding step transitions are state-only — no animated transition.**
   `mobile/app/onboarding.tsx:74-95` — `setStepIndex(i + 1)` swaps content with no fade or slide. The progress dots animate width via inline conditional (`width: i === active ? 18 : 6` at line 215) but the step content snap-cuts. Wrap the body in a `Animated.View` with a fade-in keyed off `stepIndex`, ~150ms. OTA-able.

### 🔵 V1.0.1+

- **Reanimated logger config not pinned** — Reanimated 4 logs strict warnings by default that show up as red boxes in dev. Not a v1.0 concern (release build silences them) but worth setting `configureReanimatedLogger({ strict: false })` in `_layout.tsx` for cleaner dev DX.
- **Tip modal anticipation timing tuned at 200ms in the abstract** (`tokens.tipFlow.anticipationMs`, theme.ts:232) — the doc comment in `app/tip/[slug].tsx:13-17` says "tune on a real device". Closed-testing data should drive a value sweep in v1.0.1.
