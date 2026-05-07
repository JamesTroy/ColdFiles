/**
 * Project: Cold Case — family-attributed unsolved homicides via WordPress
 * REST API.
 *
 * The earlier dormancy block (sources/namus.ts-style "wake-up paths" comment
 * and the memory note `project_cold_case_deferred.md`) was based on a
 * misread of the site structure. We thought the case detail was a SPA stub
 * fed by AJAX. It isn't. Each "Cold Case Spotlight" post is a regular
 * WordPress post under date-based permalinks (/YYYY/MM/DD/slug/), and the
 * site exposes the standard WP REST API at /wp-json/wp/v2/posts.
 *
 * Discovery: paginate /wp-json/wp/v2/posts?categories=4 (Cold Case
 * Spotlight, ~376 posts as of 2026-05-02) and emit one API URL per post.
 *
 * Detail: fetch /wp-json/wp/v2/posts/{id}. The response carries a
 * `yoast_head_json` object with a SEO-grade `description` field — a
 * single-sentence summary that names the victim, action, location, and
 * date in a consistent enough shape to parse for incident_date and
 * location_state. Examples:
 *
 *   "Edward McClain went missing from the 1600 block of Colgate Road in
 *    Jacksonville, FL on November 20, 2000 and has not been heard from
 *    since."
 *   "On April 5, 2018, deputies responded to reports of gunfire on SW
 *    Williston Rd. in Gainesville, FL and found Devonte Jenkins shot to
 *    death."
 *
 * The full body content is in `content.rendered` (HTML); we strip it for
 * narrative.
 *
 * Trust weight: 75 — same tier as Charley (volunteer-aggregator with
 * documented family-submission intake; not an authoritative federal
 * source like NamUs).
 *
 * Be polite: PCC is a small nonprofit. 5s rate limit + the 02:00–05:00 UTC
 * window from Charley's playbook.
 */

import type {
  AgencyHint,
  CaseRecord,
  DateQuality,
  ExtractedPhoto,
  SourceConfig,
} from '../supabase/functions/_shared/types.ts';
import type { CaseEventInput } from '../supabase/functions/_shared/case-events.ts';
import {
  parseDate,
  parseState,
  splitName,
  stripHtml,
  truncateNarrative,
} from '../supabase/functions/_shared/normalize.ts';

const API_BASE = 'https://projectcoldcase.org/wp-json/wp/v2';
const COLD_CASE_SPOTLIGHT_CATEGORY = 4;
const PER_PAGE = 100;
const MAX_PAGES = 10; // safety cap; ~376 posts as of 2026-05-02 → 4 pages

interface YoastImage {
  url?: string;
  width?: number;
  height?: number;
  type?: string;
}

interface YoastHeadJson {
  title?: string;
  description?: string;
  og_image?: YoastImage[];
  article_published_time?: string;
  author?: string;
}

interface PccPost {
  id: number;
  slug: string;
  link: string;
  date: string;
  title: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  yoast_head_json?: YoastHeadJson;
}

/**
 * Decode the HTML entities WP serializes into JSON post titles and Yoast
 * descriptions: numeric (&#NNNN; / &#xHHHH;) and a small set of named
 * entities common in WP-generated content. Without decoding, names with
 * apostrophes serialize as "De&#8217;Shaun" which we'd then key into the
 * dedupe table with the entity baked in. WP serves the entity-encoded form
 * in the JSON API even though the rendered HTML page decodes it; we have
 * to do the decode ourselves.
 */
function decodeHtmlEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Pull date + city + state out of a Yoast description sentence.
 *
 * Two main shapes the descriptions take:
 *   1. "<Name> went missing from <where> in <City>, <State> on <Date> ..."
 *   2. "On <Date>, ... in <City>, <State> ... <Name> ..."
 *
 * The order matters less than the markers. We look for:
 *   - date:  "<Month> <day>, <year>" or "<year>" patterns anywhere
 *   - state: "<City>, <2-letter-state>" or "<City>, <FullStateName>"
 */
function parseYoastDescription(desc: string): {
  iso?: string;
  quality: DateQuality;
  rawDate?: string;
  city?: string;
  state?: string;
  locationText?: string;
} {
  const out: ReturnType<typeof parseYoastDescription> = { quality: 'unknown' };
  if (!desc) return out;

  // Date — try month-day-year first, then month-year, then year-only.
  // Anchor on word boundaries so "May 15" inside a name doesn't match.
  const monthDayYear = desc.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/,
  );
  if (monthDayYear) {
    const parsed = parseDate(monthDayYear[0]);
    if (parsed.iso) {
      out.iso = parsed.iso;
      out.quality = parsed.quality;
      out.rawDate = monthDayYear[0];
    }
  } else {
    const monthYear = desc.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/,
    );
    if (monthYear) {
      const parsed = parseDate(monthYear[0]);
      if (parsed.iso) {
        out.iso = parsed.iso;
        out.quality = parsed.quality;
        out.rawDate = monthYear[0];
      }
    } else {
      const yearOnly = desc.match(/\b(19\d{2}|20\d{2})\b/);
      if (yearOnly) {
        out.iso = `${yearOnly[1]}-01-01`;
        out.quality = 'year_only';
        out.rawDate = yearOnly[1];
      }
    }
  }

  // Location — "<City>, <ST>" with a 2-letter state. We anchor before the
  // comma so we don't match arbitrary commas in the sentence.
  const cityState = desc.match(
    /\bin\s+([A-Z][A-Za-z .'-]{1,40}?),\s+([A-Z]{2})\b/,
  );
  if (cityState) {
    out.city = cityState[1].trim();
    out.state = cityState[2];
    out.locationText = `${out.city}, ${out.state}`;
  } else {
    // Fallback: try full-state-name pattern.
    const cityStateFullName = desc.match(
      /\bin\s+([A-Z][A-Za-z .'-]{1,40}?),\s+([A-Z][A-Za-z ]+?)(?=[\s,.])/,
    );
    if (cityStateFullName) {
      const stateCode = parseState(cityStateFullName[2]);
      if (stateCode) {
        out.city = cityStateFullName[1].trim();
        out.state = stateCode;
        out.locationText = `${out.city}, ${stateCode}`;
      }
    }
  }

  return out;
}

export const projectColdCase: SourceConfig = {
  slug: 'project_cold_case',
  name: 'Project: Cold Case',
  kind: 'nonprofit',
  baseUrl: 'https://projectcoldcase.org',
  rateLimitMs: 5000,
  scheduleCron: '0 9 5 * *',
  trustWeight: 75,
  windowUtc: { startHour: 2, endHour: 5 },
  attribution: {
    html:
      'Source: <a href="https://projectcoldcase.org" rel="external">Project: Cold Case</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'custom',
    // Discovery emits the human-facing canonical URLs (date-permalink form
    // like /2026/04/27/edward-mcclain/) so case_sources.source_url stores
    // the URL we'd actually want a user to land on if they tap the source
    // chip on the case detail. The post ID rides along as a `?pcc_id=`
    // query param so detail.fetchUrls below can derive the WP REST API
    // endpoint without an extra slug-lookup round-trip per case.
    //
    // deriveExternalId in pipeline.ts checks `?id=` first; we use
    // `?pcc_id=` specifically so that check falls through and external_id
    // resolves to the URL's last path segment (the WP slug, e.g.
    // 'edward-mcclain'). Stable across re-scrapes.
    discoverFn: async (fetcher, detailLimit) => {
      const target = detailLimit ?? Infinity;
      const urls: string[] = [];
      for (let page = 1; page <= MAX_PAGES && urls.length < target; page += 1) {
        const items = await fetcher.getJson<
          Array<{ id: number; link: string }>
        >(
          `${API_BASE}/posts?categories=${COLD_CASE_SPOTLIGHT_CATEGORY}&per_page=${PER_PAGE}&_fields=id,link&page=${page}`,
        );
        if (!Array.isArray(items) || items.length === 0) break;
        for (const item of items) {
          if (typeof item?.id !== 'number' || typeof item?.link !== 'string') continue;
          // Skip "Cold Case Spotlight – <Name>" editorial roundup posts.
          // PCC's category 4 mixes individual case posts with these
          // summaries; the summary URLs always start with
          // /cold-case-spotlight-. Their title parses to victim_first_name
          // ='Cold' and the body has Avada-theme CSS leakage, so they're
          // unusable as cases.
          if (/\/cold-case-spotlight-/i.test(item.link)) continue;
          const sep = item.link.includes('?') ? '&' : '?';
          urls.push(`${item.link}${sep}pcc_id=${item.id}`);
          if (urls.length >= target) break;
        }
        if (items.length < PER_PAGE) break; // last page
      }
      return urls;
    },
  },
  detail: {
    kind: 'json',
    // Translate the discovery-emitted human URL into the WP REST API
    // endpoint by extracting the embedded pcc_id query param.
    fetchUrls: (detailUrl) => {
      let id = '';
      try {
        id = new URL(detailUrl).searchParams.get('pcc_id') ?? '';
      } catch {
        /* fall through */
      }
      if (!id) {
        // Defensive: if pcc_id wasn't encoded (e.g. a manually-supplied
        // detail URL), the fetcher will return an empty post object and
        // mapJson handles it as a skip.
        return { post: detailUrl };
      }
      return { post: `${API_BASE}/posts/${id}` };
    },
    mapJson: (data, _detailUrl): Partial<CaseRecord> => {
      const post = data.post as PccPost | null;
      if (!post) return { raw: { empty: true } };

      const yoast = post.yoast_head_json ?? {};
      const description = decodeHtmlEntities(yoast.description ?? '').trim();
      const parsed = parseYoastDescription(description);

      const titleRendered = decodeHtmlEntities(
        stripHtml(post.title?.rendered ?? ''),
      ).trim();

      // Defensive belt-and-suspenders against the discoverFn URL filter:
      // if a Cold Case Spotlight post slips through (e.g. PCC adds a new
      // category-tag pattern we don't catch), the title heuristic still
      // skips the record. The title format is consistent: "Cold Case
      // Spotlight – <Name>" with an em-dash. Fall through to empty so
      // the persist path treats it as a no-op.
      if (/^cold case spotlight\b/i.test(titleRendered)) {
        return { raw: { skipped: 'cold-case-spotlight-summary' } };
      }

      const nameParts = titleRendered ? splitName(titleRendered) : { first: undefined, last: undefined };

      const photos: ExtractedPhoto[] = (yoast.og_image ?? [])
        .map((img) => img.url)
        .filter((u): u is string => !!u && u.startsWith('http'))
        .map((url) => ({ url, kind: 'photo_victim' as const }));

      const bodyHtml = post.content?.rendered ?? '';
      const narrativeRaw = stripHtml(bodyHtml).trim();
      const narrative = narrativeRaw ? truncateNarrative(narrativeRaw) : undefined;
      // Yoast description is the SEO-tuned single-sentence summary —
      // perfect as the narrative_short; falls back to the body's first
      // paragraph when description is missing.
      const narrativeShort =
        description ||
        narrativeRaw.split(/\n{2,}/)[0]?.slice(0, 240) ||
        undefined;

      const agencyHint: AgencyHint = {
        // PCC doesn't consistently name the investigating agency in their
        // descriptions; route tips to PCC's own info-seeking line, which
        // forwards to the family + agency on their side.
        name: 'Project: Cold Case',
        tip_url: 'https://projectcoldcase.org/contact-us/',
      };

      // Timeline events:
      //   - incident:               parsed date in the yoast description
      //                             sentence. source_quote is the verbatim
      //                             single-sentence Yoast description (the
      //                             upstream evidence the date came from).
      //   - case_spotlight_published: yoast.article_published_time. Editorial
      //                             milestone — when PCC published the
      //                             spotlight post on the victim. Date is
      //                             ISO timestamp, quality 'exact'.
      const events: CaseEventInput[] = [];
      const sourceUrl = post.link;
      if (parsed.iso && description) {
        events.push({
          event_kind: 'incident',
          headline: parsed.locationText
            ? `Incident — ${parsed.locationText}`
            : 'Incident',
          event_date: parsed.iso,
          event_date_quality: parsed.quality,
          event_date_text:
            parsed.rawDate && parsed.quality !== 'exact' ? parsed.rawDate : undefined,
          source_url: sourceUrl,
          source_quote: description,
        });
      }
      if (yoast.article_published_time) {
        const publishedIso = yoast.article_published_time.slice(0, 10);
        events.push({
          event_kind: 'case_spotlight_published',
          headline: 'Cold Case Spotlight published',
          event_at: yoast.article_published_time,
          event_date: /^\d{4}-\d{2}-\d{2}$/.test(publishedIso) ? publishedIso : undefined,
          event_date_quality: 'exact',
          source_url: sourceUrl,
          source_quote: `Article published: ${yoast.article_published_time}`,
        });
      }

      return {
        kind: 'homicide',
        status: 'open',
        victim_name: titleRendered || undefined,
        victim_first_name: nameParts.first,
        victim_last_name: nameParts.last,

        incident_date: parsed.iso,
        incident_date_quality: parsed.quality,
        incident_date_text:
          parsed.rawDate && parsed.quality !== 'exact' ? parsed.rawDate : undefined,

        location_text: parsed.locationText,
        location_city: parsed.city,
        location_state: parsed.state,

        narrative,
        narrative_short: narrativeShort,

        agency_hint: agencyHint,
        photos,
        events,

        raw: {
          post_id: post.id,
          slug: post.slug,
          link: post.link,
          published_at: yoast.article_published_time,
          author: yoast.author,
        },
      };
    },
    inferKind: () => 'homicide',
  },
  defaults: {
    status: 'open',
    kind: 'homicide',
    incident_date_quality: 'unknown',
    photos: [],
    raw: {},
  },
};
