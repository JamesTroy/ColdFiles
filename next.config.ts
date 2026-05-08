/**
 * Next.js config for coldfile.app — the public web property.
 *
 * Security headers applied to every response. Threat model:
 *   - Clickjacking on /account/delete (an attacker iframes the deletion
 *     page and tricks a signed-in user into confirming). X-Frame-Options
 *     DENY closes that.
 *   - MIME sniffing on user-controlled responses (none in v1.0, but
 *     defense-in-depth). X-Content-Type-Options nosniff.
 *   - Referrer leakage to outbound links from legal pages. strict-origin-
 *     when-cross-origin keeps the path opaque.
 *   - Permissions creep (camera, microphone, geolocation, USB, etc.). The
 *     web property uses none of these; deny by default.
 *   - Mixed-content downgrades. HSTS preloads HTTPS for two years.
 *   - Inline-script XSS. CSP allows self + Vercel's inline boot script
 *     hashes (Next.js writes a small inline runtime); deny everything else
 *     by default. `unsafe-inline` for style-src is required by Next.js
 *     SSR's atomic styles, no realistic alternative on this version.
 *   - Cross-origin window references (e.g., a popup or opener stealing
 *     `window.opener` to navigate the parent). COOP same-origin isolates
 *     the browsing context group.
 *   - Asset embedding by attackers (other sites loading our JSON / images
 *     as resources to fingerprint logged-in state). CORP same-origin
 *     blocks the cross-origin load.
 *
 * No CSP `report-uri` wired in v1.0 — add post-launch when traffic
 * justifies a Sentry / Report-To endpoint.
 */

import type { NextConfig } from 'next';

// Pin the CSP `connect-src` to the production Supabase project URL rather
// than `https://*.supabase.co` — a wildcard would let an XSS exfiltrate to
// any Supabase project on the platform. The URL is read at build time;
// builds without the env (rare — only fresh clones before `vercel env pull`)
// degrade to the wildcard so Vercel preview deployments don't 502 on missing
// config.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_CSP_ORIGIN = (() => {
  if (!SUPABASE_URL) return 'https://*.supabase.co';
  try {
    return new URL(SUPABASE_URL).origin;
  } catch {
    return 'https://*.supabase.co';
  }
})();

const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // Cross-Origin-Opener-Policy: same-origin isolates this top-level browsing
  // context from cross-origin documents that try to obtain a `window`
  // reference (e.g., legacy `window.opener` attacks from an attacker-opened
  // popup). Skipping COEP — it requires every embedded resource to send
  // CORP, which would break Google Fonts on this property.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Cross-Origin-Resource-Policy: same-origin prevents other origins from
  // loading our pages/JSON as resources (script, img, fetch) — defends
  // against side-channel fingerprinting of logged-in state.
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      `connect-src 'self' ${SUPABASE_CSP_ORIGIN}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
];

const config: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default config;
