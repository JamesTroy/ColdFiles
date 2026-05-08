// CORS helpers for browser-callable Edge Functions.
//
// Why this exists: tip-route-submit, takedown-submit, and reverse-geocode
// were originally shipping `access-control-allow-origin: '*'` to keep
// the mobile app working (RN fetches don't send a meaningful Origin and
// would be rejected by an origin-pinned ACAO). The wildcard means any
// website can replay a captured Bearer JWT from a victim's browser.
//
// Trade: echo the request's Origin only when it's in an allowlist; for
// requests with no Origin (mobile clients), return an empty string for
// ACAO so the browser CORS check is a no-op for that response. Mobile
// fetches don't enforce CORS anyway, so they continue to work; web
// callers from anywhere outside the allowlist get blocked by the
// browser before the response body is exposed to script.
//
// `access-control-allow-credentials` is INTENTIONALLY not set — these
// functions auth via Bearer JWT, not cookies, and combining a wildcard
// or echoed origin with credentials would let any site mount a CSRF
// against the function. Bearer auth + no-credentials = no CSRF surface.

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'https://coldfile.app',
  'https://www.coldfile.app',
]);

const ALLOWED_METHODS = 'POST, OPTIONS';
const ALLOWED_HEADERS =
  'authorization, x-client-info, content-type, apikey';
const PREFLIGHT_MAX_AGE_SECONDS = '86400'; // 24h — same as prior wildcard

/**
 * Resolve the value to send for `access-control-allow-origin`.
 *
 *   - Web caller in allowlist (e.g., coldfile.app)  → echo the Origin
 *   - Web caller outside allowlist                  → empty string
 *     (browser blocks the response in the CORS check)
 *   - Mobile caller (no Origin header)              → empty string
 *     (RN fetch ignores CORS, the empty value is harmless)
 *
 * Echoing the actual origin (vs. a static string) is required because a
 * browser will reject a response whose ACAO doesn't byte-match the request
 * Origin. Vary: Origin is also set so caches don't serve a wrong-origin
 * response from a previous request.
 */
function resolveAllowOrigin(req: Request): string {
  const origin = req.headers.get('origin');
  if (!origin) return '';
  return ALLOWED_ORIGINS.has(origin) ? origin : '';
}

/**
 * Headers to attach to every response (preflight + actual). Pair with
 * `Vary: Origin` so a CDN doesn't serve a cached response with the wrong
 * ACAO to a different origin.
 */
export function corsHeaders(req: Request): Record<string, string> {
  return {
    'access-control-allow-origin': resolveAllowOrigin(req),
    'access-control-allow-headers': ALLOWED_HEADERS,
    'vary': 'Origin',
  };
}

/**
 * Build the preflight (OPTIONS) response. Adds ACAM in addition to the
 * common headers since browsers only consult `access-control-allow-methods`
 * during preflight.
 */
export function preflightResponse(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(req),
      'access-control-allow-methods': ALLOWED_METHODS,
      'access-control-max-age': PREFLIGHT_MAX_AGE_SECONDS,
    },
  });
}
