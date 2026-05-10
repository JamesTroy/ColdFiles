// Edge Function: takedown-confirm
//
// Public click-link handler for the takedown email-confirmation gate
// (audit H3). Submitters land here from the confirmation email sent by
// takedown-submit. Successful click flips `confirmed_at = now()` on the
// matching takedown_requests row, which is what surfaces the request to
// the operator review queue (queue filter: `confirmed_at IS NOT NULL`).
//
// Contract:
//   GET /takedown-confirm?token=<base64url-token>
//   HEAD /takedown-confirm?token=<...>   — same gating, no body
//   200 text/html — confirmed (or already-confirmed idempotent re-click)
//   400 text/html — invalid / missing token
//   410 text/html — link expired (>7 days post-submit)
//   429 text/html — per-IP rate limit
//   500 JSON     — internal error (correlation id for ops grep)
//
// Token storage: takedown_requests stores SHA-256 hex of the raw token.
// We hash the URL token and look up by hash; the raw token never lived
// in the DB, so a DB read could not have produced a clickable URL.
//
// Rate limit: per-IP 10/min. With 256-bit token entropy, brute-force is
// computationally infeasible — this rate limit blocks link-scanner storms,
// click noise, and any drive-by enumeration; it is not the primary defense.
//
// `cases.takedown_requested_at` (the case-hide gate) is NOT touched by
// this function. The operator still decides what gets honored. This
// endpoint only opens the queue door for review.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { internalError } from '../_shared/responses.ts';
import {
  type FormattedCaseInfo,
  type NotifyContext,
  isOperatorNotifyConfigured,
  logSendError,
  notifyOperator,
} from '../_shared/takedown-notify.ts';

const SUPABASE_URL = mustEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = mustEnv('SUPABASE_SERVICE_ROLE_KEY');

// Per-IP rate limit on the confirm click. 10/min is far above any legitimate
// click pattern (the user clicks once; email scanners and link-preview bots
// sometimes pre-fetch, but rarely 10x in a minute) and far below anything
// that would let a scripted enumerator probe the token space.
const RL_CLICKS_PER_MIN = 10;

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`takedown-confirm: missing required env ${name}`);
  return v;
}

interface CaseRow {
  slug: string | null;
  victim_name: string | null;
  kind: string | null;
  location_city: string | null;
  location_state: string | null;
  case_number_primary: string | null;
}

interface TakedownRow {
  id: string;
  case_id: string;
  reference_code: string;
  requester_relationship: string | null;
  requester_relationship_other: string | null;
  resolutions: string[] | null;
  reason: string;
  confirmation_expires_at: string | null;
  confirmed_at: string | null;
}

Deno.serve(async (req) => {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return htmlResponse(405, errorPage('Method not allowed', 'This endpoint only accepts GET requests.'));
  }

  // Parse + sanity-check the token. Don't echo the raw token in any error
  // body — it's a credential, not a query identifier.
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  if (!token || !isPlausibleToken(token)) {
    return htmlResponse(400, errorPage('Invalid link', 'This confirmation link is invalid.'));
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Per-IP rate limit before the DB lookup. Mirrors reverse-geocode's
  // backstop pattern (mig 45) but uses takedown_confirm_rate_limit (mig 46).
  const ipHash = await sha256Hex(`coldfile-ip-v1:${ipFor(req)}`);
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: clickCount } = await supabase
    .from('takedown_confirm_rate_limit')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', oneMinAgo);
  if ((clickCount ?? 0) >= RL_CLICKS_PER_MIN) {
    return htmlResponse(
      429,
      errorPage('Too many attempts', 'Please wait a moment and try the link again.'),
      { 'retry-after': '60' },
    );
  }
  // Log the click attempt before the lookup. Failed inserts here don't block
  // the user — rate limit is defense in depth, not the primary control.
  try {
    await supabase
      .from('takedown_confirm_rate_limit')
      .insert({ ip_hash: ipHash });
  } catch {
    // best-effort
  }

  const tokenHash = await sha256Hex(token);

  const { data: row, error: selectError } = await supabase
    .from('takedown_requests')
    .select(
      'id, case_id, reference_code, requester_relationship, ' +
      'requester_relationship_other, resolutions, reason, ' +
      'confirmation_expires_at, confirmed_at',
    )
    .eq('confirmation_token_hash', tokenHash)
    .maybeSingle();

  if (selectError) {
    return internalError(req, selectError, 'takedown-confirm.select');
  }
  if (!row) {
    return htmlResponse(400, errorPage('Invalid link', 'This confirmation link is invalid or has already been used up.'));
  }

  const takedown = row as unknown as TakedownRow;

  // Expiry check — 410 Gone is the right status for "the resource was
  // valid, the link no longer is."
  const now = Date.now();
  const expiresAt = takedown.confirmation_expires_at
    ? Date.parse(takedown.confirmation_expires_at)
    : null;
  if (expiresAt !== null && expiresAt < now) {
    return htmlResponse(
      410,
      errorPage(
        'Link expired',
        'This confirmation link expired. If you still want to file the request, please submit it again from the app.',
      ),
    );
  }

  // Idempotent re-click — return a friendly already-confirmed page rather
  // than an error. Email scanners + double-clicks should not look like
  // failures to the user.
  if (takedown.confirmed_at) {
    return htmlResponse(
      200,
      successPage(takedown.reference_code, /* alreadyConfirmed */ true),
    );
  }

  // Flip the gate.
  const { error: updateError } = await supabase
    .from('takedown_requests')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('id', takedown.id);
  if (updateError) {
    return internalError(req, updateError, 'takedown-confirm.update');
  }

  // Operator notify. Best-effort, fire-and-forget; the user-facing response
  // shouldn't block on email send. Note that the operator notify happens
  // HERE, not in takedown-submit — that's the audit H3 fix in two pieces
  // (gate the row + delay the operator notify until email ownership is
  // proven).
  //
  // We don't have the raw submitter email at this layer — takedown-submit
  // dropped it after sending the confirmation, by design (storing it would
  // re-open the privacy posture submit explicitly closed). The operator
  // gets the reference code + request id, and can correspond with the
  // submitter via the reply-to chain on any further email touch. The
  // success HTML page below IS the post-confirm receipt for the submitter.
  if (isOperatorNotifyConfigured()) {
    const { data: caseRow } = await supabase
      .from('cases')
      .select('slug, victim_name, kind, location_city, location_state, case_number_primary')
      .eq('id', takedown.case_id)
      .maybeSingle();

    const ctx: NotifyContext = {
      reference: takedown.reference_code,
      caseId: takedown.case_id,
      caseInfo: formatCaseInfo(caseRow),
      relationship: takedown.requester_relationship ?? 'other',
      relationshipOther: takedown.requester_relationship_other,
      resolutions: takedown.resolutions ?? [],
      reasonFull: takedown.reason,
      contactEmail: `(verified at confirmation; see request id ${takedown.id})`,
      contactPhone: null,
      requestId: takedown.id,
    };
    notifyOperator(ctx).catch(logSendError('operator notify (post-confirm)'));
  }

  return htmlResponse(200, successPage(takedown.reference_code, false));
});

function htmlResponse(
  status: number,
  body: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...extraHeaders,
    },
  });
}

/**
 * Plausible token shape: base64url alphabet, 32 bytes encoded → ~43 chars,
 * no padding. We don't enforce the exact length precisely (43 vs 44) — we
 * just want a cheap rejection for obviously bad inputs before the SHA + DB
 * round trip.
 */
function isPlausibleToken(t: string): boolean {
  return t.length >= 16 && t.length <= 128 && /^[A-Za-z0-9_-]+$/.test(t);
}

function formatCaseInfo(row: unknown): FormattedCaseInfo {
  const r = (row ?? {}) as CaseRow;
  const title = r.victim_name
    ?? (r.kind === 'unidentified' || r.kind === 'unclaimed' ? 'Unidentified person' : 'Name not released');
  const place = [r.location_city, r.location_state].filter(Boolean).join(', ');
  const identifier = r.case_number_primary ?? r.slug?.toUpperCase() ?? 'unknown';
  const metaLine = [place, identifier].filter(Boolean).join(' · ');
  return { title, metaLine, identifier };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function ipFor(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HTML pages — minimal, self-contained, warm amber palette per the brand
// note in CLAUDE.md/MEMORY (amber = ethical posture, not aesthetic). No
// JavaScript, no external assets; this page must work in any email-client
// preview pane and over the worst possible mobile connection.
// ─────────────────────────────────────────────────────────────────────────

const PAGE_HEAD = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>The Cold File · Takedown</title>
<style>
  :root {
    --amber: #b87333;
    --ink: #1c1816;
    --ink-soft: #5a4f48;
    --paper: #faf6f1;
    --rule: #e7dfd5;
  }
  html,body { margin:0; padding:0; background:var(--paper); color:var(--ink); }
  body { font-family: ui-serif, Georgia, "Newsreader", serif; line-height:1.55;
         min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  main { max-width:520px; width:100%; background:#fff; border:1px solid var(--rule);
         border-radius:6px; padding:32px 28px; }
  h1 { font-size:22px; margin:0 0 16px; color:var(--ink); font-weight:600; letter-spacing:-0.01em; }
  h1 .accent { color:var(--amber); }
  p { font-size:15px; margin:12px 0; color:var(--ink-soft); }
  p.lead { color:var(--ink); }
  .ref { display:inline-block; font-family: ui-monospace, "SF Mono", Menlo, monospace;
         font-size:13px; padding:4px 8px; background:#fdf6ec; color:var(--amber);
         border:1px solid #f0e3cf; border-radius:4px; }
  .footer { margin-top:24px; padding-top:16px; border-top:1px solid var(--rule);
            font-size:13px; color:var(--ink-soft); }
  .footer a { color:var(--amber); text-decoration:none; }
</style></head><body><main>`;

const PAGE_TAIL = `<div class="footer">— The Cold File</div></main></body></html>`;

function successPage(reference: string, alreadyConfirmed: boolean): string {
  const headline = alreadyConfirmed
    ? 'Already <span class="accent">confirmed</span>'
    : '<span class="accent">Confirmed</span>'
  ;
  const lead = alreadyConfirmed
    ? "This request has already been confirmed. A person on our team is reviewing it and will reply within 5 business days."
    : "Thanks for confirming. A person on our team will review your request and reply within 5 business days."
  ;
  return `${PAGE_HEAD}
<h1>${headline}</h1>
<p class="lead">${escapeHtml(lead)}</p>
<p>Reference: <span class="ref">${escapeHtml(reference)}</span></p>
<p>If you don't hear back by then, reply to the email we sent and we'll follow up.</p>
${PAGE_TAIL}`;
}

function errorPage(headline: string, body: string): string {
  return `${PAGE_HEAD}
<h1>${escapeHtml(headline)}</h1>
<p class="lead">${escapeHtml(body)}</p>
${PAGE_TAIL}`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
