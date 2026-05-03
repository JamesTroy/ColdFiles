#!/usr/bin/env bash
# Smoke-test for the watch_zone_hit producer trigger chain.
#
# Two scenarios in one run, both gates from migrations 19 + 27:
#
#   Scenario A — INSERT path (migration 19):
#     INSERT a case with location_point already populated.
#     Trigger cases_watch_zone_hit_trigger fires → pg_net → notify-fanout.
#
#   Scenario B — UPDATE OF location_point path (migration 27):
#     INSERT a case with location_point IS NULL, then UPDATE to set it.
#     Trigger cases_watch_zone_hit_on_geocode_trigger fires.
#     This is the geocoder-late-arrival path — the regression target if
#     anyone refactors the trigger function.
#
# Three assertion gates per scenario:
#   Gate 1 — case lands inside the synthetic watch zone (precondition).
#            Failure here means the test fixture is broken, not the code.
#   Gate 2 — net._http_response shows recent rows (pg_net dispatched).
#            Failure here, with Gate 1 passing, localizes to the trigger
#            function body (notify_watch_zone_hit) or the Vault secret.
#   Gate 3 — that response row's status_code = 200 and the body shows
#            notify-fanout reported back ({"sent":...} shape).
#            Failure here, with Gate 2 passing, localizes to notify-
#            fanout itself or the function URL in migration 19.
#
# Push delivery is NOT asserted — tokens are device-specific. A
# notify-fanout response of {"sent":0,"note":"no recipients"} is the
# expected pass when the synthetic test user has no push_tokens row.
#
# Synthetic-artifact policy:
#   • Source slug              = smoke_test
#   • Auth user email          = smoke-watch-zone-{ISO}@example.invalid
#                                 (RFC 6761 reserved TLD — won't bounce)
#   • Watch zone label         = [smoke] {ISO}
#   • Case slug prefix         = smoke-watch-zone-{ISO}-{a|b}
#   • case_sources.source_external_id = smoke:watch-zone:{ISO}:{a|b}
#
# Cleanup is captured-IDs-only via smoke_cleanup() RPC (migration 28).
# A trap on EXIT/INT/TERM removes every created artifact even on partial
# failure — no production pollution, no manual cleanup.
#
# Required env (in repo-root .env):
#   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#
# Prereqs (one-time):
#   • Apply migration 28 (introspection RPCs).
#   • Vault secret `service_role_key` already in place (migration 19).

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "error: .env not found at repo root" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

SUPABASE_URL="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"
: "${SUPABASE_URL:?SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL must be set in .env}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY must be set in .env}"

ISO="$(date -u +%Y%m%dT%H%M%SZ)"
SOURCE_SLUG='smoke_test'
ZONE_LABEL="[smoke] ${ISO}"
USER_EMAIL="smoke-watch-zone-${ISO}@example.invalid"

# Artifact manifest. Cleanup reads these arrays.
CREATED_CASE_IDS=()
CREATED_ZONE_IDS=()
CREATED_SOURCE_IDS=()
CREATED_USER_ID=""

REST="${SUPABASE_URL}/rest/v1"
FUN="${SUPABASE_URL}/functions/v1"
AUTH_ADMIN="${SUPABASE_URL}/auth/v1/admin"
SR_HEADERS=(
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
)

# ─── helpers ─────────────────────────────────────────────────────────────
say()  { printf '%s %s\n' "$1" "$2"; }
ok()   { say "  ✓" "$1"; }
fail() { say "  ✗" "$1"; FAILED=1; }

# Compact JSON extractor — zero deps beyond python3 (already used by the
# notify-fanout smoke script in this repo; no jq requirement).
jget() { python3 -c "import json,sys; print(json.loads(sys.stdin.read())$1)"; }

cleanup() {
  local rc=$?
  echo
  say "→" "cleanup (rc=${rc})"

  # Build JSON arrays from the bash arrays. Empty array becomes []
  # which the RPC handles via array_length() null-check.
  local case_json zone_json source_json
  case_json="$(printf '%s\n' "${CREATED_CASE_IDS[@]:-}" | python3 -c "import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))")"
  zone_json="$(printf '%s\n' "${CREATED_ZONE_IDS[@]:-}" | python3 -c "import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))")"
  source_json="$(printf '%s\n' "${CREATED_SOURCE_IDS[@]:-}" | python3 -c "import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))")"

  if [[ "${case_json}" != "[]" || "${zone_json}" != "[]" || "${source_json}" != "[]" ]]; then
    curl -sS -X POST "${REST}/rpc/smoke_cleanup" \
      "${SR_HEADERS[@]}" \
      -H 'Content-Type: application/json' \
      -d "{\"p_case_ids\":${case_json},\"p_zone_ids\":${zone_json},\"p_source_ids\":${source_json}}" \
      >/dev/null || say "  !" "smoke_cleanup RPC failed (review manually)"
    ok "removed cases=${#CREATED_CASE_IDS[@]} zones=${#CREATED_ZONE_IDS[@]} sources=${#CREATED_SOURCE_IDS[@]}"
  else
    ok "no artifacts to remove"
  fi

  if [[ -n "${CREATED_USER_ID}" ]]; then
    curl -sS -X DELETE "${AUTH_ADMIN}/users/${CREATED_USER_ID}" \
      "${SR_HEADERS[@]}" \
      >/dev/null || say "  !" "auth user delete failed (id=${CREATED_USER_ID})"
    ok "removed auth user ${CREATED_USER_ID}"
  fi

  exit "${rc}"
}
trap cleanup EXIT INT TERM

FAILED=0

# ─── 0. preflight ────────────────────────────────────────────────────────
say "→" "preflight"

# Verify migration 28 RPCs exist by calling smoke_pgnet_recent with a
# far-future timestamp (returns empty, succeeds if function exists).
preflight_resp=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "${REST}/rpc/smoke_pgnet_recent" \
  "${SR_HEADERS[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"p_since":"2099-01-01T00:00:00Z"}')
if [[ "${preflight_resp}" != "200" ]]; then
  fail "smoke_pgnet_recent RPC returned HTTP ${preflight_resp} — apply migration 28 first"
  exit 1
fi
ok "introspection RPCs available"

# ─── 1. setup: source row ────────────────────────────────────────────────
say "→" "setup: ensure source slug=${SOURCE_SLUG}"
source_resp=$(curl -sS -X POST "${REST}/sources" \
  "${SR_HEADERS[@]}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation,resolution=merge-duplicates' \
  -d "$(python3 -c "
import json
print(json.dumps({
  'slug': '${SOURCE_SLUG}',
  'name': 'Smoke Test',
  'kind': 'aggregator',
  'base_url': 'https://example.invalid/',
  'attribution_html': 'smoke',
  'active': False,
}))
")")
SMOKE_SOURCE_ID=$(echo "${source_resp}" | jget '[0]["id"]')
CREATED_SOURCE_IDS+=("${SMOKE_SOURCE_ID}")
ok "source id=${SMOKE_SOURCE_ID}"

# ─── 2. setup: synthetic auth user ───────────────────────────────────────
say "→" "setup: create auth user ${USER_EMAIL}"
user_resp=$(curl -sS -X POST "${AUTH_ADMIN}/users" \
  "${SR_HEADERS[@]}" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "
import json
print(json.dumps({
  'email': '${USER_EMAIL}',
  'password': 'smoke-${ISO}-x',
  'email_confirm': True,
}))
")")
CREATED_USER_ID=$(echo "${user_resp}" | jget '["id"]')
ok "user id=${CREATED_USER_ID}"

# ─── 3. setup: synthetic watch zone ──────────────────────────────────────
# 0.1°×0.1° square centered on (37.5, -122.5) — empty Pacific Ocean coords.
# No real cases will land here so any signal we measure is ours.
ZONE_CENTER_LAT=37.5
ZONE_CENTER_LNG=-122.5
ZONE_BOX_DELTA=0.1

# Insert via direct SQL would be cleaner, but RPC create_watch_zone is
# auth.uid()-gated. Insert directly through PostgREST as service-role.
WKT_POLY="SRID=4326;POLYGON((${ZONE_CENTER_LNG} ${ZONE_CENTER_LAT}, $(python3 -c "print(${ZONE_CENTER_LNG}+${ZONE_BOX_DELTA})") ${ZONE_CENTER_LAT}, $(python3 -c "print(${ZONE_CENTER_LNG}+${ZONE_BOX_DELTA})") $(python3 -c "print(${ZONE_CENTER_LAT}+${ZONE_BOX_DELTA})"), ${ZONE_CENTER_LNG} $(python3 -c "print(${ZONE_CENTER_LAT}+${ZONE_BOX_DELTA})"), ${ZONE_CENTER_LNG} ${ZONE_CENTER_LAT}))"

say "→" "setup: create watch zone label='${ZONE_LABEL}'"
zone_resp=$(curl -sS -X POST "${REST}/user_watches" \
  "${SR_HEADERS[@]}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d "$(python3 -c "
import json
print(json.dumps({
  'user_id': '${CREATED_USER_ID}',
  'watch_zone_geom': '${WKT_POLY}',
  'watch_zone_label': '${ZONE_LABEL}',
  'notify_new_cases': True,
}))
")")
SMOKE_ZONE_ID=$(echo "${zone_resp}" | jget '[0]["id"]')
CREATED_ZONE_IDS+=("${SMOKE_ZONE_ID}")
ok "zone id=${SMOKE_ZONE_ID}"

# ─── helpers shared by both scenarios ────────────────────────────────────
# Insert a case row directly via PostgREST. Returns the new id.
# point_wkt is empty string for "leave NULL".
insert_case() {
  local label="$1" point_wkt="$2"
  local slug="smoke-watch-zone-${ISO}-${label}"
  local body
  body=$(python3 -c "
import json
d = {
  'slug': '${slug}',
  'kind': 'unidentified',
  'status': 'open',
  'location_text': 'Smoke fixture (${label})',
  'narrative_short': 'Synthetic case for smoke test ${ISO} scenario ${label}.',
}
pt = '${point_wkt}'
if pt:
  d['location_point'] = pt
print(json.dumps(d))
")
  curl -sS -X POST "${REST}/cases" \
    "${SR_HEADERS[@]}" \
    -H 'Content-Type: application/json' \
    -H 'Prefer: return=representation' \
    -d "${body}" \
    | jget '[0]["id"]'
}

update_case_point() {
  local case_id="$1" point_wkt="$2"
  curl -sS -X PATCH "${REST}/cases?id=eq.${case_id}" \
    "${SR_HEADERS[@]}" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c "
import json
print(json.dumps({'location_point': '${point_wkt}'}))
")" >/dev/null
}

# Gate 2/3: poll smoke_pgnet_recent for status_code rows since since_ts.
# Returns 0 + prints rows JSON if any found within timeout, else 1.
poll_pgnet() {
  local since_ts="$1" deadline=$(( $(date +%s) + 15 ))
  while (( $(date +%s) < deadline )); do
    local rows
    rows=$(curl -sS -X POST "${REST}/rpc/smoke_pgnet_recent" \
      "${SR_HEADERS[@]}" \
      -H 'Content-Type: application/json' \
      -d "{\"p_since\":\"${since_ts}\"}")
    # PostgREST returns a JSON array. Empty array means no rows yet.
    # Check the trimmed body — '[]' (with no whitespace from PostgREST)
    # is the empty case; anything else carries at least one row.
    local trimmed
    trimmed="$(echo "${rows}" | tr -d ' \n\r\t')"
    if [[ -n "${trimmed}" && "${trimmed}" != "[]" ]]; then
      echo "${rows}"
      return 0
    fi
    sleep 1
  done
  return 1
}

# Run the three gates against a case_id.
run_gates() {
  local label="$1" case_id="$2" pgnet_since="$3"
  echo
  say "→" "scenario ${label} (case_id=${case_id})"

  # Gate 1: ST_Intersects.
  local intersect
  intersect=$(curl -sS -X POST "${REST}/rpc/smoke_check_zone_intersect" \
    "${SR_HEADERS[@]}" \
    -H 'Content-Type: application/json' \
    -d "{\"p_case_id\":\"${case_id}\",\"p_zone_id\":\"${SMOKE_ZONE_ID}\"}")
  if [[ "${intersect}" == "true" ]]; then
    ok "gate 1: case lands inside watch zone"
  else
    fail "gate 1: case does NOT intersect watch zone (intersect=${intersect}) — fixture broken"
    return
  fi

  # Gate 2: pg_net response row appeared.
  local rows
  if rows=$(poll_pgnet "${pgnet_since}"); then
    local n
    n=$(echo "${rows}" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
    ok "gate 2: pg_net dispatched (${n} response row(s) since trigger)"
  else
    fail "gate 2: no net._http_response rows in 15s — trigger function or Vault secret"
    return
  fi

  # Gate 3: latest response status_code == 200 + sensible body.
  local latest_status latest_body
  latest_status=$(echo "${rows}" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r[0]['status_code'] if r else '')")
  latest_body=$(echo "${rows}" | python3 -c "import json,sys; r=json.load(sys.stdin); print((r[0].get('content') or '')[:200])")
  if [[ "${latest_status}" == "200" ]]; then
    ok "gate 3: notify-fanout returned 200 (body: ${latest_body})"
  else
    fail "gate 3: status_code=${latest_status} (body: ${latest_body}) — notify-fanout or URL"
  fi
}

# ─── scenario A: INSERT with location_point set ──────────────────────────
POINT_INSIDE="SRID=4326;POINT($(python3 -c "print(${ZONE_CENTER_LNG}+0.05)") $(python3 -c "print(${ZONE_CENTER_LAT}+0.05)"))"
SINCE_A=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CASE_A_ID=$(insert_case 'a' "${POINT_INSIDE}")
CREATED_CASE_IDS+=("${CASE_A_ID}")
run_gates 'A — INSERT with point set (migration 19 trigger)' "${CASE_A_ID}" "${SINCE_A}"

# ─── scenario B: INSERT with NULL, then UPDATE point ─────────────────────
SINCE_B_INSERT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CASE_B_ID=$(insert_case 'b' '')
CREATED_CASE_IDS+=("${CASE_B_ID}")

# The INSERT must NOT fire trigger 19 (location_point IS NULL guard).
# Sleep briefly so the polling window for B picks up only the UPDATE.
sleep 2
SINCE_B=$(date -u +%Y-%m-%dT%H:%M:%SZ)
update_case_point "${CASE_B_ID}" "${POINT_INSIDE}"
run_gates 'B — INSERT NULL then UPDATE point (migration 27 trigger)' "${CASE_B_ID}" "${SINCE_B}"

# ─── summary ─────────────────────────────────────────────────────────────
echo
if [[ "${FAILED}" -eq 0 ]]; then
  say "✓" "smoke passed — both watch_zone_hit triggers operational"
  exit 0
else
  say "✗" "smoke failed — see gate output above"
  exit 1
fi
