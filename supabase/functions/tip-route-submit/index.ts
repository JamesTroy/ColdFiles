// Edge Function: tip-route-submit
//
// The single route-resolution + audit endpoint for submit-tip handoffs.
//
// Contract:
//   POST /tip-route-submit
//   Body: { case_id: uuid, content_hash?: string, user_agent_summary?: string }
//   Returns: { agency_name, route_kind, tip_url, tip_phone }
//
// What it does (in order):
//   1. Rate-limit on ip_hash (cheap COUNT against tip_routings).
//   2. Resolve the route per docs/04_DESIGN_SYSTEM.md "Routing logic":
//        case.tip_*  →  case.primary_agency.tip_*  →  state clearinghouse → FBI
//   3. Insert a tip_routings row (timestamp, target, content_hash, ip_hash,
//      user_agent_summary). Content itself is NEVER stored.
//   4. Return the resolved deep-link target so the client can open it.
//
// Auth: anon — anonymous tips are first-class. Direct anon writes to
// tip_routings are blocked at the policy layer (migration 04); this function
// runs with service-role and is the only path that can write the row.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { resolveTipRoute } from '../_shared/tip-route.ts';
import type { ResolvedRoute, TipRouteAgency } from '../_shared/tip-route.ts';

interface RequestBody {
  case_id?: string;
  content_hash?: string | null;
  user_agent_summary?: string | null;
}

// Rate limits per ip_hash. Tuned for closed testing first; revisit before
// public launch. The minute window catches replay attacks; the hour window
// catches sustained scripted abuse.
const RL_PER_MINUTE = 5;
const RL_PER_HOUR = 30;

// Body size cap. Tip metadata is tiny — case_id + content_hash + UA summary.
// Anything larger is malformed or hostile.
const MAX_BODY_BYTES = 4 * 1024;

// Fail loud on missing env. With Deno.env.get(...) ?? '' the function would
// happily call createClient('','') and surface confusing 401s downstream.
const SUPABASE_URL = mustEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_ANON_KEY = mustEnv('SUPABASE_ANON_KEY');

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`tip-route-submit: missing required env ${name}`);
  return v;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return preflight();
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  // Body size cap — bounded read before JSON parse.
  const contentLength = parseInt(req.headers.get('content-length') ?? '', 10);
  if (!Number.isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'request too large' }, 413);
  }

  let body: RequestBody;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'request too large' }, 413);
    body = JSON.parse(raw) as RequestBody;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  if (!body.case_id || !isUuid(body.case_id)) {
    return json({ error: 'case_id is required' }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Rate-limit on ip_hash.
  const ipHash = await hashIp(req);
  const limited = await isRateLimited(supabase, ipHash);
  if (limited) {
    return json({ error: 'too many requests' }, 429, { 'retry-after': '60' });
  }

  // 2. Resolve the route.
  let resolved: ResolvedRoute;
  try {
    resolved = await resolveRoute(supabase, body.case_id);
  } catch (err) {
    return json({ error: errMessage(err) }, 500);
  }

  // 3. Insert tip_routings row (audit log — content itself is never stored).
  const userId = await extractUserId(req);
  const { error: insertError } = await supabase.from('tip_routings').insert({
    case_id: body.case_id,
    user_id: userId,
    routed_to_agency_id: resolved.agency_id,
    routed_to_url: resolved.tip_url,
    routed_to_kind: resolved.route_kind,
    content_hash: body.content_hash ?? '',
    ip_hash: ipHash,
    user_agent_summary: body.user_agent_summary ?? null,
  });

  if (insertError) {
    // Audit-log row failing doesn't block the user's tip handoff — return
    // the route anyway. But log loudly with structured fields so this surfaces
    // in Supabase logs (the rate-limit query depends on this row landing, so a
    // sustained failure mode would also disable rate limiting).
    console.error(
      JSON.stringify({
        msg: 'tip-route-submit audit insert failed',
        case_id: body.case_id,
        agency_id: resolved.agency_id,
        route_kind: resolved.route_kind,
        ip_hash_prefix: ipHash.slice(0, 8),
        error: insertError.message,
      }),
    );
  }

  // 4. Return the resolved target.
  return json(resolved);
});

async function isRateLimited(
  supabase: ReturnType<typeof createClient>,
  ipHash: string,
): Promise<boolean> {
  // Two windows in one query each (Edge Function-friendly): minute and hour.
  // Both rely on tip_routings_iphash_created_idx — see migration 05.
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();

  const [minute, hour] = await Promise.all([
    supabase
      .from('tip_routings')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', oneMinuteAgo),
    supabase
      .from('tip_routings')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', oneHourAgo),
  ]);

  if ((minute.count ?? 0) >= RL_PER_MINUTE) return true;
  if ((hour.count ?? 0) >= RL_PER_HOUR) return true;
  return false;
}

async function resolveRoute(
  supabase: ReturnType<typeof createClient>,
  caseId: string,
): Promise<ResolvedRoute> {
  // Single read: case + primary agency, both their tip_* fields. location_state
  // is included so we can route to the state clearinghouse when no agency FK.
  const { data, error } = await supabase
    .from('cases')
    .select(`
      id,
      tip_route_kind,
      tip_url,
      tip_phone,
      location_state,
      primary_agency:agencies!cases_primary_agency_id_fkey (
        id,
        name,
        short_name,
        tip_route_kind,
        tip_url,
        phone_tip
      )
    `)
    .eq('id', caseId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('case not found');

  return resolveTipRoute(
    {
      tip_route_kind: (data as { tip_route_kind: ResolvedRoute['route_kind'] | null }).tip_route_kind,
      tip_url: (data as { tip_url: string | null }).tip_url,
      tip_phone: (data as { tip_phone: string | null }).tip_phone,
      location_state: (data as { location_state: string | null }).location_state,
    },
    data.primary_agency as TipRouteAgency | null,
  );
}

async function hashIp(req: Request): Promise<string> {
  // Cloudflare/Vercel/Supabase set this on the inbound; if absent, fall back.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown';
  const data = new TextEncoder().encode(`coldfile-ip-v1:${ip}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function extractUserId(req: Request): Promise<string | null> {
  // The mobile client may pass an Authorization header when auth lands. For
  // anonymous tips the column stays null and that's fine.
  const authz = req.headers.get('authorization');
  if (!authz) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authz } },
    auth: { persistSession: false },
  });
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

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

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, x-client-info, content-type, apikey',
      ...extra,
    },
  });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
