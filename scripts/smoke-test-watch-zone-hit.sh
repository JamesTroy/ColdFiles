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
AUTH_ADMIN="${SUPABASE_URL}/auth/v1/admin"
SR_HEADERS=(
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
)

# ─── helpers ─────────────────────────────────────────────────────────────
say()  { printf '%s %s\n' "$1" "$2"; }
ok()   { say "  ✓" "$1"; }
fail() { say "  ✗" "$1"; FAILED=1; }

# Build a JSON object from env-var key=name pairs. Avoids the quoting hell
# of inlining ${...} into multi-line python -c. Pass values via env, and
# the python script reads them via os.environ — no bash interpolation
# touches the python source.
#
# Usage: build_json KEY1=ENVVAR1 KEY2=ENVVAR2 ...
#   where ENVVAR1 etc. are already exported in the caller's environment.
build_json() {
  python3 -c '
import json, os, sys
out = {}
for arg in sys.argv[1:]:
    k, _, env = arg.partition("=")
    v = os.environ.get(env, "")
    if v == "__BOOL_TRUE__":
        out[k] = True
    elif v == "__BOOL_FALSE__":
        out[k] = False
    elif v == "__OMIT__":
        continue
    else:
        out[k] = v
print(json.dumps(out))
' "$@"
}

# Compact JSON extractor — zero deps beyond python3.
# $1 is the python subscript expression, e.g. '[0]["id"]' or '["id"]'.
jget() { python3 -c "import json,sys; print(json.loads(sys.stdin.read())$1)"; }

cleanup() {
  local rc=$?
  echo
  say "→" "cleanup (rc=${rc})"

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

export V_SLUG="${SOURCE_SLUG}"
export V_NAME='Smoke Test'
export V_KIND='aggregator'
export V_BASE='https://example.invalid/'
export V_ATTR='smoke'
export V_ACTIVE='__BOOL_FALSE__'
src_body=$(build_json \
  slug=V_SLUG \
  name=V_NAME \
  kind=V_KIND \
  base_url=V_BASE \
  attribution_html=V_ATTR \
  active=V_ACTIVE)
unset V_SLUG V_NAME V_KIND V_BASE V_ATTR V_ACTIVE

source_resp=$(curl -sS -X POST "${REST}/sources" \
  "${SR_HEADERS[@]}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation,resolution=merge-duplicates' \
  -d "${src_body}")
SMOKE_SOURCE_ID=$(echo "${source_resp}" | jget '[0]["id"]')
CREATED_SOURCE_IDS+=("${SMOKE_SOURCE_ID}")
ok "source id=${SMOKE_SOURCE_ID}"

# ─── 2. setup: synthetic auth user ───────────────────────────────────────
say "→" "setup: create auth user ${USER_EMAIL}"

export V_EMAIL="${USER_EMAIL}"
export V_PASSWORD="smoke-${ISO}-x"
export V_CONFIRM='__BOOL_TRUE__'
user_body=$(build_json \
  email=V_EMAIL \
  password=V_PASSWORD \
  email_confirm=V_CONFIRM)
unset V_EMAIL V_PASSWORD V_CONFIRM

user_resp=$(curl -sS -X POST "${AUTH_ADMIN}/users" \
  "${SR_HEADERS[@]}" \
  -H 'Content-Type: application/json' \
  -d "${user_body}")
CREATED_USER_ID=$(echo "${user_resp}" | jget '["id"]')
ok "user id=${CREATED_USER_ID}"

# ─── 3. setup: synthetic watch zone ──────────────────────────────────────
# 0.1°×0.1° square centered on (37.5, -122.5) — empty Pacific Ocean coords.
ZONE_CENTER_LAT=37.5
ZONE_CENTER_LNG=-122.5
ZONE_BOX_DELTA=0.1

# Build the WKT polygon via python (cleaner than bash arithmetic with floats).
WKT_POLY=$(LAT="${ZONE_CENTER_LAT}" LNG="${ZONE_CENTER_LNG}" D="${ZONE_BOX_DELTA}" python3 -c '
import os
lat = float(os.environ["LAT"])
lng = float(os.environ["LNG"])
d   = float(os.environ["D"])
pts = [
    (lng,     lat),
    (lng + d, lat),
    (lng + d, lat + d),
    (lng,     lat + d),
    (lng,     lat),  # close ring
]
print("SRID=4326;POLYGON((" + ", ".join(f"{x} {y}" for x, y in pts) + "))")
')

say "→" "setup: create watch zone label='${ZONE_LABEL}'"

export V_USER_ID="${CREATED_USER_ID}"
export V_GEOM="${WKT_POLY}"
export V_LABEL="${ZONE_LABEL}"
export V_NOTIFY='__BOOL_TRUE__'
zone_body=$(build_json \
  user_id=V_USER_ID \
  watch_zone_geom=V_GEOM \
  watch_zone_label=V_LABEL \
  notify_new_cases=V_NOTIFY)
unset V_USER_ID V_GEOM V_LABEL V_NOTIFY

zone_resp=$(curl -sS -X POST "${REST}/user_watches" \
  "${SR_HEADERS[@]}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d "${zone_body}")
SMOKE_ZONE_ID=$(echo "${zone_resp}" | jget '[0]["id"]')
CREATED_ZONE_IDS+=("${SMOKE_ZONE_ID}")
ok "zone id=${SMOKE_ZONE_ID}"

# ─── helpers shared by both scenarios ────────────────────────────────────
insert_case() {
  local label="$1" point_wkt="$2"
  local slug="smoke-watch-zone-${ISO}-${label}"

  export V_SLUG="${slug}"
  export V_KIND='unidentified'
  export V_STATUS='open'
  export V_LOC="Smoke fixture (${label})"
  export V_NARR="Synthetic case for smoke test ${ISO} scenario ${label}."
  if [[ -n "${point_wkt}" ]]; then
    export V_POINT="${point_wkt}"
    local point_arg='location_point=V_POINT'
  else
    export V_POINT='__OMIT__'
    local point_arg='location_point=V_POINT'
  fi
  local body
  body=$(build_json \
    slug=V_SLUG \
    kind=V_KIND \
    status=V_STATUS \
    location_text=V_LOC \
    narrative_short=V_NARR \
    "${point_arg}")
  unset V_SLUG V_KIND V_STATUS V_LOC V_NARR V_POINT

  curl -sS -X POST "${REST}/cases" \
    "${SR_HEADERS[@]}" \
    -H 'Content-Type: application/json' \
    -H 'Prefer: return=representation' \
    -d "${body}" \
    | jget '[0]["id"]'
}

update_case_point() {
  local case_id="$1" point_wkt="$2"
  export V_POINT="${point_wkt}"
  local body
  body=$(build_json location_point=V_POINT)
  unset V_POINT
  curl -sS -X PATCH "${REST}/cases?id=eq.${case_id}" \
    "${SR_HEADERS[@]}" \
    -H 'Content-Type: application/json' \
    -d "${body}" >/dev/null
}

# Gate 2/3: poll smoke_pgnet_recent for status_code rows since since_ts.
# Returns 0 + prints rows JSON if any found within timeout, else 1.
# pg_net's worker has a ~10s poll interval; the deadline is generous
# enough to ride through one full cycle plus the request RTT.
poll_pgnet() {
  local since_ts="$1" deadline=$(( $(date +%s) + 45 ))
  while (( $(date +%s) < deadline )); do
    local rows
    rows=$(curl -sS -X POST "${REST}/rpc/smoke_pgnet_recent" \
      "${SR_HEADERS[@]}" \
      -H 'Content-Type: application/json' \
      -d "{\"p_since\":\"${since_ts}\"}")
    local trimmed
    trimmed="$(echo "${rows}" | tr -d ' \n\r\t')"
    if [[ -n "${trimmed}" && "${trimmed}" != "[]" ]]; then
      echo "${rows}"
      return 0
    fi
    sleep 2
  done
  return 1
}

# Gate 2 diagnostic: total rows + max(id) in pg_net queue + response
# tables. The script captures a "baseline" max(id) before each scenario
# fires the trigger; if max(id) didn't grow on either table during the
# scenario, the trigger never reached pg_net (function body / Vault).
# If queue grew but response didn't, request is in-flight or stalled.
diagnose_pgnet() {
  curl -sS -X POST "${REST}/rpc/smoke_pgnet_queue_count" \
    "${SR_HEADERS[@]}" \
    -H 'Content-Type: application/json' \
    -d '{}'
}

run_gates() {
  local label="$1" case_id="$2" pgnet_since="$3" baseline_diag="$4"
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
    fail "gate 2: no net._http_response rows in 45s"
    local current_diag
    current_diag=$(diagnose_pgnet)
    echo "      baseline (pre-trigger): ${baseline_diag}"
    echo "      current  (post-trigger): ${current_diag}"
    echo "      → if both max_id values are unchanged, the trigger never reached pg_net"
    echo "        (notify_watch_zone_hit() bailed early, likely on the Vault secret read)"
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

# Build the inside-the-zone POINT WKT.
POINT_INSIDE=$(LAT="${ZONE_CENTER_LAT}" LNG="${ZONE_CENTER_LNG}" python3 -c '
import os
lat = float(os.environ["LAT"]) + 0.05
lng = float(os.environ["LNG"]) + 0.05
print(f"SRID=4326;POINT({lng} {lat})")
')

# ─── scenario A: INSERT with location_point set ──────────────────────────
BASELINE_A=$(diagnose_pgnet)
SINCE_A=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CASE_A_ID=$(insert_case 'a' "${POINT_INSIDE}")
CREATED_CASE_IDS+=("${CASE_A_ID}")
run_gates 'A — INSERT with point set (migration 19 trigger)' "${CASE_A_ID}" "${SINCE_A}" "${BASELINE_A}"

# ─── scenario B: INSERT with NULL, then UPDATE point ─────────────────────
CASE_B_ID=$(insert_case 'b' '')
CREATED_CASE_IDS+=("${CASE_B_ID}")

# Briefly let any incidental net activity settle so polling for B picks up
# only the UPDATE-induced row.
sleep 2
BASELINE_B=$(diagnose_pgnet)
SINCE_B=$(date -u +%Y-%m-%dT%H:%M:%SZ)
update_case_point "${CASE_B_ID}" "${POINT_INSIDE}"
run_gates 'B — INSERT NULL then UPDATE point (migration 27 trigger)' "${CASE_B_ID}" "${SINCE_B}" "${BASELINE_B}"

# ─── summary ─────────────────────────────────────────────────────────────
echo
if [[ "${FAILED}" -eq 0 ]]; then
  say "✓" "smoke passed — both watch_zone_hit triggers operational"
  exit 0
else
  say "✗" "smoke failed — see gate output above"
  exit 1
fi
