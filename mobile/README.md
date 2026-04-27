# The Cold File — mobile (Expo)

The Play Store / App Store client. Expo + React Native + Supabase JS + (eventually) Mapbox native + Expo Notifications.

The web property at `coldfile.app` is a separate Next.js codebase. **Two thin frontends, one Supabase backend.** All read paths in this app go through a bare `@supabase/supabase-js` client — Postgres functions or RLS-gated table reads, never a Next.js route handler. See `docs/00_DECISIONS.md` for the architecture rule.

## Run

```bash
cd mobile
npm install     # one time
npx expo start  # interactive runner — press i for iOS sim, a for Android emulator
```

Native runs require:
- iOS: Xcode + a configured iOS simulator. macOS only.
- Android: Android Studio + an AVD, or a physical device with USB debugging.

For early UI iteration, **Expo Go** on a physical device is fastest — no native build required. The map's SVG-canvas placeholder works in Expo Go; the real Mapbox native integration (Week 5b) will need a custom dev client.

## Layout

```
mobile/
├── app/                       Expo Router file-based routes
│   ├── _layout.tsx              Loads fonts, locks dark theme, configures the stack
│   ├── (tabs)/                  Tab group: Map / List / Saved / Me
│   │   ├── _layout.tsx
│   │   ├── index.tsx            Map (home tab)
│   │   ├── list.tsx
│   │   ├── saved.tsx
│   │   └── me.tsx
│   ├── case/[slug].tsx          Case detail screen
│   └── tip/[slug].tsx           Submit-tip modal
├── components/
│   ├── cf/                    Cold File design-system primitives
│   │   ├── text.tsx             SerifTitle / SansBody / MonoLabel / NarrativeText / InfoText
│   │   ├── pin.tsx              Case-kind shape encoding (filled / ring+dot / open ring)
│   │   ├── pill.tsx             UnsolvedPill / ColdPill / ResolvedPill / FilterChip
│   │   ├── radio-card.tsx       Submit-tip route picker pattern
│   │   ├── key-facts.tsx        Verifiable case data table
│   │   ├── photo-frame.tsx      Evidence-register hero photo (corner brackets + caption)
│   │   ├── source-chip.tsx      Trust-weight ordered source links
│   │   ├── trust-disclosure.tsx Full callout + short caption variants
│   │   ├── peek-sheet.tsx       Map pin-tap bottom sheet
│   │   ├── map-canvas.tsx       SVG map placeholder (Mapbox lands behind this contract)
│   │   └── cta-button.tsx       AmberCTA + SecondaryCTA
│   └── haptic-tab.tsx         Template — iOS haptic on tab press
├── constants/
│   └── theme.ts               Single source of truth for design tokens
└── app.json                   Expo config
```

## Theme contract

Every component imports `tokens` from `constants/theme.ts`. **Do not hard-code hex values anywhere else.** If a value isn't in the token table, the design hasn't sanctioned it — push the question back to `docs/04_DESIGN_SYSTEM.md` rather than inventing one inline.

The tokens file mirrors the snapshot in the design doc exactly. Geometry math (`pin.strokeForDiameter`, `pin.recent.alphaByAge`, `cluster.diameterFor`) is in the tokens, not scattered across components, so design rules and implementation stay coupled.

## What's wired vs. what's stubbed

**Wired:**
- Design system tokens, fonts, navigation skeleton
- All four tabs render with the correct visual language
- Case detail + submit-tip modal screens render with sample data
- The Pin renderer enforces the geometry contract (filled / ring+dot / open ring, stroke scaling, recency decay, selected halo)

**Stubbed (Week 5b–5c):**
- Mapbox native (the SVG canvas is a visual placeholder; real markers replace it behind the same `<MapCanvas>` contract)
- Supabase queries (the screens use static sample data — replace with `cases_within_radius` / `cases_in_bbox` RPC calls and slug-keyed selects)
- Expo Notifications + FCM
- Tip-routing wire-up (the modal calls `router.back()` on submit; should POST to a tip-routing Edge Function and transition to the success state with the `tip.success` flash)
- Auth + premium upsell
