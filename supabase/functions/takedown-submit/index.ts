// Edge Function: takedown-submit
//
// Anonymous-friendly takedown request endpoint. Receives a case-scoped report
// from a family member, subject, legal counsel, journalist, or rights holder.
// Returns a short reference code; emails both the operator and the submitter
// so the request feels like it landed on a desk, not into a void.
//
// Contract (matches mobile/app/takedown-request/[slug].tsx):
//   POST /takedown-submit
//   Body: {
//     case_id: uuid,
//     relationship: 'family' | 'subject' | 'legal' | 'journalist' | 'other',
//     relationship_other?: string,         // <=50 chars, only when relationship='other'
//     resolutions: ('remove_photo'|'remove_case'|'correct_info'|'other')[],
//     reason: string,                      // 20–1000 chars
//     email: string,                       // raw, hashed before persistence
//     phone?: string                       // raw, hashed before persistence
//   }
//   Response 200: { reference: 'CF-XXXXX', received_at: ISO8601 }
//   Response 429: { error: 'rate_limit', retry_after_s: number }
//   Response 4xx: { error: 'validation', field?: string, message: string }
//
// Privacy posture:
//   - Email hashed with a salted SHA-256 before DB persistence.
//   - Phone hashed the same way.
//   - The raw email + phone live in memory long enough to send the operator
//     and submitter notification emails, then go out of scope.
//   - Reference code is stored unique-indexed so the operator can paste it
//     from the email into the dashboard to find the row.
//
// Migration 04 blocks direct anon writes to takedown_requests; this function
// uses the service-role key to bypass RLS.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflightResponse } from '../_shared/cors.ts';

// Spam-guard tiers — per the spec, the (case_id, email)-per-24h check is the
// real one (catches the legitimate-abuse pattern of someone hitting submit
// multiple times on the same case). IP-per-hour is secondary; mostly defense
// against scripted scraping. Both throw the same opaque "we'll reply to your
// earlier message" copy so we never disclose the threshold.
const RL_PER_CASE_EMAIL_24H = 1;
const RL_PER_IP_HOUR = 5;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_REASON_LEN = 1000;
const MIN_REASON_LEN = 20;

const SUPABASE_URL = mustEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
const NOTIFY_FROM = Deno.env.get('TAKEDOWN_NOTIFY_FROM') ?? null;
const NOTIFY_TO = Deno.env.get('TAKEDOWN_NOTIFY_TO') ?? null;
const NOTIFY_REPLY_TO = Deno.env.get('TAKEDOWN_REPLY_TO') ?? 'takedown@coldfile.app';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? null;
const APP_NAME = Deno.env.get('TAKEDOWN_APP_NAME') ?? 'The Cold File';

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`takedown-submit: missing required env ${name}`);
  return v;
}

type Relationship = 'family' | 'subject' | 'legal' | 'journalist' | 'other';
type Resolution = 'remove_photo' | 'remove_case' | 'correct_info' | 'other';

interface RequestBody {
  case_id?: string;
  relationship?: Relationship;
  relationship_other?: string | null;
  resolutions?: Resolution[];
  reason?: string;
  email?: string;
  phone?: string | null;
}

const VALID_RELATIONSHIPS: ReadonlySet<string> = new Set([
  'family',
  'subject',
  'legal',
  'journalist',
  'other',
]);
const VALID_RESOLUTIONS: ReadonlySet<string> = new Set([
  'remove_photo',
  'remove_case',
  'correct_info',
  'other',
]);

// Crockford-style base32, removing visually ambiguous characters (I, L, O, U,
// 0, 1). Five chars over a 27-char alphabet = ~14.4M codes. Plenty of headroom
// at v1.0.1 scale; if collisions ever bite we extend.
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

Deno.serve(async (req) => {
  // Per-request closures so the response helpers can attach the right
  // Origin-echoing ACAO header without threading req through every call.
  const cors = corsHeaders(req);
  const jsonInit = (status: number, extra: Record<string, string> = {}): ResponseInit => ({
    status,
    headers: {
      'content-type': 'application/json',
      ...cors,
      ...extra,
    },
  });
  const err400 = (error: string, message: string, status = 400): Response =>
    new Response(JSON.stringify({ error, message }), jsonInit(status));
  const errField = (field: string, message: string): Response =>
    new Response(
      JSON.stringify({ error: 'validation', field, message }),
      jsonInit(400),
    );
  // Opaque rate-limit copy — we never disclose which threshold was hit.
  // The form's success-state already commits to "we'll reply to your
  // earlier message," which handles the social side without telling
  // abusers what limit to probe.
  const rateLimited = (): Response =>
    new Response(
      JSON.stringify({
        error: 'rate_limit',
        message:
          "It looks like you've already sent us a request about this case. We'll reply to your earlier message — no need to submit again.",
      }),
      jsonInit(429, { 'retry-after': '86400' }),
    );

  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return err400('method_not_allowed', 'POST only', 405);

  const contentLength = parseInt(req.headers.get('content-length') ?? '', 10);
  if (!Number.isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
    return err400('too_large', 'request too large', 413);
  }

  let body: RequestBody;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return err400('too_large', 'request too large', 413);
    body = JSON.parse(raw) as RequestBody;
  } catch {
    return err400('validation', 'invalid json');
  }

  // Required + shape validation, mapping straight to spec §9.1.
  if (!body.case_id || !isUuid(body.case_id)) {
    return errField('case_id', 'case_id is required');
  }
  if (!body.relationship || !VALID_RELATIONSHIPS.has(body.relationship)) {
    return errField('relationship', 'pick a relationship');
  }
  if (body.relationship === 'other' && !(body.relationship_other ?? '').trim()) {
    return errField('relationship_other', 'specify your relationship');
  }
  const resolutions = (body.resolutions ?? []).filter((r) => VALID_RESOLUTIONS.has(r));
  if (resolutions.length === 0) {
    return errField('resolutions', 'pick at least one outcome');
  }
  const reason = (body.reason ?? '').trim();
  if (reason.length < MIN_REASON_LEN) {
    return errField('reason', `tell us a bit more (${MIN_REASON_LEN}+ chars)`);
  }
  if (reason.length > MAX_REASON_LEN) {
    return errField('reason', 'reason too long');
  }
  if (!body.email || !isEmail(body.email)) {
    return errField('email', 'a valid email so we can reply');
  }
  if (body.phone && body.phone.length > 32) {
    return errField('phone', 'phone too long');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Email + phone hashes for persistence; raw values only used for notifies.
  const emailHash = await sha256Hex(
    `coldfile-takedown-email-v1:${body.email.trim().toLowerCase()}`,
  );
  const phoneHash = body.phone
    ? await sha256Hex(`coldfile-takedown-phone-v1:${body.phone.replace(/\D/g, '')}`)
    : null;

  // Tier 1 — the spam guard that actually matters: 1 request per
  // (case_id, email) per 24h. Catches "I refreshed and re-submitted",
  // multi-account-from-same-email, and scripted abusers who pick a target
  // case and burn through resolutions. Backed by the compound index in
  // migration 07.
  const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { count: dupCount } = await supabase
    .from('takedown_requests')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', body.case_id)
    .eq('requester_email_hash', emailHash)
    .gte('created_at', oneDayAgo);
  if ((dupCount ?? 0) >= RL_PER_CASE_EMAIL_24H) {
    return rateLimited();
  }

  // Tier 2 — per-IP backstop. Defense against scripted scraping. notes
  // carries the ip_hash prefix; the per-IP per-hour count uses it.
  const ipHash = await sha256Hex(`coldfile-ip-v1:${ipFor(req)}`);
  const ipPrefix = `ip:${ipHash.slice(0, 16)}`;
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count: ipCount } = await supabase
    .from('takedown_requests')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', oneHourAgo)
    .eq('notes', ipPrefix);
  if ((ipCount ?? 0) >= RL_PER_IP_HOUR) {
    return rateLimited();
  }

  // Generate a unique reference code. 14M possibilities at 5 chars; we retry
  // up to 3 times on a unique-violation just in case.
  let reference = generateReference();
  let inserted: { id: string; created_at: string } | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error: insertError } = await supabase
      .from('takedown_requests')
      .insert({
        case_id: body.case_id,
        requester_relationship: body.relationship,
        requester_relationship_other:
          body.relationship === 'other'
            ? (body.relationship_other ?? '').trim().slice(0, 50)
            : null,
        resolutions,
        requester_email_hash: emailHash,
        requester_phone_hash: phoneHash,
        reason,
        reference_code: reference,
        notes: ipPrefix,
      })
      .select('id, created_at')
      .single();
    if (!insertError) {
      inserted = data as { id: string; created_at: string };
      break;
    }
    if (insertError.message?.includes('duplicate key') && insertError.message.includes('reference')) {
      reference = generateReference();
      continue;
    }
    lastError = insertError.message;
    break;
  }

  if (!inserted) {
    return new Response(
      JSON.stringify({ error: 'server', message: lastError ?? 'insert failed' }),
      jsonInit(500),
    );
  }

  // Fetch case info for the notify emails. The submitter's confirmation needs
  // to identify which case they reported on — months from now, when they go
  // looking for the receipt, the ref code alone won't tell them. The
  // operator notify benefits from the same context.
  const { data: caseRow } = await supabase
    .from('cases')
    .select('slug, victim_name, kind, location_city, location_state, case_number_primary')
    .eq('id', body.case_id)
    .maybeSingle();

  // Best-effort notifies. Don't block the response — DB row is the
  // authoritative record; emails are operator + submitter convenience.
  if (RESEND_API_KEY) {
    const caseInfo = formatCaseInfo(caseRow);
    const notifyContext = {
      reference,
      caseId: body.case_id,
      caseInfo,
      relationship: body.relationship,
      relationshipOther:
        body.relationship === 'other' ? (body.relationship_other ?? '').trim() : null,
      resolutions,
      reasonFull: reason,
      contactEmail: body.email.trim(),
      contactPhone: body.phone?.trim() || null,
      requestId: inserted.id,
    };
    if (NOTIFY_FROM && NOTIFY_TO) {
      notifyOperator(notifyContext).catch(logSendError('operator notify'));
    }
    if (NOTIFY_FROM) {
      notifySubmitter(notifyContext).catch(logSendError('submitter confirmation'));
    }
  }

  return new Response(
    JSON.stringify({ reference, received_at: inserted.created_at }),
    jsonInit(200),
  );
});

interface CaseRow {
  slug: string | null;
  victim_name: string | null;
  kind: string | null;
  location_city: string | null;
  location_state: string | null;
  case_number_primary: string | null;
}

interface FormattedCaseInfo {
  title: string;
  metaLine: string;
  identifier: string;
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

function generateReference(): string {
  const buf = new Uint8Array(5);
  crypto.getRandomValues(buf);
  let out = 'CF-';
  for (let i = 0; i < 5; i++) {
    out += REF_ALPHABET[buf[i] % REF_ALPHABET.length];
  }
  return out;
}

interface NotifyContext {
  reference: string;
  caseId: string;
  caseInfo: FormattedCaseInfo;
  relationship: string;
  relationshipOther: string | null;
  resolutions: string[];
  reasonFull: string;
  contactEmail: string;
  contactPhone: string | null;
  requestId: string;
}

async function notifyOperator(ctx: NotifyContext): Promise<void> {
  const subject = `[${ctx.reference}] Takedown · ${ctx.relationship} · ${ctx.caseInfo.identifier}`;
  const lines = [
    `Reference: ${ctx.reference}`,
    `Request id: ${ctx.requestId}`,
    `Case: ${ctx.caseInfo.title}`,
    `       ${ctx.caseInfo.metaLine}`,
    `Case id: ${ctx.caseId}`,
    `Relationship: ${ctx.relationship}${ctx.relationshipOther ? ` (${ctx.relationshipOther})` : ''}`,
    `Wanted outcomes: ${ctx.resolutions.join(', ')}`,
    `Contact email: ${ctx.contactEmail}`,
    ...(ctx.contactPhone ? [`Contact phone: ${ctx.contactPhone}`] : []),
    '',
    'Reason:',
    ctx.reasonFull,
    '',
    `Review: select * from takedown_requests where reference_code = '${ctx.reference}';`,
  ];
  await sendEmail({
    to: NOTIFY_TO!,
    subject,
    text: lines.join('\n'),
    replyTo: ctx.contactEmail,
  });
}

/**
 * Confirmation email to the submitter. This is the receipt they'll go looking
 * for months later — include enough context that they can pick it up cold
 * without remembering exactly which case they reported on. Subject carries
 * the reference up front so it's findable in inbox search.
 */
async function notifySubmitter(ctx: NotifyContext): Promise<void> {
  const subject = `We received your request — ${ctx.reference}`;
  const lines = [
    `Thanks for sending this. A real person on our team will read your request and reply within 5 business days.`,
    '',
    `Reference: ${ctx.reference}`,
    '',
    `If you don't hear back by then, just reply to this email and we'll follow up.`,
    '',
    `── What you sent us ──`,
    '',
    `Case: ${ctx.caseInfo.title}`,
    `       ${ctx.caseInfo.metaLine}`,
    '',
    `Your relationship: ${formatRelationship(ctx.relationship)}${ctx.relationshipOther ? ` (${ctx.relationshipOther})` : ''}`,
    `What you'd like us to do: ${ctx.resolutions.map(formatResolution).join(', ')}`,
    '',
    `Your reason:`,
    ctx.reasonFull,
    '',
    `── ──`,
    '',
    `Reply to this email if you need to add anything or clarify.`,
    '',
    `— ${APP_NAME}`,
  ];
  await sendEmail({
    to: ctx.contactEmail,
    subject,
    text: lines.join('\n'),
    replyTo: NOTIFY_REPLY_TO,
  });
}

function formatRelationship(r: string): string {
  switch (r) {
    case 'family': return 'family member of the subject';
    case 'subject': return 'the subject';
    case 'legal': return 'legal representative';
    case 'journalist': return 'journalist or researcher';
    default: return 'other';
  }
}

function formatResolution(r: string): string {
  switch (r) {
    case 'remove_photo': return 'remove photo(s)';
    case 'remove_case': return 'remove this case';
    case 'correct_info': return 'correct information';
    default: return 'other';
  }
}

async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

function logSendError(label: string) {
  return (err: unknown) => {
    console.error(
      JSON.stringify({
        msg: `takedown ${label} failed`,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  };
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

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.trim().length <= 254;
}

