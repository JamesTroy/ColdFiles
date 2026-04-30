# 07 — Web Surface Audit (XSS · CSRF/SSRF · CORS/Headers)

**Audit date:** 2026-04-30
**Scope:** Three web-security domains across the two-frontend / one-backend topology.
- Next.js 15 marketing+legal site at `coldfile.app` (Vercel, deployed today)
- Expo SDK 54 React Native app under `mobile/` (closed-test build candidate)
- Supabase Edge Functions under `supabase/functions/`
- Local + Edge scrape pipeline under `scripts/`, `sources/`, `supabase/functions/_shared/`

**Out of scope (already covered):** general code-vuln review (`01`), auth + crypto (`02`), privacy / GDPR (`03`), API + RLS surface (`04`), dependency CVEs (`05`).

Severity legend: 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · 🔵 LOW · ✓ verified

---

## Domain 1 — XSS Prevention

### 1.1 Next.js side (`coldfile.app`)

**Surface inventory.** The Next.js tree under `app/` is fully static (`x-vercel-cache: PRERENDER` confirmed live). No `app/api/` route handlers exist (`find app -name 'route.ts*'` is empty; `app/api/` directory exists but is empty). No middleware, no Server Actions, no user-input forms. Pages are five legal/marketing routes plus `manifest.ts`, `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`.

| ID | Severity | File:Line | Finding |
|----|----------|-----------|---------|
| W-XSS-1 | 🔵 LOW | `app/layout.tsx:114-117` | `dangerouslySetInnerHTML` is used to inject the JSON-LD `Organization` block. Source is the in-file constant `ORG_LD` serialized through `JSON.stringify`. No user data flows in. **Caveat:** `JSON.stringify` does not escape `</` sequences; if any future field were to contain a literal `</script>`, it would break out of the script tag. **Fix (defense-in-depth):** wrap the serializer to replace `</` with `<\/`. Not a launch blocker — current input is a static literal. |
| ✓ | — | `app/page.tsx`, `app/account/delete/page.tsx`, `app/_components/legal-doc.tsx`, `app/legal/*` | All text rendered as JSX children (auto-escaped). All `href` values are literal strings (`/legal/*`, `mailto:`). No URL params read, no `useSearchParams`, no dynamic routes outside the legal/account static set. |
| ✓ | — | `app/opengraph-image.tsx` | Pure static `next/og` `ImageResponse`. No user input, no template literal that incorporates request data. |
| ✓ | — | `app/manifest.ts`, `app/sitemap.ts`, `app/robots.ts` | All return constant data structures — no string templating, no request-derived values. `sitemap.ts` lists five literal URLs; `manifest.ts` references local icons. |
| ✓ | — | `app/api/` | Directory is empty — no API routes exist on the public web property. There is no Next.js server-side surface that takes URL params and renders to JSX. |

**No `eval` / `new Function` anywhere in the Next.js tree.** Confirmed via repo-wide grep.

### 1.2 React Native side (mobile/)

**WebView inventory.** Two WebView consumers, both in `mobile/components/cf/`:
- `leaflet-map.tsx` — main map (case pins + "you are here")
- `leaflet-watch-zone.tsx` — watch-zone polygon preview

| ID | Severity | File:Line | Finding |
|----|----------|-----------|---------|
| ✓ | — | `mobile/components/cf/leaflet-map.tsx:72-77, 83-90` | Initial HTML is built once via `useMemo([])` and frozen for the WebView's lifetime. Subsequent updates run through `injectJavaScript` with `JSON.stringify(markers)` and `JSON.stringify(here)` — both interpolate strictly typed data (`PinKind` enum, numbers, booleans, IDs). No narrative text, agency name, or other free-form string is interpolated into the injected JS. |
| ✓ | — | `mobile/components/cf/leaflet-watch-zone.tsx:115-273` | All script-side interpolation uses `JSON.stringify(...)` on typed inputs (`vertices` lat/lng numbers, `insidePins` enum + numbers, palette constants). No user-typed string flows into the HTML. |
| ✓ | — | `originWhitelist` | Both WebViews scope `originWhitelist` to `https://(a|b|c|d).basemaps.cartocdn.com`, `https://unpkg.com`, `about:blank`. No `*` and no `https?://*`. `mixedContentMode="never"` is set on both, so any `http://` resource attempts are blocked. |
| ✓ | — | `setMarkers` / `setHere` | The injected runtime composes SVG markup as string concatenation but every interpolated value is a number (diameter, cx/cy, radius) or a hex color from the local `tokens` constant. Marker `id` is round-tripped through `postMessage` only — never re-rendered into the DOM. |
| W-XSS-2 | 🔵 LOW | `leaflet-map.tsx:518` | Marker `id` (a string) is closed-over and posted back via `postMessage({ type: 'marker', id })`. Today the only producer is internal pin-data with UUID-shaped IDs from Supabase, but if the pipeline ever sources `id` from scraped attributes, it is **not** sanitized before being stored in Storage's `<img src>` chain on the RN side. **Fix:** none required for V1 (id types are UUIDs); document the contract on the consumer side that marker IDs must be opaque tokens, not user content. |

**No `innerHTML` / `outerHTML` / `document.write` outside the trusted Leaflet script body** (where they're used by Leaflet itself on tokenized data). No DOM XSS sink that touches user-controlled input.

### 1.3 Trusted-sink hygiene (Image src, anchor href)

| ID | Severity | File:Line | Finding |
|----|----------|-----------|---------|
| ✓ | — | `mobile/lib/photo-policy.ts:56-80` | `effectivePhotoUri` is the chokepoint for all hero photos. It refuses to return the source URL (forces null) for Charley/Doe-attributed media when `mirror_url` is unset — see `feedback_photo_sourcing_policy`. Photo Image src therefore comes from one of three places: a Supabase Storage URL (mirrored), an agency-released hot-link allowed by policy, or null (em-dash placeholder). |
| W-XSS-3 | 🟡 MEDIUM | `mobile/components/cf/source-chip.tsx:26-31` | `WebBrowser.openBrowserAsync(url)` opens `case_sources.source_url` directly — that field is populated by the scraper from external HTML. If a malicious source ever shipped a URL with a non-http(s) scheme (`javascript:`, `intent:`, `data:`), `openBrowserAsync` would forward it to the system browser, which usually rejects but the contract is sloppy. **Fix:** validate scheme (`url.startsWith('https://') || url.startsWith('http://')`) before calling — drop one line in the chip. Same chokepoint covers all sources. |
| ✓ | — | `mobile/app/tip/[slug].tsx:117-135` | `target` is the `tip_url` from the resolved route. Sources are: case-level override (admin-controlled today), agency table (admin-controlled), `STATE_CLEARINGHOUSES` (in-repo constant), or FBI fallback (constant). No scraper-supplied URL reaches `Linking.openURL` in V1. `Linking.canOpenURL` is the only gate; for `https://` that is fine, but adding the same scheme allow-list as W-XSS-3 is cheap. |
| ✓ | — | `mobile/app/case/[slug].tsx:487-490` | `new URL(s.source_url).hostname` parses for display only. If parse throws, the whole list-build throws — but `source_url` is a `not null` column, populated by the scraper, and exists for every case. Mild robustness hit, not a security one. |

---

## Domain 2 — CSRF & SSRF

### 2.1 CSRF

| ID | Severity | File | Finding |
|----|----------|------|---------|
| ✓ | — | Auth model | Supabase auth uses bearer-token JWTs in `Authorization` headers, not cookies. `coldfile.app` does not set any `Set-Cookie` (verified via curl on `/`, `/legal/privacy`, `/account/delete`). There is no SameSite/credentialed-cookie surface to forge. CSRF risk is structurally near-zero. |
| ✓ | — | `mobile/app/account/delete*` | Account deletion is in-app only — no web form. The `account/delete` page on the web is informational + `mailto:` link. No state-changing GET/POST endpoint on the public web property. |
| ✓ | — | `supabase/functions/tip-route-submit/index.ts:213-225` | `extractUserId` validates the bearer via `supabase.auth.getUser()` against the user's own JWT. The schema explicitly permits anonymous tips (RLS `for insert with check (true)`), so there is no privilege to elevate via forgery — a forged anonymous tip from a third-party origin still produces an anonymous tip-route audit row, identical to what the legitimate flow produces. |

### 2.2 SSRF — scraper / photo-cache (the real surface)

The scrape pipeline runs server-side and fetches arbitrary URLs from external HTML/sitemaps. This is the domain's largest exposure.

| ID | Severity | File:Line | Finding |
|----|----------|-----------|---------|
| W-SSRF-1 | 🟠 HIGH | `supabase/functions/_shared/pipeline.ts:140-176` (`sitemapDiscovery`) | Sitemap-index recursion follows every `<loc>` it finds, with **no host pinning to `source.baseUrl`**. The only filter is `strat.urlPattern` applied to terminal (non-index) URLs; intermediate `<sitemapindex>` `<loc>` values are followed unconditionally. A compromised or spoofed sitemap could redirect the crawler at internal hosts (`http://169.254.169.254/...`, `http://localhost:8080/...`, intra-Supabase). **Fix:** before `await visit(u)`, parse `u` and require `new URL(u).host === new URL(strat.sitemapUrl).host`. One line, no behavioral change for the legitimate Charley case. |
| W-SSRF-2 | 🟠 HIGH | `supabase/functions/_shared/http.ts:7-42` (`PoliteFetcher.get`) | The shared fetcher does not enforce: (a) URL scheme allow-list (only `http:`/`https:`), (b) IP block-list for RFC1918 / loopback / link-local / `169.254.169.254` metadata IPs, (c) global egress timeout, (d) max-redirect cap, (e) max response size. `fetch` defaults follow up to 20 redirects; a 302 chain from a controlled origin to `http://169.254.169.254/latest/meta-data/iam/security-credentials/` would be honored. **Fix bundle (one helper, one PR):** add `assertSafeUrl(url)` that `new URL`-parses, requires `protocol === 'https:'` (or `http:` for sources we explicitly opt in), rejects when the resolved hostname is in an SSRF-blocklist (loopback, RFC1918, `*.local`, IMDS IPs, `0.0.0.0`), and pipes that into both `PoliteFetcher.get` and the inner-redirect path (`redirect: 'manual'` then validate the `Location` header). Edge Function runtime is Deno — `Deno.resolveDns` is available, or use a coarser hostname-only check for V1. **Add an `AbortController` with a 30-second timeout to bound egress.** |
| W-SSRF-3 | 🟠 HIGH | `supabase/functions/_shared/media.ts:53` (`cacheOne`) | `await ctx.fetcher.getBytes(photo.url)` is the photo-mirror primitive. `photo.url` is harvested from scraped HTML via `extract.ts`'s `<img src>` walker — fully attacker-influenced (a Charley page, a Doe page, or any source we add). Today this inherits the same lack of scheme/IP guards as W-SSRF-2. Specific risk: a poisoned source page that hot-links `<img src="http://169.254.169.254/...">` triggers a server-side fetch from the Edge Function, which then **stores the response in `case-media`** as a public-bucket object. The result is that internal metadata could be exfiltrated into a publicly readable storage path. **Fix:** apply the W-SSRF-2 helper here, plus enforce a max-bytes ceiling on `getBytes` (currently unbounded — a malicious source could OOM the Edge Function with a 1GB response). |
| W-SSRF-4 | 🟡 MEDIUM | `supabase/functions/photo-cache/index.ts:30` | The backfill re-reads `case_sources.raw_payload.photos[*]` and feeds those strings into `cacheMediaForCase` → `getBytes`. Same risk as W-SSRF-3, plus the additional concern that `raw_payload` is stored JSON — a future writer (manual import, Supabase Studio paste) could insert a hostile URL that the backfill picks up. **Fix:** the W-SSRF-2 chokepoint covers this. |
| W-SSRF-5 | 🟡 MEDIUM | `supabase/functions/_shared/pipeline.ts:111`, `extract.ts:254-260` | `new URL(href, pageUrl)` with no host pinning means a `<a href="//evil.tld/case/...">` on a legitimate Charley page resolves to a third-party host and gets crawled. URL-pattern filters are regex-only and are evaluated against the resolved absolute URL, so `urlPattern: /\/case\/[a-z0-9-]+\/?$/i` on Charley would match `https://evil.tld/case/foo` just as well. **Fix:** anchor `urlPattern` regexes with the source host (e.g. `^https://charleyproject\.org/case/`), or apply the host-pinning helper at the discovery level. Lower-severity than 1–3 because it costs the attacker an XSS on the source first. |
| ✓ | — | `supabase/functions/tip-route-submit/index.ts` | This Edge Function does not fetch any external URL based on user input. Its only outbound call is `supabase.from(...)` (in-VPC). Not an SSRF surface. |
| ✓ | — | `supabase/functions/geocode-pending/index.ts` | Calls Mapbox with case `location_text`; URL is built from a single trusted constant + URL-encoded query string. Mapbox is the fixed origin; no user-controlled URL. |
| ✓ | — | Mobile WebView `originWhitelist` | Already tightened (verified live in 1.2). Mobile cannot SSRF — fetches are CDN-pinned. |
| ✓ | — | Next.js | No `app/api/*` route consumes a URL parameter. `next/og` `opengraph-image.tsx` does not fetch. |

### 2.3 SSRF — Other surfaces

| ID | Severity | File | Finding |
|----|----------|------|---------|
| ✓ | — | `scripts/scrape-cli.ts` | Local CLI shares the same `PoliteFetcher`. The CLI runs in dev environments only (requires `SUPABASE_SERVICE_ROLE_KEY` in env). The same W-SSRF-2 fix protects the CLI automatically since they share the helper module. |
| ✓ | — | `supabase/functions/ingest-tick/index.ts:47-50` | The cron dispatcher's only outbound `fetch` is `${SUPABASE_URL}/functions/v1/ingest-source?source=${row.slug}` with `slug` URL-encoded. `slug` comes from the `sources` table (admin-controlled) — not an SSRF surface. |
| ✓ | — | `supabase/functions/ingest-source/index.ts:34-39` | Auth gate uses `INGEST_TICK_SECRET` constant-equality compare. No URL fetched on user input. |

---

## Domain 3 — CORS & Headers

### 3.1 Live header verification (`coldfile.app`, post-deploy)

Verified at audit time via `curl -sI`:

```
GET https://www.coldfile.app/                  → HTTP/2 200
GET https://coldfile.app/                       → HTTP/2 307 → www
GET https://www.coldfile.app/legal/privacy      → HTTP/2 200
GET https://www.coldfile.app/account/delete    → HTTP/2 200
GET https://www.coldfile.app/sitemap.xml       → HTTP/2 200
GET https://www.coldfile.app/robots.txt        → HTTP/2 200
```

Every 200 response carries the seven security headers from `next.config.ts`:

| Header | Live value (post-deploy reality) |
|--------|----------------------------------|
| `X-Frame-Options` | `DENY` ✓ |
| `X-Content-Type-Options` | `nosniff` ✓ |
| `Referrer-Policy` | `strict-origin-when-cross-origin` ✓ |
| `Permissions-Policy` | accel/camera/geo/gyro/mag/mic/payment/usb all `()` ✓ |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` ✓ |
| `Content-Security-Policy` | full directive (see below) ✓ |
| (apex `coldfile.app`) | redirect carries HSTS only — fine, redirect target picks up the rest ✓ |

Apex 307 → www correctly preserves HSTS. The 307 itself does not carry CSP/X-Frame-Options, but since the body is empty plain-text and the response is short-lived, this is acceptable; the followed-to www response carries the full set.

### 3.2 CSP analysis

Active policy:

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: blob:;
connect-src 'self' https://*.supabase.co;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
```

| ID | Severity | Finding |
|----|----------|---------|
| W-CSP-1 | 🟡 MEDIUM | `script-src 'unsafe-inline'` is broader than necessary. Next.js 15 ships its inline boot script with a per-request nonce in `_document` when nonces are configured; switching to nonce-based CSP closes inline-XSS without breaking SSR. **Today's risk:** the Next.js tree has one `dangerouslySetInnerHTML` (the JSON-LD block, W-XSS-1) but otherwise no JSX entry points for inline-script injection — the practical risk surface is small. **Fix:** post-launch, swap `'unsafe-inline'` for `'nonce-{rand}'` via Next.js's `headers()` and `nonce` helper. |
| W-CSP-2 | 🔵 LOW | `style-src 'unsafe-inline'` is required by Next.js's atomic-style runtime — there is no realistic alternative on Next 15.5 today. The comment in `next.config.ts:17-18` already documents this. ✓ accepted constraint. |
| W-CSP-3 | 🔵 LOW | `connect-src 'self' https://*.supabase.co` — wildcard subdomain is appropriate (Supabase project + storage + functions live under different subdomains). The Next.js site itself does not currently call Supabase from the browser, so this is forward-looking; consider tightening to the specific project subdomain when it lands. |
| ✓ | — | `frame-ancestors 'none'` + `X-Frame-Options DENY` | Belt-and-suspenders clickjacking defense covers `/account/delete` (the only legitimate concern). |
| ✓ | — | `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` | All correct. |
| W-CSP-4 | 🔵 LOW | No `frame-src` directive set → falls back to `default-src 'self'`. Equivalent to denying third-party iframes, which is what we want. ✓ effectively correct. |
| W-CSP-5 | 🔵 LOW | No `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` / `Cross-Origin-Resource-Policy` headers. Recommended for any page that opens windows or embeds resources; the legal pages do neither, so the risk is theoretical. **Fix (post-launch):** add `Cross-Origin-Opener-Policy: same-origin` to harden against window-reference attacks if/when the site adds interactive surfaces. |
| W-CSP-6 | 🔵 LOW | No CSP `report-uri` / `report-to`. Already documented in `next.config.ts:20-21` as a post-launch follow-up. |

### 3.3 Vercel default headers

Vercel injects `access-control-allow-origin: *` on static asset responses by default — visible on `/`, `/legal/privacy`, `/account/delete`, `/sitemap.xml`, `/robots.txt`. For HTML pages with no credentialed cross-origin reads this is harmless (browsers won't share cookies/auth across origins anyway). Worth noting:

| ID | Severity | Finding |
|----|----------|---------|
| W-CORS-1 | 🔵 LOW | Vercel's default `access-control-allow-origin: *` on the marketing pages cannot be overridden via `next.config.ts` `headers()` (Vercel applies it after Next emits headers). Operationally fine — there is no credentialed data on these pages, and CORS is a same-origin-data protection, not an HTML-content protection. Document it; do not block on it. |

### 3.4 Supabase Edge Function CORS

| ID | Severity | File:Line | Finding |
|----|----------|-----------|---------|
| W-CORS-2 | 🟡 MEDIUM | `supabase/functions/tip-route-submit/index.ts:230-234` | Response CORS is `access-control-allow-origin: *` with `access-control-allow-headers: authorization, x-client-info, content-type, apikey`. The mobile app does not need CORS at all (native HTTP, no browser-origin enforcement), and the web property does not call this endpoint in V1. **Recommendation:** tighten to a literal allow-list when web traffic begins (`https://coldfile.app`, `https://www.coldfile.app`, `null` for the WebView origin if needed). For closed-test launch, `*` is acceptable because no browser-origin call exists; flag as a hardening item before public web-call surfaces ship. **Also missing:** an `OPTIONS` preflight handler. The function returns 405 for any non-POST method — a browser preflight (`OPTIONS`) would 405 and the request would never go through. Today this is moot (mobile is not a browser); fix when web traffic goes live. |
| ✓ | — | `ingest-tick`, `ingest-source`, `geocode-pending`, `photo-cache` | None of these need CORS — they are server-to-server only (cron / service-role auth). Their JSON responses do not set `access-control-allow-origin`, which is correct. |

### 3.5 Cookies

| ID | Severity | Finding |
|----|----------|---------|
| ✓ | — | The Next.js site sets **no cookies** on any verified path (`/`, `/legal/privacy`, `/account/delete`, `/sitemap.xml`, `/robots.txt`) — confirmed via `curl -sI`. Supabase auth on web is not used in V1. Mobile auth uses bearer tokens in `Authorization` headers, not cookies. The site is cookie-free; SameSite/Secure attribute audits are non-applicable. |

---

## Ship-blocker Checklist (closed-test launch this week)

This list is the smallest set of items that **must** land before the build goes to Google Play closed testing. Everything else above is a hardening item with a tracked severity, not a launch blocker.

- [ ] **W-SSRF-1, W-SSRF-2, W-SSRF-3** (one PR) — Add `assertSafeUrl(url)` helper in `supabase/functions/_shared/http.ts` enforcing: scheme allow-list (`https:` only, `http:` per-source opt-in), hostname not in loopback / RFC1918 / link-local / `169.254.169.254` / `0.0.0.0`, `redirect: 'manual'` on `fetch` so redirect targets are revalidated through the helper, AbortController with a 30s timeout, max-bytes cap on `getBytes` (suggest 25 MB). Wire it into `PoliteFetcher.get`, `sitemapDiscovery` (host-pin to `source.baseUrl`), and `cacheMediaForCase`. **Why blocker:** the `case-media` bucket is publicly readable; W-SSRF-3 admits server-side metadata exfil into a public path. That is a real production risk the moment the photo-cache cron runs against live sources.

- [ ] **W-XSS-3** (one-liner) — In `mobile/components/cf/source-chip.tsx:27`, gate `WebBrowser.openBrowserAsync(url)` on `url.startsWith('https://') || url.startsWith('http://')`. Drops scraper-supplied scheme injection. **Why blocker:** the chip is on every case detail in the V1 build; a single bad URL in the seed/import set ships the bug.

Everything else (W-XSS-1, W-XSS-2, W-SSRF-4, W-SSRF-5, W-CSP-1 through W-CSP-6, W-CORS-1, W-CORS-2) is a post-launch hardening item — the live posture is acceptable for closed testing.
