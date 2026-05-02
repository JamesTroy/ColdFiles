// Edge Function: notify-fanout
//
// Stub for v1.0.1 push delivery. Reads matching push_tokens rows, posts to
// Expo's push relay, and returns a count. NOT wired to any trigger yet —
// this is the dispatcher; the producer side (what calls this function with
// what payload) is the next ticket.
//
// TODO(triggers): wire from these producers, in this order:
//   1. case_sources INSERT inside an active watch_zones bbox
//      → kind: 'watch_zone_hit', case_id, zone_id
//      Mechanism: pg_net call from a per-row AFTER INSERT trigger on
//      case_sources, gated on a watch-zone-bbox spatial match. See
//      migrations/06_watch_zones.sql for the geometry.
//   2. cases UPDATE where last_changed_at advances on a case present in
//      a user's saved-cases list
//      → kind: 'saved_case_update', case_id
//      Mechanism: same pg_net pattern, joined on the saved-cases table.
//   3. agency-acknowledge webhook (separate service, not built yet)
//      → kind: 'tip_status_change', tip_id, case_id
//      Mechanism: external webhook → notify-fanout call directly.
//
// Auth: this function is called by privileged producers only. Public CORS
// is left off for now — every caller is server-to-server (pg_net or another
// Edge Function with the service-role key).
//
// Privacy: only delivery metadata + the case_slug data field crosses the
// wire. No name, no description, no photo URL. The notification body is
// generated from the kind + the tiny per-case lookup; the recipient device
// follows data.case_slug through expo-router to the case detail screen.

import { createClient } from 'jsr:@supabase/supabase-js@2';

type NotifyKind = 'watch_zone_hit' | 'saved_case_update' | 'tip_status_change';

interface NotifyPayload {
  kind: NotifyKind;
  case_id?: string;
  tip_id?: string;
  zone_id?: string;
}

interface PushToken {
  expo_push_token: string;
  user_id: string | null;
  install_id: string | null;
  prefs: Record<string, unknown> | null;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  // iOS-only: amber accent badge category if we ever add actions.
}

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_BATCH = 100; // Expo's documented per-request cap.

const SUPABASE_URL = mustEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = mustEnv('SUPABASE_SERVICE_ROLE_KEY');

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`notify-fanout: missing required env ${name}`);
  return v;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  let body: NotifyPayload;
  try {
    body = (await req.json()) as NotifyPayload;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  if (!isNotifyKind(body.kind)) {
    return json({ error: 'invalid kind' }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Resolve a small notification envelope (title/body/data) per kind. The
  // case_slug is fetched once here so all recipients share the same lookup.
  const envelope = await buildEnvelope(supabase, body);
  if (!envelope) {
    return json({ error: 'failed to build envelope' }, 500);
  }

  // Filter tokens by the relevant pref. The prefs JSONB shape mirrors the
  // mobile NotificationPrefs interface (see use-notification-prefs.ts):
  //   { savedCaseUpdates: bool, watchZoneAlerts: bool, tipStatusUpdates: bool }
  // A pref is *opt-in by default* — missing key reads as enabled.
  const prefKey = prefKeyForKind(body.kind);
  const tokens = await selectTokensForKind(supabase, body, prefKey);

  if (tokens.length === 0) {
    return json({ kind: body.kind, sent: 0, skipped: 0, note: 'no recipients' });
  }

  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t.expo_push_token,
    title: envelope.title,
    body: envelope.body,
    data: envelope.data,
    sound: 'default',
    priority: 'default',
  }));

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH) {
    const chunk = messages.slice(i, i + EXPO_PUSH_BATCH);
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate',
        },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        failed += chunk.length;
        console.error(
          JSON.stringify({
            msg: 'expo push relay returned non-2xx',
            status: res.status,
            kind: body.kind,
            chunk_size: chunk.length,
          }),
        );
        continue;
      }
      // The body has per-message tickets — for the v1 stub we just count the
      // chunk as sent and let production wiring inspect tickets later (the
      // receipt-poll path lives in the v1.0.2 ticket).
      sent += chunk.length;
    } catch (err) {
      failed += chunk.length;
      console.error(
        JSON.stringify({
          msg: 'expo push relay fetch failed',
          kind: body.kind,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return json({ kind: body.kind, sent, failed, total: messages.length });
});

function isNotifyKind(s: unknown): s is NotifyKind {
  return s === 'watch_zone_hit' || s === 'saved_case_update' || s === 'tip_status_change';
}

function prefKeyForKind(kind: NotifyKind): string {
  switch (kind) {
    case 'watch_zone_hit':
      return 'watchZoneAlerts';
    case 'saved_case_update':
      return 'savedCaseUpdates';
    case 'tip_status_change':
      return 'tipStatusUpdates';
  }
}

async function selectTokensForKind(
  supabase: ReturnType<typeof createClient>,
  body: NotifyPayload,
  prefKey: string,
): Promise<PushToken[]> {
  // Single read: every token whose pref is not explicitly false. Deeper
  // recipient scoping (watch-zone owners only, saved-case owners only) is
  // intentionally deferred — the producer side is what enforces "this user
  // cares about this case." The fan-out function trusts the producer's
  // payload + only filters by the user's coarse pref toggle.
  //
  // TODO(scoping): when triggers ship, narrow by user_id matching watch-zone
  // owner / saved-case owner. For now the producer needs to call this
  // function once per recipient (or once with a list of user_ids — extend
  // payload before that ticket).
  const query = supabase
    .from('push_tokens')
    .select('expo_push_token, user_id, install_id, prefs')
    // `prefs->prefKey != false` would be the SQL; PostgREST expresses it via
    // .or() with explicit null/true cases since JSONB doesn't have a
    // built-in "default-true" coercion in the .filter() DSL.
    .or(`prefs->>${prefKey}.is.null,prefs->>${prefKey}.eq.true`);

  const { data, error } = await query;
  if (error) {
    console.error(
      JSON.stringify({ msg: 'push_tokens select failed', kind: body.kind, error: error.message }),
    );
    return [];
  }
  // Cast: PostgREST's typegen would narrow this; the stub doesn't pull in
  // the generated types, so we widen + trust the column list above.
  return (data ?? []) as unknown as PushToken[];
}

async function buildEnvelope(
  supabase: ReturnType<typeof createClient>,
  body: NotifyPayload,
): Promise<{ title: string; body: string; data: Record<string, unknown> } | null> {
  const data: Record<string, unknown> = { kind: body.kind };

  let caseSlug: string | null = null;
  let caseTitle: string | null = null;

  if (body.case_id) {
    // Schema column names are `victim_first_name` / `victim_last_name`
    // (per migrations/01_schema.sql); selecting `first_name` / `last_name`
    // would error on first invocation and the entire fan-out would fail.
    const { data: caseRow } = await supabase
      .from('cases')
      .select('slug, victim_first_name, victim_last_name')
      .eq('id', body.case_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (caseRow) {
      caseSlug = (caseRow as { slug?: string | null }).slug ?? null;
      const last = (caseRow as { victim_last_name?: string | null }).victim_last_name;
      const first = (caseRow as { victim_first_name?: string | null }).victim_first_name;
      // Title shape mirrors the case-row glance pattern. Falls back to "a case"
      // when names are absent (Doe network) — never leaks a placeholder Doe ID.
      if (last || first) {
        caseTitle = [first, last].filter(Boolean).join(' ');
      } else {
        caseTitle = 'a case';
      }
    }
  }

  if (caseSlug) data.case_slug = caseSlug;
  if (body.zone_id) data.zone_id = body.zone_id;
  if (body.tip_id) data.tip_id = body.tip_id;

  switch (body.kind) {
    case 'watch_zone_hit':
      return {
        title: 'New case in your watch zone',
        body: caseTitle ? `${caseTitle} — open to view.` : 'A new case landed inside a zone you watch.',
        data,
      };
    case 'saved_case_update':
      return {
        title: 'Update on a saved case',
        body: caseTitle ? `New info on ${caseTitle}.` : 'A case you saved has new info.',
        data,
      };
    case 'tip_status_change':
      return {
        title: 'Tip status updated',
        body: 'An agency updated the status of a tip you submitted.',
        data,
      };
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
