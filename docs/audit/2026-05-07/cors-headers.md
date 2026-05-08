# CORS & Headers Audit — 2026-05-07

Follow-on to the six-audit pre-submission set. Scoped to: Next.js
security headers, Edge Function CORS, cookie posture.

## Headline

Web property's header set was already strong — six headers + a
threat-model docstring. Three refinements applied. Edge Function CORS
was wildcard `*`, defensible for mobile-only callers but tightened
to an Origin-echo allowlist. Cookies are a non-issue (no `Set-Cookie`
in source).

## Findings & remediation status

### A1 — CSP `connect-src` pinned to production Supabase (Medium → Fixed)

**Was:** [next.config.ts:47](../../../next.config.ts#L47) allowed
`https://*.supabase.co` — any project on the Supabase platform.

**Risk:** A successful XSS could exfiltrate to an attacker-controlled
Supabase project hosted under the same wildcard.

**Fix:** Read `NEXT_PUBLIC_SUPABASE_URL` at build time, extract the
origin via `new URL(...).origin`, inject into CSP. Falls back to the
wildcard when the env is missing (fresh-clone / preview builds before
`vercel env pull`) so build doesn't 502.

### A2 — `script-src 'unsafe-inline'` (Medium → Fixed in feat/csp-nonce-middleware)

**Was:** [next.config.ts](../../../next.config.ts) shipped
`script-src 'self' 'unsafe-inline'`. The static CSP couldn't carry a
per-request nonce, so inline scripts (the JSON-LD organization block,
Next.js's runtime boot script) needed `'unsafe-inline'` to load —
which defangs CSP's main XSS protection (an injected
`<script>alert(1)</script>` would execute despite the CSP).

**Fix:** New [middleware.ts](../../../middleware.ts) mints a
per-request 16-byte base64 nonce, attaches it to the request headers
as `x-nonce` (so Server Components can read it via `next/headers()`),
and writes a dynamic `Content-Security-Policy` header on the response
naming that nonce. CSP value:

```
script-src 'self' 'nonce-{NONCE}' 'strict-dynamic' 'unsafe-inline'
```

`'strict-dynamic'` is the modern hardening directive — in CSP3
browsers, `'self'` and `https:` source-list entries are IGNORED, so
the only way for a script to load is to carry the nonce or be loaded
by an already-trusted nonced script. `'unsafe-inline'` is left as
a CSP2-fallback for older Safari that doesn't recognize
`'strict-dynamic'`; CSP3-aware browsers ignore `'unsafe-inline'`
when a nonce is present, so the practical effect is nonce-only on
modern browsers.

[app/layout.tsx](../../../app/layout.tsx) reads the nonce via
`(await headers()).get('x-nonce')` and stamps it on its inline
JSON-LD `<script>`. Next.js framework scripts (the runtime boot, RSC
chunks) get the nonce automatically because middleware sets the CSP
on the request — Next.js's documented behavior.

**Trade:** the legal pages (`/legal/privacy`, `/legal/takedown`,
`/legal/terms`) move from static prerender (`○`) to dynamic
server-rendered (`ƒ`) because `headers()` is a dynamic API. For a
low-traffic legal property, the security win (real XSS defense vs.
defanged CSP) outweighs the per-request render cost on Vercel's
Fluid Compute. If traffic ever justifies static prerender, the
JSON-LD nonce can be removed and a Subresource-Integrity hash
allowlist can replace it — but that's premature today.

**Skipped on prefetches** via the middleware matcher's `missing`
clause — prefetch responses don't render fresh content, and the
cached non-prefetch response carries the right CSP.

### A3 — COOP + CORP headers added (Low → Fixed)

**Was:** No cross-origin isolation headers.

**Fix:** Added [next.config.ts:62-66](../../../next.config.ts#L62-L66):
- `Cross-Origin-Opener-Policy: same-origin` — isolates the top-level
  browsing context group from cross-origin documents holding a
  `window` reference (legacy `window.opener` attacks from
  attacker-opened popups).
- `Cross-Origin-Resource-Policy: same-origin` — blocks other origins
  from loading our pages/JSON as resources, defends against
  side-channel fingerprinting of logged-in state.
- COEP intentionally NOT added — it requires every embedded resource
  to send CORP, which would break Google Fonts.

### A4 — CSP report-uri (Low → Filed for later)

**Status:** Already noted in the next.config.ts docstring as
"add post-launch when traffic justifies a Sentry / Report-To
endpoint." No action this PR.

### B1 — Edge Function CORS tightened (Medium → Fixed)

**Was:** [tip-route-submit/index.ts:233-240](../../../supabase/functions/tip-route-submit/index.ts),
[takedown-submit/index.ts:474-481](../../../supabase/functions/takedown-submit/index.ts),
[reverse-geocode/index.ts:201-208](../../../supabase/functions/reverse-geocode/index.ts)
all set `access-control-allow-origin: '*'`.

**Risk profile (why it wasn't catastrophic):**
- These functions auth via `Authorization: Bearer <JWT>`, not
  cookies. `access-control-allow-credentials` was never set — without
  it, the wildcard can't be combined for CSRF.
- Mobile RN fetches don't enforce CORS, so the wildcard wasn't
  required for the mobile path.

**Risk that justified the fix:**
- A user with a captured JWT (from a separate XSS, console paste,
  malicious extension) could have it replayed by any browser-origin.
- Future web flows (the `coldfile.app` legal property is already live
  — easy to add a tip submission form there) would have inherited the
  wildcard.

**Fix:** New shared module
[supabase/functions/_shared/cors.ts](../../../supabase/functions/_shared/cors.ts):
- Allowlist: `https://coldfile.app`, `https://www.coldfile.app`.
- `corsHeaders(req)` echoes the request `Origin` only when in the
  allowlist; returns empty string otherwise (browsers reject the
  response in the CORS check; mobile fetches ignore CORS regardless).
- `Vary: Origin` on every response so a caching layer can't serve a
  wrong-origin response.
- `preflightResponse(req)` builds the OPTIONS response.

Three Edge Functions migrated to per-request closure pattern: response
helpers (`json`/`ok`/`err400`/`errField`/`rateLimited`) live inside
the `Deno.serve` handler so they read the resolved `cors` from outer
closure scope. Avoids threading `req` through every call site.

### B2 — Cron/server-only functions intentionally have no CORS (Info)

`notify-fanout`, `photo-cache`, `geocode-pending`, `ingest-source`,
`ingest-tick` are cron-driven or function-to-function — no CORS
handlers because they should never be browser-callable. Confirmed
correct posture; no change.

### C1 — Cookies (Info)

Zero `Set-Cookie` writes in source (web app + Edge Functions). Auth
lives on mobile via `expo-secure-store` (post-Wave-1A); web property
is static legal/landing. Vercel adds platform cookies (preview
comments, analytics) — out of scope, follow Vercel defaults.

If a web sign-in flow ever ships: HttpOnly + Secure + SameSite=Lax
(or Strict for non-OAuth), refresh in HttpOnly cookie + JWT in memory.

## Verification

- `npm run typecheck` — clean
- `npm test` — 361/361 vitest tests pass
- Manual CSP inspection: pinned Supabase origin, added COOP/CORP
  visible in next.config.ts headers list
- Edge Functions: shared cors.ts with allowlist + Origin-echo
  applied to three browser-callable functions

## Future work (not in this PR)

1. **A2 nonce-based CSP** — `feat/csp-nonce-middleware`.
   Highest-value remaining XSS defense.
2. **A4 CSP report-uri** — when traffic justifies a reporting
   endpoint (Sentry or a small Edge Function tee'd to a database
   table).
3. **Allowlist drift watch** — if a marketing/preview subdomain like
   `staging.coldfile.app` ever needs to call the Edge Functions,
   extend `ALLOWED_ORIGINS` in cors.ts. The constant is the canonical
   source of truth; don't echo arbitrary origins.
