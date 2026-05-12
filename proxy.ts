/**
 * CSP nonce proxy for coldfile.app.
 *
 * (Renamed from middleware.ts → proxy.ts during the Next 16 upgrade.
 * Next.js deprecated the `middleware` file convention in v16; `proxy.ts`
 * is the new name. The proxy runtime is always nodejs — edge is no longer
 * supported here. This file's logic is runtime-agnostic, so the runtime
 * change is a non-issue. See
 * https://nextjs.org/docs/app/guides/upgrading/version-16#middleware-to-proxy.)
 *
 * Mints a fresh per-request nonce, attaches it to the request headers
 * (so Server Components can read it via `next/headers` and pass it to
 * inline <script> tags they render), and writes a dynamic
 * Content-Security-Policy header on the response that names that
 * nonce.
 *
 * Why this exists: the static CSP in next.config.ts shipped
 * `script-src 'self' 'unsafe-inline'` because Next.js renders a
 * boot/runtime inline script. `'unsafe-inline'` defeats CSP's main
 * job — an injected `<script>alert(1)</script>` would execute despite
 * the CSP. Nonce + `'strict-dynamic'` lets only the framework's own
 * scripts (which Next.js auto-stamps with the request nonce when this
 * middleware sets the CSP header) and any descendant scripts they
 * load run, while blocking attacker-injected inline scripts.
 *
 * `'strict-dynamic'` makes `'self'` and `https:` source-list entries
 * be IGNORED in CSP Level 3 — by design, so a single XSS in a `'self'`
 * script can't pull in attacker-controlled JS by URL. The nonce is
 * the only way in.
 *
 * Skipped on prefetch responses (matcher below) — prefetches don't
 * render new content, and the cached non-prefetch response carries
 * the right CSP.
 */

import { NextResponse, type NextRequest } from 'next/server';

// 16 random bytes → base64. Nonces only need to be unique per
// response, but 128 bits of randomness eliminates any practical
// collision risk and matches OWASP guidance.
function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Pin Supabase project URL into connect-src here too — same rationale
// as next.config.ts:A1. Falls back to the wildcard when the env is
// missing (fresh-clone preview before vercel env pull) so middleware
// doesn't 500 on missing config.
function supabaseCspOrigin(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return 'https://*.supabase.co';
  try {
    return new URL(url).origin;
  } catch {
    return 'https://*.supabase.co';
  }
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' + nonce is the modern hardening mode.
    // 'unsafe-inline' stays as a fallback for browsers that don't
    // support strict-dynamic (CSP2-only, mostly older Safari) — those
    // browsers will accept the nonce too, so the practical effect is
    // strict-dynamic everywhere it's supported and nonced-only-inline
    // on the long tail.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`,
    // style-src keeps 'unsafe-inline' for Next.js SSR's atomic-style
    // injection — no realistic alternative on this Next.js version
    // and the XSS leverage from inline styles is much lower than
    // inline scripts.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${supabaseCspOrigin()}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Make the nonce visible to Server Components via next/headers().
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Setting CSP on the request headers is what cues Next.js's own
  // framework scripts to inherit the nonce (documented behavior in
  // /docs/app/building-your-application/configuring/content-security-policy).
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  // The actual response header the browser will enforce.
  response.headers.set('content-security-policy', csp);

  return response;
}

export const config = {
  matcher: [
    // Skip API routes, static assets, image optimizer, favicon, and
    // Next.js prefetch responses. Prefetches don't render fresh
    // content, so re-running middleware on them would mint a nonce
    // that no rendered HTML uses.
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
