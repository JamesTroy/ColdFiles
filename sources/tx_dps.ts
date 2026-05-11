import type {
  AgencyHint,
  CaseRecord,
  ExtractedPhoto,
  SourceConfig,
} from '../supabase/functions/_shared/types.ts';
import type { CaseEventInput } from '../supabase/functions/_shared/case-events.ts';
import { makeCookieJar } from '../supabase/functions/_shared/http.ts';
import {
  heightToCm,
  parseAge,
  parseDate,
  parseSex,
  parseState,
  truncateNarrative,
  weightToKg,
} from '../supabase/functions/_shared/normalize.ts';

/**
 * Texas DPS Missing Persons Clearinghouse Online Bulletin.
 * https://www.dps.texas.gov/apps/mpch/
 *
 * State DOJ clearinghouse run by the TX Department of Public Safety.
 * ASP.NET MVC app behind a `__RequestVerificationToken` antiforgery
 * pair (cookie + hidden form field, both required and bound to each
 * other). The search dispatcher accepts an empty-criteria POST and
 * returns the FULL missing-persons corpus inline — 822 records as of
 * 2026-05-10, single response, no pagination. Detail pages are server-
 * rendered HTML with stable IDs.
 *
 * Robots.txt: standard Drupal allow-all, no Crawl-delay. The /apps/
 * subtree is fully crawlable. We use 2s/req as a politeness floor.
 *
 * ─── DISCOVERY FLOW ────────────────────────────────────────────────────
 *
 * 1. GET  /apps/mpch/MissingPerson/mpIndex
 *      → sets cookie __RequestVerificationToken_L2FwcHMvbXBjaA2 (path
 *        is /apps/mpch, name is base64 of that path with trailing "2")
 *      → renders <form method="post"> with a sibling
 *        <input name="__RequestVerificationToken" value="..."> whose
 *        value is paired with the cookie value (server validates both).
 *
 * 2. POST same URL with body
 *        __RequestVerificationToken={token from step 1's hidden input}
 *      and the cookie from step 1 echoed back as Cookie header.
 *      → 200 OK, response body is the full results listing with 822
 *        <a href="/apps/mpch/MissingPerson/mpDetails/{ID}"> anchors.
 *
 * 3. Each detail URL is a GET-fetchable HTML page (server-rendered,
 *    no cookie required for detail pages).
 *
 * IDs come in two flavors and serve different purposes:
 *   - URL ID:      "M1-10-20113-20-41PM"
 *     Database creation timestamp. Stable, opaque, suitable for
 *     source_external_id.
 *   - Case Number: "M1101002"
 *     Agency-issued reference rendered on the detail page. Use as
 *     case_number_primary → Tier-1 dedupe via agency_case_number.
 *
 * ─── UNIDENTIFIED PERSONS (deferred) ───────────────────────────────────
 *
 * /apps/mpch/Unidentified/unIndex uses the same antiforgery shape but
 * does NOT accept an empty-criteria POST — empty body redirects back
 * to the form, and a single Sex=Male filter also redirects. Need to
 * probe the minimum-required filter combination before adding UN here.
 * Probably needs at least Country or Race + Sex. Filed as a follow-up;
 * for v1 ship MP-only.
 *
 * ─── DETAIL PAGE DOM ───────────────────────────────────────────────────
 *
 * Field shape is `<span><strong>Label: </strong></span> value` with the
 * value rendered as the next text node after the strong-labeled span.
 * No anchored class names, no RDFa attributes — the spanLabelValue()
 * helper below walks the inner HTML of each <p> looking for the strong-
 * close-tag → text pattern, similar to mt_mmpd's pLabelValue() but
 * matched on span-strong rather than bare b-tags.
 *
 * Fields exposed on detail pages:
 *   Name, AKA, Case Number, Case Type, Height (split across two spans),
 *   Date of Birth, Eye Color, Race, Weight, Age Missing, Hair Color,
 *   Sex, Last Seen in (city + county-in-parens), State Missing From,
 *   Country Missing From, Last Seen on, Circumstances.
 *
 * NOT exposed: agency name (TX DPS is the agency-of-record; case_number
 * carries the local PD's case ref but the agency name itself is not
 * rendered on the public detail page).
 *
 * ─── OUT-OF-STATE CASES ────────────────────────────────────────────────
 *
 * Like ca_mups, TX DPS holds cases that occurred in other states (sample
 * record M1101002 was missing from Elgin, Illinois). Use the "State
 * Missing From" field for location_state — don't default to TX. When
 * State Missing From is missing/empty, fall back to TX as the agency
 * default, same posture as ca_mups's "absent (XX) suffix means in-state"
 * heuristic.
 *
 * ─── PHOTO POLICY ──────────────────────────────────────────────────────
 *
 * Photos hosted at /apps/mpch_images/final/{caseNumber}.jpg. Agency-
 * released state government works — hot-linking allowed per
 * feedback_photo_sourcing_policy. source_attribution = "Texas DPS MPCH".
 *
 * Trust weight: 80. Same tier as ca_mups, nys_dcjs, mt_mmpd, nm_dps —
 * state DOJ owns the rows directly.
 */

const BASE = 'https://www.dps.texas.gov';
const MP_INDEX_URL = `${BASE}/apps/mpch/MissingPerson/mpIndex`;
const PHOTO_BASE = `${BASE}/apps/mpch_images/final`;

/**
 * Pull the antiforgery token's value out of the form HTML.
 * The hidden input renders as:
 *   <input name="__RequestVerificationToken" type="hidden" value="..." />
 * Order of attributes is stable in the framework's output.
 */
function extractAntiforgeryToken(html: string): string | undefined {
  const m = html.match(
    /name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/,
  );
  return m?.[1];
}

/**
 * Walk <p> blocks looking for `<span><strong>Label: </strong></span>`
 * and return the text that follows up to the next tag boundary.
 *
 * The field shape repeats across the page. Multiple <p> blocks each
 * carry a handful of labeled spans separated by <br>. Match is case-
 * insensitive on the label; trailing whitespace is collapsed.
 *
 * Returns the first non-empty value found across all <p> blocks.
 */
function spanLabelValue(
  $: import('cheerio').CheerioAPI,
  label: string,
): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<span>\\s*<strong>\\s*${escaped}\\s*:\\s*</strong>\\s*</span>\\s*([^<]*)`,
    'i',
  );
  let result: string | undefined;
  $('p').each((_, el) => {
    if (result !== undefined) return;
    const html = $(el).html() ?? '';
    const m = html.match(re);
    if (!m) return;
    const v = (m[1] ?? '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#?[a-z0-9]+;/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (v) result = v;
  });
  return result;
}

/**
 * The "Last Seen in: City (County)" block uses a bare <strong> label
 * (no surrounding <span>) and the value is split across plain text +
 * a sibling <span> for the parenthesized county. Match the strong-
 * close-tag → text pattern across all <p> blocks.
 */
function strongLabelValue(
  $: import('cheerio').CheerioAPI,
  label: string,
): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<strong>\\s*${escaped}\\s*:?\\s*</strong>\\s*([^<]*)`,
    'i',
  );
  let result: string | undefined;
  $('p').each((_, el) => {
    if (result !== undefined) return;
    const html = $(el).html() ?? '';
    const m = html.match(re);
    if (!m) return;
    const v = (m[1] ?? '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (v) result = v;
  });
  return result;
}

/**
 * Height comes back as `<span>6'</span> <span>00"</span>` — two
 * adjacent spans. Reconstruct "6'00"" → heightToCm-compatible
 * "6'0"" format. Returns undefined if the spans aren't found.
 */
function extractHeight($: import('cheerio').CheerioAPI): number | undefined {
  let raw: string | undefined;
  $('p').each((_, el) => {
    if (raw !== undefined) return;
    const html = $(el).html() ?? '';
    const m = html.match(
      /<span>\s*<strong>\s*Height\s*:\s*<\/strong>\s*<\/span>\s*<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>/i,
    );
    if (m) {
      const ft = (m[1] ?? '').replace(/[^\d]/g, '');
      const inches = (m[2] ?? '').replace(/[^\d]/g, '');
      if (ft) raw = `${ft}'${inches || '0'}"`;
    }
  });
  return raw ? heightToCm(raw) : undefined;
}

/**
 * Strip "(County)" parens trailer off the Last-Seen-in city value.
 * "Elgin (Kane)" → "Elgin". Falls back to the input if no parens.
 */
function cityFromLastSeen(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^([^(]+?)(?:\s*\([^)]*\))?\s*$/);
  return m?.[1]?.trim() || undefined;
}

export const txDps: SourceConfig = {
  slug: 'tx_dps',
  name: 'Texas DPS Missing Persons Clearinghouse',
  kind: 'state',
  baseUrl: BASE,
  rateLimitMs: 2000, // robots-allow-all, no Crawl-delay declared; 2s as politeness floor
  scheduleCron: '0 3 * * 3', // Wednesday 03:00 UTC — weekly, offset from ca_mups (Sat 02:00)
  trustWeight: 80,
  attribution: {
    html:
      'Source: <a href="https://www.dps.texas.gov/apps/mpch/" rel="external">Texas DPS Missing Persons Clearinghouse</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'custom',
    discoverFn: async (fetcher, detailLimit) => {
      // Form submission needs an antiforgery cookie+token pair. Seed
      // the jar with the GET, extract the hidden token, post both.
      const jar = makeCookieJar();
      const formHtml = await fetcher.getText(MP_INDEX_URL, { jar });
      const token = extractAntiforgeryToken(formHtml);
      if (!token) {
        // Server response shape changed — fail loud so the next
        // operator sees this in scrape:run output and re-probes.
        throw new Error(
          'tx_dps: __RequestVerificationToken not found on mpIndex form — page shape changed',
        );
      }
      const res = await fetcher.postForm(
        MP_INDEX_URL,
        { __RequestVerificationToken: token },
        { jar },
      );
      if (!res.ok) {
        throw new Error(`tx_dps: mpIndex POST failed: ${res.status}`);
      }
      const html = await res.text();
      const seen = new Set<string>();
      const urls: string[] = [];
      const linkRe = /\/apps\/mpch\/MissingPerson\/mpDetails\/([A-Za-z0-9-]+)/g;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(html)) !== null) {
        const id = m[1];
        if (!id) continue;
        const detailUrl = `${BASE}/apps/mpch/MissingPerson/mpDetails/${id}`;
        if (seen.has(detailUrl)) continue;
        seen.add(detailUrl);
        urls.push(detailUrl);
        if (detailLimit && urls.length >= detailLimit) break;
      }
      return urls;
    },
  },
  detail: {
    kind: 'cheerio',
    selectors: {
      // Name field renders as "<span><strong>Name: </strong></span>
      // <span>Jose Angel Fuentes</span>" — the value is wrapped in
      // its own span, so the standard text-after-strong helper would
      // pick up only the surrounding whitespace. Pull the name in a
      // transform instead. We still declare a selector here so the
      // runner has a non-empty extraction signal.
      name: 'div.detailDataContainer',
    },
    transforms: {
      victim_name: (_raw, $) => {
        // Match `<span><strong>Name: </strong></span><span>VALUE</span>`
        // directly — the value is inside an adjacent span, not a text node.
        const html = $('div.detailDataContainer').first().html() ?? '';
        const m = html.match(
          /<span>\s*<strong>\s*Name\s*:\s*<\/strong>\s*<\/span>\s*<span>([^<]+)<\/span>/i,
        );
        return m?.[1]?.replace(/\s+/g, ' ').trim() || undefined;
      },

      victim_age: (_raw, $) => {
        const raw = spanLabelValue($, 'Age Missing');
        return raw ? parseAge(raw) : undefined;
      },
      victim_sex: (_raw, $) => parseSex(spanLabelValue($, 'Sex') ?? ''),
      victim_race: (_raw, $) => spanLabelValue($, 'Race'),
      victim_hair_color: (_raw, $) => spanLabelValue($, 'Hair Color'),
      victim_eye_color: (_raw, $) => spanLabelValue($, 'Eye Color'),
      victim_height_cm: (_raw, $) => extractHeight($),
      victim_weight_kg: (_raw, $) => {
        const raw = spanLabelValue($, 'Weight');
        return raw ? weightToKg(raw) : undefined;
      },
      victim_aliases: (_raw, $) => {
        const raw = strongLabelValue($, 'AKA');
        if (!raw) return undefined;
        const aliases = raw
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        return aliases.length ? aliases : undefined;
      },

      incident_date: (_raw, $) =>
        parseDate(spanLabelValue($, 'Last Seen on') ?? '').iso,
      incident_date_quality: (_raw, $) =>
        parseDate(spanLabelValue($, 'Last Seen on') ?? '').quality,
      incident_date_text: (_raw, $) => {
        const raw = spanLabelValue($, 'Last Seen on');
        if (!raw) return undefined;
        return parseDate(raw).quality !== 'exact' ? raw : undefined;
      },
      last_seen_date: (_raw, $) =>
        parseDate(spanLabelValue($, 'Last Seen on') ?? '').iso,
      last_seen_text: (_raw, $) => {
        const city = cityFromLastSeen(strongLabelValue($, 'Last Seen in'));
        const state = spanLabelValue($, 'State Missing From');
        if (!city && !state) return undefined;
        return [city, state].filter(Boolean).join(', ');
      },
      last_seen_circumstances: (_raw, $) => {
        const raw = $('.circumstancesContainer p').first().text() ?? '';
        // Strip the leading "Circumstances: " label that lives inside
        // the same <p> as the body text.
        const cleaned = raw.replace(/^\s*Circumstances\s*:?\s*/i, '').trim();
        return cleaned || undefined;
      },

      location_city: (_raw, $) =>
        cityFromLastSeen(strongLabelValue($, 'Last Seen in')),
      location_state: (_raw, $) => {
        // "State Missing From" is the source-of-truth for the case's
        // location. Falls back to TX when absent (rare; the field is
        // populated on every observed record so far).
        const explicit = parseState(spanLabelValue($, 'State Missing From') ?? '');
        return explicit ?? 'TX';
      },

      // No agency block on the detail page — TX DPS is the agency-of-
      // record. The local PD's case ref lives in Case Number; we expose
      // it via case_number_primary for the agency_case_number dedupe key.
      agency_hint: (): AgencyHint => ({
        name: 'Texas Department of Public Safety',
      }),

      case_number_primary: (_raw, $) =>
        spanLabelValue($, 'Case Number'),

      photos: (_raw, $): ExtractedPhoto[] => {
        const photos: ExtractedPhoto[] = [];
        $('img.mainDetailsFinalPic').each((_, el) => {
          const src = $(el).attr('src');
          if (!src) return;
          // Absolute URL on dps.texas.gov; hot-linkable per gov-works policy.
          photos.push({ url: src, kind: 'photo_victim' });
        });
        return photos;
      },

      narrative: (_raw, $) => {
        const raw = $('.circumstancesContainer p').first().text() ?? '';
        const cleaned = raw.replace(/^\s*Circumstances\s*:?\s*/i, '').trim();
        return cleaned ? truncateNarrative(cleaned) : undefined;
      },
      narrative_short: (_raw, $) => {
        const raw = $('.circumstancesContainer p').first().text() ?? '';
        const cleaned = raw.replace(/^\s*Circumstances\s*:?\s*/i, '').trim();
        if (!cleaned) return undefined;
        return cleaned.split(/\n{2,}/)[0]?.slice(0, 240) || undefined;
      },

      events: (_raw, $, pageUrl): CaseEventInput[] | undefined => {
        const rawDate = spanLabelValue($, 'Last Seen on');
        if (!rawDate || !pageUrl) return undefined;
        const parsed = parseDate(rawDate);
        if (!parsed.iso && parsed.quality === 'unknown') return undefined;
        const city = cityFromLastSeen(strongLabelValue($, 'Last Seen in'));
        const state = spanLabelValue($, 'State Missing From');
        const locLabel = [city, state].filter(Boolean).join(', ');
        return [
          {
            event_kind: 'last_seen',
            headline: locLabel ? `Last seen — ${locLabel}` : 'Last seen',
            event_date: parsed.iso ?? undefined,
            event_date_quality: parsed.quality,
            event_date_text: parsed.quality !== 'exact' ? rawDate : undefined,
            source_url: pageUrl,
            source_quote: `Last Seen on: ${rawDate}`,
          },
        ];
      },

      raw: (_raw, $) => ({
        caseType: spanLabelValue($, 'Case Type'),
        dateOfBirth: spanLabelValue($, 'Date of Birth'),
        countryMissingFrom: spanLabelValue($, 'Country Missing From'),
        // Case Number is the agency-issued ref; keep raw to make the
        // URL-ID vs case-number distinction auditable from the row alone.
        caseNumber: spanLabelValue($, 'Case Number'),
      }),
    },
    inferKind: () => 'missing',
  },
  defaults: {
    status: 'open',
    kind: 'missing',
    incident_date_quality: 'unknown',
    photos: [],
    raw: {},
  },
};

// Suppress "imported but unused" warning for the photo-base constant,
// which is documented in the header for future debugging but not used
// in code paths (photos arrive on the detail page as absolute URLs).
void PHOTO_BASE;
