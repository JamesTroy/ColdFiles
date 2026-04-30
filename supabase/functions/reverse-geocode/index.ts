// Edge Function: reverse-geocode
//
// Server-side reverse geocoding for the watch-zone Save & Name sheet. Caches
// every centroid lookup in the existing geocode_cache table so each unique
// zone center costs us at most one upstream call ever. Centroid-keyed
// caching is the design intent; without it Nominatim's no-heavy-use clause
// would bite the moment we have enough users to care (per spec note).
//
// Provider: Nominatim (OpenStreetMap). Free, no key, but their usage policy
// requires a real User-Agent and reasonable rate (1 req/sec). We satisfy
// both: the cache hit-rate makes the actual upstream rate negligible, and
// the UA identifies the project so they can reach us if there's an issue.
//
// Contract:
//   POST /reverse-geocode
//   Body: { lat: number, lng: number }
//   Response 200: { label: string, source: 'cache' | 'nominatim' }
//   Response 4xx: { error: string }
//
// The label is something the SaveSheet can prefill — short and human:
// "Ojai, CA" / "Channel Islands, Ventura County, CA" / "South Bay, LA".
// Capped at 40 chars; truncated mid-word avoided by preferring earlier
// commas as truncation points.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = mustEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = mustEnv('SUPABASE_SERVICE_ROLE_KEY');

// Identifies us per Nominatim's usage policy. Include both the project URL
// and a contact email — operator can be reached if traffic looks anomalous.
const NOMINATIM_UA =
  'ColdFile/1.0 (+https://coldfile.app; contact@coldfile.app)';

const MAX_LABEL_LEN = 40;
const CACHE_KIND = 'r'; // distinguishes from the forward-geocode entries

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`reverse-geocode: missing required env ${name}`);
  return v;
}

interface RequestBody {
  lat?: number;
  lng?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return errResponse(405, 'method_not_allowed');

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return errResponse(400, 'invalid_json');
  }
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return errResponse(400, 'lat_lng_required');
  }
  if (Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return errResponse(400, 'lat_lng_out_of_range');
  }

  // Cache key — 3 decimal places ≈ 110m precision. Two zones with centers
  // within 110m collapse to the same cache entry. Acceptable for our scale;
  // if a user zone-hops by 50m the label is still right.
  const latRounded = body.lat.toFixed(3);
  const lngRounded = body.lng.toFixed(3);
  const cacheKey = `${CACHE_KIND}:${latRounded},${lngRounded}`;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Cache lookup.
  const { data: cached } = await supabase
    .from('geocode_cache')
    .select('raw, cached_at')
    .eq('query_normalized', cacheKey)
    .maybeSingle();

  if (cached) {
    const raw = cached.raw as { label?: string } | null;
    if (raw?.label) {
      return ok({ label: raw.label, source: 'cache' });
    }
  }

  // Upstream call. Default to en-US so we get readable English place names.
  const upstream = await callNominatim(body.lat, body.lng).catch(() => null);
  const label = upstream ? formatLabel(upstream) : null;

  if (!label) {
    // Fall through gracefully — the client falls back to "Watch zone — {date}"
    // when the label is empty.
    return ok({ label: '', source: 'nominatim' });
  }

  // Cache write — best-effort; a failed insert doesn't block the response.
  await supabase
    .from('geocode_cache')
    .upsert({
      query_normalized: cacheKey,
      lat: body.lat,
      lng: body.lng,
      precision: 'reverse',
      raw: { label, upstream },
    })
    .then(() => undefined)
    .catch(() => undefined);

  return ok({ label, source: 'nominatim' });
});

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  county?: string;
  state?: string;
  country_code?: string;
  neighbourhood?: string;
  suburb?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
  display_name?: string;
}

async function callNominatim(
  lat: number,
  lng: number,
): Promise<NominatimResponse | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?` +
    `lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1&zoom=10`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': NOMINATIM_UA,
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as NominatimResponse;
}

function formatLabel(n: NominatimResponse): string {
  const a = n.address ?? {};
  const place = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.neighbourhood;
  const region = a.state;
  const country = (a.country_code ?? '').toUpperCase();

  // Prefer the most specific place + state abbrev. Two-letter US states get
  // abbreviated ("California" → "CA") for compactness; non-US fall back to
  // the country code.
  const stateShort = country === 'US' && region
    ? US_STATE_TO_ABBREV[region.toLowerCase()] ?? region
    : region;

  const parts = [place, stateShort].filter(Boolean) as string[];
  if (parts.length > 0) {
    return clamp(parts.join(', '), MAX_LABEL_LEN);
  }
  // Last resort — first segment of display_name.
  if (n.display_name) {
    return clamp(n.display_name.split(',').slice(0, 2).join(',').trim(), MAX_LABEL_LEN);
  }
  return '';
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  // Prefer truncating at a comma boundary so we don't cut a place name in
  // half.
  const trimmed = s.slice(0, max);
  const lastComma = trimmed.lastIndexOf(',');
  if (lastComma > 8) return trimmed.slice(0, lastComma);
  return trimmed.replace(/\s+\S*$/, '') + '…';
}

const US_STATE_TO_ABBREV: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC',
};

function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, x-client-info, content-type, apikey',
      'access-control-max-age': '86400',
    },
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, x-client-info, content-type, apikey',
    },
  });
}

function errResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, x-client-info, content-type, apikey',
    },
  });
}
