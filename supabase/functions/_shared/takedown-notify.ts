// Shared notify helpers for the takedown email pipeline.
//
// Why this module exists: the email-confirmation gate (audit H3) split the
// notify flow across two functions. takedown-submit emails the submitter
// a confirmation link and writes the row with `confirmed_at = NULL`.
// takedown-confirm fires after the click, sets `confirmed_at = now()`,
// and only THEN notifies the operator. Both functions need the same
// operator-notify shape — defining it here keeps the format identical
// across both callers without duplication drift.
//
// All three notify functions are best-effort. Callers should attach
// `.catch(logSendError(...))` and not block the user-facing response on
// the email send.

const NOTIFY_FROM = Deno.env.get('TAKEDOWN_NOTIFY_FROM') ?? null;
const NOTIFY_TO = Deno.env.get('TAKEDOWN_NOTIFY_TO') ?? null;
const NOTIFY_REPLY_TO = Deno.env.get('TAKEDOWN_REPLY_TO') ?? 'takedown@coldfile.app';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? null;
const APP_NAME = Deno.env.get('TAKEDOWN_APP_NAME') ?? 'The Cold File';

export interface FormattedCaseInfo {
  title: string;
  metaLine: string;
  identifier: string;
}

export interface NotifyContext {
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

/**
 * True only when the env is fully wired for operator notify. Callers can
 * use this to skip the call (and avoid a thrown error on a misconfigured
 * stack) rather than catching and logging.
 */
export function isOperatorNotifyConfigured(): boolean {
  return Boolean(RESEND_API_KEY && NOTIFY_FROM && NOTIFY_TO);
}

/**
 * True when at least the from-address + Resend key are wired. Used to gate
 * the submitter-side confirmation email and the post-confirm receipt.
 */
export function isSubmitterNotifyConfigured(): boolean {
  return Boolean(RESEND_API_KEY && NOTIFY_FROM);
}

/**
 * Operator notify. Called from takedown-confirm after the email-confirmation
 * gate clears, NOT from takedown-submit. The pre-confirm row is invisible
 * to the operator queue (which filters on `confirmed_at IS NOT NULL`).
 */
export async function notifyOperator(ctx: NotifyContext): Promise<void> {
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
 * Confirmation email — the click-to-verify link sent FIRST (before the
 * operator sees anything). Audit H3 gate. The link points at
 * takedown-confirm with the raw token in the query string. Tone is sober:
 * this is a takedown request, not marketing.
 */
export async function sendConfirmationEmail(args: {
  ctx: NotifyContext;
  confirmUrl: string;
}): Promise<void> {
  const { ctx, confirmUrl } = args;
  const subject = `Confirm your takedown request — ${ctx.reference}`;
  const lines = [
    `Confirm your takedown request`,
    '',
    `We received a takedown request from this email address. Click the link`,
    `below to confirm — only after you confirm will a person on our team`,
    `review it.`,
    '',
    confirmUrl,
    '',
    `This link expires in 7 days. If you didn't make this request, you can`,
    `ignore this email — nothing will happen.`,
    '',
    `── What you sent us ──`,
    '',
    `Reference: ${ctx.reference}`,
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
    `— ${APP_NAME}`,
  ];
  await sendEmail({
    to: ctx.contactEmail,
    subject,
    text: lines.join('\n'),
    replyTo: NOTIFY_REPLY_TO,
  });
}

/**
 * Post-confirm receipt to the submitter — sent AFTER they click the link
 * and the operator gets notified. This is the "we got it, expect a reply
 * within 5 business days" message. Months from now, when they go looking
 * for the receipt, this is what they'll find by searching the reference.
 */
export async function notifySubmitter(ctx: NotifyContext): Promise<void> {
  const subject = `We received your request — ${ctx.reference}`;
  const lines = [
    `Thanks for confirming. A real person on our team will read your request and reply within 5 business days.`,
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

export function formatRelationship(r: string): string {
  switch (r) {
    case 'family': return 'family member of the subject';
    case 'subject': return 'the subject';
    case 'legal': return 'legal representative';
    case 'journalist': return 'journalist or researcher';
    default: return 'other';
  }
}

export function formatResolution(r: string): string {
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
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured');
  }
  if (!NOTIFY_FROM) {
    throw new Error('TAKEDOWN_NOTIFY_FROM not configured');
  }
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

export function logSendError(label: string) {
  return (err: unknown) => {
    console.error(
      JSON.stringify({
        msg: `takedown ${label} failed`,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  };
}
