#!/usr/bin/env bash
# Smoke-test for notify-fanout Edge Function.
#
# Usage:
#   scripts/smoke-test-notify-fanout.sh                          # default: saved_case_update with a real recent case
#   scripts/smoke-test-notify-fanout.sh saved_case_update CASE_ID
#   scripts/smoke-test-notify-fanout.sh watch_zone_hit CASE_ID ZONE_ID
#   scripts/smoke-test-notify-fanout.sh tip_status_change CASE_ID TIP_ID
#   scripts/smoke-test-notify-fanout.sh ingest_alive_alarm USER_ID [HOURS_QUIET]
#
# Reads SUPABASE_SERVICE_ROLE_KEY from the repo-root .env file. The function
# requires service-role auth because it fans out across every push_tokens
# row whose user pref isn't explicitly false.
#
# For ingest_alive_alarm, USER_ID is the operator user_id that should receive
# the alarm (matches the operator_user_id Vault secret from mig 49). The
# HOURS_QUIET param defaults to 99 so the notification body is informative.
# This mode validates the receive-path; it does NOT invoke check_ingest_alive().
# To exercise the producer side directly: temporarily set the threshold Vault
# secret to '0' and run `select check_ingest_alive()` from psql, then reset.

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

KIND="${1:-saved_case_update}"
CASE_ID="${2:-}"
ZONE_ID="${3:-}"
TIP_ID="${3:-}"
OPERATOR_USER_ID="${2:-}"
HOURS_QUIET="${3:-99}"

# Pre-flight: how many push tokens would receive this kind?
echo "→ pre-flight: counting eligible push tokens for kind=$KIND..."
case "$KIND" in
  watch_zone_hit)     PREF_KEY="watchZoneAlerts" ;;
  saved_case_update)  PREF_KEY="savedCaseUpdates" ;;
  tip_status_change)  PREF_KEY="tipStatusUpdates" ;;
  ingest_alive_alarm) PREF_KEY="systemAlarms" ;;
  *) echo "error: unknown kind '$KIND'"; exit 2 ;;
esac

TOKEN_COUNT=$(curl -sS \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact" \
  -H "Range: 0-0" \
  -I "$SUPABASE_URL/rest/v1/push_tokens?select=id&or=(prefs->>$PREF_KEY.is.null,prefs->>$PREF_KEY.eq.true)" \
  | grep -i 'content-range' | sed 's/.*\///' | tr -d '\r\n' || echo "?")

echo "  eligible tokens: $TOKEN_COUNT"
if [[ "$TOKEN_COUNT" == "0" ]]; then
  echo "  no tokens registered yet — install 1.0.1 + grant notification permission first"
  exit 0
fi

# Pick a real recent case if none provided. Skipped for tip_status_change
# (which doesn't need a case) and ingest_alive_alarm (which is operator-only
# and doesn't deep-link to a case).
if [[ -z "$CASE_ID" && "$KIND" != "tip_status_change" && "$KIND" != "ingest_alive_alarm" ]]; then
  echo "→ picking a recent case_id..."
  CASE_ID=$(curl -sS \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    "$SUPABASE_URL/rest/v1/cases?select=id,slug,victim_first_name,victim_last_name&deleted_at=is.null&order=last_changed_at.desc&limit=1" \
    | python3 -c "import json,sys; r=json.load(sys.stdin); print(r[0]['id']) if r else None")
  echo "  case_id: $CASE_ID"
fi

# For ingest_alive_alarm the second positional is the operator user_id, not
# a case_id. Require it explicitly — broadcasting an operator alarm is the
# wrong default.
if [[ "$KIND" == "ingest_alive_alarm" ]]; then
  if [[ -z "$OPERATOR_USER_ID" ]]; then
    echo "error: ingest_alive_alarm requires OPERATOR_USER_ID as the second arg" >&2
    echo "  scripts/smoke-test-notify-fanout.sh ingest_alive_alarm <user_uuid> [hours_quiet]" >&2
    exit 2
  fi
  echo "  operator_user_id: $OPERATOR_USER_ID"
  echo "  hours_quiet: $HOURS_QUIET (synthetic)"
fi

# Build payload.
PAYLOAD=$(python3 -c "
import json,sys
p={'kind':'$KIND'}
if '$CASE_ID' and '$KIND' != 'ingest_alive_alarm': p['case_id']='$CASE_ID'
if '$KIND'=='watch_zone_hit' and '$ZONE_ID': p['zone_id']='$ZONE_ID'
if '$KIND'=='tip_status_change' and '$TIP_ID': p['tip_id']='$TIP_ID'
if '$KIND'=='ingest_alive_alarm':
    p['user_ids']=['$OPERATOR_USER_ID']
    p['hours_quiet']=float('$HOURS_QUIET')
    p['threshold_hours']=24
print(json.dumps(p))
")

echo "→ POST $SUPABASE_URL/functions/v1/notify-fanout"
echo "  payload: $PAYLOAD"
echo

curl -sS -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$SUPABASE_URL/functions/v1/notify-fanout" \
  | python3 -m json.tool

echo
echo "→ check the Pixel for the notification."
