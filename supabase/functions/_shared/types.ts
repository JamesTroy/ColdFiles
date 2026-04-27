// Shared types used by every source config, the ingest runner, and the local CLI.
// `import type` only — no runtime imports. Safe to import from Node and Deno alike.

import type { CheerioAPI } from 'cheerio';

export type CaseKind =
  | 'homicide'
  | 'missing'
  | 'unidentified'
  | 'unclaimed'
  | 'suspicious_death';

export type CaseStatus =
  | 'open'
  | 'cleared_arrest'
  | 'cleared_other'
  | 'identified'
  | 'located'
  | 'withdrawn';

export type SexKind = 'male' | 'female' | 'unknown' | 'other';

export type DateQuality =
  | 'exact'
  | 'approximate'
  | 'year_only'
  | 'suspect'
  | 'unknown';

export type SourceKind =
  | 'federal'
  | 'state'
  | 'agency'
  | 'aggregator'
  | 'nonprofit'
  | 'media';

export type MediaKind =
  | 'photo_victim'
  | 'sketch_victim'
  | 'reconstruction'
  | 'age_progression'
  | 'photo_clothing'
  | 'photo_jewelry'
  | 'photo_evidence'
  | 'photo_location'
  | 'sketch_poi'
  | 'document';

export type TipRouteKind =
  | 'crime_stoppers_p3'
  | 'agency_form'
  | 'agency_phone'
  | 'fbi_tip'
  | 'namus_form'
  | 'email';

export interface ExtractedPhoto {
  url: string;
  caption?: string;
  kind: MediaKind;
}

export interface AgencyHint {
  name?: string;
  phone?: string;
  tip_url?: string;
}

/**
 * The output of a source's detail-page extraction. One CaseRecord per source row.
 * Multiple CaseRecords across sources collapse into a single `cases` row via dedupe.
 */
export interface CaseRecord {
  source_external_id: string;
  source_url: string;
  kind: CaseKind;
  status: CaseStatus;

  victim_name?: string;
  victim_first_name?: string;
  victim_last_name?: string;
  victim_aliases?: string[];
  victim_age?: number;
  victim_age_min?: number;
  victim_age_max?: number;
  victim_sex?: SexKind;
  victim_race?: string;
  victim_ethnicity?: string;
  victim_height_cm?: number;
  victim_weight_kg?: number;
  victim_eye_color?: string;
  victim_hair_color?: string;
  distinguishing_marks?: string;

  incident_date?: string; // ISO YYYY-MM-DD
  incident_date_quality: DateQuality;
  incident_date_text?: string;

  location_text?: string;
  location_city?: string;
  location_county?: string;
  location_state?: string; // 2-letter
  location_zip?: string;

  last_seen_text?: string;
  last_seen_date?: string;
  last_seen_clothing?: string;
  last_seen_circumstances?: string;

  narrative?: string;
  narrative_short?: string;

  case_number_primary?: string;
  ncic_number?: string;
  namus_number?: string;
  reward_amount_usd?: number;
  reward_text?: string;

  agency_hint?: AgencyHint;
  photos: ExtractedPhoto[];

  /** Everything we extracted, kept verbatim for re-scoring when we improve the parser. */
  raw: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Source configs
// ────────────────────────────────────────────────────────────────────────────

export interface ListStrategyStatePagination {
  kind: 'state_index_pagination';
  /** Returns a path (relative to baseUrl) for a given 2-letter state code. */
  statePath: (state: string) => string;
  /** Query param name used for pagination. */
  pageParam: string;
  /** States to iterate. */
  states: string[];
}

export interface ListStrategySitemap {
  kind: 'sitemap';
  sitemapUrl: string;
  urlPattern: RegExp;
}

export interface ListStrategyJsonApi {
  kind: 'json_api';
  /** One or more index endpoint URLs. Each is fetched independently. */
  endpoints: string[];
  /** Dot-path into the response for the array of result items. Empty string for top-level array. */
  itemsPath: string;
  /** Map a JSON item into the URL of its detail page. */
  detailUrl: (item: Record<string, unknown>) => string;
  /** Optional pagination. Omit for single-shot endpoints (Doe Network). */
  paginate?: {
    pageSize: number;
    /** Dot-path into the response for the next-cursor value. */
    cursorPath: string;
  };
}

export interface ListStrategyAlphaIndex {
  kind: 'alpha_index';
  indexUrl: string;
  /** If provided, the index URL is appended with `?{letterParam}=A`, ..., `?{letterParam}=Z`. */
  letterParam?: string;
  /** Selector for case-detail anchors on each index page. */
  detailLinkSelector?: string;
}

export type ListStrategy =
  | ListStrategyStatePagination
  | ListStrategySitemap
  | ListStrategyJsonApi
  | ListStrategyAlphaIndex;

export interface DetailSelectors {
  name?: string;
  age?: string;
  sex?: string;
  race?: string;
  height?: string;
  weight?: string;
  incidentDate?: string;
  lastSeenDate?: string;
  locationText?: string;
  locationCity?: string;
  locationState?: string;
  narrative?: string;
  /** Selector matching one or more <img> elements. The runner pulls [src]. */
  photoUrls?: string;
  agencyName?: string;
  agencyPhone?: string;
  caseNumber?: string;
  namusNumber?: string;
  ncicNumber?: string;
  rewardText?: string;
  distinguishingMarks?: string;
  clothing?: string;
}

export interface DetailStrategyCheerio {
  kind: 'cheerio';
  selectors: DetailSelectors;
  /** Date formats to try in order when parsing extracted date strings. Uses date-fns-style tokens. */
  dateFormats?: string[];
  /** Per-field transforms when selectors aren't enough. The transform receives the raw selector text. */
  transforms?: {
    [field in keyof CaseRecord]?: (raw: string, $: CheerioAPI) => unknown;
  };
  /** Inferred case kind if not derivable from URL/selectors. */
  inferKind?: (record: Partial<CaseRecord>) => CaseKind;
  /** If a source uses photos differently per field — override the default 'photo_victim' kind. */
  photoKind?: (imgUrl: string, alt: string) => MediaKind;
}

/**
 * For sources whose detail data lives in one or more JSON endpoints (Doe Network's
 * mpdatabase.php?id=X&fields=true / &agencies=true / &images=true). The runner
 * fetches every URL fetchUrls() returns, keyed by the same key, and hands the
 * resulting record to mapJson.
 */
export interface DetailStrategyJson {
  kind: 'json';
  /** Build URLs to fetch for one detail. Multiple URLs supported when a source splits data across endpoints. */
  fetchUrls: (detailUrl: string) => Record<string, string>;
  /** Map the fetched JSON map (keyed by fetchUrls keys) into a partial CaseRecord. */
  mapJson: (data: Record<string, unknown>, detailUrl: string) => Partial<CaseRecord>;
  /** Inferred case kind if mapJson can't determine it. */
  inferKind?: (record: Partial<CaseRecord>) => CaseKind;
}

export type DetailStrategy = DetailStrategyCheerio | DetailStrategyJson;

export interface SourceAttribution {
  html: string;
  linkBackRequired: boolean;
}

export interface SourceConfig {
  slug: string;
  name: string;
  kind: SourceKind;
  baseUrl: string;
  /** Minimum milliseconds between consecutive requests to this host. */
  rateLimitMs: number;
  userAgent?: string;
  /** Standard cron expression. The runner reads this to compute next_run_at. */
  scheduleCron: string;
  attribution: SourceAttribution;
  list: ListStrategy;
  detail: DetailStrategy;
  defaults?: Partial<CaseRecord>;
  /** 0-100. Field-conflict resolution prefers higher trust. */
  trustWeight: number;
  /** Optional time-of-day window (UTC). E.g. only run between 02:00-05:00 source-local. */
  windowUtc?: { startHour: number; endHour: number };
}

// ────────────────────────────────────────────────────────────────────────────
// Dedupe
// ────────────────────────────────────────────────────────────────────────────

export type DedupeKeyType =
  | 'namus_number'
  | 'ncic_number'
  | 'name_state_year'
  | 'lastname_age_sex'
  | 'agency_case_number'
  | 'source_external_id';

export interface DedupeKey {
  type: DedupeKeyType;
  value: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Pipeline result types
// ────────────────────────────────────────────────────────────────────────────

export interface DryRunResult {
  source_slug: string;
  detail_urls_seen: number;
  records_extracted: number;
  records: CaseRecord[];
  dedupe_keys_per_record: DedupeKey[][];
}

export interface RunStats {
  cases_seen: number;
  cases_new: number;
  cases_updated: number;
  errors: { url: string; message: string }[];
}
