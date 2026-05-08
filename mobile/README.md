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

The production renderer is `components/cf/leaflet-map.tsx` — Leaflet 1.9 inside a WebView with OpenStreetMap raster tiles (served by CARTO + OpenFreeMap CDNs; see `app/legal/privacy/page.tsx` for the vendor disclosure). The WebView path bypasses the React Native layout chain entirely so it's not affected by the upstream MapLibre/Mapbox/@rnmapbox GL-surface measurement bug under Fabric.

The native MapLibre integration lives in `components/cf/maps-view.tsx` but is **stubbed at module scope** — the runtime imports are commented out so the dev client builds even when the native module isn't linked. `isNativeMapAvailable()` returns false; consumers (`app/(tabs)/index.tsx`, `app/watch-zone.tsx`) fall back to `LeafletMap` automatically. Re-enabling is a one-file flip when the upstream Fabric fix ships — re-add the runtime imports + body in `maps-view.tsx`, no consumer changes needed.

The pin grammar (filled / ring+dot / open ring + selection halo + recency ring) is identical across both renderers — it serializes to inline SVG inside Leaflet `divIcon`s today, and the same SVG primitives drive the native marker layer when MapLibre is restored.

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
│   │   Visual / typography:
│   │   ├── text.tsx             SerifTitle / SansBody / MonoLabel / NarrativeText / InfoText
│   │   ├── brand-mark.tsx       Wordmark + glyph
│   │   ├── brand-splash.tsx     Boot splash overlay
│   │   ├── pin.tsx              Case-kind shape encoding (filled / ring+dot / open ring)
│   │   ├── pill.tsx             UnsolvedPill / ColdPill / ResolvedPill / FilterChip
│   │   ├── cta-button.tsx       AmberCTA + SecondaryCTA
│   │   Map / location:
│   │   ├── leaflet-map.tsx      Production renderer (Leaflet WebView + OSM raster tiles)
│   │   ├── leaflet-watch-zone.tsx  Watch-zone polygon variant of leaflet-map
│   │   ├── maps-view.tsx        Native MapLibre wrapper — currently stubbed
│   │   ├── map-bottom-sheet.tsx Map pin-tap bottom sheet
│   │   ├── case-location-map.tsx Static-map preview on case detail
│   │   └── draw-zone-map.tsx    Watch-zone polygon drawer
│   │   Case detail:
│   │   ├── key-facts.tsx        Verifiable case data table
│   │   ├── photo-frame.tsx      Evidence-register hero photo (corner brackets + caption)
│   │   ├── photo-gallery.tsx    Thumb strip + warning gating
│   │   ├── photo-lightbox.tsx   Full-screen viewer
│   │   ├── source-chip.tsx      Trust-weight ordered source links
│   │   ├── trust-disclosure.tsx Full callout + short caption variants
│   │   ├── case-events-section.tsx
│   │   ├── cases-near-case-section.tsx
│   │   └── case-row.tsx
│   │   Tip / takedown / legal:
│   │   ├── radio-card.tsx       Submit-tip route picker pattern
│   │   ├── legal-doc.tsx        Privacy / terms / takedown layout
│   │   └── terms-update-banner.tsx Material-change banner (PR #57)
│   │   App shell + reliability:
│   │   ├── screen-shell.tsx     Standard screen wrapper
│   │   ├── tab-bar.tsx          Bottom tab styling
│   │   ├── error-boundary.tsx   Top-level catch (PR #63)
│   │   ├── error-state.tsx      Inline error UI
│   │   ├── empty-state.tsx      Inline empty-list UI
│   │   ├── success-flash.tsx    Tip-submitted confirmation
│   │   ├── source-health-list.tsx Diagnostics screen content
│   │   └── amber-slider.tsx     Range input
│   └── haptic-tab.tsx         Template — iOS haptic on tab press
├── constants/
│   └── theme.ts               Single source of truth for design tokens
└── app.json                   Expo config
```

## Theme contract

Every component imports `tokens` from `constants/theme.ts`. **Do not hard-code hex values anywhere else.** If a value isn't in the token table, the design hasn't sanctioned it — push the question back to `docs/04_DESIGN_SYSTEM.md` rather than inventing one inline.

The tokens file mirrors the snapshot in the design doc exactly. Geometry math (`pin.strokeForDiameter`, `pin.recent.alphaByAge`, `cluster.diameterFor`) is in the tokens, not scattered across components, so design rules and implementation stay coupled.

## What's wired (as of v1.0.4)

The app is shipping. Most of what was previously listed here as "stubbed" is now live:

- **Design system + navigation**: tokens, fonts, four tabs, all screens render with the correct visual language.
- **Pin renderer**: enforces the geometry contract (filled / ring+dot / open ring, stroke scaling, recency decay, selected halo). Identical SVG primitives across the Leaflet + (deferred) MapLibre paths.
- **Supabase data layer**: `lib/supabase.ts` (auth session in `expo-secure-store` post v1.0.4 — Android Keystore / iOS Keychain) + typed schema in `lib/types/database.ts` + per-screen hooks in `lib/hooks/`. Live RPCs (`cases_within_radius`, `cases_in_bbox`, `cases_in_polygon`) + RLS-gated table reads. Designer-mode sample data when env vars are unset.
- **Auth**: magic-link sign-in (PKCE), expired-link Alert, Android intent-hijack defense, account deletion that unregisters push + clears local storage. Auth-state changes re-register / clear push tokens.
- **Push notifications + FCM**: `expo-notifications` registered, push token persisted server-side via `notify-fanout` Edge Function. Watch-zone hits and saved-case events fan out as alerts.
- **Tip routing**: `tip/[slug].tsx` modal POSTs to the `tip-route-submit` Edge Function, resolves to a real per-agency target (Crime Stoppers P3, FBI, NamUs, agency form, agency phone, email — see `docs/05_TIP_ROUTING.md`), and transitions to the `tip.success` flash.
- **Watch zones**: polygon drawing on `draw-zone-map.tsx`, persisted to Supabase, alerts via `notify-fanout` when ingested cases fall inside.
- **Takedown intake**: `takedown-request/[slug].tsx` modal posts to the `takedown-submit` Edge Function (rate-limited per case+email).
- **Top-level error boundary**: `error-boundary.tsx` (PR #63) wraps the Stack in `app/_layout.tsx` with a "Something broke. Tap to reload." fallback. Crash-reporter seam (`reportError`) is unused — Sentry/Crashlytics plug in there when wanted.
- **CI pre-push gate**: `.githooks/pre-push` runs `npm run preflight` (`tsc --noEmit && expo lint --max-warnings 0`) so a tsc/lint regression bounces locally instead of riding to Play Console as a broken AAB.

## Still stubbed / deferred

- **Native MapLibre renderer**: `components/cf/maps-view.tsx` is restored but gated behind `EXPO_PUBLIC_ENABLE_NATIVE_MAP=1`. Production builds leave the env var unset → `isNativeMapAvailable()` returns false → consumers route to `LeafletMap`. The half-render bug is a layout/measurement issue in our parent chain (per memory `feedback_map_top_half_not_render.md`), not an SDK bug — diagnosis is the next step before we can flip the env var on for production. To diagnose locally:

  ```sh
  echo 'EXPO_PUBLIC_ENABLE_NATIVE_MAP=1' >> mobile/.env
  npx expo start          # or rebuild dev client if you haven't yet
  ```

  Open the Map tab in the dev client; the half-render should reproduce. The fix lives upstream of `<MapsView>` in `app/(tabs)/index.tsx` / `app/watch-zone.tsx`.

- **Premium upsell**: the Me tab has a placeholder row. No billing wired yet.
- **iOS build**: Android-only AAB shipping today. iOS is a config flip + App Store provisioning when the audience expands.
