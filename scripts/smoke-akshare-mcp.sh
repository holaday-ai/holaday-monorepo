#!/usr/bin/env bash
# Smoke check for the local-only akshare-mcp HTTP service.
set -euo pipefail

BASE_URL="${AKSHARE_HTTP_URL:-http://127.0.0.1:8848}"
RANK_TIMEOUT="${AKSHARE_SMOKE_RANK_TIMEOUT:-60}"

curl_json() {
  local path="$1"
  local timeout="$2"
  curl -fsS --max-time "$timeout" "${BASE_URL}${path}"
}

require_payload() {
  local label="$1"
  local payload="$2"
  if ! grep -Fq '"data":[' <<<"$payload"; then
    echo "❌ ${label}: response is not an AkShare data envelope" >&2
    echo "$payload" >&2
    exit 1
  fi
  if grep -Fq '"error"' <<<"$payload"; then
    echo "❌ ${label}: upstream returned an error envelope" >&2
    echo "$payload" >&2
    exit 1
  fi
  if grep -Fq '"count":0' <<<"$payload"; then
    echo "❌ ${label}: ranking returned zero rows" >&2
    echo "$payload" >&2
    exit 1
  fi
}

echo "→ akshare smoke: ${BASE_URL}/healthz"
HEALTH="$(curl_json /healthz 5)"
if ! grep -Fq '"status":"ok"' <<<"$HEALTH"; then
  echo "❌ healthz failed: ${HEALTH:-<empty>}" >&2
  exit 1
fi

echo "→ akshare smoke: gainers ranking"
GAINERS="$(curl_json '/stock-rankings/gainers?limit=1' "$RANK_TIMEOUT")"
require_payload "gainers" "$GAINERS"

echo "→ akshare smoke: amount ranking"
AMOUNT="$(curl_json '/stock-rankings/amount?limit=1' "$RANK_TIMEOUT")"
require_payload "amount" "$AMOUNT"

echo "✅ akshare-mcp smoke OK"
