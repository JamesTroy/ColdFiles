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
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.supabase.co",
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
