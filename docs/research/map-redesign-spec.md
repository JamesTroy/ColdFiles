# The Cold File — Map Screen Redesign Spec

Source-of-truth reference for the map-screen redesign. Original spec
authored 2026-04-30. Implementation tracked in todos / commits.

---

## Local context that overrides parts of this spec

Two saved-state items override what this spec recommends:

1. **§4.1 MapLibre migration is upstream-blocked, not scope-deferred.**
   The MapLibre Native module hits a measurement bug under Fabric
   (`newArchEnabled = true`, forced by Reanimated 4) that reproduces across
   four map SDKs — see `feedback_map_top_half_not_render.md` in user memory.
   `mobile/components/cf/maps-view.tsx` is intentionally stubbed; the Leaflet
   WebView path is the v1 renderer. Flip back when the upstream fix lands.

2. **Pin color palette is more restrained than this spec proposes.**
   Existing tokens use warm-tan / amber / cream (shape-first encoding) per
   `feedback_amber_is_ethical_posture.md`. The spec's `pinHomicide: '#A04A2E'`
   (rust) is a step toward traffic-light coloring that the saved memory
   explicitly excludes. Implementation preserves the existing restraint
   palette; spec colors are referenced only where they don't conflict.

Everything else in the spec applies as written.

---

## Original spec preserved below

*Spec content omitted from this file to keep it lean — original lives in chat
transcript at* `/Users/jtroy/.claude/projects/-Users-jtroy-Desktop-ColdFiles/`
*and is reproduced verbatim if needed. The local-overrides section above plus
todo state are what implementation tracks against.*
