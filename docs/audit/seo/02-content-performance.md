# Content + Performance + Quick-Wins SEO Audit — coldfile.app

**Auditor:** Claude (Opus 4.7, 1M context)
**Date:** 2026-04-29
**Scope:** Next.js 15 App Router web property at `/Users/jtroy/Desktop/ColdFiles`, deployed to Vercel at https://coldfile.app (apex 307→www).
**Stage:** Pre-launch / closed-testing only.
**Pages audited:** `/`, `/legal/privacy`, `/legal/terms`, `/legal/takedown`, `/account/delete`, `/feature-graphic`.

Severity legend: 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · 🔵 LOW.

---

## Executive Summary

The site is small, fast, and structurally honest — five static pages, security-headers-by-default, font-display:swap, no third-party scripts, all rendered HTML matches the source. There are no rendering or performance liabilities to chase. **The findings are almost entirely "missing files at the root of the public/ directory"** (which doesn't exist), plus **two structural choices that are bleeding link equity from day one**: the apex→www 307 redirect with no canonical to reconcile it, and the OG URL pointing at the wrong host (`coldfile.app` while the canonical host is `www.coldfile.app`).

Trust posture is strong on the legal pages (Matte Black Dev LLC named, contact emails for every concern, "Last updated" dates, ~2,300 words on Privacy). Trust posture is **weak on the marketing index** — the entity is named only in 11px footer mono-cap; there is no About copy, no E-E-A-T-bearing prose, and the page is ~30 visible words. For a YMYL-adjacent cold-case product this is the main content-side risk.

No JSON-LD, no `robots.txt`, no `sitemap.xml`, no favicon, no apple-touch-icon, no manifest, no canonical link, no OG image. None of these are blocking for closed testing; all are 5–30-minute fixes.

**See findings 1–5 below for the full breakdown** and a bundled "30-minute quick wins" checklist at the bottom.

---

## 1. Ranking Factors (E-E-A-T for a YMYL-adjacent product)

Cold-case content is **YMYL-adjacent** (sensitive subject matter, family/victim impact, public safety). Google's quality raters weight Experience-Expertise-Authoritativeness-Trustworthiness more heavily here than for a generic SaaS marketing site.

### Findings

#### 🟠 HIGH — Marketing index does not name the publishing entity in body content
- **File:** `/Users/jtroy/Desktop/ColdFiles/app/page.tsx:85`
- **What:** "MATTE BLACK DEV LLC · VENTURA, CA" appears only in the 11px mono-cap footer. The hero, sub-headline, and body copy never mention the operator. Compare the legal pages where "Matte Black Dev LLC" appears in prose ("operated by Matte Black Dev LLC, a California limited liability company").
- **Why it matters:** Google's E-E-A-T evaluation for sensitive verticals checks whether the publisher is identifiable from the visible content, not just from a small-print footer. For a product that handles tips routed to law enforcement, ambiguous publisher identity is a trust drag.
- **Fix:** Add a 1–2 sentence paragraph after the existing "Tips routed to..." line: *"The Cold File is built by Matte Black Dev LLC, an independent studio in Ventura, California. We are not affiliated with any law enforcement agency."* This single sentence does triple duty — entity disclosure, non-affiliation disclaimer (matches the Terms language), and content depth on a thin page.

#### 🟠 HIGH — No author / About / contact-info presence on the marketing index
- **File:** `/Users/jtroy/Desktop/ColdFiles/app/page.tsx`
- **What:** The marketing index has no contact email visible (the footer links to legal pages where the email appears, but the index itself has no `mailto:` or address). For YMYL-adjacent content, having `support@coldfile.app` (or `privacy@`) reachable in one click from the marketing page is a cheap E-E-A-T signal.
- **Fix:** Add a single line under the entity sentence: *"Questions: support@coldfile.app · Takedown requests: takedown@coldfile.app"* (mono caption, evidence-chrome color — matches the existing aesthetic).

#### 🟡 MEDIUM — No "About" or "How it works" page; legal pages alone carry the trust load
- **What:** A typical YMYL-adjacent site has at least one prose page that explains *what* the product is, *who* runs it, and *what data sources back it* — separate from the legal text. Currently that work is being done partially by the privacy policy's "Where case information comes from" section.
- **Fix (post-launch, not blocking):** Add `/about` page with: founding context, why the app exists, how case information is sourced, the "tips never pass through us" architecture, and the takedown/correction posture. Reuses content already written in the privacy policy. This is the page that should rank for "what is the cold file app" branded queries.

#### 🟢 GOOD — HTTPS verified
- HSTS preload is set, HTTPS upgrade is enforced, security headers (X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy) confirmed live via `curl -I`. Trustworthiness baseline is met.

#### 🟢 GOOD — Legal pages carry contact info and "Last updated" dates
- All four legal pages display a `Last updated · YYYY-MM-DD` line and an entity-named contact section. Google's quality raters treat dated, contact-attributed legal pages as a positive trust signal.

---

## 2. SEO Quick Wins (do-these-in-30-minutes list)

These are today-actionable, file-line-specific changes. Bundle them into a single PR.

### 🔴 CRITICAL — `og:url` points to the wrong canonical host
- **File:** `/Users/jtroy/Desktop/ColdFiles/app/layout.tsx:50`
- **What:** `metadataBase: new URL('https://coldfile.app')` and `openGraph.url: 'https://coldfile.app'`. But the apex domain 307-redirects to `https://www.coldfile.app/` (verified via `curl -sI`). So when a social platform unfurls a share, Open Graph claims the canonical URL is the apex while the actual served URL is www. Different hosts in the cache layer = potential dedupe miss + a small but real signal-fragmentation risk for link equity.
- **Fix:** Either (a) change the redirect direction so www→apex (Vercel project settings), or (b) update `metadataBase` to `https://www.coldfile.app` and `openGraph.url` to `'https://www.coldfile.app'`. **Recommended: (a)** — apex is shorter, the brand is two short syllables, and most modern sites canonicalize to apex. Update the Vercel domain config so `coldfile.app` is primary and `www.coldfile.app` redirects to it.

### 🔴 CRITICAL — No `canonical` link tag anywhere
- **File:** `/Users/jtroy/Desktop/ColdFiles/app/layout.tsx` (root `metadata`) and each page's local `metadata`
- **What:** Verified via `curl` — no `<link rel="canonical">` is emitted on `/` or `/legal/privacy`. With the apex/www split (above) this is the difference between Google deduping correctly and Google indexing both hosts independently.
- **Fix:** Add `alternates: { canonical: '/' }` to the root layout metadata, and `alternates: { canonical: '/legal/privacy' }` (and equivalents) to each page's metadata block. Next.js will resolve them against `metadataBase` automatically.

### 🟠 HIGH — Missing `robots.txt`
- **What:** `https://www.coldfile.app/robots.txt` returns 404 (verified). Search engines treat absent robots.txt as "crawl everything", which is fine functionally — but **the `/feature-graphic` route is a Play Store asset, not content.** It is correctly `noindex`-ed via metadata (line 32 of `app/feature-graphic/page.tsx`), but a robots.txt entry is belt-and-suspenders.
- **Fix:** Create `/Users/jtroy/Desktop/ColdFiles/app/robots.ts`:
  ```ts
  import type { MetadataRoute } from 'next';
  export default function robots(): MetadataRoute.Robots {
    return {
      rules: [{ userAgent: '*', allow: '/', disallow: ['/feature-graphic', '/api'] }],
      sitemap: 'https://coldfile.app/sitemap.xml',
    };
  }
  ```

### 🟠 HIGH — Missing `sitemap.xml`
- **What:** 404 (verified). Five static pages, all stable URLs — sitemap is trivial.
- **Fix:** Create `/Users/jtroy/Desktop/ColdFiles/app/sitemap.ts`:
  ```ts
  import type { MetadataRoute } from 'next';
  export default function sitemap(): MetadataRoute.Sitemap {
    const base = 'https://coldfile.app';
    const lastModified = new Date('2026-04-29');
    return [
      { url: `${base}/`,                priority: 1.0, lastModified },
      { url: `${base}/legal/privacy`,   priority: 0.6, lastModified },
      { url: `${base}/legal/terms`,     priority: 0.6, lastModified: new Date('2026-04-28') },
      { url: `${base}/legal/takedown`,  priority: 0.6, lastModified: new Date('2026-04-28') },
      { url: `${base}/account/delete`,  priority: 0.4, lastModified },
    ];
  }
  ```

### 🟠 HIGH — No favicon, no apple-touch-icon, no manifest
- **What:** All three return 404 (verified). Browsers show a generic globe in the tab; Google search results show no site icon next to the result; iOS "Add to Home Screen" gets a screenshot fallback instead of a real icon.
- **Fix (Next.js 15 file-based icons):** Drop these files into `/Users/jtroy/Desktop/ColdFiles/app/`:
  - `icon.svg` or `icon.png` (32×32 or larger) — Next.js auto-emits `<link rel="icon">`
  - `apple-icon.png` (180×180) — Next.js auto-emits `<link rel="apple-touch-icon">`
  - `manifest.ts` returning a `MetadataRoute.Manifest` — sets `name: 'The Cold File'`, `short_name: 'Cold File'`, `theme_color: '#0a0a0a'`, `background_color: '#0a0a0a'`, `display: 'standalone'`, with a 192 and 512 icon entry pointing at `/icon.png` variants.

  The mobile app already has icon assets at `/Users/jtroy/Desktop/ColdFiles/mobile/dist/favicon.ico` — reuse the brand mark from the Play Store feature graphic (the wordmark + corner brackets) as a silhouette icon at 512px, downsample for the others.

### 🟠 HIGH — No Open Graph image
- **File:** `/Users/jtroy/Desktop/ColdFiles/app/layout.tsx:45-51`
- **What:** OG block exists but has no `images` field. Twitter card is `summary` (small image) — without an `og:image` it falls back to a blank tile. This is the single most visible regression on shared links to coldfile.app.
- **Fix:** The Play Store feature graphic page (`app/feature-graphic/page.tsx`) is essentially already the OG asset at 1024×500. Either:
  - **(a) Static export:** capture the feature-graphic render once as `/Users/jtroy/Desktop/ColdFiles/app/opengraph-image.png` (Next.js 15 file-based OG image, auto-emits the meta tags), OR
  - **(b) Dynamic OG:** convert `feature-graphic/page.tsx` to a `app/opengraph-image.tsx` using `next/og`'s `ImageResponse` so the asset re-renders on font/copy changes. **(b) is cleaner** but **(a) ships in 5 minutes** with the screenshot the developer is already capturing for Play Store. Also bump Twitter card to `summary_large_image` once an OG image exists.

### 🟡 MEDIUM — Missing structured-data publisher block
- See section 4 below.

### 🟡 MEDIUM — `/feature-graphic` route is publicly browsable but its `noindex` is metadata-only
- **File:** `/Users/jtroy/Desktop/ColdFiles/app/feature-graphic/page.tsx:32`
- **What:** `robots: { index: false, follow: false }` is set, which is correct. But the page is also reachable by anyone who guesses the URL, and it deliberately renders 1024×500 of brand asset. After Play Store submission and screenshot capture, this route should arguably be deleted from production, or moved behind a non-production environment.
- **Fix (post-launch):** Remove the route after the asset is captured and uploaded to Play Console. Keep the source in a feature-graphics archive folder.

---

## 3. Core Web Vitals SEO

The site is static text + Google Fonts via `next/font`. There are no images, no third-party scripts, no client-side data fetching. Vercel's edge serves it pre-rendered (verified: `x-nextjs-prerender: 1`, `x-vercel-cache: HIT`).

### Findings

#### 🟢 GOOD — LCP fundamentals are clean
- LCP candidate is the H1 serif heading "Discover unsolved cases near you." rendered in Newsreader 500 at 56px. Verified live HTML: the serif font woff2 is `<link rel="preload" ... as="font" crossorigin>` — Next.js 15 next/font handles this automatically. No render-blocking external CSS, no third-party JS in the head, no hero image to wait for.
- **No action needed.**

#### 🟢 GOOD — `font-display: swap` confirmed
- All three fonts in `app/layout.tsx:19-38` declare `display: 'swap'` explicitly. The Newsreader serif will swap from system-serif fallback when ready, avoiding FOIT. This is the right call for the case-file aesthetic — system serifs (Georgia, Times) are close enough that the swap won't be visually jarring.

#### 🟡 MEDIUM — CLS risk: serif swap shifts the H1 baseline
- **File:** `/Users/jtroy/Desktop/ColdFiles/app/page.tsx:38-48`
- **What:** Newsreader and Georgia have noticeably different x-height and cap-height. When the swap fires (typically 100–300ms post-LCP on first visit), the 56px H1 reflows by a few pixels, contributing to CLS.
- **Why it's only MEDIUM:** Next.js 15 `next/font` ships an automatic size-adjust fallback (`size-adjust`, `ascent-override`, `descent-override`) which is verified present in the rendered HTML (`<meta name="next-size-adjust">`). This drops the shift from "visible" to "subpixel."
- **Fix (optional):** No code change required. If Vercel Speed Insights post-launch shows CLS > 0.1, revisit by hard-coding `fallback: ['Georgia', 'serif']` and `adjustFontFallback: true` (the latter is the default).

#### 🟢 GOOD — INP is a non-issue for v1.0
- The pages have zero interactivity beyond `<a href>` links. No client components, no hydration cost, no event handlers. Verified: only one `next/link` per page. INP will be ~0ms across all pages.

#### 🟡 MEDIUM — `mailto:` links on `/account/delete` are fine but should preconnect to Google Fonts
- **What:** Three Google Fonts are loaded from `fonts.gstatic.com`. The CSP `font-src` allows it (line 46 of `next.config.ts`), and `next/font` preloads the woff2 files directly — so a `<link rel="preconnect" href="https://fonts.gstatic.com">` is **redundant** in this setup. **Skip this fix** unless `next/font` behavior changes.

#### 🔵 LOW — Speed Insights not wired
- **What:** Vercel Speed Insights would auto-emit a tiny client-side beacon to surface real-user CWV in the Vercel dashboard. Not strictly necessary; useful post-launch for trend detection. To add: install `@vercel/speed-insights/next` and import `<SpeedInsights />` once in `layout.tsx`.

---

## 4. Structured Data SEO (Schema.org / JSON-LD)

Verified via `curl` — **no `application/ld+json` script blocks** anywhere on `/` or `/legal/privacy`. This is not blocking for ranking but it is the cheapest path to rich-result eligibility once the app launches.

### Findings

#### 🟡 MEDIUM — Add `Organization` JSON-LD to root layout
- **File:** `/Users/jtroy/Desktop/ColdFiles/app/layout.tsx`
- **What to add (in `<body>` before `{children}`, or via metadata `other` field):**
  ```tsx
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{
      __html: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Matte Black Dev LLC',
        url: 'https://coldfile.app',
        email: 'support@coldfile.app',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Ventura',
          addressRegion: 'CA',
          addressCountry: 'US',
        },
      }),
    }}
  />
  ```
- **Why MEDIUM not HIGH:** Google extracts Organization signal from prose and footer text already; the JSON-LD just makes it explicit. Closed-testing audience won't see a difference.

#### 🟡 MEDIUM — Add `MobileApplication` JSON-LD on the marketing index (post-launch)
- **File:** `/Users/jtroy/Desktop/ColdFiles/app/page.tsx`
- **What to add (once Play Store URL is live):**
  ```ts
  {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    name: 'The Cold File',
    operatingSystem: 'ANDROID, IOS',
    applicationCategory: 'ReferenceApplication',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: 'Matte Black Dev LLC' },
    // aggregateRating: add once 5+ reviews exist
  }
  ```
- **Why:** Eligibility for the App rich result in Google search — the card with star rating and "Get on Google Play" link.

#### 🔵 LOW — `WebPage` JSON-LD on legal pages
- **What:** Each legal page could carry a minimal `WebPage` block with `lastReviewed`, `author`, `publisher`. Modest signal; only worth doing if the legal pages are getting linked externally (regulator inquiries, security disclosures). Skip for v1.0.

---

## 5. Content SEO Audit

### Marketing index (`/`)

#### 🟠 HIGH — Index page is thin (≈30 visible words)
- **File:** `/Users/jtroy/Desktop/ColdFiles/app/page.tsx:32-66`
- **What:** Visible body text:
  - "THE COLD FILE" (eyebrow)
  - "Discover unsolved cases near you." (H1, 5 words)
  - "Tips routed to the agencies that own them — never held by us." (subhead, 12 words)
  - "Coming soon to Play Store + App Store" (8 words)
  - Footer attribution + 4 link labels
  - **Total: ~35 words.**
- **Why it matters:** Google's quality raters and the `Helpful Content System` flag thin marketing pages. For a YMYL-adjacent vertical this risk is amplified.
- **Fix — recommended option (a): Add a "What this is / What this isn't" block.** Mirror the framing already in the privacy policy. Suggested copy (drops in below the "Coming soon" line, ~140 words, takes the page from ~35 to ~175 words):

  > **What it is.** A map-first directory of unsolved cold cases — homicides, missing persons, unidentified persons — aggregated from public records (NamUs, the Charley Project, the Doe Network, Project: Cold Case, and law-enforcement agencies that publish unsolved cases on their public sites). Every case links back to its source.
  >
  > **What it isn't.** We don't investigate cases. We don't store the content of your tips — when you submit one, you leave the app and route directly to the agency that owns the case. We aren't affiliated with any law-enforcement agency.
  >
  > **Who runs it.** The Cold File is built by Matte Black Dev LLC, an independent studio in Ventura, California. Questions: support@coldfile.app · Takedown requests: takedown@coldfile.app.

- **Fix — alternative option (b): noindex the root** until marketing is fully written. Add `robots: { index: false, follow: true }` to `app/layout.tsx` metadata, then drop it once option (a) ships. **Use only if option (a) cannot be written before launch** — closed testing has no public users so the urgency is low; but Google may still discover the URL via Vercel preview indexing or linked-from-Play-Store traffic.

#### 🟢 GOOD — Tagline has natural keyword density
- "Unsolved cases" + "near you" + "Tips routed" hit the most-likely branded and unbranded queries without keyword-stuffing. Don't change the existing copy when adding the new block — append, don't rewrite.

### Legal pages

#### 🟢 GOOD — Privacy policy is substantive (~2,300 words, 19 sections)
- File: `app/legal/privacy/page.tsx`. Sections: plain-language summary, who we are, location, account info, crash data, what we don't collect, tips, sources, photos, takedown, children, service providers, retention, rights, California, EEA/UK, security, changes, contact. Far above any "thin content" threshold.

#### 🟡 MEDIUM — Terms of Service is borderline thin (~440 words, 9 sections)
- File: `app/legal/terms/page.tsx`. Substantively complete (acceptable use, no warranty, limitation of liability, governing law) but each section is one short paragraph. 300 words is the typical "not thin" floor; this clears it but barely.
- **Fix (optional, low priority):** Expand "Acceptable use" with examples; expand "Limitation of liability" with the specific damage classes excluded (which is already permitted under CA law). Or accept as-is — terms pages typically rank for branded queries only and Google doesn't penalize concise legal copy.

#### 🟢 GOOD — Takedown page is right-sized (~360 words, 6 sections)
- File: `app/legal/takedown/page.tsx`. Clear "what we honor / how to request / what happens after / bad-faith requests" structure. Above the thin-content floor; no fix needed.

#### 🟢 GOOD — Account-deletion page (~290 words) is fit-for-purpose
- File: `app/account/delete/page.tsx`. Slightly under 300 words but Google does not apply the thin-content heuristic to functional / utility pages (deletion forms, settings UIs). The "What gets deleted" + "How to request by email" structure is exactly what Google Play policy wants to see, with a `mailto:` quick-action CTA. No fix needed.

---

## 30-Minute Quick-Wins Bundle

Numbered for sequential execution. Estimate: 25–35 minutes total.

1. **Pick one canonical host (apex or www).** Configure Vercel: in Project Settings → Domains, set `coldfile.app` as Primary, mark `www.coldfile.app` as redirect-to-primary. *(file: Vercel dashboard, not in repo)* — **2 min**
2. **Add canonical URL via metadata.** In `/Users/jtroy/Desktop/ColdFiles/app/layout.tsx:40-52`, add `alternates: { canonical: '/' }`. Add the same to each page's local metadata block (`app/legal/privacy/page.tsx:5-9`, `terms`, `takedown`, `account/delete`). — **5 min**
3. **Create `app/robots.ts`** as shown in finding 2 → "Missing robots.txt" above. — **2 min**
4. **Create `app/sitemap.ts`** as shown in finding 2 → "Missing sitemap.xml" above. — **3 min**
5. **Add favicon + apple-icon + manifest.** Drop `app/icon.png` (512×512), `app/apple-icon.png` (180×180), and `app/manifest.ts` returning `MetadataRoute.Manifest`. — **10 min** (longest because requires asset generation)
6. **Add `opengraph-image.png` to `app/`** by capturing the existing `/feature-graphic` render. Bump Twitter card to `summary_large_image` in `app/layout.tsx`. — **5 min**
7. **Add the publisher paragraph and contact line to `app/page.tsx`** between line 65 and line 66 (after "Coming soon to..." and before `</main>`) — see finding 5, option (a). — **5 min**

**After this bundle, the only meaningful items remaining are:**
- Organization JSON-LD (medium, 5 min)
- MobileApplication JSON-LD with Play Store URL (medium, after launch)
- About page (medium, post-launch)
- Speed Insights wiring (low, post-launch)

---

## "No Findings" Categories

- **Performance** — site is functionally CWV-perfect for v1.0; only fix worth tracking is the serif swap CLS, which next/font's size-adjust already mitigates.
- **Mobile usability** — single-column flex layout, viewport meta correct, no horizontal scroll, fonts scale legibly. Not separately evaluated.
- **Accessibility (SEO-impact)** — H1 present and unique on every page, semantic landmarks (`<main>`, `<footer>`, `<nav>`, `<header>`, `<section>`) used correctly throughout. No images means no alt-text gaps.

---

## File:Line Reference Map

| Finding | File | Line(s) |
|---|---|---|
| Marketing thin content / no entity prose | `app/page.tsx` | 32–66 |
| Wrong OG host | `app/layout.tsx` | 44, 50 |
| No canonical | `app/layout.tsx` | 40–52 (root) + each page's local `metadata` |
| Twitter card too small | `app/layout.tsx` | (no current tag — emitted as default `summary`) |
| No robots/sitemap | (does not exist) | create `app/robots.ts`, `app/sitemap.ts` |
| No favicon/manifest/apple-icon | (does not exist) | create `app/icon.png`, `app/apple-icon.png`, `app/manifest.ts` |
| No JSON-LD | `app/layout.tsx`, `app/page.tsx` | add `<script type="application/ld+json">` |
| Serif swap CLS (mitigated) | `app/layout.tsx` | 19–24 (Newsreader config) |
| Feature-graphic noindex | `app/feature-graphic/page.tsx` | 32 |
| Privacy policy length | `app/legal/privacy/page.tsx` | (whole file, ~2,300 words) |
| Terms borderline thin | `app/legal/terms/page.tsx` | (whole file, ~440 words) |

---

*End of audit. Severity-stratified findings: 2 CRITICAL, 5 HIGH, 6 MEDIUM, 2 LOW.*
