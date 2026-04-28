# The Cold File — mobile (Expo)

The Play Store / App Store client. Expo + React Native + Supabase JS + MapLibre GL Native (with OpenFreeMap public tiles) + Expo Notifications.

The web property at `coldfile.app` is a separate Next.js codebase. **Two thin frontends, one Supabase backend.** All read paths in this app go through a bare `@supabase/supabase-js` client — Postgres functions or RLS-gated table reads, never a Next.js route handler. See `docs/00_DECISIONS.md` for the architecture rule.

## Run

```bash
cd mobile
npm install                          # one time
cp .env.example .env                 # only Supabase config; map needs no key
```

This app ships with `@maplibre/maplibre-react-native` — **Expo Go does not work**. You need a custom dev client built once via `expo run:android` or EAS Build, then iterate against that.

### The map

MapLibre GL Native (open-source) renders OpenFreeMap public tiles — community-funded OSM-derived hosting. **No API key, no signup, no Google Cloud.** The basemap is always available; nothing to configure.

If you want a custom basemap style later, host a MapLibre style JSON anywhere (S3, GitHub Pages, Supabase Storage) and swap `tokens.map.styleUrl` in `mobile/constants/theme.ts`.

### First build (one time)

```bash
npx expo prebuild --clean -p android
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
npx expo run:android
```

Requires Android Studio installed locally with at least one configured AVD, **or** a physical device with USB debugging enabled and connected. The first build takes 5–10 minutes; subsequent JS-only changes hot-reload normally.

### Day-to-day after the first build

```bash
npx expo start                       # press a to open in your dev client / running emulator
```

The dev client is named "The Cold File" and the app icon shows on the device after the first run.

### Designer mode (no Supabase)

The hooks fall back to sample data when Supabase env vars are missing. The map renders against MapLibre + OpenFreeMap regardless — designer mode + real basemap is the default development experience.

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
