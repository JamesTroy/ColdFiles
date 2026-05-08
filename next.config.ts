/**
 * Next.js config for coldfile.app — the public web property.
 *
 * Static security headers applied to every response. Threat model:
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
 *   - Cross-origin window references (e.g., a popup or opener stealing
 *     `window.opener` to navigate the parent). COOP same-origin isolates
 *     the browsing context group.
 *   - Asset embedding by attackers (other sites loading our JSON / images
 *     as resources to fingerprint logged-in state). CORP same-origin
 *     blocks the cross-origin load.
 *
 * Content-Security-Policy is set from middleware.ts on a per-request
 * basis because it carries a fresh nonce. Don't add CSP here — it'd
 * be the static value, and the dynamic value from middleware would
 * win on every request anyway.
 *
 * No CSP `report-uri` wired in v1.0 — add post-launch when traffic
 * justifies a Sentry / Report-To endpoint.
 */

import type { NextConfig } from 'next';

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
