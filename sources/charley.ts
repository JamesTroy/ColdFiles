import type { SourceConfig } from '../supabase/functions/_shared/types.ts';
import type { CaseEventInput } from '../supabase/functions/_shared/case-events.ts';
import { byLabel, textOf } from '../supabase/functions/_shared/extract.ts';
import {
  extractPhone,
  heightToCm,
  parseAge,
  parseDate,
  parseSex,
  parseState,
  truncateNarrative,
  weightToKg,
} from '../supabase/functions/_shared/normalize.ts';

/**
 * The Charley Project — single-operator WordPress site, ~16k missing-person profiles.
 * Be exceptionally polite (5s between requests, 02:00–05:00 UTC window).
 *
 * Real DOM (vendored fixture: case_john-andrew-aarlie.html):
 *   article.type-case > .entry-content > h1.entry-title
 *                                       > #case
 *                                         > #case-top
 *                                           > #photos > ul > li > img
 *                                           > .column > ul > li > <strong>{Label}</strong> {value}
 *                                         > #case-bottom
 *                                           > .column:first-child > h3 + p (narrative)
 *                                           > .column > #agencies > ul > li (name + phone, newline-separated)
 *
 * Meta-list labels we extract from #case-top:
 *   "Missing Since", "Missing From", "Classification", "Sex", "Race", "Date of Birth",
 *   "Age", "Height and Weight", "Clothing/Jewelry Description", "Medical Conditions",
 *   "Distinguishing Characteristics".
 *
 * Discovery uses the WordPress sitemap (wp-sitemap-posts-case-N.xml) — far cleaner
 * than the alphabetical index, and the site publishes one anyway.
 */
export const charleyProject: SourceConfig = {
  slug: 'charley_project',
  name: 'The Charley Project',
  kind: 'nonprofit',
  baseUrl: 'https://charleyproject.org',
  rateLimitMs: 5000,
  scheduleCron: '0 9 1 * *',
  trustWeight: 75,
  windowUtc: { startHour: 2, endHour: 5 },
  attribution: {
    html: 'Source: <a href="https://charleyproject.org" rel="external">The Charley Project</a>',
    linkBackRequired: true,
  },
  list: {
    kind: 'sitemap',
    sitemapUrl: 'https://charleyproject.org/wp-sitemap.xml',
    urlPattern: /\/case\/[a-z0-9-]+\/?$/i,
  },
  detail: {
    kind: 'cheerio',
    selectors: {
      name: 'h1.entry-title',
      photoUrls: '#photos img',
    },
    transforms: {
      victim_age: (_, $) => parseAge(byLabel($, '#case-top li', 'Age') ?? ''),
      victim_sex: (_, $) => parseSex(byLabel($, '#case-top li', 'Sex') ?? ''),
      victim_race: (_, $) => orUndef(byLabel($, '#case-top li', 'Race')),
      victim_height_cm: (_, $) => {
        const hw = byLabel($, '#case-top li', 'Height and Weight');
        return hw ? heightToCm(hw.split(',')[0] ?? '') : undefined;
      },
      victim_weight_kg: (_, $) => {
        const hw = byLabel($, '#case-top li', 'Height and Weight');
        const part = hw?.split(',')[1];
        return part ? weightToKg(part) : undefined;
      },
      distinguishing_marks: (_, $) =>
        orUndef(byLabel($, '#case-top li', 'Distinguishing Characteristics')),
      last_seen_clothing: (_, $) =>
        orUndef(byLabel($, '#case-top li', 'Clothing/Jewelry Description')),
      incident_date: (_, $) => {
        const raw = byLabel($, '#case-top li', 'Missing Since');
        return raw ? parseDate(raw).iso : undefined;
      },
      incident_date_quality: (_, $) => {
        const raw = byLabel($, '#case-top li', 'Missing Since');
        return raw ? parseDate(raw).quality : 'unknown';
      },
      incident_date_text: (_, $) => {
        const raw = byLabel($, '#case-top li', 'Missing Since');
        return raw && parseDate(raw).quality !== 'exact' ? raw : undefined;
      },
      location_text: (_, $) => orUndef(byLabel($, '#case-top li', 'Missing From')),
      location_state: (_, $) => {
        const raw = byLabel($, '#case-top li', 'Missing From');
        const tail = raw?.split(',').pop()?.trim();
        return tail ? parseState(tail) : undefined;
      },
      location_city: (_, $) => {
        const raw = byLabel($, '#case-top li', 'Missing From');
        const head = raw?.split(',')[0]?.trim();
        return head || undefined;
      },
      agency_hint: (_, $) => {
        const li = $('#agencies li').first();
        if (!li.length) return undefined;
        const lines = li
          .text()
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean);
        return {
          name: lines[0] || undefined,
          phone: lines[1] ? extractPhone(lines[1]) : undefined,
        };
      },
      narrative: (_, $) => {
        const raw = textOf($, '#case-bottom .column', { preserveNewlines: true });
        const cleaned = raw.replace(/^Details of Disappearance\s*/i, '').trim();
        return cleaned ? truncateNarrative(cleaned) : undefined;
      },
      narrative_short: (_, $) => {
        const raw = textOf($, '#case-bottom .column', { preserveNewlines: true });
        const cleaned = raw.replace(/^Details of Disappearance\s*/i, '').trim();
        return cleaned.split(/\n{2,}/)[0]?.slice(0, 240) || undefined;
      },
      // Timeline events — Charley emits last_seen from the "Missing Since"
      // meta-list value. source_quote is the raw upstream value verbatim
      // (with the field label preserved so an operator audit reads cleanly).
      // Suppressed when Missing Since didn't parse to a date — a dateless
      // last_seen headline isn't useful in the timeline.
      events: (_, $, pageUrl) => {
        const rawDate = byLabel($, '#case-top li', 'Missing Since');
        if (!rawDate) return undefined;
        const parsed = parseDate(rawDate);
        if (!parsed.iso && parsed.quality === 'unknown') return undefined;
        const url = pageUrl ?? '';
        if (!url) return undefined;
        const locationLabel = byLabel($, '#case-top li', 'Missing From')?.trim();
        const event: CaseEventInput = {
          event_kind: 'last_seen',
          headline: locationLabel ? `Last seen — ${locationLabel}` : 'Last seen',
          event_date: parsed.iso ?? undefined,
          event_date_quality: parsed.quality,
          event_date_text: parsed.quality !== 'exact' ? rawDate : undefined,
          source_url: url,
          source_quote: `Missing Since: ${rawDate}`,
        };
        return [event];
      },
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

function orUndef(v: string | undefined): string | undefined {
  return v && v.length ? v : undefined;
}
