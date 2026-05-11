// Polite HTTP fetcher with rate-limit, identifying UA, and 429-aware backoff.
// Uses global fetch — works in Deno (Edge Functions) and Node 18+ (local CLI).

const DEFAULT_UA =
  'ColdFileBot/1.0 (+https://coldfile.app/about; contact@coldfile.app)';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25MB — generous for sitemaps + photos
const DEFAULT_MAX_REDIRECTS = 5;

/**
 * SSRF guard. Rejects non-public destinations before fetch() is called.
 *
 * The scrape pipeline downloads photo bytes from third-party sites and writes
 * them into the *publicly readable* `case-media` Storage bucket. Without this
 * guard, a poisoned source row could direct the crawler at internal addresses
 * (cloud metadata, RFC1918, loopback) and the response would be exfiltrated
 * into the public bucket. Layered defense: scheme allow-list, hostname IP
 * literal block, then per-redirect re-validation in safeFetch().
 */
export function assertSafeUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(`invalid URL: ${url}`, 0);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new HttpError(`disallowed scheme: ${u.protocol}`, 0);
  }
  const host = u.hostname.toLowerCase();
  if (!host) throw new HttpError(`empty hostname: ${url}`, 0);
  // IPv4 literal — block private + loopback + link-local + IMDS.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map((n) => parseInt(n, 10));
    if (o.some((n) => n > 255)) throw new HttpError(`invalid IPv4: ${host}`, 0);
    if (
      o[0] === 10 || // 10.0.0.0/8
      o[0] === 127 || // loopback
      (o[0] === 169 && o[1] === 254) || // 169.254.0.0/16 (IMDS, link-local)
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || // 172.16.0.0/12
      (o[0] === 192 && o[1] === 168) || // 192.168.0.0/16
      o[0] === 0 || // 0.0.0.0/8
      o[0] >= 224 // multicast / reserved
    ) {
      throw new HttpError(`disallowed IPv4: ${host}`, 0);
    }
  }
  // IPv6 literal — block loopback + link-local + ULA.
  // WHATWG URL keeps brackets on `.hostname` for IPv6 ([::1] not ::1), so
  // strip them before comparing. An earlier comment claimed the brackets
  // were stripped; that was wrong and the IPv6 guard was inert until tests
  // caught it.
  if (host.startsWith('[') && host.endsWith(']')) {
    const lower = host.slice(1, -1).toLowerCase();
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      // IPv4-mapped IPv6 (::ffff:0.0.0.0/96). WHATWG URL normalizes the
      // dotted-quad tail to hex (e.g. ::ffff:127.0.0.1 → ::ffff:7f00:1),
      // so a substring check on the prefix catches both forms. Public web
      // servers don't legitimately use v4-mapped IPv6, so blanket-blocking
      // this range is safer than reconstructing the IPv4 octets.
      lower.startsWith('::ffff:')
    ) {
      throw new HttpError(`disallowed IPv6: ${host}`, 0);
    }
  }
  // Common internal-DNS gotchas. Cheap belt-and-suspenders; won't catch a
  // /etc/hosts override or a public DNS pointing at 127.0.0.1 (rare; the IP
  // re-check on each redirect catches the latter once the redirect lands).
  if (host === 'localhost' || host === 'metadata.google.internal' || host.endsWith('.internal')) {
    throw new HttpError(`disallowed hostname: ${host}`, 0);
  }
  return u;
}

/**
 * fetch() wrapper that re-validates each redirect, enforces a global timeout,
 * caps response body size, and refuses cross-host redirects when host-pinned.
 *
 * Manual redirect handling is the only way to re-run assertSafeUrl on the
 * post-redirect Location: a 302 to http://169.254.169.254/ would otherwise
 * sail past the entry-point check.
 */
export interface SafeFetchOptions extends RequestInit {
  /** When set, redirects must keep the same host. Used for sitemap/RSS recursion. */
  pinHost?: string;
  /** Defaults to 30s. */
  timeoutMs?: number;
  /** Defaults to 25MB; throws HttpError(0) if exceeded. */
  maxBytes?: number;
  /** Defaults to 5; throws HttpError(0) if exceeded. */
  maxRedirects?: number;
}

export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const pinHost = opts.pinHost?.toLowerCase();

  let current = url;
  let hops = 0;
  while (true) {
    const u = assertSafeUrl(current);
    if (pinHost && u.hostname.toLowerCase() !== pinHost) {
      throw new HttpError(`redirect off-host: ${u.hostname} vs pinned ${pinHost}`, 0);
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        ...opts,
        redirect: 'manual',
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    // Manual mode reports redirects as 3xx with a Location header.
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      hops += 1;
      if (hops > maxRedirects) {
        throw new HttpError(`too many redirects (>${maxRedirects})`, 0);
      }
      const next = new URL(res.headers.get('location')!, current).toString();
      current = next;
      continue;
    }
    // Cap body size by inspecting Content-Length up-front. The full read
    // happens in the consumer (.text/.json/.arrayBuffer), so we wrap the
    // body with a counting transform when no Content-Length was sent.
    const declared = parseInt(res.headers.get('content-length') ?? '', 10);
    if (!Number.isNaN(declared) && declared > maxBytes) {
      throw new HttpError(`response too large: ${declared} > ${maxBytes}`, 0);
    }
    if (res.body && (Number.isNaN(declared) || declared <= 0)) {
      return new Response(capBodyStream(res.body, maxBytes), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    return res;
  }
}

function capBodyStream(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let read = 0;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) return controller.close();
        read += value.byteLength;
        if (read > max) {
          controller.error(new HttpError(`response exceeded ${max} bytes`, 0));
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
}

export class PoliteFetcher {
  private lastRequest = 0;

  constructor(
    private rateLimitMs: number,
    private userAgent: string = DEFAULT_UA,
  ) {}

  async get(url: string, init?: PoliteFetchOptions): Promise<Response> {
    // Two retry envelopes layered together:
    //   - HTTP-level (429 / 503): server told us to back off; we honor it
    //     and retry indefinitely (Retry-After capped at 10 minutes).
    //   - Network-level (TypeError "fetch failed", AbortError "operation
    //     was aborted"): transient connectivity hiccups. Cap at 2 retries
    //     with exponential backoff (1s, 3s) so we don't hang on a sustained
    //     outage.
    // HttpError thrown from safeFetch (SSRF guard, redirect cap, body-size
    // overflow) is structural, NOT transient — bubble immediately.
    let networkAttempts = 0;
    while (true) {
      const wait = Math.max(0, this.lastRequest + this.rateLimitMs - Date.now());
      if (wait > 0) await sleep(wait);
      this.lastRequest = Date.now();

      let res: Response;
      try {
        const cookieHeader = init?.jar?.cookieHeader();
        res = await safeFetch(url, {
          ...init,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            ...(init?.headers ?? {}),
          },
        });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (networkAttempts >= 2) throw err;
        const backoffMs = 1000 * Math.pow(3, networkAttempts);
        networkAttempts += 1;
        await sleep(backoffMs);
        continue;
      }

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
        await sleep(Math.min(retryAfter, 600) * 1000);
        networkAttempts = 0;
        continue;
      }

      if (res.status === 503) {
        await sleep(60_000);
        networkAttempts = 0;
        continue;
      }

      init?.jar?.ingest(res);
      return res;
    }
  }

  async getText(url: string, init?: PoliteFetchOptions): Promise<string> {
    const res = await this.get(url, init);
    if (!res.ok) {
      throw new HttpError(`GET ${url} failed: ${res.status}`, res.status);
    }
    return res.text();
  }

  async getJson<T = unknown>(url: string, init?: PoliteFetchOptions): Promise<T> {
    const res = await this.get(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new HttpError(`GET ${url} failed: ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  }

  async getBytes(url: string, init?: SafeFetchOptions): Promise<ArrayBuffer> {
    const res = await this.get(url, init);
    if (!res.ok) {
      throw new HttpError(`GET ${url} failed: ${res.status}`, res.status);
    }
    return res.arrayBuffer();
  }

  /**
   * POST a JSON body and return the parsed JSON response. Honors the same
   * polite-rate + 429/503-retry envelope as get(). Used by sources whose
   * discovery API takes a JSON body (NamUs Search) rather than query params.
   */
  async postJson<T = unknown>(
    url: string,
    body: unknown,
    init?: SafeFetchOptions,
  ): Promise<T> {
    // Same dual-envelope retry strategy as get(); see comments there.
    let networkAttempts = 0;
    while (true) {
      const wait = Math.max(0, this.lastRequest + this.rateLimitMs - Date.now());
      if (wait > 0) await sleep(wait);
      this.lastRequest = Date.now();

      let res: Response;
      try {
        res = await safeFetch(url, {
          ...init,
          method: 'POST',
          body: JSON.stringify(body),
          headers: {
            'User-Agent': this.userAgent,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(init?.headers ?? {}),
          },
        });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (networkAttempts >= 2) throw err;
        const backoffMs = 1000 * Math.pow(3, networkAttempts);
        networkAttempts += 1;
        await sleep(backoffMs);
        continue;
      }

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
        await sleep(Math.min(retryAfter, 600) * 1000);
        networkAttempts = 0;
        continue;
      }
      if (res.status === 503) {
        await sleep(60_000);
        networkAttempts = 0;
        continue;
      }
      if (!res.ok) {
        throw new HttpError(`POST ${url} failed: ${res.status}`, res.status);
      }
      return (await res.json()) as T;
    }
  }

  /**
   * POST application/x-www-form-urlencoded form data and return the raw
   * Response. Used by sources fronted by ASP.NET MVC / classic ASP forms
   * where the search dispatcher requires a real HTML-form submission
   * (TX DPS MPCH posts an antiforgery-token pair; classic-ASP sites like
   * FDLE MEPIC use a session cookie established on the search-page GET).
   *
   * Returns the Response so the caller can inspect non-2xx (e.g. a 302
   * redirect to the form page indicates the server rejected the criteria
   * — a real signal, not a transport failure). Use `getText`-style on the
   * result if you want the HTML body.
   *
   * Cookie state: pass a CookieJar via `init.jar` and call .get() on it
   * after a prior get()/getText() against the form page to seed the jar
   * with whatever session cookies the server set. The jar is consulted
   * for the outgoing Cookie header and updated with Set-Cookie from the
   * response — both must use the same jar instance.
   */
  async postForm(
    url: string,
    body: Record<string, string>,
    init?: PoliteFetchOptions,
  ): Promise<Response> {
    const params = new URLSearchParams(body).toString();
    let networkAttempts = 0;
    while (true) {
      const wait = Math.max(0, this.lastRequest + this.rateLimitMs - Date.now());
      if (wait > 0) await sleep(wait);
      this.lastRequest = Date.now();

      let res: Response;
      try {
        const cookieHeader = init?.jar?.cookieHeader();
        res = await safeFetch(url, {
          ...init,
          method: 'POST',
          body: params,
          headers: {
            'User-Agent': this.userAgent,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            ...(init?.headers ?? {}),
          },
        });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (networkAttempts >= 2) throw err;
        const backoffMs = 1000 * Math.pow(3, networkAttempts);
        networkAttempts += 1;
        await sleep(backoffMs);
        continue;
      }

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
        await sleep(Math.min(retryAfter, 600) * 1000);
        networkAttempts = 0;
        continue;
      }
      if (res.status === 503) {
        await sleep(60_000);
        networkAttempts = 0;
        continue;
      }
      init?.jar?.ingest(res);
      return res;
    }
  }
}

/**
 * Per-request options for PoliteFetcher methods that participate in a
 * cookie-jar session. Same shape as SafeFetchOptions plus an optional
 * jar that the method reads on the way out (Cookie header) and writes
 * on the way back (ingest Set-Cookie). Use the same jar instance across
 * a multi-step flow (GET form → POST submit) to keep session state.
 */
export interface PoliteFetchOptions extends SafeFetchOptions {
  jar?: CookieJar;
}

/**
 * Minimal in-memory cookie jar — name/value pairs only, no attribute
 * honoring (Path/Domain/Expires/Max-Age/SameSite). Sufficient for the
 * short-lived single-host form-submit flows we use it for: the jar's
 * lifetime is one discoverFn invocation, the host is fixed by the
 * source, and we don't care if cookies "expire" mid-flow because the
 * flow is sub-second from form-GET to form-POST.
 *
 * Reads multi-Set-Cookie via Headers.getSetCookie() (undici/Deno) with
 * a single-header fallback for older runtimes.
 */
export interface CookieJar {
  cookieHeader(): string | undefined;
  ingest(res: Response): void;
}

export function makeCookieJar(): CookieJar {
  const cookies = new Map<string, string>();
  return {
    cookieHeader(): string | undefined {
      if (cookies.size === 0) return undefined;
      return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    ingest(res: Response): void {
      // Node 18.14+ and Deno expose getSetCookie() returning string[];
      // older runtimes only have get('set-cookie') which folds multiple
      // headers into a single comma-joined string (technically wrong for
      // cookies since values can contain commas, but acceptable for the
      // simple session cookies we see in practice on these sources).
      const headers = res.headers as Headers & { getSetCookie?: () => string[] };
      const list = typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : res.headers.get('set-cookie')
          ? [res.headers.get('set-cookie')!]
          : [];
      for (const sc of list) {
        const semi = sc.indexOf(';');
        const pair = semi >= 0 ? sc.slice(0, semi) : sc;
        const eq = pair.indexOf('=');
        if (eq < 1) continue;
        cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
  };
}

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────────────────────
// robots.txt — minimal parser, just the User-Agent: * rules and our UA.
// ────────────────────────────────────────────────────────────────────────────

export interface RobotsRules {
  /** Allowed-prefix list. Matches longest-prefix wins per RFC. */
  allow: string[];
  /** Disallowed-prefix list. */
  disallow: string[];
  /** Crawl-delay seconds, if present. */
  crawlDelaySec?: number;
}

export async function fetchRobots(
  fetcher: PoliteFetcher,
  baseUrl: string,
  ourUserAgent = DEFAULT_UA,
): Promise<RobotsRules> {
  const url = new URL('/robots.txt', baseUrl).toString();
  let text = '';
  try {
    const res = await fetcher.get(url);
    if (res.status === 404) return { allow: [], disallow: [] };
    text = await res.text();
  } catch {
    return { allow: [], disallow: [] };
  }
  return parseRobots(text, ourUserAgent);
}

export function parseRobots(text: string, ourUserAgent: string): RobotsRules {
  // RFC 9309 §2.2.1: only the most specific matching group applies. If our
  // UA matches an explicit group, the wildcard group is ignored entirely;
  // otherwise we use the wildcard group. Two-pass: collect star + exact
  // separately, then return whichever applies.
  const lines = text.split(/\r?\n/);
  const star: RobotsRules = { allow: [], disallow: [] };
  const exact: RobotsRules = { allow: [], disallow: [] };
  let exactSeen = false;
  type Bucket = 'star' | 'exact' | null;
  let bucket: Bucket = null;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === 'user-agent') {
      const isStar = value === '*';
      const isUs = value !== '' && ourUserAgent.toLowerCase().includes(value.toLowerCase());
      if (isUs) {
        bucket = 'exact';
        exactSeen = true;
      } else if (isStar) {
        bucket = 'star';
      } else {
        bucket = null;
      }
      continue;
    }
    if (!bucket) continue;
    const target = bucket === 'exact' ? exact : star;

    if (key === 'allow') target.allow.push(value);
    else if (key === 'disallow' && value !== '') target.disallow.push(value);
    else if (key === 'crawl-delay') {
      const n = parseFloat(value);
      if (!Number.isNaN(n)) target.crawlDelaySec = n;
    }
  }

  return exactSeen ? exact : star;
}

/** True if `path` is allowed by `rules`. Longest-prefix-wins. */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  let bestAllowLen = -1;
  let bestDisallowLen = -1;
  for (const a of rules.allow) {
    if (path.startsWith(a) && a.length > bestAllowLen) bestAllowLen = a.length;
  }
  for (const d of rules.disallow) {
    if (path.startsWith(d) && d.length > bestDisallowLen) bestDisallowLen = d.length;
  }
  if (bestDisallowLen < 0) return true;
  return bestAllowLen >= bestDisallowLen;
}

// ────────────────────────────────────────────────────────────────────────────
// SHA-256 helper (Web Crypto, available in both Deno and Node 18+).
// ────────────────────────────────────────────────────────────────────────────

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  let bytes: ArrayBuffer;
  if (typeof input === 'string') {
    const u8 = new TextEncoder().encode(input);
    bytes = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  } else if (input instanceof Uint8Array) {
    bytes = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  } else {
    bytes = input;
  }
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
