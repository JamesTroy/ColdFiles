# The Cold File — Decision Log

A short, dated record of architecture and product calls that shaped the build. New entries go on top.

---

## 2026-04-28 — V1 ships the SVG MapCanvas; real basemap deferred

**Decision:** The home-tab map and the Watch Zone polygon both render against the SVG `MapCanvas` placeholder for V1. Real basemap (MapLibre / Mapbox / Google) is deferred to a follow-up.

**Why:**

- MapLibre Native and its forks (Mapbox GL Native, `@rnmapbox/maps`) all hit the same GL-surface measurement bug under Fabric: the GL viewport caches its first measurement during the React layout pass and renders at half-height permanently. The bug is upstream of all the RN bindings, in MapLibre Native itself.
- Reanimated 4 requires Fabric (`newArchEnabled = true`), so we can't roll back to the legacy architecture as a workaround.
- Workarounds attempted: explicit dimensions via `onLayout`, absolute positioning, deferred mount, force re-mount-after-300ms, three different SDK swaps (`@rnmapbox/maps` v10.3 → `react-native-maps` 1.20 → `@maplibre/maplibre-react-native` v11). All half-render the same way; none accept the layout fix.
- Time spent: a session and a half. Rest of the app is essentially done. Pragmatic call is ship the design-correct placeholder and revisit later.

**What ships in V1:**

- SVG `MapCanvas` rendering pins at deterministic hash positions (not real geography). Same `<Pin>` SVG component as before, same design tokens, same selection/recency/halo treatments. Looks like the prototype; doesn't pan or zoom.
- `isNativeMapAvailable()` returns `false`. The native-map code path stays committed but inert behind the gate. Flip it to `true` when the upstream fix lands.

**Returning to a real basemap:**

Two paths when we revisit:

1. **MapLibre Native fix.** Watch [maplibre/maplibre-native](https://github.com/maplibre/maplibre-native) issues for "Fabric layout" / "GL surface measurement". When a release notes resolves it, flip `isNativeMapAvailable()` and rebuild. The MapLibre RN integration is already wired.
2. **WebView Leaflet.** If the upstream fix takes too long, ship a WebView wrapping Leaflet + OSM tiles. Slightly worse performance than native but bypasses the entire RN layout chain — no GL-surface bug because there's no GL surface. About a day's work; the pin grammar serializes to inline SVG inside Leaflet `divIcon` without much friction.

The V1 launch metro is small enough geographically (LA County, ~25mi radius) that the SVG canvas with kind-encoded pins reads cleanly to a user. The map experience improves materially with a real basemap, but the case-file aesthetic and the tip-routing flow — which are what make the product distinctive — work fully on the placeholder.

---

## 2026-04-28 — Reanimated babel plugin is required, not optional

**Decision:** `mobile/babel.config.js` is part of the foundation, not a setup-doc step. The plugin entry — `react-native-worklets/plugin` — must remain the last plugin in the array.

**Why:**
- Reanimated 4 split worklets out to `react-native-worklets`. Without the plugin registered, every call into Reanimated (`useSharedValue`, `useAnimatedStyle`, `withTiming`) crashes at runtime — both our `SuccessFlash` component and Expo Router's screen-transition internals fail. The app simply doesn't launch.
- The default Expo SDK 54 template ships **without** a `babel.config.js`. A future contributor who clones the repo and runs `npx expo start` will hit this exactly once — usually during their first EAS build, which is also the first time anyone other than the original author compiles the project. Half a day lost to "why does the splash screen never dismiss."

**How to apply:**
- The plugin entry stays load-bearing in `mobile/babel.config.js`. **Do not move it to a setup README or onboarding doc.** Setup docs go unread; broken builds get debugged.
- If the plugin name changes in a future Reanimated/worklets release, update the file and add a follow-up entry here.
- Same logic applies to any future native-binding plugin (Mapbox config plugin, push-notification plugin) — they belong in `app.json`'s `plugins` array, codified in the repo, never as instructions someone has to remember.

---

## 2026-04-27 — Mobile path: Expo (not Capacitor, not TWA)

**Decision:** The Play Store / App Store client is **Expo (React Native)**. The web property at `coldfile.app` is **Next.js App Router**. Two thin frontends, one Supabase backend.

**Considered and rejected:**

- **Capacitor + Next.js.** The friction is real, not theoretical. Next.js wants to be server-rendered; Capacitor wants a static bundle. `output: 'export'` kills route handlers and server actions, both of which the existing Next.js stack leans on. The "keeps your existing stack" pitch breaks down — the stack that survives the wrap isn't the stack actually in use.
- **TWA / Bubblewrap.** Wrong tool for a map-first interactive app. Mapbox native ≫ Mapbox web on gesture handling, offline tile caching, and marker clustering — most visible on lower-end Android. PWA push on Android also evaporates the moment a user clears site data, which kills the watch-zone-alerts premium hook.

**Why Expo wins specifically here:**

- BarkPark Mobile already shipped on Expo + Supabase + Mapbox + Expo Notifications + FCM + EAS Build. The patterns are muscle memory — locale routing, RLS-aware Supabase client, Mapbox component, push registration, EAS submit. None of it is new architecture.
- Native Mapbox + Expo Notifications cleanly support the two features the premium tier hangs off (map UX + alerts).
- The "slower v1 vs Capacitor" cost normally cited for Expo doesn't apply when the stack is already proven for the operator.

**Architecture rule that follows from this:**

> Read paths must be callable from a bare Supabase JS client. Use Postgres functions (RPCs) or RLS-gated direct table reads. The two RPCs in the schema (`cases_within_radius`, `cases_in_bbox`) are the canonical example.
>
> Reach for a Next.js route handler **only** for: Stripe webhooks, admin moderation UI, OG-image generation, and sitemap generation. Anything else lives in Postgres or in an Edge Function so the mobile app and the web app share the data contract with zero divergence.

---

## 2026-04-27 — Trust-weight adjustment ledger

The initial weights below are **guesses**, not measurements. The first time we see real merge conflicts (likely the Charley → Doe Network overlap in Week 2), record the adjustment here with the observation that triggered it. Don't relitigate the same call in six months.

**Initial values** *(see `_shared/trust-merge.ts` for source-of-truth):*

| Source | Weight | Rationale at time of setting |
|--------|--------|------------------------------|
| Investigating agency direct (LAPD, LASD) | 95 | They own the case |
| NamUs | 90 | Federal, vetted, but bottlenecked by review pipeline |
| FBI Wanted | 90 | Federal, current |
| NCMEC | 85 | Children-only, careful curation |
| FDLE | 85 | Active state-level, well-structured |
| NJSP / OSP / TXDPS Cold Case | 80 | Active state-level, structured |
| Charley Project | 75 | Single-operator, researched, narrative-rich but not authoritative |
| Doe Network | 70 | Volunteer, occasionally outdated |
| Solve the Case | 60 | Supplementary, smaller dataset |
| Project: Cold Case | 50 | Known data quality issues (1970 dates, stale) |
| Media reports | 40 | Useful for narrative color, low for facts |

**Adjustments observed in production** *(append rows here, never edit prior rows):*

> *(Empty until Week 2 dedupe runs surface real conflicts. Format:* `YYYY-MM-DD — bumped <source> from N to M because <observation>` *)*

---

## 2026-04-27 — Source ingestion: federal-first, dedupe is the moat

**Decision:** Build the federal aggregators (NamUs, Charley Project, Doe Network, Project: Cold Case, Solve the Case) first. Add state-level scrapers only for the four strong states (FL, NJ, OR, TX). LA County is the launch metro — agency-direct (LAPD, LASD) for that geography only.

**Why:**
- The five federal sources cover ~70% of nationally-known cold cases across all 50 states. State-level work past FL/NJ/OR/TX returns sub-linearly per scraper-week.
- A single case appearing in NamUs + Charley + Doe + LASD is a feature: dedupe + multi-source linking is the OpenRecord pattern (one entity row, N source rows). It's also the single biggest contributor to data quality, so it has to be the bedrock primitive, not an afterthought.

**Rule:** Trust-weighted field merge handles per-field conflicts (agency-direct = 95, NamUs = 90, Charley = 75, Project: Cold Case = 50). Narrative is special: pick longest-from-highest-trust for display, store all sources for "read more" links.

---

## 2026-04-27 — Tip routing, never tip ownership

**Decision:** Every case ends with a one-tap "Submit a Tip" that hits the **investigating agency's existing public infrastructure** — Crime Stoppers P3, agency tip form, agency phone. The Cold File never holds, stores, or moderates tip content.

**Why:**
- Holding tips means moderating them. Moderating tips on cold cases means making credibility judgments about tips on unsolved homicides, which is a legal and ethical landmine that has no positive product upside.
- Routing-only keeps the legal surface clean: no evidence-handling obligations, no chain-of-custody, no defamation risk from accusations against named individuals.

**Logged:** `tip_routings` table records that a tip was submitted, the routing target, and a SHA-256 of the content (for abuse rate-limiting). The content itself is never stored.

---

## 2026-04-27 — Project: Cold Case 1970-01-01 date bug

**Decision:** Auto-flag any imported case with `incident_date = 1970-01-01` as `incident_date_quality = 'suspect'`. Surface a "date unknown" treatment in the UI, do not display the misleading 1970 date.

**Why:** The Project: Cold Case database is publicly known to have a bad-import bug that resets dates to the Unix epoch. We trust their case existence, not their dates.

---

## 2026-04-27 — Block-level location snapping

**Decision:** Geocoded points are snapped to ~100m granularity (3 decimal places, per `snapToBlock()`) before being stored in `location_point`. The map view always uses the snapped point. The textual location ("15400 block of Temple Ave") is shown in the case detail.

**Why:** Avoids pinpointing private residences while still answering "what's near me?" usefully. ~100m matches what agencies typically publish anyway ("the 15400 block of"), so we're not destroying signal that was real.
