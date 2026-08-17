#!/usr/bin/env bash
# Strict production smoke check for the local-only akshare-mcp HTTP service.
set -euo pipefail

BASE_URL="${AKSHARE_HTTP_URL:-http://127.0.0.1:8848}"
RANK_TIMEOUT="${AKSHARE_SMOKE_RANK_TIMEOUT:-60}"
SCREENING_TIMEOUT="${AKSHARE_SMOKE_SCREENING_TIMEOUT:-240}"
SCREENING_REQUEST_TIMEOUT="${AKSHARE_SMOKE_SCREENING_REQUEST_TIMEOUT:-20}"
SCREENING_POLL_SECONDS="${AKSHARE_SMOKE_SCREENING_POLL_SECONDS:-5}"
MIN_UNIVERSE_COUNT="${AKSHARE_SMOKE_MIN_UNIVERSE_COUNT:-4000}"
REQUIRE_INTRADAY="${AKSHARE_SMOKE_REQUIRE_INTRADAY:-auto}"
MAX_FETCH_AGE="${AKSHARE_SMOKE_MAX_FETCH_AGE_SECONDS:-120}"
MAX_MARKET_LAG="${AKSHARE_SMOKE_MAX_MARKET_LAG_SECONDS:-300}"
NOW_SHANGHAI="${AKSHARE_SMOKE_NOW:-$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S%z)}"

case "$REQUIRE_INTRADAY" in
  auto|1|true|yes|0|false|no) ;;
  *)
    echo "❌ AKSHARE_SMOKE_REQUIRE_INTRADAY must be auto/true/false" >&2
    exit 2
    ;;
esac

if ! [[ "$MAX_FETCH_AGE" =~ ^[1-9][0-9]*$ ]] || ! [[ "$MAX_MARKET_LAG" =~ ^[1-9][0-9]*$ ]] \
  || ! [[ "$SCREENING_TIMEOUT" =~ ^[1-9][0-9]*$ ]] \
  || ! [[ "$SCREENING_REQUEST_TIMEOUT" =~ ^[1-9][0-9]*$ ]] \
  || ! [[ "$SCREENING_POLL_SECONDS" =~ ^[1-9][0-9]*$ ]] \
  || ! [[ "$MIN_UNIVERSE_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "❌ AKSHARE smoke numeric limits must be positive whole numbers" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl_json_to_file() {
  local path="$1"
  local timeout="$2"
  local output="$3"
  curl -fsS --max-time "$timeout" "${BASE_URL}${path}" >"$output"
}

screening_response_ready() {
  python3 - "$1" <<'PY'
import json
import sys
from pathlib import Path

try:
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)

if not isinstance(payload, dict):
    raise SystemExit(1)

rows = payload.get("data")
count = payload.get("count")
if payload.get("error") or not isinstance(rows, list) or not rows:
    raise SystemExit(1)
if not isinstance(count, int) or count <= 0:
    raise SystemExit(1)
PY
}

wait_for_screening_universe() {
  local output="$1"
  local deadline=$((SECONDS + SCREENING_TIMEOUT))
  local attempt=1

  while true; do
    local remaining=$((deadline - SECONDS))
    if (( remaining <= 0 )); then
      echo "❌ akshare screening universe did not become ready within ${SCREENING_TIMEOUT}s" >&2
      return 1
    fi

    local request_timeout="$SCREENING_REQUEST_TIMEOUT"
    if (( request_timeout > remaining )); then
      request_timeout="$remaining"
    fi

    if curl_json_to_file '/screening-universe' "$request_timeout" "$output" \
      && screening_response_ready "$output"; then
      return 0
    fi

    remaining=$((deadline - SECONDS))
    if (( remaining <= 0 )); then
      echo "❌ akshare screening universe did not become ready within ${SCREENING_TIMEOUT}s" >&2
      return 1
    fi

    local poll_seconds="$SCREENING_POLL_SECONDS"
    if (( poll_seconds > remaining )); then
      poll_seconds="$remaining"
    fi
    echo "  screening universe not ready (attempt ${attempt}); retrying in ${poll_seconds}s"
    sleep "$poll_seconds"
    attempt=$((attempt + 1))
  done
}

echo "→ akshare smoke: ${BASE_URL}/healthz"
curl_json_to_file /healthz 5 "$TMP_DIR/health.json"

echo "→ akshare smoke: full-market screening universe"
wait_for_screening_universe "$TMP_DIR/screening-universe.json"

echo "→ akshare smoke: gainers ranking"
curl_json_to_file '/stock-rankings/gainers?limit=1' "$RANK_TIMEOUT" "$TMP_DIR/gainers.json"

echo "→ akshare smoke: amount ranking"
curl_json_to_file '/stock-rankings/amount?limit=1' "$RANK_TIMEOUT" "$TMP_DIR/amount.json"

TODAY="${NOW_SHANGHAI:0:10}"
echo "→ akshare smoke: A-share trading calendar for $TODAY"
curl_json_to_file "/trading-day/$TODAY" 20 "$TMP_DIR/trading-day.json"

echo "→ akshare smoke: real quote"
curl_json_to_file '/quote/601958' 20 "$TMP_DIR/quote.json"

echo "→ akshare smoke: intraday minute series"
INTRADAY_AVAILABLE=1
if ! curl_json_to_file '/intraday/601958' 20 "$TMP_DIR/intraday.json"; then
  INTRADAY_AVAILABLE=0
  : >"$TMP_DIR/intraday.json"
fi

# Live requests can cross a minute boundary. Refresh the evaluation clock after
# every response has arrived so a new real minute is not mislabeled as future.
if [[ -z "${AKSHARE_SMOKE_NOW:-}" ]]; then
  NOW_SHANGHAI="$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S%z)"
fi

python3 - \
  "$NOW_SHANGHAI" \
  "$REQUIRE_INTRADAY" \
  "$MAX_FETCH_AGE" \
  "$MAX_MARKET_LAG" \
  "$MIN_UNIVERSE_COUNT" \
  "$INTRADAY_AVAILABLE" \
  "$TMP_DIR/health.json" \
  "$TMP_DIR/gainers.json" \
  "$TMP_DIR/amount.json" \
  "$TMP_DIR/screening-universe.json" \
  "$TMP_DIR/trading-day.json" \
  "$TMP_DIR/quote.json" \
  "$TMP_DIR/intraday.json" <<'PY'
from __future__ import annotations

import json
import math
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


(
    now_raw,
    intraday_mode,
    max_fetch_age_raw,
    max_market_lag_raw,
    min_universe_count_raw,
    intraday_available_raw,
    health_path,
    gainers_path,
    amount_path,
    screening_path,
    calendar_path,
    quote_path,
    intraday_path,
) = sys.argv[1:]

SHANGHAI = timezone(timedelta(hours=8))
MAX_FETCH_AGE = int(max_fetch_age_raw)
MAX_MARKET_LAG = int(max_market_lag_raw)
MIN_UNIVERSE_COUNT = int(min_universe_count_raw)
intraday_transport_available = intraday_available_raw == "1"


class GateFailure(RuntimeError):
    pass


def concise_exception(exc_type: type[BaseException], exc: BaseException, traceback: Any) -> None:
    if issubclass(exc_type, GateFailure):
        print(f"❌ akshare real-data gate failed: {exc}", file=sys.stderr)
        return
    sys.__excepthook__(exc_type, exc, traceback)


sys.excepthook = concise_exception


def fail(message: str) -> None:
    raise GateFailure(message)


def parse_timestamp(value: Any, label: str, *, assume_shanghai: bool = False) -> datetime:
    if not isinstance(value, str) or not value.strip():
        fail(f"{label} is missing")
    text = value.strip().replace("Z", "+00:00")
    # GNU date emits offsets such as +0800, while Python 3.10's
    # datetime.fromisoformat requires +08:00.
    text = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", text)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        fail(f"{label} is not an ISO timestamp")
    if parsed.tzinfo is None:
        if not assume_shanghai:
            fail(f"{label} has no timezone")
        parsed = parsed.replace(tzinfo=SHANGHAI)
    return parsed.astimezone(SHANGHAI)


now = parse_timestamp(now_raw, "AKSHARE_SMOKE_NOW", assume_shanghai=True)
today = now.date().isoformat()
now_minute = now.replace(second=0, microsecond=0)
minute_of_day = now.hour * 60 + now.minute


def load_json(path: str, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        fail(f"{label} response is not valid JSON")
    if not isinstance(payload, dict):
        fail(f"{label} response is not an object")
    return payload


def validate_source(payload: dict[str, Any], label: str) -> None:
    source = payload.get("source")
    if not isinstance(source, str) or not source.startswith("akshare:"):
        fail(f"{label} has a non-production data source")
    if re.search(r"(?:mock|fixture|synthetic|demo)", source, flags=re.IGNORECASE):
        fail(f"{label} has a non-production data source")


def data_envelope(path: str, label: str) -> dict[str, Any]:
    payload = load_json(path, label)
    if payload.get("error"):
        fail(f"{label} upstream returned {payload.get('error_code', 'an error')}")
    rows = payload.get("data")
    if not isinstance(rows, list) or not rows or payload.get("count") == 0:
        fail(f"{label} returned no real rows")
    validate_source(payload, label)
    return payload


health = load_json(health_path, "healthz")
if health.get("status") != "ok" or health.get("adapter_ready") is not True:
    fail("healthz does not report a ready real-data adapter")

gainers = data_envelope(gainers_path, "gainers")
amount = data_envelope(amount_path, "amount")
screening = load_json(screening_path, "screening universe")
if screening.get("error"):
    fail(f"screening universe upstream returned {screening.get('error_code', 'an error')}")
screening_rows = screening.get("data")
screening_count = screening.get("count")
screening_source = screening.get("source")
if (
    not isinstance(screening_source, str)
    or not screening_source.startswith(("akshare:", "sina:"))
    or re.search(r"(?:mock|fixture|synthetic|demo)", screening_source, flags=re.IGNORECASE)
):
    fail("screening universe has a non-production data source")
if (
    not isinstance(screening_rows, list)
    or not isinstance(screening_count, int)
    or screening_count < MIN_UNIVERSE_COUNT
    or len(screening_rows) < MIN_UNIVERSE_COUNT
):
    fail(
        "screening universe is unexpectedly small "
        f"({screening_count!r}; minimum {MIN_UNIVERSE_COUNT})"
    )
calendar = data_envelope(calendar_path, "trading calendar")
calendar_row = calendar["data"][0]
if not isinstance(calendar_row, dict) or calendar_row.get("date", "").replace("-", "") != today.replace("-", ""):
    fail("trading calendar returned a different date")
is_trading_day = calendar_row.get("is_trading_day")
if not isinstance(is_trading_day, bool):
    fail("trading calendar did not return a boolean session state")

# The first few minutes after each opening auction are a source grace period.
active_market = is_trading_day and (
    9 * 60 + 35 <= minute_of_day <= 11 * 60 + 30
    or 13 * 60 + 5 <= minute_of_day <= 15 * 60
)
auto_requires_intraday = is_trading_day and 9 * 60 + 35 <= minute_of_day <= 15 * 60 + 15
if intraday_mode in {"1", "true", "yes"}:
    intraday_required = True
elif intraday_mode in {"0", "false", "no"}:
    intraday_required = False
else:
    intraday_required = auto_requires_intraday

quote = data_envelope(quote_path, "quote")
intraday: dict[str, Any] | None = None
if intraday_transport_available and Path(intraday_path).stat().st_size > 0:
    candidate = load_json(intraday_path, "intraday")
    rows = candidate.get("data")
    unavailable = bool(candidate.get("error")) or not isinstance(rows, list) or not rows or candidate.get("count") == 0
    if unavailable:
        if intraday_required:
            if candidate.get("error"):
                fail(f"intraday upstream returned {candidate.get('error_code', 'an error')}")
            fail("intraday returned no real rows")
    else:
        validate_source(candidate, "intraday")
        intraday = candidate
elif intraday_required:
    fail("intraday is unavailable during the required trading window")


def fetched_at(payload: dict[str, Any], label: str) -> datetime:
    fetched = parse_timestamp(payload.get("fetched_at"), f"{label} fetched_at")
    age = (now - fetched).total_seconds()
    if age < -MAX_FETCH_AGE:
        fail(f"{label} fetched_at is in the future")
    # fetched_at measures when the adapter contacted the real upstream. It must
    # stay fresh even when the exchange itself is paused or closed.
    if age > MAX_FETCH_AGE:
        fail(f"{label} fetched_at is stale ({int(age)}s old)")
    return fetched


def finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def validate_ranking(payload: dict[str, Any], label: str) -> None:
    row = payload["data"][0]
    if not isinstance(row, dict):
        fail(f"{label} row is not a real market ranking")
    code = str(row.get("代码", "")).strip()
    price = finite_number(row.get("最新价"))
    change = finite_number(row.get("涨跌幅"))
    amount_value = finite_number(row.get("成交额"))
    if (
        re.fullmatch(r"\d{6}", code) is None
        or price is None
        or price <= 0
        or change is None
        or amount_value is None
        or amount_value <= 0
    ):
        fail(f"{label} row is not a real market ranking")


validate_ranking(gainers, "gainers")
validate_ranking(amount, "amount")
fetched_at(gainers, "gainers")
fetched_at(amount, "amount")
fetched_at(quote, "quote")
if intraday is not None:
    fetched_at(intraday, "intraday")


def market_time(row: Any, keys: tuple[str, ...], label: str) -> datetime:
    if not isinstance(row, dict):
        fail(f"{label} row is invalid")
    raw = next((row.get(key) for key in keys if row.get(key) not in {None, ""}), None)
    return parse_timestamp(raw, label, assume_shanghai=True)


quote_time = market_time(quote["data"][0], ("行情时间", "时间"), "quote market time")
quote_row = quote["data"][0]
quote_code = str(quote_row.get("代码", "")).strip() if isinstance(quote_row, dict) else ""
quote_price = finite_number(quote_row.get("最新价")) if isinstance(quote_row, dict) else None
if quote_code != "601958" or quote_price is None or quote_price <= 0:
    fail("quote row is not a real market quote")
if quote_time.replace(second=0, microsecond=0) > now_minute:
    fail("quote contains a future market minute")

minute_times: list[datetime] = []
if intraday is not None:
    minute_times = [
        market_time(row, ("时间", "行情时间"), "intraday minute")
        for row in intraday["data"]
    ]
    if any(point.replace(second=0, microsecond=0) > now_minute for point in minute_times):
        fail("intraday contains a future minute point")
    minute_dates = {point.date().isoformat() for point in minute_times}
    if len(minute_dates) != 1:
        fail("intraday contains multiple trade dates")

quote_date = quote_time.date().isoformat()
intraday_date = max(minute_times).date().isoformat() if minute_times else None
if quote_date > today or (intraday_date is not None and intraday_date > today):
    fail("market data uses a future trade date")
if intraday_date is not None and quote_date != intraday_date:
    fail("quote and intraday trade dates are inconsistent")

# After the opening grace period, a real trading day's payload must be today's
# session. Before the open and on closed days, the latest prior session is valid.
if is_trading_day and minute_of_day >= 9 * 60 + 35:
    if quote_date != today or (intraday_date is not None and intraday_date != today):
        fail("trade date does not match current trading day")

def require_market_cutoff(reference: datetime, context: str) -> None:
    points = [("quote", quote_time)]
    if minute_times:
        points.append(("intraday", max(minute_times)))
    for label, point in points:
        lag = (reference - point).total_seconds()
        if lag < 0:
            fail(f"{label} contains a market minute outside {context}")
        if lag > MAX_MARKET_LAG:
            fail(f"latest market minute is stale {context} ({label}: {int(lag)}s behind)")


if active_market:
    require_market_cutoff(now, "during active session")
elif is_trading_day and 11 * 60 + 30 < minute_of_day < 13 * 60 + 5:
    require_market_cutoff(now.replace(hour=11, minute=30, second=0, microsecond=0), "for lunch break")
elif is_trading_day and minute_of_day > 15 * 60:
    require_market_cutoff(now.replace(hour=15, minute=0, second=0, microsecond=0), "after close")
elif quote_date < today:
    prior_close = quote_time.replace(hour=15, minute=0, second=0, microsecond=0)
    require_market_cutoff(prior_close, "for the latest closed session")

if intraday is None:
    print("⚠️ akshare smoke: intraday unavailable outside the required trading window; not blocking deploy")

phase = "active" if active_market else ("closed-session" if not is_trading_day else "paused-session")
minute_summary = max(minute_times).strftime("%Y-%m-%d %H:%M") if minute_times else "unavailable"
print(
    "✓ real-data gate: "
    f"trading_day={str(is_trading_day).lower()} phase={phase} "
    f"quote={quote_time.strftime('%Y-%m-%d %H:%M')} intraday={minute_summary} "
    f"screening_universe={screening_count}"
)
PY

echo "✅ akshare-mcp smoke OK"
