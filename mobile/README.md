# The Cold File — mobile (Expo)

The Play Store / App Store client. Expo + React Native + Supabase JS + (eventually) Mapbox native + Expo Notifications.

The web property at `coldfile.app` is a separate Next.js codebase. **Two thin frontends, one Supabase backend.** All read paths in this app go through a bare `@supabase/supabase-js` client — Postgres functions or RLS-gated table reads, never a Next.js route handler. See `docs/00_DECISIONS.md` for the architecture rule.

## Run

```bash
cd mobile
npm install                         # one time
cp .env.example .env                # configure Supabase access (optional — see below)
npx expo start                      # interactive runner — press i for iOS sim, a for Android emulator
```

Native runs require:
- iOS: Xcode + a configured iOS simulator. macOS only.
- Android: Android Studio + an AVD, or a physical device with USB debugging.

For early UI iteration, **Expo Go** on a physical device is fastest — no native build required. The map's SVG-canvas placeholder works in Expo Go; the real Mapbox native integration (Week 5b) will need a custom dev client.

### Designer mode (no backend)

If `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are unset, every data hook falls back to sample data from `lib/sample-data.ts`. The UI iterates without anyone needing a Supabase project. The header on the Map screen and the List tab append `· SAMPLE` so it's obvious which mode you're in.

When the env vars are set, the same hooks switch to live queries (`cases_within_radius` RPC, slug-keyed table reads) automatically. No screen-level changes required.

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
- The Pin renderer enforces the geometry contract (filled / ring+dot / open ring, stroke scaling, recency decay, selected halo)
- **Supabase data layer**: `lib/supabase.ts` + typed schema in `lib/types/database.ts` + per-screen hooks in `lib/hooks/`. Map / List / Case-detail screens call the live RPCs and table reads when env is configured; designer-mode sample data otherwise.

**Stubbed (Week 5b–5c):**
- **Mapbox native** — the SVG canvas is a visual placeholder; real markers replace it behind the same `<MapCanvas>` contract. Pin xy positions on the map screen are deterministic hashes of case slug today; real coordinates land with Mapbox.
- **Auth** — Supabase client runs with `persistSession: false` for now. When auth lands, swap in `@react-native-async-storage/async-storage` as the storage adapter; the saved tab and watch zones go live then.
- **Expo Notifications + FCM** — needed for watch-zone alerts.
- **Tip-routing wire-up** — the modal calls `router.back()` on submit; should POST to a tip-routing Edge Function and transition to the success state with the `tip.success` flash.
- **Premium upsell** — the Me tab has a placeholder row.
