import { describe, expect, it } from 'vitest';
import { corsHeaders, preflightResponse } from '../cors.ts';

// CORS allowlist conformance. Risk this guards against:
//   - Drift to a wildcard ACAO (the original bug we fixed) — the empty
//     string for unknown origins is what blocks cross-site replay.
//   - Adding `access-control-allow-credentials: true` later and not
//     realizing the combo with an echoed Origin opens CSRF — the test
//     for ACAC absence is the canary.
//   - Forgetting `Vary: Origin` and getting a CDN to serve a wrong-
//     origin response.

function makeReq(origin: string | null): Request {
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  return new Request('https://example.com/whatever', { method: 'POST', headers });
}

describe('corsHeaders', () => {
  it('echoes the Origin when allowlisted (apex)', () => {
    const h = corsHeaders(makeReq('https://coldfile.app'));
    expect(h['access-control-allow-origin']).toBe('https://coldfile.app');
  });

  it('echoes the Origin when allowlisted (www subdomain)', () => {
    const h = corsHeaders(makeReq('https://www.coldfile.app'));
    expect(h['access-control-allow-origin']).toBe('https://www.coldfile.app');
  });

  it('returns empty ACAO for an attacker origin', () => {
    const h = corsHeaders(makeReq('https://evil.example'));
    expect(h['access-control-allow-origin']).toBe('');
  });

  it('returns empty ACAO when Origin header is absent (mobile RN fetch)', () => {
    const h = corsHeaders(makeReq(null));
    expect(h['access-control-allow-origin']).toBe('');
  });

  it('returns empty ACAO for a near-miss subdomain', () => {
    // staging.coldfile.app is NOT in the allowlist. If it ever needs
    // access, it must be added explicitly to ALLOWED_ORIGINS, not echoed.
    const h = corsHeaders(makeReq('https://staging.coldfile.app'));
    expect(h['access-control-allow-origin']).toBe('');
  });

  it('always sets Vary: Origin so caches do not serve a wrong-origin response', () => {
    expect(corsHeaders(makeReq('https://coldfile.app'))['vary']).toBe('Origin');
    expect(corsHeaders(makeReq('https://evil.example'))['vary']).toBe('Origin');
    expect(corsHeaders(makeReq(null))['vary']).toBe('Origin');
  });

  it('does not set access-control-allow-credentials (Bearer auth, not cookies)', () => {
    // Combining echoed Origin + credentials would open CSRF. We auth via
    // Authorization: Bearer JWT, so credentials must stay off.
    const h = corsHeaders(makeReq('https://coldfile.app'));
    expect(h).not.toHaveProperty('access-control-allow-credentials');
  });
});

describe('preflightResponse', () => {
  it('returns 204', async () => {
    const res = preflightResponse(makeReq('https://coldfile.app'));
    expect(res.status).toBe(204);
  });

  it('echoes allowed Origin', async () => {
    const res = preflightResponse(makeReq('https://coldfile.app'));
    expect(res.headers.get('access-control-allow-origin')).toBe('https://coldfile.app');
  });

  it('returns empty ACAO for disallowed Origin', async () => {
    const res = preflightResponse(makeReq('https://evil.example'));
    expect(res.headers.get('access-control-allow-origin')).toBe('');
  });

  it('declares POST + OPTIONS as allowed methods', async () => {
    const res = preflightResponse(makeReq('https://coldfile.app'));
    const methods = res.headers.get('access-control-allow-methods') ?? '';
    expect(methods).toContain('POST');
    expect(methods).toContain('OPTIONS');
  });

  it('caches the preflight result for 24h', async () => {
    const res = preflightResponse(makeReq('https://coldfile.app'));
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  it('declares the headers Supabase clients send (authorization, apikey, etc.)', async () => {
    const res = preflightResponse(makeReq('https://coldfile.app'));
    const h = res.headers.get('access-control-allow-headers') ?? '';
    expect(h).toContain('authorization');
    expect(h).toContain('apikey');
    expect(h).toContain('content-type');
  });
});
