# Audit 06 — Interaction Patterns, Pass 2

Scope: Cold File mobile (Expo SDK 54, RN 0.81, Reanimated 4) — closed-testing build v1.0.0 after commit `dd718ec`.
Method: Static re-read of every screen + every interactive `cf/*` primitive. Same heuristics as Pass 1 (Material 3 + iOS HIG baselines for touch, dismissal, keyboard hygiene). No on-device verification — findings reasoned from code only. Items already documented as deferred in `02-interaction.md` are not re-flagged.

Severity legend:
- 🔴 SHIP-BLOCKER — closed-testing reviewer would flag, or visibly broken on real hardware.
- 🟡 OTA POLISH — real issue, fixable via OTA push without rebuilding the AAB.
- 🔵 V1.0.1+ — known limitation or larger refactor; non-blocking.
- ✅ VERIFIED — Pass 1 ship-blocker / OTA item that landed correctly.

---

## 1. Mobile UX

### ✅ VERIFIED
- **Peek sheet now wires `onDismiss`** with an X in the top-right (`mobile/components/cf/peek-sheet.tsx:73-98`); the map screen passes `setSelectedSlug(null)` (`mobile/app/(tabs)/index.tsx:220`). The X uses `e.stopPropagation()` so it doesn't double-fire as a sheet-open. Hit area is 28×28 + `hitSlop:12` = 52×52, just under the 48dp baseline once `hitSlop` is included. Good.
- **Tab-bar haptic moved to `onPressIn`** (`mobile/components/cf/tab-bar.tsx:55-62`); navigation event still fires on `onPress` so the tactile cue lands at touch-down without breaking gesture cancellation. Correct.

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **Map background tap doesn't deselect a pin.**
   `mobile/app/(tabs)/index.tsx:155-212` — the X button now exists, but the parent `View` wrapping the map renderer still has no `onPress` to clear `selectedSlug`. On a real Android device users habitually tap empty map space to dismiss a peek; right now they have to find the 28-pt X. Either add an outer `Pressable` around `LeafletRenderer`/`NativeRenderer` that fires `setSelectedSlug(null)` on tap-without-marker, or accept the X-only path explicitly. Cheap OTA win.

2. **Peek-sheet X has no z-order guarantee against the grab handle and the section row.**
   `mobile/components/cf/peek-sheet.tsx:74-98` — the dismiss `Pressable` is positioned `absolute, top: 8, right: 12` inside the same flex parent as the grab handle (line 60) and the SELECTED row (line 101). The grab handle is centered at `marginBottom: 10` from the same top, so the X sits over the right end of the section label row. Visual collision today (the row uses `space-between` flex, so the right-edge `Open →` mono label gets covered). Move the X 28px down (below the section row) or use `marginRight: 32` on the section label to reserve the slot.

3. **Watch-zone toggle row still announces as a button, not a switch.**
   `mobile/app/watch-zone.tsx:399-417` — Pass 1 §1 OTA #4 not addressed. Still no `accessibilityRole="switch"` and no `accessibilityState={{ checked: value }}`. Keeps shipping with TalkBack reading "double-tap to activate" instead of "switch, on/off". One-line fix per row.

### 🔵 V1.0.1+

- **Peek-sheet swipe-down dismissal** isn't wired — only the X button. Users on Pixel hardware expect a downward-pan to close any sheet-shaped surface. Reanimated `Gesture.Pan()` + `runOnJS(onDismiss)` after a 60dp threshold is a v1.0.1 polish.

---

## 2. Navigation UX

### ✅ VERIFIED
- **Onboarding back chevron** is now in a flex-row with `justify-content: space-between` (`mobile/app/onboarding.tsx:113-157`), 32-pt reserved spacers preserve dot centering across step changes. No more collision with the progress dots.
- **SKIP gated to `stepIndex > 0`** (`mobile/app/onboarding.tsx:83, 138-156`); the 17+ content notice on step 1 is now mandatory viewing before Skip becomes available. Good.

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **Sign-in / Search modal back-arrow iconography wasn't switched to "close".**
   Pass 1 §2 OTA #2 is unaddressed.
   - `mobile/app/sign-in.tsx:101` — still `Ionicons name="chevron-back"`.
   - `mobile/app/search.tsx:73` — still `Ionicons name="chevron-back"`.
   Both screens are presented with `presentation: 'modal'` (`mobile/app/_layout.tsx:122-123`); the chevron reads as stack-back, not modal-close. Replace both with `Ionicons name="close"`. Two-line OTA push.

2. **Onboarding back chevron is reachable by Talkback but the `accessibilityHint` is missing.**
   `mobile/app/onboarding.tsx:122-131` — `accessibilityLabel="Previous step"` plus `accessibilityRole="button"` are correct, but a screen-reader user steps backward through onboarding without any hint about *what step* they'll land on. Add `accessibilityHint="Returns to the previous onboarding step"`. Minor.

3. **NEW — `unstable_settings.anchor` doesn't gate `onboarding`.**
   `mobile/app/_layout.tsx:39-41` — `anchor: '(tabs)'` is correct for the back-stack root, but `OnboardingGate` (`:137-148`) does the redirect with a `useEffect`. On a cold launch where `state` is briefly `'unknown'` and `pathname` is `/`, the gate renders the tabs first, then replaces with `/onboarding`. The result is a frame or two of map-tab content visible before onboarding mounts. Switch the gate to a Suspense-style fallback (return null while `state === 'unknown'`) or guard the `Stack` itself behind `state !== 'unknown'`. Not a SHIP-BLOCKER (the splash screen on real devices likely covers it), but it's an OTA-able polish.

### 🔵 V1.0.1+

- Deep-link routing for `coldfile://case/{slug}` still unhandled (Pass 1 §2 V1.0.1+).

---

## 3. Forms & Validation (post-KeyboardAvoidingView)

### ✅ VERIFIED — Pass 1 SHIP-BLOCKER fix landed correctly

All three forms are wrapped in `<KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>` with the right structure:

| File | KAV outermost | ScrollView inside | `keyboardShouldPersistTaps="handled"` | Per-platform behavior |
|---|---|---|---|---|
| `mobile/app/sign-in.tsx:68-222` | yes | yes (`:117`) | yes (`:124`) | yes |
| `mobile/app/watch-zone.tsx:66-187` | yes | yes (`:117`) | yes (`:119`) | yes |
| `mobile/app/tip/[slug].tsx:144-304` | yes | yes (`:149`) | yes (`:151`) | yes |

Sticky CTAs on watch-zone (`:174-185`) and tip (`:275-302`) sit *inside* the KAV but *outside* the ScrollView, which is correct — the bottom bar lifts with the keyboard.

`KeyboardAvoidingView` does NOT wrap `delete-account.tsx`. Acceptable: that screen has no `TextInput` (it's a confirm-delete page only), so there's no keyboard to avoid.

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **NEW — `KeyboardAvoidingView` is missing the `keyboardVerticalOffset` prop on screens with a top inset.**
   `mobile/app/sign-in.tsx:68-71`, `mobile/app/watch-zone.tsx:66-69`, `mobile/app/tip/[slug].tsx:144-148` — all three KAVs sit *inside* the `SafeAreaView` provider but are not given `keyboardVerticalOffset`. On iOS with `behavior="padding"` and a non-zero top inset (notch / Dynamic Island), the bottom of the form gets over-padded by `insets.top`, which on a Pixel-tall iPhone (e.g., 16 Pro) leaves dead space below the lifted form. Add `keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}` to all three. Easy OTA push, visible improvement on iOS.

2. **NEW — Tip body still has no `maxLength`.**
   `mobile/app/tip/[slug].tsx:250-265` — Pass 1 §3 OTA #4 was about both tip body and zone name; neither received the cap. Watch-zone name (`mobile/app/watch-zone.tsx:125-141`) also unbounded. Cap tip body at `maxLength={4000}` and zone name at `maxLength={60}`.

3. **Pass 1 §3 OTA #1 (sign-in error → `accessibilityRole="alert"`) not addressed.**
   `mobile/app/sign-in.tsx:189-199` — same on `mobile/app/delete-account.tsx:170-180`. Screen readers still won't announce the new error.

4. **Pass 1 §3 OTA #2 (`returnKeyType="send"`, `onSubmitEditing`, `textContentType="emailAddress"`) not addressed.**
   `mobile/app/sign-in.tsx:166-187` — still missing all three. The fix was a one-OTA change; was not picked up.

5. **Pass 1 §3 OTA #3 (sending state → `AmberCTA loading`) not addressed.**
   `mobile/app/sign-in.tsx:201-207` — still swaps the entire CTA for a bare `<ActivityIndicator>`. The `AmberCTA` component already supports `loading` (`mobile/components/cf/cta-button.tsx:22, 42-44`); a one-line change would unify the surface. Note: the tip modal already uses `AmberCTA loading={...}` correctly (`mobile/app/tip/[slug].tsx:296-300`), so the precedent is in-tree.

### 🔵 V1.0.1+

- Client-side email regex still `.includes('@')` (`sign-in.tsx:51`). Same as Pass 1 V1.0.1+.

---

## 4. Modal & Dialog

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **Tip modal grab handle still drawn over a system sheet.**
   Pass 1 §1 OTA #3 not addressed. `mobile/app/tip/[slug].tsx:153-163` still draws a 36×4 bar at the top of the ScrollView; on iOS the screen is `presentation: 'modal'` (`_layout.tsx:108`) which gives a native handle. Net effect: two stacked handles on iOS. Either drop the custom one or `Platform.OS === 'android'` it.

2. **NEW — Tip modal close button moved to a separate row but isn't `accessibilityViewIsModal`-anchored.**
   `mobile/app/tip/[slug].tsx:165-208` — The close X is now next to the title (good visual). But the tip modal still doesn't set `accessibilityViewIsModal` on the root container, so Voiceover users can swipe past it into the underlying tab content. Add `accessibilityViewIsModal={true}` to the outer `KeyboardAvoidingView`.

3. **NEW — Sign-out alert / delete-account confirm aren't using a custom dialog.**
   `mobile/app/(tabs)/me.tsx:36-51` and `mobile/app/delete-account.tsx:51-64` use `Alert.alert(...)`. That's fine, but on Android, `Alert` honors the system theme — on a light-themed Pixel this renders white-on-white-button text against the dark-mode app, which looks like a bug to a closed-testing reviewer who switches themes mid-session. Not a blocker, but a v1.0.1 should swap to a Reanimated bottom-sheet confirm so the destructive flow stays in the case-file aesthetic.

### 🔵 V1.0.1+

- Pass 1 §4 V1.0.1+ items (PhotoFrame `accessibilityRole="button"`, focus management on modal mount) still apply.

---

## 5. Micro-interactions

### ✅ VERIFIED
- **Tab-bar haptic on `onPressIn`** confirmed (`mobile/components/cf/tab-bar.tsx:55-62`).
- **Onboarding step-3 CTA shows `loading` while acquiring location** (`mobile/app/onboarding.tsx:194` — `loading={isLast && acquiring}`). The `AmberCTA` shows the spinner correctly.

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **Pass 1 §5 OTA #2 (AmberCTA `loadingLabel`) not addressed.**
   `mobile/components/cf/cta-button.tsx:22-68` — `loading` still draws a bare `ActivityIndicator` with no copy. With sign-in's network round-trip plus the new `acquiring` state on onboarding, the bare-spinner failure mode is now reachable in two flows. Add `loadingLabel?: string` and render `<ActivityIndicator size="small" /> + label` inline when present.

2. **Pass 1 §5 OTA #3 (SuccessFlash haptic pairing) not addressed.**
   `mobile/components/cf/success-flash.tsx:65-74` — the visual flash still fires without a paired `Haptics.notificationAsync(NotificationFeedbackType.Success)`. The submit medium-impact at T+0 (`mobile/app/tip/[slug].tsx:100`) and the visual flash at T+700-1300ms remain decoupled.

3. **NEW — AmberCTA `disabled={loading}` blocks press but doesn't visually mute.**
   `mobile/components/cf/cta-button.tsx:24-44` — `disabled={loading}` blocks the press, and the spinner draws over the amber bg, but the bg itself doesn't dim. On a slow network this looks like a stuck button (user can't tell that "Send link" is mid-flight vs failed silently). Add `opacity: loading ? 0.6 : 1` to the style, paired with the `loadingLabel` change above.

4. **NEW — `Pressable` `pressed` opacity 0.6 on the tab bar overlays the Android ripple.**
   `mobile/components/cf/tab-bar.tsx:87-98` — `android_ripple` sits ALONGSIDE `style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}`. The ripple is the Material idiom; the opacity is the iOS idiom. On Pixel hardware the user sees both at once (ripple radiating + the icon dimming under it), which feels like a double-feedback bug. Pass 1 §1 V1.0.1+ flagged this; given it's now in shipping code and is one branch, push it to OTA: `style={({ pressed }) => ({ opacity: Platform.OS === 'ios' && pressed ? 0.6 : 1, ... })}`.

### 🔵 V1.0.1+

- Pin-press CSS animation in the WebView is fine. Native press-state for `CircleButton` on case detail (Pass 1 §5 V1.0.1+) still applies.

---

## 6. Motion & Interaction

### 🔴 SHIP-BLOCKER
None.

### 🟡 OTA POLISH

1. **Pass 1 §6 OTA #1 (no `useReducedMotion`) not addressed.**
   `grep -rn "useReducedMotion\|isReduceMotionEnabled\|prefers-reduced-motion" mobile/` returns zero matches. `mobile/components/cf/brand-mark.tsx:38-47` still calls `withRepeat(..., -1)` unconditionally; `success-flash.tsx:65-74` still sequences color animation unconditionally; `leaflet-map.tsx:272-278` still injects the `cf-here-pulse` 2s infinite keyframe with no `prefers-reduced-motion: reduce` media query. Same fix as Pass 1.

2. **Pass 1 §6 OTA #2 (onboarding step transitions) not addressed.**
   `mobile/app/onboarding.tsx:90-94` — primary CTA still calls `setStepIndex((i) => i + 1)` with no animated transition. Visible jank on a slow Android.

### 🔵 V1.0.1+

- Reanimated logger config still unpinned (Pass 1 §6 V1.0.1+).
- Tip-flow anticipation timing not yet tuned from device data (Pass 1 §6 V1.0.1+).

---

## Regression Check — did any fix introduce a new issue?

**Verdict: No SHIP-BLOCKERS introduced. Two minor regressions worth noting, both OTA-able.**

1. **Peek-sheet X button collision risk** (1.OTA #2 above) — adding the X without reserving space inside the SELECTED row means the `Open →` mono label can sit under the X at certain widths.
2. **`KeyboardAvoidingView` lacks `keyboardVerticalOffset`** (3.OTA #1 above) — strictly a "fix didn't go far enough" not a regression, but the form-keyboard story isn't fully closed on iOS until that prop lands.

The KeyboardAvoidingView wrappers themselves are structurally correct on all three forms (per-platform `behavior`, scroll persistTaps, sticky bar outside the ScrollView). The earlier ship-blocker is genuinely fixed.

---

## Pass-2 Summary Table

| Severity | Count | Items |
|---|---|---|
| 🔴 SHIP-BLOCKER | 0 | — |
| 🟡 OTA POLISH | 14 | See sections above |
| ✅ VERIFIED | 5 | KAV (3 forms), peek-sheet onDismiss, tab-bar onPressIn, onboarding skip-gating, onboarding back chevron layout |
| 🔵 V1.0.1+ | 5 | swipe-down peek dismiss, deep-link routing, Alert→bottom-sheet confirm, modal focus management, Reanimated logger config |

Top OTA push for v1.0.0.1:
1. Modal back-chevron → close-icon (sign-in, search) — copy-paste, two lines.
2. `keyboardVerticalOffset` on three KAV wrappers + AmberCTA `loadingLabel`/dim — closes the form-keyboard story.
3. `useReducedMotion` hook in BrandMark + SuccessFlash + Leaflet HTML `prefers-reduced-motion` — closes Play Store accessibility expectation.
