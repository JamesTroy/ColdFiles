# 05 — Dependency Security Audit

**Audit date:** 2026-04-29
**Scope:** Two npm projects + Deno Edge Functions
- Root: `/Users/jtroy/Desktop/ColdFiles` (Next.js 15 marketing/legal site)
- Mobile: `/Users/jtroy/Desktop/ColdFiles/mobile` (Expo SDK 54 / RN 0.81.5)
- Deno: `supabase/functions/*` using `jsr:@supabase/supabase-js@2`
**Posture this week:** Google Play closed testing ships from these trees.

Severity legend: 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · 🔵 LOW

---

## 1. CVE Scan (`npm audit --omit=dev`)

### Root project — `npm audit --omit=dev`
- **Exit code:** 1 (non-zero because vulns present)
- **Total:** 2 moderate, 0 high, 0 critical
- **Production deps audited:** 50 prod, 207 total

| ID | Package | Installed | CVE | CVSS | Severity | Path / Effect |
|----|---------|-----------|-----|------|----------|---------------|
| GHSA-qx2v-qp2m-jg93 | `postcss` | 8.4.31 | XSS via unescaped `</style>` in CSS stringify | 6.1 | 🟡 MEDIUM | transitive via `next@15.5.15` |
| (rollup advisory chain) | `next` | 15.5.15 | inherits postcss issue | — | 🟡 MEDIUM | direct |

**Notes**
- The postcss XSS path requires an attacker to control CSS that the build stringifies. The root project compiles legal/marketing pages from internal MDX — no user-supplied CSS reaches postcss at build time. Runtime exposure is **near-zero**, but the advisory is real; bump postcss ≥ 8.5.10 (or wait for Next.js patch wave).
- `npm audit fix` reports `next@9.3.3` as the "fix" — that is a downgrade and is **not** the correct remediation. Manually pin a postcss override or upgrade Next 15 minor.

### Mobile project — `npm audit --omit=dev`
- **Exit code:** 1
- **Total:** 17 moderate, 0 high, 0 critical
- **Production deps audited:** 761 prod, 1001 total

The 17 advisories collapse to **two** root causes (both moderate, both build-toolchain-only):

| ID | Package | Installed | CVE | CVSS | Severity | Reach at runtime |
|----|---------|-----------|-----|------|----------|------------------|
| GHSA-qx2v-qp2m-jg93 | `postcss` | 8.4.49 | XSS via stringify | 6.1 | 🟡 MEDIUM | **Build-time only** — pulled by `@expo/metro-config`. Does not ship in the APK. |
| GHSA-w5hq-g745-h8pq | `uuid` | 7.0.3 | Missing buffer bounds check in v3/v5/v6 when buf provided | 0.0 (no CVSS) | 🟡 MEDIUM | **Build-time only** — pulled by `xcode` → `@expo/config-plugins` (prebuild path; iOS-side, not used on Android closed-testing build). |

Cascade effect (the other 15 entries): `@expo/cli`, `@expo/config`, `@expo/config-plugins`, `@expo/metro-config`, `@expo/prebuild-config`, `@maplibre/maplibre-react-native`, `expo`, `expo-asset`, `expo-constants`, `expo-linking`, `expo-manifests`, `expo-router`, `expo-splash-screen`, `expo-updates`, `xcode` — all flagged because they transitively depend on the two roots above. None are independent CVEs.

**Closed-testing impact:** The two underlying vulns are XSS in build-time CSS processing and a buffer-bounds bug in iOS-prebuild UUID generation. Neither is reachable from the Android user-runtime bundle. **Not a ship-blocker for this week.**

### Deno Edge Functions
- Single import: `jsr:@supabase/supabase-js@2`. JSR-served, lockable via `deno.lock`. No npm audit applicable.
- No CVEs known against `@supabase/supabase-js@2.x` line as of this date.

---

## 2. Outdated Packages (security-sensitive only)

Filter: only deps that (a) carry an active advisory, or (b) are auth/crypto/network-sensitive AND >2 minor or >1 major behind. Routine UI/format bumps deliberately omitted.

### Root
| Package | Current | Latest | Behind | Sensitive? | Action |
|---------|---------|--------|--------|-----------|--------|
| `next` | 15.5.15 | 16.2.4 | 1 major | Yes (renders auth pages, sets headers) | 🔵 LOW — defer to Next 16 stable, no active critical CVE on 15.x line |
| `@supabase/supabase-js` | 2.105.0 | 2.105.1 | 1 patch | Yes (auth) | Patch-bump, painless |
| `cheerio` | (in tree) | current | — | Server-side scraping only | OK |

### Mobile (security-sensitive bucket only)
| Package | Current | Latest | Behind | Sensitive? | Action |
|---------|---------|--------|--------|-----------|--------|
| `expo` (and ecosystem) | 54.0.34 | 55.0.18 | 1 major | Yes (manages OTA, deep links, secure store) | 🔵 LOW — Expo 55 still maturing; 54.x is current LTS-ish for SDK 54. Track but don't block. |
| `expo-updates` | 29.0.17 | 55.0.21 (SDK 55 line) | aligned w/ SDK 54 | **Yes — code delivery** | Stay locked to SDK-54-matched line; do not jump independently |
| `expo-crypto` | 15.0.9 | 55.0.14 (SDK 55 line) | aligned w/ SDK 54 | Yes (crypto) | Same — pinned to SDK 54 line by design |
| `react-native` | 0.81.5 | 0.85.2 | 4 minor | Yes (network/SSL stack) | 🔵 LOW — RN ships with SDK 54; bumping decoupled from SDK breaks Expo prebuild |
| `@react-native-async-storage/async-storage` | 2.0.0 | 3.0.2 | 1 major | Yes (token storage) | 🔵 LOW — Expo SDK 54 expects 2.0.x range |
| `@supabase/supabase-js` | 2.105.0 | 2.105.1 | 1 patch | Yes (auth) | Patch-bump |

**Top 3 outdated security-sensitive packages to track post-launch:**
1. `next` 15 → 16 (root)
2. `expo` 54 → 55 (mobile, full SDK upgrade)
3. `react-native` 0.81 → 0.85 (mobile, gated by SDK upgrade)

None are ship-blockers. The Expo ecosystem is intentionally locked to SDK 54 versions — the "outdated" report is misleading because Expo manages compatibility windows.

---

## 3. License Risk

Walked all 836 mobile + 100 root package.json files; counted SPDX licenses.

### Root project license distribution
- 100 packages walked. **Zero AGPL / SSPL / GPL-only.**
- One LGPL flagged: `@img/sharp-libvips-darwin-arm64@1.2.4` (LGPL-3.0-or-later). **Optional darwin-arm64 native binary** for the `sharp` image-processing pipeline (build-time, not redistributed). LGPL on a dev-time binary linked dynamically does not create distribution obligations on the published Next.js app. **No action required.**

### Mobile project license distribution
- 836 packages. Top licenses: MIT 708, ISC 41, Apache-2.0 25, BSD-2 21, BSD-3 17, BlueOak 6.
- Flagged outliers:

| Package | License | Distribution risk? |
|---------|---------|--------------------|
| `lightningcss` | MPL-2.0 | 🟡 MEDIUM-LOW. MPL-2.0 is file-level copyleft. We do not modify lightningcss source — link-only use is permitted with attribution. Safe for app distribution. |
| `lightningcss-darwin-arm64` | MPL-2.0 | Same as above; native-binary build dep, not in APK. |
| `node-forge` | (BSD-3-Clause OR GPL-2.0) | **Dual-licensed — we elect BSD-3-Clause.** No GPL obligation. Safe. |

**No AGPL / SSPL / proprietary-blocker licenses present.**
Notice files are required for MPL components if they ship at runtime; lightningcss is build-time only, so notice obligation is satisfied by the existing OSS attribution page.

---

## 4. Supply-Chain

### `@maplibre/maplibre-react-native` (called out in scope)
- **Version pinned:** 11.0.2 (latest stable)
- **Maintainers:** `maplibreorg` (org account, board@maplibre.org), `birkskyum`, `kiwikilian` — all named individuals tied to the MapLibre Foundation.
- **Repo:** `github.com/maplibre/maplibre-react-native` — official MapLibre org, open governance.
- **License:** MIT
- **First published:** 2022-12-29 · **Latest publish:** 2026-04-24 (5 days ago — actively maintained)
- **Downloads (last 30d):** 113,197 — moderate but healthy for a niche RN map library.
- **Deps:** `@maplibre/maplibre-gl-style-spec@24.8.1`, `@turf/distance/helpers/length/nearest-point-on-line@^7.3.5`. All MIT, all from established orgs.
- **Verdict:** ✅ Legitimate. Community-maintained but under formal MapLibre Foundation governance, not a single-maintainer drive-by. Continue tracking releases; no supply-chain concern.

### Other supply-chain checks
- No typosquat patterns detected against scoped names (`@expo/*`, `@supabase/*`, `@react-navigation/*`, `@maplibre/*` all match canonical orgs).
- No deps with download counts < ~10k/mo on the production-runtime path.
- `@supabase/supabase-js` — 78M downloads/month, official org. No concern.
- All Turf.js packages (transitive via maplibre) — established Turf org, MIT, well-maintained.
- No deprecated-package warnings on prod paths (the existing `xcode → uuid@7` chain is the only stale-transitive issue, already covered by §1).

---

## 5. Lockfile Integrity

| Project | `package-lock.json` present | Tracked in git | `lockfileVersion` | Pinned via lock |
|---------|-----------------------------|----------------|-------------------|-----------------|
| Root | ✅ `/Users/jtroy/Desktop/ColdFiles/package-lock.json` (109 KB, 209 version entries) | ✅ `git ls-files` confirms | 3 | ✅ All transitive deps locked with integrity hashes |
| Mobile | ✅ `/Users/jtroy/Desktop/ColdFiles/mobile/package-lock.json` (504 KB, 1003 version entries) | ✅ `git ls-files` confirms | 3 | ✅ All transitive deps locked with integrity hashes |

`.gitignore` does not exclude lockfiles. Both lockfiles use `lockfileVersion: 3` and contain `integrity` SHA-512 hashes for every resolved package — reproducible installs are guaranteed.

`package.json` direct-dependency style: caret-ranges (`^x.y.z`) for npm-published deps and tilde-ranges (`~x.y.z`) for the Expo-managed bucket. This is correct for an Expo-managed RN project. **The lockfile is the source of truth for reproducibility — no concern.**

---

## Summary Table

| Area | Status | Blocker for closed testing? |
|------|--------|------------------------------|
| Critical CVEs | 0 root, 0 mobile | No |
| High CVEs | 0 root, 0 mobile | No |
| Moderate CVEs | 2 root (postcss/next), 17 mobile (collapses to postcss + uuid, both build-time) | No |
| License copyleft | None at runtime; LGPL/MPL only on build-side native binaries | No |
| Supply-chain | All prod deps verified to legitimate orgs | No |
| Lockfile integrity | Both committed, lockfileVersion 3, integrity hashes present | No |

**Ship-clear for closed testing this week.** Schedule postcss/next and Expo SDK 55 upgrades into the post-closed-testing maintenance window.
