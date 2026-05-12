// Edge Function: dna-funding-route
//
// Audit-and-redirect endpoint for the per-case DNA funding handoff. Mirrors
// tip-route-submit's posture: server-side log of the click, no donor data,
// rate-limited, then return the destination URL for the client to open.
//
// Cold File does NOT process payments, hold case-tied funds, or collect any
// data the external platform (Othram / Season of Justice) collects after
// the redirect. See migrations/48_dna_funding_route.sql for the schema and
// docs/13_DNA_FUNDING.md for the policy.
//
// Contract:
//   POST /dna-funding-route
//   Body: { case_id: uuid, user_agent_summary?: string }
//   Returns: { funding_url, funding_kind }
//   Errors: 400 if case_id invalid; 404 if the case has no funding URL
//           (CTA should have been hidden — client-side bug if we see this);
//           429 rate-limited; 500 on internal error.
//
// Auth: anon — same as tip-route-submit. Direct anon writes to
// dna_funding_handoffs are blocked at the RLS layer (mig 48); this function
// runs with service-role and is the only path that can write the row.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflightResponse } from '../_shared/cors.ts';
import { internalError } from '../_shared/responses.ts';
import {
  resolveDnaFundingRoute,
  type DnaFundingCase,
  type DnaFundingKind,
  type ResolvedDnaFundingRoute,
} from '../_shared/dna-funding.ts';

interface RequestBody {
  case_id?: string;
  user_agent_summary?: string | null;
}

// Rate limits per ip_hash. Same shape as tip-route-submit. Donation handoffs
// are click-driven so the per-minute bound stays generous; the hourly bound
// catches sustained scripted abuse.
const RL_PER_MINUTE = 5;
const RL_PER_HOUR = 30;

const MAX_BODY_BYTES = 2 * 1024;

const SUPABASE_URL = mustEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_ANON_KEY = mustEnv('SUPABASE_ANON_KEY');

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`dna-funding-route: missing required env ${name}`);
  return v;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...cors, ...extra },
    });

  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

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

  const ipHash = await hashIp(req);
  const limited = await isRateLimited(supabase, ipHash);
  if (limited) {
    return json({ error: 'too many requests' }, 429, { 'retry-after': '60' });
  }

  let resolved: ResolvedDnaFundingRoute | null;
  try {
    resolved = await loadAndResolve(supabase, body.case_id);
  } catch (err) {
    return internalError(req, err, 'dna-funding-route.resolve');
  }

  if (!resolved) {
    // Client-side bug if we see this — the CTA should have been hidden.
    // Return 404 so the client can hide it after the fact rather than
    // silently redirect to a wrong page.
    return json({ error: 'no DNA funding route for this case' }, 404);
  }

  const userId = await extractUserId(req);
  const { error: insertError } = await supabase.from('dna_funding_handoffs').insert({
    case_id: body.case_id,
    user_id: userId,
    routed_to_url: resolved.funding_url,
    routed_to_kind: resolved.funding_kind,
    ip_hash: ipHash,
    user_agent_summary: body.user_agent_summary ?? null,
  });

  if (insertError) {
    // Fail-closed for the same reason tip-route-submit fails closed: the
    // rate-limiter reads from this table.
    console.error(
      JSON.stringify({
        msg: 'dna-funding-route audit insert failed',
        case_id: body.case_id,
        kind: resolved.funding_kind,
        ip_hash_prefix: ipHash.slice(0, 8),
        error: insertError.message,
      }),
    );
    return internalError(req, insertError, 'dna-funding-route.audit-insert');
  }

  return json(resolved);
});

async function isRateLimited(
  supabase: ReturnType<typeof createClient>,
  ipHash: string,
): Promise<boolean> {
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();

  const [minute, hour] = await Promise.all([
    supabase
      .from('dna_funding_handoffs')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', oneMinuteAgo),
    supabase
      .from('dna_funding_handoffs')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', oneHourAgo),
  ]);

  if ((minute.count ?? 0) >= RL_PER_MINUTE) return true;
  if ((hour.count ?? 0) >= RL_PER_HOUR) return true;
  return false;
}

async function loadAndResolve(
  supabase: ReturnType<typeof createClient>,
  caseId: string,
): Promise<ResolvedDnaFundingRoute | null> {
  const { data, error } = await supabase
    .from('cases')
    .select('dna_funding_url, dna_funding_kind')
    .eq('id', caseId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('case not found');

  return resolveDnaFundingRoute({
    dna_funding_url: (data as { dna_funding_url: string | null }).dna_funding_url,
    dna_funding_kind:
      (data as { dna_funding_kind: DnaFundingKind | null }).dna_funding_kind,
  });
}

async function hashIp(req: Request): Promise<string> {
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
