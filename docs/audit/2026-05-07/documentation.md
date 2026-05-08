# Documentation Quality Audit — 2026-05-07

Follow-on to the CORS & Headers audit. Scoped to: README completeness,
inline comment quality, JSDoc/TSDoc on exports, API reference coverage.

## Headline

**Inline comments are a project strength** — many files (especially
`app.config.ts`, Edge Functions, hooks) carry substantial "why" prose
that explains decisions, not just code. Don't lose this.

**Both READMEs have major staleness** — the root README mislists
Edge Functions and names dependencies (Mapbox geocoding) we no longer
use; the mobile README still describes the app as if v0.5 (`MapCanvas`
SVG placeholder, "Auth — stubbed", "Mapbox native — stubbed", "Tip
routing — stubbed") when all of that is wired and shipped in v1.0.4.

**JSDoc on exports is inconsistent** — the Edge Function shared
modules are partial; mobile hooks are mostly bare.

**No formal API reference** for the RPCs (`cases_within_radius`,
`cases_in_bbox`, `cases_in_polygon`) or Edge Function request/response
contracts. Acceptable for v1.0 scope.

## Findings

### D1 — Root README is misaligned with current reality (Medium → Fixed in PR #69)

[README.md](../../../README.md) at the repo root has three concrete
inaccuracies:

**Function inventory mislisted** ([README.md:36-41](../../../README.md#L36-L41))

```
├── supabase/functions/
│   ├── ingest-source/            Single runner. Takes ?source=namus
│   ├── ingest-tick/              Cron entrypoint
│   ├── geocode-pending/          Geocodes cases that came in without coords
│   ├── photo-cache/              Downloads media to Supabase Storage
│   ├── dedupe-resolver/          Background dedupe re-checker
│   └── _shared/                  Shared utilities (fetcher, extractor, dedupe, ...)
```

Actual functions in `supabase/functions/`: `_shared`, `geocode-pending`,
`ingest-source`, `ingest-tick`, **`notify-fanout`**,  `photo-cache`,
**`reverse-geocode`**, **`takedown-submit`**, **`tip-route-submit`**.

`dedupe-resolver/` does not exist (was the planned name in the original
spec, never built; dedupe lives in `_shared/persist.ts:queueForTier3Review`
and runs inline in the persist path). Three real functions
(`notify-fanout`, `reverse-geocode`, `takedown-submit`, `tip-route-submit`)
are silently absent from the inventory.

**Wrong geocoding vendor** ([README.md:10](../../../README.md#L10))

```
- **Backend (shared):** ... + Mapbox geocoding
```

`mobile/app/privacy.tsx` and `app/legal/privacy/page.tsx` were already
updated in PR #60 (Wave 1B) to name OpenStreetMap Nominatim as the
real vendor (we run our own through `reverse-geocode` Edge Function).
The README missed the same correction.

**Stale architecture stub** ([README.md:8](../../../README.md#L8))

```
+ MapLibre / Leaflet WebView (basemap path is the V1 SVG `MapCanvas` placeholder...)
```

`MapCanvas` was deleted in PR #61 (Wave 2D code-quality cleanup) — the
component had zero importers in production code. The reference to it
in the headline architecture description is misleading: the basemap is
real (MapLibre Native + Leaflet WebView fallback), not a placeholder.

### D2 — Mobile README describes a pre-v1.0 prototype (High → Fixed in PR #69)

[mobile/README.md](../../../mobile/README.md) is the most stale doc in
the repo. Three concrete categories of drift:

**The "Stubbed" section is now mostly wired** ([mobile/README.md:100-105](../../../mobile/README.md#L100-L105))

```
**Stubbed (Week 5b–5c):**
- **Mapbox native** — the SVG canvas is a visual placeholder ...
- **Auth** — Supabase client runs with `persistSession: false` for now ...
- **Expo Notifications + FCM** — needed for watch-zone alerts.
- **Tip-routing wire-up** — the modal calls `router.back()` on submit ...
- **Premium upsell** — the Me tab has a placeholder row.
```

Reality:
- **Map**: real basemap shipped (MapLibre + Leaflet fallback). Not a stub.
- **Auth**: `expo-secure-store`-backed Supabase session, magic link,
  PKCE, account deletion, push token re-registration on auth-state
  change. All shipped in PR #59 (Wave 1A) for v1.0.4.
- **Notifications + FCM**: live. `google-services.json` committed,
  push-token registration in `lib/hooks/use-push-token.ts`,
  fan-out via `notify-fanout` Edge Function.
- **Tip-routing**: live. `tip-route-submit` Edge Function +
  `tip/[slug].tsx` modal calls it.
- **Premium upsell**: still a placeholder. The only entry that's
  still accurate.

A new contributor reading this would believe the app is in mid-development
when v1.0.4 has shipped to Play Console and is updating users.

**SVG MapCanvas references** ([mobile/README.md:19-21](../../../mobile/README.md#L19-L21))

The whole "The map (V1)" section describes the SVG `MapCanvas` placeholder.
The component is deleted. The section should describe the real architecture:
MapLibre Native (preferred) with a Leaflet WebView (`leaflet-map.tsx`)
fallback, plus `maps-view.tsx` as the abstraction.

**Component list is wrong** ([mobile/README.md:67-83](../../../mobile/README.md#L67-L83))

Lists 11 components in `components/cf/`. Includes 2 deleted files
(`peek-sheet.tsx`, `map-canvas.tsx`). Missing 23 real files including
`error-boundary.tsx` (PR #63 Wave 2E), `leaflet-map.tsx`,
`leaflet-watch-zone.tsx`, `case-events-section.tsx`,
`cases-near-case-section.tsx`, `legal-doc.tsx`,
`terms-update-banner.tsx`, `screen-shell.tsx`, `tab-bar.tsx`,
`source-health-list.tsx`, etc.

### D3 — Inconsistent JSDoc on exported functions (Medium → Fixed)

**Status:** Audited again pre-fix and the original finding was overly
broad. **Every** mobile hook file has a file-level JSDoc block at the
top that documents its main export — they aren't bare, they document
at the file level instead of the export level. That's a coherent
project pattern (single-export hook files use file-level docs;
multi-export utility modules like `dedupe.ts` use per-export docs).

Genuine bare-export gaps after the closer audit:

| File | Function | Status |
| --- | --- | --- |
| `_shared/persist.ts` | `persistRecord` | ✓ JSDoc added (8-step pipeline + idempotency note + Tier-3 review reference) |
| `mobile/lib/hooks/use-user.ts` | `signInWithEmail` | ✓ JSDoc added |
| `mobile/lib/hooks/use-user.ts` | `signOut` | ✓ JSDoc added |
| `mobile/lib/hooks/use-fresh-receipt.ts` | `markReceiptFresh` | ✓ JSDoc added |

The original D3 inventory counted ~31 "bare" hook exports because the
inventory script only matched multi-line `/** ... */` blocks ending
in ` */` — it missed single-line JSDoc (`/** foo */`) and file-level
docs that ended several lines before the export. The actual gaps were
4, all narrow.

**Lesson:** documentation density audits need to count file-level docs
+ single-line JSDocs alongside multi-line export-level JSDocs, not
just the latter. Otherwise the false-positive rate is high.

### D4 — No formal API reference (Low)

No `docs/API.md` or equivalent. The contracts live where they're
implemented:

- **PostgREST RPCs** (`cases_within_radius`, `cases_in_bbox`,
  `cases_in_polygon`, `watch_zone_hit`): defined in `migrations/*.sql`,
  no centralized signature reference.
- **Edge Function request/response shapes**: defined in
  `supabase/functions/<name>/index.ts` near the top of each file
  (good docstring practice — but consumers need to grep eight
  different files to find them).
- **Mobile hook return types**: defined in `lib/types/hooks.ts`
  (`QueryResult<T>`) and per-hook `interface XBundle` types.

**Why this is Low priority:** the project is two-frontends-one-backend
with the mobile + web codebases co-located in this repo, so consumers
can read implementation directly. An external contract doc earns its
upkeep cost only when there are external consumers (other teams,
partner integrations, public API).

### D5 — Inline comment quality is a project strength (Info — preserve)

Spot-check observations across `mobile/app.config.ts`,
`supabase/functions/_shared/http.ts`, `supabase/functions/_shared/persist.ts`,
`mobile/lib/supabase.ts`:

- Comments routinely explain **why** decisions were made, not what code
  does (e.g., the SSRF guard rationale in `_shared/http.ts`, the
  intent-hijack defense in `lib/supabase.ts`, the manifest-tightening
  rationale in `app.config.ts`).
- Cross-references to memory entries and CLAUDE.md rules are common
  ("per the project's hooks-before-early-returns memory rule",
  "see CLAUDE.md release sequence").
- Threat-model docstrings on the security-relevant files
  (`next.config.ts`, `cors.ts`).

**Don't lose this.** When future-me adds a fix or a feature, write the
comment that explains *why* it had to be done that way, not what the
code says.

### D6 — TODOs are tracked, not lost (Info)

11 TODO/FIXME tokens in mobile + supabase code. Categorized:

- **6 placeholder photo URLs** in `mobile/lib/sample-data.ts`
  (`TODO_PHOTO_URL`) — handled defensively by `lib/photo-policy.ts:28`
  which returns `null` for that sentinel. Tracked, not lost.
- **1 v1.0.2 follow-up** in `mobile/lib/hooks/use-tip-history.ts:19`
  ("replace the static 'pending' default with a status field"). Tagged
  with version target.
- **1 case_pair_review_queue follow-up** in
  `supabase/functions/_shared/persist.ts:741`. Tagged with the
  intended migration name.

These are good — they cite version targets or specific follow-ups.
No "TODO: figure out what this does" abandoned thoughts.

## Suggested next moves

Three tracks, in priority order:

1. **README sweep (~30 min)** — D1 + D2. Fix:
   - Root README function inventory + drop `MapCanvas` reference + correct geocoding vendor
   - Mobile README rewrite of "Stubbed" section + "The map (V1)" section + component list
   Worth doing as a single PR (`docs/readme-current-with-v1.0.4`).

2. **JSDoc pass on hooks + persist.ts main exports (~1 hour)** — D3.
   Add docstrings to exports that lack them. Match the pattern used by
   `dedupe.ts` and `extract.ts` (which are fully documented).

3. **API reference (skip for v1.0)** — D4. Earns its keep when an
   external consumer appears or when the API surface stabilizes
   enough that a contract doc won't decay weekly.

D5 is "preserve, don't change." D6 is "no action, currently fine."

## Verification

This audit reads against current `main` HEAD. If a PR lands that
changes the README between this audit and the fix PR, re-derive
findings against the updated state.
