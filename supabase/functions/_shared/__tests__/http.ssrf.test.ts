import { describe, expect, it } from 'vitest';
import { assertSafeUrl, parseRobots, isAllowed, HttpError } from '../http.ts';

// SSRF guard. The scrape pipeline downloads bytes from third-party URLs and
// writes them into the publicly-readable `case-media` bucket. A poisoned
// source row that aimed the crawler at internal addresses (cloud metadata,
// loopback, RFC1918) would exfiltrate that response into a public bucket.
// The guard is the single chokepoint; this test pins its predicates.

describe('assertSafeUrl — scheme allow-list', () => {
  it('accepts http and https', () => {
    expect(() => assertSafeUrl('http://example.com/x')).not.toThrow();
    expect(() => assertSafeUrl('https://example.com/x')).not.toThrow();
  });

  it.each(['file:///etc/passwd', 'ftp://example.com', 'gopher://x', 'javascript:alert(1)', 'data:text/plain;base64,aGk='])(
    'rejects %s',
    (url) => {
      expect(() => assertSafeUrl(url)).toThrow(HttpError);
    },
  );
});

describe('assertSafeUrl — IPv4 literals', () => {
  it.each([
    ['http://127.0.0.1/', 'loopback'],
    ['http://10.0.0.1/', '10.0.0.0/8'],
    ['http://172.16.0.1/', '172.16/12'],
    ['http://172.31.255.255/', '172.16/12 upper'],
    ['http://192.168.1.1/', '192.168/16'],
    ['http://169.254.169.254/latest/meta-data/', 'AWS IMDS'],
    ['http://0.0.0.0/', '0.0.0.0/8'],
    ['http://224.0.0.1/', 'multicast'],
  ])('rejects %s (%s)', (url) => {
    expect(() => assertSafeUrl(url)).toThrow(HttpError);
  });

  it('accepts a public IPv4', () => {
    expect(() => assertSafeUrl('http://8.8.8.8/')).not.toThrow();
  });

  it('rejects 172.15.x.x adjacency check is correct (15 is public)', () => {
    // 172.15/16 is NOT private — only 172.16/12 (16–31) is. This guards
    // against an off-by-one that would either over-block (false positives
    // on legit 172.15 hosts) or under-block (172.32 misclassified).
    expect(() => assertSafeUrl('http://172.15.0.1/')).not.toThrow();
    expect(() => assertSafeUrl('http://172.32.0.1/')).not.toThrow();
    expect(() => assertSafeUrl('http://172.16.0.1/')).toThrow(HttpError);
    expect(() => assertSafeUrl('http://172.31.255.255/')).toThrow(HttpError);
  });

  it('rejects malformed IPv4 (octet > 255)', () => {
    expect(() => assertSafeUrl('http://999.0.0.1/')).toThrow(HttpError);
  });
});

describe('assertSafeUrl — IPv6 literals', () => {
  it.each([
    ['http://[::1]/', 'loopback'],
    ['http://[::]/', 'unspecified'],
    ['http://[fe80::1]/', 'link-local'],
    ['http://[fc00::1]/', 'ULA'],
    ['http://[fd00::1]/', 'ULA'],
    ['http://[::ffff:127.0.0.1]/', 'v4-mapped loopback'],
    ['http://[::ffff:169.254.169.254]/', 'v4-mapped IMDS'],
  ])('rejects %s (%s)', (url) => {
    expect(() => assertSafeUrl(url)).toThrow(HttpError);
  });

  it('accepts a public IPv6', () => {
    expect(() => assertSafeUrl('http://[2001:4860:4860::8888]/')).not.toThrow();
  });
});

describe('assertSafeUrl — DNS gotchas', () => {
  it.each([
    'http://localhost/',
    'http://LOCALHOST/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://kubernetes.default.svc.internal/',
  ])('rejects %s', (url) => {
    expect(() => assertSafeUrl(url)).toThrow(HttpError);
  });

  it('accepts public hosts that merely contain the substring "internal"', () => {
    // .internal matching must be a suffix, not a substring — otherwise we'd
    // block legit hosts like "international.example.com".
    expect(() => assertSafeUrl('https://international.example.com/')).not.toThrow();
    expect(() => assertSafeUrl('https://internal-affairs.example.com/')).not.toThrow();
  });
});

describe('assertSafeUrl — malformed input', () => {
  it('rejects garbage strings', () => {
    expect(() => assertSafeUrl('not-a-url')).toThrow(HttpError);
    expect(() => assertSafeUrl('')).toThrow(HttpError);
  });
});

describe('parseRobots / isAllowed — exact-UA precedence', () => {
  it('our-UA block overrides * block', () => {
    const text = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: ColdFileBot',
      'Allow: /sitemap',
      'Disallow: /admin',
    ].join('\n');
    const rules = parseRobots(text, 'ColdFileBot/1.0 (+https://coldfile.app)');
    expect(isAllowed(rules, '/sitemap/foo')).toBe(true);
    expect(isAllowed(rules, '/admin/foo')).toBe(false);
    // The * rules should NOT apply once we matched our exact UA.
    expect(isAllowed(rules, '/public')).toBe(true);
  });

  it('falls back to * when no exact UA match', () => {
    const text = ['User-agent: *', 'Disallow: /private'].join('\n');
    const rules = parseRobots(text, 'ColdFileBot/1.0');
    expect(isAllowed(rules, '/private/x')).toBe(false);
    expect(isAllowed(rules, '/public/x')).toBe(true);
  });

  it('longest-prefix wins for allow vs disallow', () => {
    const text = [
      'User-agent: *',
      'Disallow: /docs',
      'Allow: /docs/public',
    ].join('\n');
    const rules = parseRobots(text, 'ColdFileBot/1.0');
    expect(isAllowed(rules, '/docs/public/intro')).toBe(true);
    expect(isAllowed(rules, '/docs/private/intro')).toBe(false);
  });
});
