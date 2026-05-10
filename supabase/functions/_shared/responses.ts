// Centralized 500-class response helper for Edge Functions.
//
// Why this exists: the v1.0.x security audit (finding M4) flagged that
// ingest-source, takedown-submit, and tip-route-submit returned raw
// Postgres / error-object messages directly to the caller. Those strings
// leak schema details (column names, constraint identifiers, internal
// table names) that should never cross the trust boundary — they make
// reconnaissance trivial and turn an opaque 500 into a free schema tour.
//
// Contract: callers pass the original error to `internalError`. The
// helper logs the full stack server-side with a correlation id, and
// returns a generic `{ error: 'internal error', correlation_id }` to the
// caller. The operator can grep the server log by cid when a user
// quotes the id from a bug report — full fidelity for us, zero fidelity
// for an attacker.
//
// Use only for 500-class returns. Validation / 4xx error messages are
// caller-actionable and stay verbatim.
import { corsHeaders } from './cors.ts';

export function internalError(req: Request, err: unknown, label?: string): Response {
  const correlation_id = crypto.randomUUID();
  const tag = label ?? 'edge';
  const errStr = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`[${tag}] internal error cid=${correlation_id} err=${errStr}`);
  return new Response(
    JSON.stringify({ error: 'internal error', correlation_id }),
    {
      status: 500,
      headers: {
        'content-type': 'application/json',
        ...corsHeaders(req),
      },
    },
  );
}
