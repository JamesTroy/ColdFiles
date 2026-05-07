// Cheerio-backed extraction helpers. Used by every detail-page parser.

import * as cheerio from 'cheerio';
import type {
  CaseRecord,
  DetailStrategyCheerio,
  ExtractedPhoto,
  MediaKind,
} from './types.ts';
import {
  parseAge,
  parseDate,
  parseSex,
  parseState,
  splitName,
  truncateNarrative,
  heightToCm,
  weightToKg,
  extractPhone,
} from './normalize.ts';

export type CheerioRoot = ReturnType<typeof cheerio.load>;

/**
 * Run a `DetailStrategy` against a parsed HTML page. Returns a partial CaseRecord
 * with all extractable fields populated. The runner fills in source_external_id,
 * source_url, kind, status afterwards.
 */
export function extractWithStrategy(
  $: CheerioRoot,
  pageUrl: string,
  strategy: DetailStrategyCheerio,
): Partial<CaseRecord> {
  const sel = strategy.selectors;
  const out: Partial<CaseRecord> = {
    photos: [],
    raw: {},
  };

  // Names
  if (sel.name) {
    const name = textOf($, sel.name);
    if (name) {
      out.victim_name = name;
      const parts = splitName(name);
      out.victim_first_name = parts.first;
      out.victim_last_name = parts.last;
      (out.raw as Record<string, unknown>).name = name;
    }
  }

  // Demographics
  if (sel.age) {
    const raw = textOf($, sel.age);
    if (raw) {
      out.victim_age = parseAge(raw);
      (out.raw as Record<string, unknown>).age = raw;
    }
  }
  if (sel.sex) {
    const raw = textOf($, sel.sex);
    if (raw) {
      out.victim_sex = parseSex(raw);
      (out.raw as Record<string, unknown>).sex = raw;
    }
  }
  if (sel.race) {
    const raw = textOf($, sel.race);
    if (raw) {
      out.victim_race = raw;
      (out.raw as Record<string, unknown>).race = raw;
    }
  }
  if (sel.height) {
    const raw = textOf($, sel.height);
    if (raw) {
      out.victim_height_cm = heightToCm(raw);
      (out.raw as Record<string, unknown>).height = raw;
    }
  }
  if (sel.weight) {
    const raw = textOf($, sel.weight);
    if (raw) {
      out.victim_weight_kg = weightToKg(raw);
      (out.raw as Record<string, unknown>).weight = raw;
    }
  }
  if (sel.distinguishingMarks) {
    const raw = textOf($, sel.distinguishingMarks);
    if (raw) out.distinguishing_marks = raw;
  }
  if (sel.clothing) {
    const raw = textOf($, sel.clothing);
    if (raw) out.last_seen_clothing = raw;
  }

  // Date
  if (sel.incidentDate) {
    const raw = textOf($, sel.incidentDate);
    if (raw) {
      const parsed = parseDate(raw);
      if (parsed.iso) out.incident_date = parsed.iso;
      out.incident_date_quality = parsed.quality;
      if (parsed.text) out.incident_date_text = parsed.text;
      else if (raw && parsed.quality !== 'exact') out.incident_date_text = raw;
      (out.raw as Record<string, unknown>).incident_date_raw = raw;
    }
  } else {
    out.incident_date_quality = 'unknown';
  }

  if (sel.lastSeenDate) {
    const raw = textOf($, sel.lastSeenDate);
    if (raw) {
      const parsed = parseDate(raw);
      if (parsed.iso) out.last_seen_date = parsed.iso;
      out.last_seen_text = parsed.text ?? raw;
    }
  }

  // Location
  if (sel.locationText) {
    const raw = textOf($, sel.locationText);
    if (raw) {
      out.location_text = raw;
      // Best-effort extract state from "City, State" pattern.
      const tail = raw.split(',').pop()?.trim();
      if (tail) {
        const st = parseState(tail);
        if (st) out.location_state = st;
      }
      (out.raw as Record<string, unknown>).location_raw = raw;
    }
  }
  if (sel.locationCity) {
    const raw = textOf($, sel.locationCity);
    if (raw) out.location_city = raw;
  }
  if (sel.locationState) {
    const raw = textOf($, sel.locationState);
    if (raw) out.location_state = parseState(raw) ?? raw.toUpperCase().slice(0, 2);
  }

  // Narrative
  if (sel.narrative) {
    const raw = textOf($, sel.narrative, { preserveNewlines: true });
    if (raw) {
      out.narrative = truncateNarrative(raw);
      out.narrative_short = raw.split(/\n{2,}/)[0]?.slice(0, 240);
    }
  }

  // Investigation
  if (sel.caseNumber) {
    const raw = textOf($, sel.caseNumber);
    if (raw) out.case_number_primary = raw;
  }
  if (sel.namusNumber) {
    const raw = textOf($, sel.namusNumber);
    if (raw) out.namus_number = raw;
  }
  if (sel.ncicNumber) {
    const raw = textOf($, sel.ncicNumber);
    if (raw) out.ncic_number = raw;
  }
  if (sel.rewardText) {
    const raw = textOf($, sel.rewardText);
    if (raw) {
      out.reward_text = raw;
      const m = raw.match(/\$?\s*([\d,]+)/);
      if (m) {
        const n = parseInt(m[1].replace(/,/g, ''), 10);
        if (n > 0) out.reward_amount_usd = n;
      }
    }
  }
  if (sel.agencyName || sel.agencyPhone) {
    const name = sel.agencyName ? textOf($, sel.agencyName) : undefined;
    const phoneRaw = sel.agencyPhone ? textOf($, sel.agencyPhone) : undefined;
    out.agency_hint = {
      name: name || undefined,
      phone: phoneRaw ? extractPhone(phoneRaw) : undefined,
    };
  }

  // Photos
  if (sel.photoUrls) {
    const photos: ExtractedPhoto[] = [];
    $(sel.photoUrls).each((_, el) => {
      const img = $(el);
      const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src');
      if (!src) return;
      const abs = absUrl(src, pageUrl);
      const alt = img.attr('alt') ?? '';
      photos.push({
        url: abs,
        caption: alt || undefined,
        kind: strategy.photoKind ? strategy.photoKind(abs, alt) : 'photo_victim',
      });
    });
    out.photos = photos;
  }

  // Custom transforms (always run last so they can override selector-based extractions)
  if (strategy.transforms) {
    for (const [field, fn] of Object.entries(strategy.transforms)) {
      const sourceSelector = sel[field as keyof typeof sel];
      const raw = sourceSelector ? textOf($, sourceSelector) : '';
      const v = fn(raw, $, pageUrl);
      if (v !== undefined && v !== null) {
        // @ts-expect-error: transform return type is unknown; the SourceConfig author owns correctness here.
        out[field as keyof CaseRecord] = v;
      }
    }
  }

  // inferKind
  if (strategy.inferKind) {
    out.kind = strategy.inferKind(out);
  }

  return out;
}

/**
 * Extract structured text from a Cheerio selector.
 *  - default: collapse whitespace
 *  - preserveNewlines: keep paragraph breaks (for narratives)
 */
export function textOf(
  $: CheerioRoot,
  selector: string,
  opts: { preserveNewlines?: boolean } = {},
): string {
  const node = $(selector).first();
  if (!node.length) return '';
  if (!opts.preserveNewlines) {
    return node.text().replace(/\s+/g, ' ').trim();
  }
  // Preserve paragraph breaks: insert newlines between block-level children.
  const cloned = node.clone();
  cloned.find('br').replaceWith('\n');
  cloned.find('p, div, li').each((_, el) => {
    $(el).prepend('\n\n');
  });
  return cloned
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Resolve a relative href against a page URL. */
export function absUrl(href: string, pageUrl: string): string {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return href;
  }
}

/** Pull all anchor hrefs matching a selector. Used by list-page extractors. */
export function linksFromSelector(
  $: CheerioRoot,
  selector: string,
  pageUrl: string,
  filter?: RegExp,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  $(selector).each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const abs = absUrl(href, pageUrl);
    if (filter && !filter.test(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push(abs);
  });
  return out;
}

/** Re-export the cheerio loader so source configs can `import { load } from '@shared/extract'`. */
export const load = cheerio.load;

/**
 * Find a list item whose <strong>/<dt>/<b> label text equals `label`, then return
 * the text content of the item with the label prefix stripped. Useful for sources
 * that lay out meta fields as `<li><strong>{Label}</strong> {value}</li>`
 * (Charley Project, Doe Network, and most legacy non-profit sites).
 *
 * Returns undefined if no match.
 */
export function byLabel(
  $: CheerioRoot,
  itemSelector: string,
  label: string,
): string | undefined {
  const items = $(itemSelector).filter((_, el) => {
    const labelText = $(el).find('strong, b, dt').first().text().trim();
    return labelText === label || labelText === `${label}:`;
  });
  if (!items.length) return undefined;
  const item = items.first();

  const fullText = item.text().replace(/\s+/g, ' ').trim();
  const labelText = item.find('strong, b, dt').first().text().trim();
  if (!labelText) return fullText || undefined;

  const escaped = labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = fullText.replace(new RegExp(`^${escaped}:?\\s*`), '').trim();
  return value || undefined;
}

/** Helper: classify a photo URL into a media_kind. Source configs can override. */
export function defaultPhotoKind(url: string, alt: string): MediaKind {
  const a = `${url} ${alt}`.toLowerCase();
  if (a.includes('reconstruction') || a.includes('facial')) return 'reconstruction';
  if (a.includes('age progress') || a.includes('age-progress')) return 'age_progression';
  if (a.includes('sketch')) return 'sketch_victim';
  if (a.includes('cloth')) return 'photo_clothing';
  if (a.includes('jewel') || a.includes('ring') || a.includes('necklace')) return 'photo_jewelry';
  return 'photo_victim';
}
