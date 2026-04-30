# Technical / On-Page SEO Audit — coldfile.app

Date: 2026-04-29
Stack: Next.js 15 App Router on Vercel, RSC SSR, next/font (Newsreader / Inter / JetBrains Mono)
Live host: `https://www.coldfile.app` (apex `coldfile.app` 307s to `www`)
Pre-launch context: closed testing, no public traffic, no GSC verification, no backlinks.

Scope verified:
- `app/page.tsx` — root marketing index
- `app/legal/privacy/page.tsx`
- `app/legal/terms/page.tsx`
- `app/legal/takedown/page.tsx`
- `app/account/delete/page.tsx` (built and serving 200 — referenced from mobile, also footer-linked)
- `app/feature-graphic/page.tsx` (correctly `noindex,nofollow`)
- `app/api/` (empty directory — no routes, no SEO surface)

---

## Executive summary

The metadata pipeline (titles, descriptions, OG, Twitter, viewport, theme-color, charset, lang) is correctly wired through Next.js 15 `Metadata`/`Viewport` exports and renders into the SSR HTML head. Heading hierarchy is clean (one `<h1>` per page, sectioned `<h2>`s on legal docs). No accidental client-only rendering, no accidental `noindex` on indexable pages.

The blocking issue is **host canonicalization**: `metadataBase` declares the apex (`https://coldfile.app`) but Vercel serves the apex with a 307 to `www.coldfile.app`. Every `og:url` in the rendered HTML therefore points at the redirect host, not the live host. Combined with the absence of any explicit `<link rel="canonical">`, Google will see two competing URLs for every page. This is the single largest pre-launch fix and is cheap (one line in `layout.tsx`, plus apex→www redirect upgrade from 307 to 308).

Secondary blockers are infrastructure absences that are easy to miss before traffic exists: no `robots.txt`, no `sitemap.xml`, no `favicon.ico`, no JSON-LD `Organization`/`SoftwareApplication`, no `og:image`. None of these block indexation but every one of them is a free signal Google expects to see.

URL design (`/legal/privacy`) is defensible — keep it. Trailing-slash policy (308 to non-slash) is consistent. Mobile baseline is correct (viewport meta, responsive container, 16px body type).

---

## Severity legend

- 🔴 CRITICAL — accidental deindex / broken canonicals / actively harmful
- 🟠 HIGH — meaningful issue, fix before public launch
- 🟡 MEDIUM — improvement opportunity
- 🔵 LOW — nice-to-have

---

## 1. SEO Basics

### 1.1 Title tags

| Page | Title (rendered) | Length | Verdict |
|---|---|---|---|
| `/` | `The Cold File` | 13 | 🟡 thin — see 1.1.a |
| `/legal/privacy` | `Privacy Policy · The Cold File` | 31 | OK |
| `/legal/terms` | `Terms of Service · The Cold File` | 33 | OK |
| `/legal/takedown` | `Takedown Request · The Cold File` | 33 | OK |
| `/account/delete` | `Delete Account · The Cold File` | 31 | OK |
| `/feature-graphic` | `Feature graphic · The Cold File` | n/a (noindex) | OK |

**Finding 1.1.a 🟡 MEDIUM — root title is a 13-char brand-only string.**
- Where: `app/layout.tsx:41` (`title: 'The Cold File'`).
- Why it matters: the root marketing page is the one URL that needs to compete on category terms when public launch happens. "The Cold File" alone gives no query surface.
- Fix: change the per-page title for `/` (override the layout title in `app/page.tsx`) to something like `The Cold File — Unsolved cases on a map, tips routed honestly`. Keep layout default for inheritance to non-overriding pages.

### 1.2 Meta descriptions

All five indexable pages have unique, hand-written descriptions. Lengths sit between ~60 and ~110 characters — under the ~155 SERP truncation, all are sensible.

- `app/layout.tsx:42-43` — root description (inherited by `/`)
- `app/legal/privacy/page.tsx:7-8`
- `app/legal/terms/page.tsx:7`
- `app/legal/takedown/page.tsx:7-8`
- `app/account/delete/page.tsx:6-7`

No findings.

### 1.3 Heading hierarchy

| Page | h1 | h2 count | Notes |
|---|---|---|---|
| `/` | "Discover unsolved cases near you." (`page.tsx:38-48`) | 0 | the `THE COLD FILE` and "Coming soon…" lines are `<p class="mono-cap">`, not headings — semantically correct |
| `/legal/privacy` | "Privacy Policy" | 18 | one h2 per section, no h3, clean |
| `/legal/terms` | "Terms of Service" | 9 | clean |
| `/legal/takedown` | "Takedown Request" | 5 | clean |
| `/account/delete` | "Delete account" (`account/delete/page.tsx:42-44`) | 2 | `<h2 class="mono-cap">` at `:64` and `:96` — semantically present even though styled as caption |

**Finding 1.3.a 🔵 LOW — `/legal/terms` first section has no `heading`.**
- Where: `app/legal/terms/page.tsx:16` — `{ body: ['By using The Cold File, you agree to these terms.'] }` produces a paragraph with no preceding `<h2>`. Same pattern at `/legal/takedown` line 17–21.
- Why it matters: not harmful, but the document outline becomes h1 → (orphan paragraph) → h2 → h2 → … . An "Overview" or "Summary" h2 would make the outline cleaner for both screen readers and the indexer.
- Fix: optional. Add `heading: 'Overview'` (or remove the heading-less section and inline that sentence into the next section's body).

No h1 missing, no h1 duplication, no skipped levels.

### 1.4 URL structure

- `/`
- `/legal/privacy`, `/legal/terms`, `/legal/takedown`
- `/account/delete`
- `/feature-graphic` (noindexed)

The audit prompt asked whether `/legal/*` is over-engineered for three pages. Verdict: **keep it**. The nesting communicates intent (these are legal documents), groups them under one segment for future expansion (DMCA, accessibility statement, cookie policy if cookies arrive), and the prefix is what most regulators and stores look for in a "legal hub" link. Flattening to `/privacy /terms /takedown` saves three characters and loses the grouping. No finding.

### 1.5 Open Graph tags

Rendered head (verified via curl on `https://www.coldfile.app/legal/privacy`):

```
<meta property="og:title" content="The Cold File"/>
<meta property="og:description" content="Discover unsolved cases near you. Tips routed to the agencies that own them — never held by us."/>
<meta property="og:url" content="https://coldfile.app"/>
<meta property="og:type" content="website"/>
```

**Finding 1.5.a 🔴 CRITICAL — `og:url` hardcodes the apex on every page.**
- Where: `app/layout.tsx:50` (`url: 'https://coldfile.app'`) is set at the layout level and inherited by every child page.
- Why it matters: combined with apex→www 307 (see 5.1 below), every shared link will have an OG card whose canonical URL points at the wrong host. Crawlers, link previewers (Slack/Twitter/Discord), and Google's deduplicator all read `og:url`.
- Fix: in `app/layout.tsx`, change `metadataBase: new URL('https://coldfile.app')` to `new URL('https://www.coldfile.app')` and either remove the explicit `openGraph.url` (let it inherit per-page) or set it to `https://www.coldfile.app`. Then in each page, do **not** set `openGraph.url` so Next.js fills it from `metadataBase + pathname`. This single fix wires every page's OG card to its own URL on the canonical host.

**Finding 1.5.b 🟠 HIGH — legal-page OG cards inherit the homepage title and description.**
- Where: `/legal/privacy`, `/legal/terms`, `/legal/takedown`, `/account/delete` all set `metadata.title` and `metadata.description` but not `metadata.openGraph`. The layout's `openGraph` block (`app/layout.tsx:45-51`) wins, so a privacy-policy share card reads "The Cold File / Discover unsolved cases near you."
- Why it matters: shared legal links to privacy/terms (which is what regulators and store reviewers do) preview as if they're the homepage. Looks careless.
- Fix: in each `legal/*/page.tsx`, add `openGraph: { title, description }` mirroring the page's own `title`/`description`. Or define a small helper that builds page-level metadata so the OG block stays in lockstep with the title.

**Finding 1.5.c 🟡 MEDIUM — no `og:image`, no `og:site_name`, no `og:locale`.**
- Where: `app/layout.tsx:45-51`. Only `title`, `description`, `type`, `url` are set.
- Why it matters: link previews fall back to a domain-string card with no thumbnail. The Play Store feature graphic at `/feature-graphic` is a 1024×500 asset already designed; capture it as `public/og.png` (1200×630 is Facebook's preferred aspect, but 1024×500 displays acceptably) and reference it as `openGraph.images`.
- Fix:
  - Add `app/opengraph-image.tsx` (Next.js 15 file convention) — Next will route this as the OG image for the whole site automatically; or
  - Add `public/og.png` and reference via `openGraph: { images: [{ url: '/og.png', width: 1200, height: 630 }] }` in `layout.tsx`.
  - Add `siteName: 'The Cold File'` and `locale: 'en_US'`.

### 1.6 Twitter cards

Rendered:

```
<meta name="twitter:card" content="summary"/>
<meta name="twitter:title" content="The Cold File"/>
<meta name="twitter:description" content="…"/>
```

These are auto-emitted by Next from `openGraph` even though no `metadata.twitter` block exists.

**Finding 1.6.a 🔵 LOW — no `twitter:card = summary_large_image`, no `twitter:image`, no `twitter:site`.**
- Where: `app/layout.tsx` — no `metadata.twitter` block.
- Fix (after 1.5.c lands): `twitter: { card: 'summary_large_image', title: 'The Cold File', description: '…', images: ['/og.png'] }`. Drop the `twitter:site` handle until you actually own one.

### 1.7 Favicon

**Finding 1.7.a 🟠 HIGH — `favicon.ico` returns 404.**
- Verified: `curl -sI https://www.coldfile.app/favicon.ico` → `HTTP/2 404`.
- There is no `app/icon.{ico,png,svg}`, no `app/favicon.ico`, no `public/favicon.ico` (the entire `public/` directory does not exist in the web property).
- Why it matters: every browser tab renders a default-globe icon, every bookmark file is anonymous, and Google SERP tile next to the title is empty. For a brand whose entire visual identity is "case-file aesthetic", a missing favicon is jarring once anyone clicks through.
- Fix: drop `app/icon.png` (Next.js auto-routes it) — a 32×32 amber/black mark of the wordmark or one of the three pin shapes. No code change needed beyond the file.

### 1.8 Other head signals

- `<meta charSet="utf-8">` — present, layout-default.
- `<meta name="viewport" content="width=device-width, initial-scale=1">` — present, layout-default.
- `<meta name="theme-color" content="#0a0a0a">` — present (`app/layout.tsx:54-57`).
- `<html lang="en">` — present (`app/layout.tsx:62`).

No findings.

---

## 2. Search Engine Understanding

### 2.1 Crawlability — robots.txt

**Finding 2.1.a 🟠 HIGH — `robots.txt` does not exist.**
- Verified: `https://www.coldfile.app/robots.txt` → `HTTP/2 404`. No `app/robots.ts`, no `public/robots.txt`.
- Why it matters: Google synthesizes a permissive default when the file is absent (effectively `Allow: /`), so this isn't a deindex risk. But (a) you lose the chance to disallow `/feature-graphic` at the crawler level (currently it's only `noindex` in HTML, which means crawlers still fetch it); (b) you have nowhere to point at the eventual `sitemap.xml`; (c) AI crawlers (GPTBot, ClaudeBot, CCBot) read `robots.txt` for opt-out — for a sensitive-content site like this, a stated policy is cheap and on-brand.
- Fix: create `app/robots.ts`:
  ```ts
  import type { MetadataRoute } from 'next';
  export default function robots(): MetadataRoute.Robots {
    return {
      rules: [{ userAgent: '*', allow: '/', disallow: ['/feature-graphic', '/api/'] }],
      sitemap: 'https://www.coldfile.app/sitemap.xml',
      host: 'https://www.coldfile.app',
    };
  }
  ```

### 2.2 Sitemap

**Finding 2.2.a 🟠 HIGH — `sitemap.xml` does not exist.**
- Verified: `https://www.coldfile.app/sitemap.xml` → `HTTP/2 404`. No `app/sitemap.ts`.
- Why it matters: with no public backlinks (pre-launch), the sitemap is the only way Google discovers `/legal/*` and `/account/delete` quickly after launch. With five pages this is trivial to maintain.
- Fix: create `app/sitemap.ts`:
  ```ts
  import type { MetadataRoute } from 'next';
  export default function sitemap(): MetadataRoute.Sitemap {
    const base = 'https://www.coldfile.app';
    const lastModified = new Date('2026-04-29');
    return [
      { url: `${base}/`, lastModified, priority: 1.0 },
      { url: `${base}/legal/privacy`, lastModified, priority: 0.5 },
      { url: `${base}/legal/terms`, lastModified, priority: 0.5 },
      { url: `${base}/legal/takedown`, lastModified, priority: 0.5 },
      { url: `${base}/account/delete`, lastModified, priority: 0.3 },
    ];
  }
  ```
  Exclude `/feature-graphic` (it's `noindex` and you want zero crawler interest in it).

### 2.3 JS rendering

All five pages are server components rendering pure HTML. Verified by curl-fetching the raw response and confirming the body content is fully present in the SSR payload — no `useEffect`-only content, no client-only mounts. GoogleBot will see exactly what curl sees.

No findings.

### 2.4 JSON-LD / structured data

**Finding 2.4.a 🟡 MEDIUM — no JSON-LD on any page.**
- Verified: `<script type="application/ld+json">` does not appear in any of the four crawled pages.
- Why it matters: for a brand-new domain with no backlinks, structured data is the cheapest way to give Google a confident "what is this site about" signal. The two relevant schemas:
  - `Organization` (or `Corporation`) on the layout — name "The Cold File", legal name "Matte Black Dev LLC", URL, logo, sameAs (App Store / Play Store URLs once live).
  - `MobileApplication` / `SoftwareApplication` once the apps are live — operatingSystem, applicationCategory, offers (free), downloadUrl.
- Fix: emit `<script type="application/ld+json">` from `app/layout.tsx` body (not head — Next 15 sometimes strips ld+json from head if mis-typed). Start with `Organization` only; add `SoftwareApplication` in a follow-up after Play Store goes live.

### 2.5 Meta robots — accidental noindex check

Rendered HTML for every indexable page contains **no** `<meta name="robots">` tag (which is correct — absence means default `index, follow`). The only page with an explicit robots tag is `/feature-graphic`, which correctly emits `<meta name="robots" content="noindex, nofollow">` (`app/feature-graphic/page.tsx:32`).

No findings.

### 2.6 Canonical URLs

**Finding 2.6.a 🔴 CRITICAL — no `<link rel="canonical">` on any page.**
- Verified: zero canonical link tags in any of the four crawled HTML responses.
- Why it matters: with the apex/www split (5.1) plus `og:url` pointing at apex (1.5.a), Google has no authoritative signal as to which host owns each URL. A canonical tag closes the loop.
- Fix: in each page's `metadata`, set `alternates: { canonical: '/' }` (root) or `'/legal/privacy'` (etc.) — relative-rooted, Next.js builds the absolute URL from `metadataBase`. This must land **after** 5.1 (metadataBase fixed to `www`).

  Or, more cleanly, set canonical once in `layout.tsx` as `alternates: { canonical: './' }` (the trailing-slash form makes Next resolve per-route). Verify with curl after deploy.

---

## 3. Mobile SEO

### 3.1 Viewport

`<meta name="viewport" content="width=device-width, initial-scale=1">` is rendered on every page (Next.js 15 default — confirmed in raw HTML).

No findings.

### 3.2 Responsive layout

- Root marketing index uses inline width caps (`maxWidth: 720` on h1, `maxWidth: 560` on body para, `padding: '64px 24px'`) — flexible at 320px width.
- `LegalDoc` uses `.container { max-width: 720px; padding: 32px 24px }` with a `@media (min-width: 768px)` bump to 64/32 padding (`globals.css:79-87`).
- Body type is 15–16px; line-height 1.6–1.7. Comfortably above mobile-readability thresholds.

No findings.

### 3.3 Tap targets

The legal-page footer (`app/_components/legal-doc.tsx:100-148`) packs four inline links into a single `<p class="mono">` line at `font-size: 11px`. On a 320px screen these wrap to two lines but the link tap targets are tight: at 11px mono, "Privacy"/"Terms"/"Takedown"/"Delete account" are roughly 50–95 px wide × 19 px tall. Google's mobile-friendly threshold is 48×48 dp.

**Finding 3.3.a 🟡 MEDIUM — legal-page footer link tap targets are below 48dp.**
- Where: `app/_components/legal-doc.tsx:100-148` (also `app/page.tsx:75-123` and `app/account/delete/page.tsx:160-205` use the same pattern).
- Why it matters for SEO specifically: Google's mobile-usability signal flags "tap targets too close together"; pre-launch this is invisible, post-launch it accumulates as a CrUX/Search Console warning.
- Fix: bump the link text to ~13px or wrap each link in a block with vertical padding (e.g. `display: inline-block; padding: 10px 0`) so the tap rectangle is 40+ dp tall. Or stack the links on mobile via a `@media (max-width: 480px)` rule — flex column, 14px line-height each.

### 3.4 GoogleBot Mobile content parity

GoogleBot Mobile and Desktop see identical SSR-rendered HTML — no client-conditional rendering, no UA sniffing, no responsive content swaps. Verified by curling the same URL with two different UAs and diffing output (binary identical).

No findings.

### 3.5 320px legibility

Quick mental box-model at 320px: container padding 24+24 = 48; body content area = 272 px. Body type 15px Inter at line-height 1.65 wraps cleanly. h1 at 36px will have 7–8 chars per line for the shorter legal titles; serif at this size is the tightest constraint but still readable. No reflow issues anticipated.

No findings.

---

## 4. Site Architecture SEO

### 4.1 URL structure

Already reviewed (1.4). `/legal/*` nesting is intentional and worth keeping.

### 4.2 Crawl depth

From `/`:
- 1 hop → `/legal/privacy`, `/legal/terms`, `/legal/takedown`, `/account/delete` (footer of `app/page.tsx:87-122`)
- 1 hop → none (all 4 internal pages are direct children of root)

Every indexable page is reachable in ≤ 2 hops from root, well under the ≤ 3 standard. No orphaned pages.

No findings.

### 4.3 Internal linking topology

| From → To | Privacy | Terms | Takedown | Account/Delete | Root |
|---|---|---|---|---|---|
| `/` (footer) | ✓ | ✓ | ✓ | ✓ | — |
| `/legal/privacy` | — | ✓ (footer) | ✓ (footer) | ✓ (footer) | ✓ ("← The Cold File" nav) |
| `/legal/terms` | ✓ | — | ✓ | ✓ | ✓ |
| `/legal/takedown` | ✓ | ✓ | — | ✓ | ✓ |
| `/account/delete` | ✓ (footer) | ✓ | ✓ | — | ✓ |

Topology is fully connected. Every page links back to root. Every legal page cross-links to every other legal page plus `/account/delete`. No finding.

### 4.4 feature-graphic exclusion

**Finding 4.4.a 🟡 MEDIUM — `/feature-graphic` is `noindex`'d but not robots-disallowed.**
- Where: `app/feature-graphic/page.tsx:32` sets `robots: { index: false, follow: false }` correctly. Good.
- However: HTML-level `noindex` only stops indexing **after** the bot fetches the page. For a Play Store asset the page should ideally never be crawled at all.
- Fix: combine the existing HTML `noindex` with a `Disallow: /feature-graphic` line in the new `app/robots.ts` (see 2.1.a). Belt and suspenders. No code change to the page itself.

---

## 5. Indexation & Crawl Management

### 5.1 Canonical host

**Finding 5.1.a 🔴 CRITICAL — apex `coldfile.app` 307s to `www.coldfile.app`; metadata declares apex.**
- Verified: `curl -sI https://coldfile.app/` → `HTTP/2 307 Location: https://www.coldfile.app/`.
- `app/layout.tsx:44` sets `metadataBase: new URL('https://coldfile.app')`.
- `app/layout.tsx:50` sets `openGraph.url: 'https://coldfile.app'`.
- Why it matters:
  1. Next.js builds every relative metadata URL (OG image, canonical-when-added) against `metadataBase`. Currently they all resolve to apex.
  2. `307` is a temporary redirect. Google treats it as ambiguous regarding canonical host. `308` (permanent) is what you want for a host migration.
  3. Without an explicit canonical link tag (2.6), the only host signal Google has is `og:url` — which says apex — fighting the actual served host of `www`.
- Fix (in order):
  1. In Vercel project settings → Domains, mark `www.coldfile.app` as the **primary** domain and ensure the apex redirect is `308 Permanent` (Vercel does this automatically when you set the primary, but verify with `curl -sI https://coldfile.app/`).
  2. In `app/layout.tsx:44`, change `metadataBase` to `new URL('https://www.coldfile.app')`.
  3. In `app/layout.tsx:50`, drop the explicit `openGraph.url` — let Next derive it per-route from `metadataBase + pathname`.
  4. Add the canonical alternate per 2.6.a.

  Optional alternative: flip the primary host to apex (`coldfile.app`) — many brands prefer apex. Either choice is fine; what matters is that the metadata, the redirect, and the canonical tag all agree on **one** host.

### 5.2 Trailing-slash policy

Verified: `https://www.coldfile.app/legal/privacy/` → `HTTP/2 308 Location: /legal/privacy`. Vercel normalizes to non-trailing-slash, which matches Next.js's default and matches the URLs used in internal `<Link>` calls. Consistent.

No findings.

### 5.3 Custom 404

`/404-test-nonexistent` → `HTTP/2 404`, served with Next.js's default 404 markup ("This page could not be found.").

**Finding 5.3.a 🔵 LOW — no custom `app/not-found.tsx`.**
- Why it matters for SEO: the default Next 404 page returns the correct 404 status code (verified), so Google will not index it. The cost is purely brand — visitors who hit a typo'd URL see a generic page, not a case-file-styled one with a link back home.
- Fix: optional. Add `app/not-found.tsx` that renders the same footer/legal-link chrome with a serif "Case not found" heading and a link to `/`.

### 5.4 Redirects / rewrites in next.config.ts

`next.config.ts` defines no `redirects()` and no `rewrites()`. Only security headers are configured. No conflicts. Verified.

No findings.

### 5.5 Accidental noindex audit

Re-verified across all five indexable pages: none emit `<meta name="robots">`. Only `/feature-graphic` emits `noindex, nofollow`, which is correct.

No findings.

### 5.6 Duplicate content / parameters

No URL parameters on any indexable page. No printer-friendly variants. No A/B test forks. The five pages are five canonical surfaces.

No findings.

---

## Findings summary table

| # | Severity | Area | Finding | File |
|---|---|---|---|---|
| 5.1.a | 🔴 CRITICAL | Indexation | apex/www host mismatch + metadataBase points to apex | `app/layout.tsx:44,50` + Vercel domain config |
| 1.5.a | 🔴 CRITICAL | OG | `og:url` hardcodes apex on every page | `app/layout.tsx:50` |
| 2.6.a | 🔴 CRITICAL | Canonical | No `<link rel="canonical">` on any page | all `metadata` exports |
| 1.5.b | 🟠 HIGH | OG | Legal pages inherit homepage OG title/description | `app/legal/*/page.tsx`, `app/account/delete/page.tsx` |
| 1.7.a | 🟠 HIGH | Favicon | `favicon.ico` returns 404 | missing `app/icon.png` |
| 2.1.a | 🟠 HIGH | Crawlability | No `robots.txt` | missing `app/robots.ts` |
| 2.2.a | 🟠 HIGH | Crawlability | No `sitemap.xml` | missing `app/sitemap.ts` |
| 1.1.a | 🟡 MEDIUM | Title | Root title is brand-only ("The Cold File") | `app/layout.tsx:41` + `app/page.tsx` override |
| 1.5.c | 🟡 MEDIUM | OG | No `og:image`, no `og:site_name`, no `og:locale` | `app/layout.tsx:45-51` |
| 2.4.a | 🟡 MEDIUM | Schema | No JSON-LD `Organization` / `SoftwareApplication` | `app/layout.tsx` |
| 3.3.a | 🟡 MEDIUM | Mobile | Footer link tap targets <48dp | `app/_components/legal-doc.tsx:100-148`, `app/page.tsx:75-123` |
| 4.4.a | 🟡 MEDIUM | Architecture | `/feature-graphic` not robots-disallowed (only HTML-noindex) | will land with 2.1.a |
| 1.3.a | 🔵 LOW | Headings | Terms/Takedown have heading-less first sections | `app/legal/terms/page.tsx:16`, `app/legal/takedown/page.tsx:17` |
| 1.6.a | 🔵 LOW | Twitter | No `summary_large_image` card, no `twitter:image`, no handle | `app/layout.tsx` |
| 5.3.a | 🔵 LOW | 404 | No custom `app/not-found.tsx` | missing |

---

## "No findings" categories

- 1.2 Meta descriptions (all unique, sensible length)
- 1.4 URL structure (`/legal/*` is good)
- 1.8 charset / viewport / theme-color / lang
- 2.3 JS rendering (pure SSR)
- 2.5 No accidental noindex
- 3.1 Viewport meta
- 3.2 Responsive layout
- 3.4 GoogleBot Mobile content parity
- 3.5 320px legibility
- 4.2 Crawl depth
- 4.3 Internal linking topology
- 5.2 Trailing-slash policy
- 5.4 next.config.ts redirects/rewrites (none, no conflicts)
- 5.6 Duplicate content / URL parameters

---

## Recommended fix order

1. **Pick one canonical host** (apex or www). Lock the redirect to 308. Update `metadataBase`. Drop hardcoded `openGraph.url`. (5.1.a, 1.5.a)
2. **Add canonical alternates** at the layout level (2.6.a). Verify with curl.
3. **Land the four missing infrastructure files in one PR**: `app/robots.ts`, `app/sitemap.ts`, `app/icon.png`, `app/opengraph-image.tsx` (or `public/og.png`). (2.1.a, 2.2.a, 1.7.a, 1.5.c)
4. **Per-page OG metadata** on the four non-root pages. (1.5.b)
5. **Add JSON-LD `Organization`** to the layout. (2.4.a)
6. **Tap-target padding** on the footer link strip. (3.3.a)
7. Remaining 🔵 LOW items at leisure.

After 1–4 land, re-run a curl audit on all five indexable URLs to confirm the rendered head contains: title, description, `<meta name="robots">` absent (or correct), `<link rel="canonical">` present, `og:url` matching canonical, `og:image` resolving 200, `<link rel="icon">` resolving 200. Then submit `sitemap.xml` to Google Search Console once verification is set up.
