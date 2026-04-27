// Polite HTTP fetcher with rate-limit, identifying UA, and 429-aware backoff.
// Uses global fetch — works in Deno (Edge Functions) and Node 18+ (local CLI).

const DEFAULT_UA =
  'ColdFileBot/1.0 (+https://coldfile.app/about; contact@coldfile.app)';

export class PoliteFetcher {
  private lastRequest = 0;

  constructor(
    private rateLimitMs: number,
    private userAgent: string = DEFAULT_UA,
  ) {}

  async get(url: string, init?: RequestInit): Promise<Response> {
    const wait = Math.max(0, this.lastRequest + this.rateLimitMs - Date.now());
    if (wait > 0) await sleep(wait);
    this.lastRequest = Date.now();

    const res = await fetch(url, {
      ...init,
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...(init?.headers ?? {}),
      },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
      await sleep(Math.min(retryAfter, 600) * 1000);
      return this.get(url, init);
    }

    if (res.status === 503) {
      await sleep(60_000);
      return this.get(url, init);
    }

    return res;
  }

  async getText(url: string, init?: RequestInit): Promise<string> {
    const res = await this.get(url, init);
    if (!res.ok) {
      throw new HttpError(`GET ${url} failed: ${res.status}`, res.status);
    }
    return res.text();
  }

  async getJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
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

  async getBytes(url: string, init?: RequestInit): Promise<ArrayBuffer> {
    const res = await this.get(url, init);
    if (!res.ok) {
      throw new HttpError(`GET ${url} failed: ${res.status}`, res.status);
    }
    return res.arrayBuffer();
  }
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
  const lines = text.split(/\r?\n/);
  let active = false;
  let activeIsExact = false;
  const rules: RobotsRules = { allow: [], disallow: [] };

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === 'user-agent') {
      const isStar = value === '*';
      const isUs = ourUserAgent.toLowerCase().includes(value.toLowerCase()) && value !== '';
      if (isUs) {
        active = true;
        activeIsExact = true;
      } else if (isStar && !activeIsExact) {
        active = true;
      } else {
        active = false;
      }
      continue;
    }
    if (!active) continue;

    if (key === 'allow') rules.allow.push(value);
    else if (key === 'disallow' && value !== '') rules.disallow.push(value);
    else if (key === 'crawl-delay') {
      const n = parseFloat(value);
      if (!Number.isNaN(n)) rules.crawlDelaySec = n;
    }
  }

  return rules;
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
