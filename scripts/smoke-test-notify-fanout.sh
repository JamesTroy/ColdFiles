#!/usr/bin/env bash
# Smoke-test for notify-fanout Edge Function.
#
# Usage:
#   scripts/smoke-test-notify-fanout.sh                          # default: saved_case_update with a real recent case
#   scripts/smoke-test-notify-fanout.sh saved_case_update CASE_ID
#   scripts/smoke-test-notify-fanout.sh watch_zone_hit CASE_ID ZONE_ID
#   scripts/smoke-test-notify-fanout.sh tip_status_change CASE_ID TIP_ID
#
# Reads SUPABASE_SERVICE_ROLE_KEY from the repo-root .env file. The function
# requires service-role auth because it fans out across every push_tokens
# row whose user pref isn't explicitly false.

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

# Pre-flight: how many push tokens would receive this kind?
echo "→ pre-flight: counting eligible push tokens for kind=$KIND..."
case "$KIND" in
  watch_zone_hit)    PREF_KEY="watchZoneAlerts" ;;
  saved_case_update) PREF_KEY="savedCaseUpdates" ;;
  tip_status_change) PREF_KEY="tipStatusUpdates" ;;
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

# Pick a real recent case if none provided.
if [[ -z "$CASE_ID" && "$KIND" != "tip_status_change" ]]; then
  echo "→ picking a recent case_id..."
  CASE_ID=$(curl -sS \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    "$SUPABASE_URL/rest/v1/cases?select=id,slug,victim_first_name,victim_last_name&deleted_at=is.null&order=last_changed_at.desc&limit=1" \
    | python3 -c "import json,sys; r=json.load(sys.stdin); print(r[0]['id']) if r else None")
  echo "  case_id: $CASE_ID"
fi

# Build payload.
PAYLOAD=$(python3 -c "
import json,sys
p={'kind':'$KIND'}
if '$CASE_ID': p['case_id']='$CASE_ID'
if '$KIND'=='watch_zone_hit' and '$ZONE_ID': p['zone_id']='$ZONE_ID'
if '$KIND'=='tip_status_change' and '$TIP_ID': p['tip_id']='$TIP_ID'
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
