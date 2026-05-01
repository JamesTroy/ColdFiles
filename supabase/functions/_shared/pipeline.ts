// The crawl + extract pipeline. Pure logic — caller injects fetcher and persist hooks.
// Used by both the Edge Function runner and the local CLI (dryrun does not persist).

import type {
  CaseRecord,
  ListStrategy,
  SourceConfig,
  DryRunResult,
  ListStrategyAlphaIndex,
  ListStrategyJsonApi,
  ListStrategySitemap,
  ListStrategyStatePagination,
} from './types.ts';
import { PoliteFetcher, fetchRobots, isAllowed } from './http.ts';
import { extractWithStrategy, linksFromSelector, load } from './extract.ts';
import { generateDedupeKeys } from './dedupe.ts';

export interface CrawlOptions {
  /** Cap the number of detail pages crawled. Useful for dryrun. */
  detailLimit?: number;
  /** Cap the number of list pages crawled. */
  listLimit?: number;
  /** If true, abort on robots.txt disallow rather than just skipping. */
  strictRobots?: boolean;
  /** When provided, called with structured progress events. */
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { kind: 'list_page'; url: string; index: number }
  | { kind: 'detail_url_queued'; url: string }
  | { kind: 'detail_extracted'; url: string; record: CaseRecord }
  | { kind: 'extract_error'; url: string; error: string }
  | { kind: 'robots_blocked'; url: string };

/**
 * Discover detail URLs by walking a source's list strategy.
 * Returns a deduplicated array of detail URLs, capped by `detailLimit`.
 */
export async function discoverDetailUrls(
  source: SourceConfig,
  fetcher: PoliteFetcher,
  opts: CrawlOptions = {},
): Promise<string[]> {
  switch (source.list.kind) {
    case 'alpha_index':
      return alphaIndexDiscovery(source, source.list, fetcher, opts);
    case 'state_index_pagination':
      return statePaginationDiscovery(source, source.list, fetcher, opts);
    case 'sitemap':
      return sitemapDiscovery(source, source.list, fetcher, opts);
    case 'json_api':
      return jsonApiDiscovery(source, source.list, fetcher, opts);
    case 'custom':
      return source.list.discoverFn(fetcher, opts.detailLimit);
  }
}

async function alphaIndexDiscovery(
  source: SourceConfig,
  strat: ListStrategyAlphaIndex,
  fetcher: PoliteFetcher,
  opts: CrawlOptions,
): Promise<string[]> {
  const seen = new Set<string>();
  const urls: string[] = [];
  const linkSelector = strat.detailLinkSelector ?? 'a[href]';
  const indexUrls = strat.letterParam
    ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        .split('')
        .map((l) => `${strat.indexUrl}?${strat.letterParam}=${l}`)
    : [strat.indexUrl];

  for (let i = 0; i < indexUrls.length; i++) {
    if (opts.listLimit && i >= opts.listLimit) break;
    const indexUrl = indexUrls[i];
    opts.onProgress?.({ kind: 'list_page', url: indexUrl, index: i });
    try {
      const html = await fetcher.getText(indexUrl);
      const $ = load(html);
      for (const link of linksFromSelector($, linkSelector, indexUrl)) {
        if (seen.has(link)) continue;
        seen.add(link);
        urls.push(link);
        opts.onProgress?.({ kind: 'detail_url_queued', url: link });
        if (opts.detailLimit && urls.length >= opts.detailLimit) return urls;
      }
    } catch (err) {
      opts.onProgress?.({
        kind: 'extract_error',
        url: indexUrl,
        error: errMessage(err),
      });
    }
  }
  return urls;
}

async function statePaginationDiscovery(
  source: SourceConfig,
  strat: ListStrategyStatePagination,
  fetcher: PoliteFetcher,
  opts: CrawlOptions,
): Promise<string[]> {
  const seen = new Set<string>();
  const urls: string[] = [];
  const detailLinkSelector = 'a[href]'; // Override per-source via inferKind / dedicated source if needed.

  outer: for (const state of strat.states) {
    let page = 1;
    while (true) {
      const indexPath = strat.statePath(state);
      const url = appendQuery(new URL(indexPath, source.baseUrl).toString(), {
        [strat.pageParam]: String(page),
      });
      opts.onProgress?.({ kind: 'list_page', url, index: page });
      let html: string;
      try {
        html = await fetcher.getText(url);
      } catch (err) {
        opts.onProgress?.({ kind: 'extract_error', url, error: errMessage(err) });
        break;
      }
      const $ = load(html);
      const before = urls.length;
      for (const link of linksFromSelector($, detailLinkSelector, url)) {
        if (seen.has(link)) continue;
        seen.add(link);
        urls.push(link);
        opts.onProgress?.({ kind: 'detail_url_queued', url: link });
        if (opts.detailLimit && urls.length >= opts.detailLimit) break outer;
      }
      const newOnPage = urls.length - before;
      if (newOnPage === 0) break; // exhausted state
      page += 1;
      if (opts.listLimit && page > opts.listLimit) break;
    }
  }
  return urls;
}

async function sitemapDiscovery(
  source: SourceConfig,
  strat: ListStrategySitemap,
  fetcher: PoliteFetcher,
  opts: CrawlOptions,
): Promise<string[]> {
  const seen = new Set<string>();
  const urls: string[] = [];
  let childIndex = 0;

  // Pin recursion to the source's own host. A poisoned sitemap that lists
  // an off-host <loc> would otherwise drag the crawler off the source's
  // domain — and into anywhere the SSRF guard doesn't already block.
  const pinHost = new URL(source.baseUrl).hostname.toLowerCase();
  const sameHost = (u: string): boolean => {
    try {
      return new URL(u).hostname.toLowerCase() === pinHost;
    } catch {
      return false;
    }
  };

  // Charley (and most WordPress sources) ship a sitemap *index* at the
  // top, not a flat URL list — root tag is <sitemapindex> with <loc>s
  // pointing at child sitemaps. Detect and recurse one level.
  const visit = async (sitemapUrl: string): Promise<void> => {
    if (opts.detailLimit && urls.length >= opts.detailLimit) return;
    if (!sameHost(sitemapUrl)) return; // refuse to follow cross-host index
    const xml = await fetcher.getText(sitemapUrl);
    const isIndex = /<sitemapindex[\s>]/i.test(xml);
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = m[1].trim();
      if (!sameHost(u)) continue; // drop off-host entries silently
      if (isIndex) {
        opts.onProgress?.({ kind: 'list_page', url: u, index: childIndex++ });
        await visit(u);
        if (opts.detailLimit && urls.length >= opts.detailLimit) return;
      } else {
        if (!strat.urlPattern.test(u)) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        urls.push(u);
        opts.onProgress?.({ kind: 'detail_url_queued', url: u });
        if (opts.detailLimit && urls.length >= opts.detailLimit) return;
      }
    }
  };

  await visit(strat.sitemapUrl);
  return urls;
}

async function jsonApiDiscovery(
  source: SourceConfig,
  strat: ListStrategyJsonApi,
  fetcher: PoliteFetcher,
  opts: CrawlOptions,
): Promise<string[]> {
  const seen = new Set<string>();
  const urls: string[] = [];
  let pageIdx = 0;

  for (const endpoint of strat.endpoints) {
    let cursor: string | undefined = undefined;
    while (true) {
      const url = strat.paginate
        ? appendQuery(endpoint, {
            page_size: String(strat.paginate.pageSize),
            ...(cursor ? { cursor } : {}),
          })
        : endpoint;

      opts.onProgress?.({ kind: 'list_page', url, index: pageIdx });
      pageIdx += 1;

      let json: unknown;
      try {
        json = await fetcher.getJson<unknown>(url);
      } catch (err) {
        opts.onProgress?.({ kind: 'extract_error', url, error: errMessage(err) });
        break;
      }

      const items = strat.itemsPath ? pickPath(json, strat.itemsPath) : json;
      if (!Array.isArray(items)) break;

      for (const item of items as Record<string, unknown>[]) {
        const u = strat.detailUrl(item);
        if (seen.has(u)) continue;
        seen.add(u);
        urls.push(u);
        opts.onProgress?.({ kind: 'detail_url_queued', url: u });
        if (opts.detailLimit && urls.length >= opts.detailLimit) return urls;
      }

      if (!strat.paginate) break; // single-shot endpoint; move to next
      const next = pickPath(json, strat.paginate.cursorPath);
      if (!next || typeof next !== 'string') break;
      cursor = next;
      if (opts.listLimit && pageIdx >= opts.listLimit) break;
    }
    if (opts.detailLimit && urls.length >= opts.detailLimit) break;
  }
  return urls;
}

/**
 * Fetch + parse a single detail page into a CaseRecord (or skip with an error event).
 * Dispatches on source.detail.kind: 'cheerio' (HTML scrape) or 'json' (JSON API).
 */
export async function extractDetail(
  source: SourceConfig,
  detailUrl: string,
  fetcher: PoliteFetcher,
): Promise<CaseRecord | { error: string }> {
  let partial: Partial<CaseRecord>;
  try {
    if (source.detail.kind === 'cheerio') {
      const html = await fetcher.getText(detailUrl);
      const $ = load(html);
      partial = extractWithStrategy($, detailUrl, source.detail);
    } else {
      const urls = source.detail.fetchUrls(detailUrl);
      const data: Record<string, unknown> = {};
      for (const [key, url] of Object.entries(urls)) {
        data[key] = await fetcher.getJson<unknown>(url);
      }
      partial = source.detail.mapJson(data, detailUrl);
      if (source.detail.inferKind && !partial.kind) {
        partial.kind = source.detail.inferKind(partial);
      }
    }
  } catch (err) {
    return { error: errMessage(err) };
  }

  // The runner is responsible for kind/status fallbacks and merging defaults.
  const record: CaseRecord = {
    source_external_id: deriveExternalId(detailUrl),
    source_url: detailUrl,
    kind: partial.kind ?? source.defaults?.kind ?? 'missing',
    status: partial.status ?? source.defaults?.status ?? 'open',
    incident_date_quality:
      partial.incident_date_quality ?? source.defaults?.incident_date_quality ?? 'unknown',
    photos: partial.photos ?? [],
    raw: partial.raw ?? {},
    ...stripCore(partial),
  };

  return record;
}

function stripCore(p: Partial<CaseRecord>): Partial<CaseRecord> {
  // Drop the keys we set explicitly above so they don't double-spread.
  const {
    source_external_id: _a,
    source_url: _b,
    kind: _c,
    status: _d,
    incident_date_quality: _e,
    photos: _f,
    raw: _g,
    ...rest
  } = p as CaseRecord;
  return rest;
}

/** Default external-id derivation: last path segment, stripped of query/fragment. */
function deriveExternalId(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return seg ? decodeURIComponent(seg) : url;
  } catch {
    return url;
  }
}

/**
 * High-level dryrun: discover N URLs, extract each, return the records + dedupe keys.
 * No DB writes. Used by `npm run scrape:dryrun`.
 */
export async function dryRun(
  source: SourceConfig,
  opts: CrawlOptions = {},
): Promise<DryRunResult> {
  const fetcher = new PoliteFetcher(source.rateLimitMs, source.userAgent);

  // Robots check.
  const rules = await fetchRobots(fetcher, source.baseUrl, source.userAgent);
  if (rules.crawlDelaySec && rules.crawlDelaySec * 1000 > source.rateLimitMs) {
    // Honor a more conservative crawl-delay if robots demands it.
    (fetcher as unknown as { rateLimitMs: number }).rateLimitMs = rules.crawlDelaySec * 1000;
  }

  const urls = await discoverDetailUrls(source, fetcher, opts);
  const records: CaseRecord[] = [];
  const dedupeKeysPerRecord: ReturnType<typeof generateDedupeKeys>[] = [];

  for (const url of urls) {
    if (opts.detailLimit && records.length >= opts.detailLimit) break;

    const path = new URL(url).pathname;
    if (!isAllowed(rules, path)) {
      opts.onProgress?.({ kind: 'robots_blocked', url });
      if (opts.strictRobots) throw new Error(`robots.txt disallows ${url}`);
      continue;
    }

    const out = await extractDetail(source, url, fetcher);
    if ('error' in out) {
      opts.onProgress?.({ kind: 'extract_error', url, error: out.error });
      continue;
    }
    records.push(out);
    dedupeKeysPerRecord.push(generateDedupeKeys(out));
    opts.onProgress?.({ kind: 'detail_extracted', url, record: out });
  }

  return {
    source_slug: source.slug,
    detail_urls_seen: urls.length,
    records_extracted: records.length,
    records,
    dedupe_keys_per_record: dedupeKeysPerRecord,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ────────────────────────────────────────────────────────────────────────────

function appendQuery(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function pickPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
