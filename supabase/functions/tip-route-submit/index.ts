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
//   1. Resolve the route per docs/04_DESIGN_SYSTEM.md "Routing logic":
//        case.tip_*  →  case.primary_agency.tip_*  →  FBI tip line
//   2. Insert a tip_routings row (timestamp, target, content_hash, ip_hash,
//      user_agent_summary). Content itself is NEVER stored.
//   3. Return the resolved deep-link target so the client can open it.
//
// Auth: anon — anonymous tips are first-class. The schema's RLS policy on
// tip_routings is `for insert with check (true)`. user_id is captured if a
// session token is present, otherwise null.
//
// Rate-limiting: TODO. The ip_hash + content_hash columns are the levers; a
// future job rejects bursts from a single ip_hash and surfaces "same content
// across many cases" patterns to a moderation queue.

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface RequestBody {
  case_id?: string;
  content_hash?: string | null;
  user_agent_summary?: string | null;
}

interface ResolvedRoute {
  agency_id: string | null;
  agency_name: string;
  route_kind: 'crime_stoppers_p3' | 'agency_form' | 'agency_phone' | 'fbi_tip' | 'namus_form' | 'email';
  tip_url: string | null;
  tip_phone: string | null;
}

const FBI_FALLBACK: ResolvedRoute = {
  agency_id: null,
  agency_name: 'FBI Tip Line',
  route_kind: 'fbi_tip',
  tip_url: 'https://tips.fbi.gov',
  tip_phone: null,
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  if (!body.case_id) {
    return json({ error: 'case_id is required' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  // 1. Resolve the route.
  let resolved: ResolvedRoute;
  try {
    resolved = await resolveRoute(supabase, body.case_id);
  } catch (err) {
    return json({ error: errMessage(err) }, 500);
  }

  // 2. Insert tip_routings row (audit log only — never the content).
  const ipHash = await hashIp(req);
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
    // The audit-log row failing isn't a user-facing error — return the route
    // anyway so the user's actual tip handoff isn't blocked by our bookkeeping.
    console.error('[tip-route-submit] audit insert failed:', insertError.message);
  }

  // 3. Return the resolved target.
  return json(resolved);
});

async function resolveRoute(
  supabase: ReturnType<typeof createClient>,
  caseId: string,
): Promise<ResolvedRoute> {
  // Single read: case + primary agency, both their tip_* fields.
  const { data, error } = await supabase
    .from('cases')
    .select(`
      id,
      tip_route_kind,
      tip_url,
      tip_phone,
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

  // Tier 1: case-level override.
  if (data.tip_route_kind && (data.tip_url || data.tip_phone)) {
    return {
      agency_id: (data.primary_agency as { id?: string } | null)?.id ?? null,
      agency_name:
        (data.primary_agency as { name?: string } | null)?.name ??
        'the investigating agency',
      route_kind: data.tip_route_kind as ResolvedRoute['route_kind'],
      tip_url: data.tip_url ?? null,
      tip_phone: data.tip_phone ?? null,
    };
  }

  // Tier 2: agency default.
  const agency = data.primary_agency as
    | {
        id: string;
        name: string;
        short_name: string | null;
        tip_route_kind: ResolvedRoute['route_kind'] | null;
        tip_url: string | null;
        phone_tip: string | null;
      }
    | null;

  if (agency?.tip_route_kind && (agency.tip_url || agency.phone_tip)) {
    return {
      agency_id: agency.id,
      agency_name: agency.name,
      route_kind: agency.tip_route_kind,
      tip_url: agency.tip_url,
      tip_phone: agency.phone_tip,
    };
  }

  // Tier 3: FBI fallback.
  return FBI_FALLBACK;
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
  // The mobile client may pass an Authorization header when auth lands. For now
  // most tips arrive anonymous; the column stays null and that's fine — the
  // schema's RLS policy explicitly permits null user_id on tip_routings.
  const authz = req.headers.get('authorization');
  if (!authz) return null;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: authz } },
      auth: { persistSession: false },
    },
  );
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, x-client-info, content-type, apikey',
    },
  });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
