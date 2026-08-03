#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_SCRIPT="$SCRIPT_DIR/smoke-akshare-mcp.sh"
TEST_SCRIPT="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"

fake_payload() {
  local url="${*: -1}"
  local scenario="${SMOKE_TEST_SCENARIO:-valid_active}"
  local trade_date="2026-07-31"
  local quote_time="2026-07-31 10:04:00"
  local quote_fetched="2026-07-31T02:04:30+00:00"
  local minute_fetched="2026-07-31T02:04:30+00:00"
  local gainers_fetched="2026-07-31T02:04:30+00:00"
  local amount_fetched="2026-07-31T02:04:30+00:00"
  local minute_one="2026-07-31 10:03:00"
  local minute_two="2026-07-31 10:04:00"
  local trading_day=true
  local source="akshare:stock_zh_a_minute(sina,1m)"
  local gainers_source="akshare:sina-stock-rankings(gainers)"
  local amount_source="akshare:sina-stock-rankings(amount)"
  local gainers_row='{"代码":"600000","最新价":10,"涨跌幅":1.2,"成交额":100000}'
  local amount_row='{"代码":"600000","最新价":10,"涨跌幅":1.2,"成交额":100000}'

  case "$scenario" in
    future_minute)
      minute_two="2026-07-31 10:06:00"
      ;;
    future_weekend)
      trading_day=false
      quote_fetched="2026-08-02T02:04:30+00:00"
      minute_fetched="2026-08-02T02:04:30+00:00"
      gainers_fetched="2026-08-02T02:04:30+00:00"
      amount_fetched="2026-08-02T02:04:30+00:00"
      minute_one="2026-07-31 15:00:00"
      minute_two="2026-08-03 09:31:00"
      ;;
    stale_quote_fetch)
      quote_fetched="2026-07-31T01:50:00+00:00"
      ;;
    stale_minute_fetch)
      minute_fetched="2026-07-31T01:50:00+00:00"
      ;;
    stale_rankings_fetch)
      gainers_fetched="2026-07-31T01:50:00+00:00"
      amount_fetched="2026-07-31T01:50:00+00:00"
      ;;
    stale_market_time)
      quote_time="2026-07-31 09:50:00"
      minute_one="2026-07-31 09:49:00"
      minute_two="2026-07-31 09:50:00"
      ;;
    wrong_trade_date)
      trade_date="2026-07-30"
      quote_time="2026-07-30 15:00:00"
      minute_one="2026-07-30 14:59:00"
      minute_two="2026-07-30 15:00:00"
      ;;
    cross_date_mismatch)
      minute_one="2026-07-30 14:59:00"
      minute_two="2026-07-30 15:00:00"
      ;;
    lunch_break)
      quote_time="2026-07-31 11:30:00"
      quote_fetched="2026-07-31T04:14:30+00:00"
      minute_fetched="2026-07-31T04:14:30+00:00"
      gainers_fetched="2026-07-31T04:14:30+00:00"
      amount_fetched="2026-07-31T04:14:30+00:00"
      minute_one="2026-07-31 11:29:00"
      minute_two="2026-07-31 11:30:00"
      ;;
    lunch_stale_market_time)
      quote_time="2026-07-31 11:10:00"
      quote_fetched="2026-07-31T04:14:30+00:00"
      minute_fetched="2026-07-31T04:14:30+00:00"
      gainers_fetched="2026-07-31T04:14:30+00:00"
      amount_fetched="2026-07-31T04:14:30+00:00"
      minute_one="2026-07-31 11:09:00"
      minute_two="2026-07-31 11:10:00"
      ;;
    after_close)
      quote_time="2026-07-31 15:00:00"
      quote_fetched="2026-07-31T08:04:30+00:00"
      minute_fetched="2026-07-31T08:04:30+00:00"
      gainers_fetched="2026-07-31T08:04:30+00:00"
      amount_fetched="2026-07-31T08:04:30+00:00"
      minute_one="2026-07-31 14:59:00"
      minute_two="2026-07-31 15:00:00"
      ;;
    after_close_stale_market_time)
      quote_time="2026-07-31 14:40:00"
      quote_fetched="2026-07-31T08:04:30+00:00"
      minute_fetched="2026-07-31T08:04:30+00:00"
      gainers_fetched="2026-07-31T08:04:30+00:00"
      amount_fetched="2026-07-31T08:04:30+00:00"
      minute_one="2026-07-31 14:39:00"
      minute_two="2026-07-31 14:40:00"
      ;;
    weekend)
      trading_day=false
      quote_fetched="2026-08-02T02:04:30+00:00"
      minute_fetched="2026-08-02T02:04:30+00:00"
      gainers_fetched="2026-08-02T02:04:30+00:00"
      amount_fetched="2026-08-02T02:04:30+00:00"
      quote_time="2026-07-31 15:00:00"
      minute_one="2026-07-31 14:59:00"
      minute_two="2026-07-31 15:00:00"
      ;;
    weekend_stale_quote_fetch)
      trading_day=false
      gainers_fetched="2026-08-02T02:04:30+00:00"
      amount_fetched="2026-08-02T02:04:30+00:00"
      quote_time="2026-07-31 15:00:00"
      quote_fetched="2026-07-31T07:00:00+00:00"
      minute_fetched="2026-08-02T02:04:30+00:00"
      minute_one="2026-07-31 14:59:00"
      minute_two="2026-07-31 15:00:00"
      ;;
    holiday)
      trading_day=false
      trade_date="2026-09-30"
      quote_time="2026-09-30 15:00:00"
      quote_fetched="2026-10-01T02:04:30+00:00"
      minute_fetched="2026-10-01T02:04:30+00:00"
      gainers_fetched="2026-10-01T02:04:30+00:00"
      amount_fetched="2026-10-01T02:04:30+00:00"
      minute_one="2026-09-30 14:59:00"
      minute_two="2026-09-30 15:00:00"
      ;;
    intraday_unavailable_weekend)
      trading_day=false
      quote_fetched="2026-08-02T02:04:30+00:00"
      minute_fetched="2026-08-02T02:04:30+00:00"
      gainers_fetched="2026-08-02T02:04:30+00:00"
      amount_fetched="2026-08-02T02:04:30+00:00"
      quote_time="2026-07-31 15:00:00"
      minute_one="2026-07-31 14:59:00"
      minute_two="2026-07-31 15:00:00"
      ;;
    mock_source)
      source="mock:intraday"
      ;;
    mock_ranking_source)
      gainers_source="mock:gainers"
      ;;
    invalid_ranking_row)
      gainers_row='{"代码":"demo","最新价":0,"涨跌幅":"unknown","成交额":0}'
      ;;
  esac

  case "$url" in
    */healthz)
      printf '%s\n' '{"status":"ok","adapter_ready":true}'
      ;;
    */stock-rankings/gainers*)
      printf '{"data":[%s],"count":1,"source":"%s","fetched_at":"%s"}\n' \
        "$gainers_row" "$gainers_source" "$gainers_fetched"
      ;;
    */stock-rankings/amount*)
      printf '{"data":[%s],"count":1,"source":"%s","fetched_at":"%s"}\n' \
        "$amount_row" "$amount_source" "$amount_fetched"
      ;;
    */trading-day/*)
      printf '{"data":[{"date":"%s","is_trading_day":%s}],"count":1,"source":"akshare:tool_trade_date_hist_sina","fetched_at":"2026-07-31T02:04:30+00:00"}\n' \
        "${AKSHARE_SMOKE_NOW:0:10}" "$trading_day"
      ;;
    */quote/601958)
      printf '{"data":[{"代码":"601958","最新价":5.86,"行情时间":"%s"}],"count":1,"source":"%s","fetched_at":"%s"}\n' \
        "$quote_time" "$source" "$quote_fetched"
      ;;
    */intraday/601958)
      if [[ "$scenario" == intraday_unavailable_active || "$scenario" == intraday_unavailable_weekend ]]; then
        printf '%s\n' '{"error":"真实数据源暂不可用","error_code":"AKSHARE_UNAVAILABLE","data":[],"count":0,"source":"akshare:get_intraday","fetched_at":"2026-07-31T02:04:30+00:00"}'
        return
      fi
      printf '{"data":[{"时间":"%s","最新价":5.85},{"时间":"%s","最新价":5.86}],"count":2,"source":"%s","fetched_at":"%s"}\n' \
        "$minute_one" "$minute_two" "$source" "$minute_fetched"
      ;;
    *)
      echo "unexpected fake URL: $url" >&2
      return 22
      ;;
  esac
}

if [[ "$(basename "$0")" == "curl" ]]; then
  fake_payload "$@"
  exit
fi

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
ln -s "$TEST_SCRIPT" "$TMP_DIR/curl"

run_smoke() {
  local scenario="$1"
  local now="$2"
  (
    export PATH="$TMP_DIR:$PATH"
    export SMOKE_TEST_SCENARIO="$scenario"
    export AKSHARE_SMOKE_NOW="$now"
    export AKSHARE_SMOKE_REQUIRE_INTRADAY=auto
    export AKSHARE_SMOKE_MAX_FETCH_AGE_SECONDS=120
    export AKSHARE_SMOKE_MAX_MARKET_LAG_SECONDS=300
    bash "$SMOKE_SCRIPT"
  ) 2>&1
}

assert_passes() {
  local scenario="$1"
  local now="$2"
  local expected_phase="${3:-}"
  local output
  if ! output="$(run_smoke "$scenario" "$now")"; then
    echo "$output" >&2
    fail "$scenario should pass"
  fi
  grep -Fq 'akshare-mcp smoke OK' <<<"$output" || fail "$scenario did not report success"
  if [[ -n "$expected_phase" ]]; then
    grep -Fq "phase=$expected_phase" <<<"$output" || {
      echo "$output" >&2
      fail "$scenario did not report phase=$expected_phase"
    }
  fi
}

assert_fails_with() {
  local scenario="$1"
  local now="$2"
  local expected="$3"
  local output
  if output="$(run_smoke "$scenario" "$now")"; then
    echo "$output" >&2
    fail "$scenario should fail"
  fi
  if grep -Fq 'Traceback' <<<"$output"; then
    echo "$output" >&2
    fail "$scenario leaked a Python traceback"
  fi
  grep -Fq "$expected" <<<"$output" || {
    echo "$output" >&2
    fail "$scenario did not report '$expected'"
  }
}

assert_passes open_session '2026-07-31T10:05:00+08:00' active
assert_fails_with future_minute '2026-07-31T10:05:00+08:00' 'future minute point'
assert_fails_with future_weekend '2026-08-02T10:05:00+08:00' 'future minute point'
assert_fails_with stale_quote_fetch '2026-07-31T10:05:00+08:00' 'quote fetched_at is stale'
assert_fails_with stale_minute_fetch '2026-07-31T10:05:00+08:00' 'intraday fetched_at is stale'
assert_fails_with stale_rankings_fetch '2026-07-31T10:05:00+08:00' 'gainers fetched_at is stale'
assert_fails_with stale_market_time '2026-07-31T10:05:00+08:00' 'latest market minute is stale'
assert_fails_with wrong_trade_date '2026-07-31T10:05:00+08:00' 'trade date does not match current trading day'
assert_fails_with cross_date_mismatch '2026-07-31T10:05:00+08:00' 'trade dates are inconsistent'
assert_fails_with intraday_unavailable_active '2026-07-31T10:05:00+08:00' 'intraday upstream returned'
assert_fails_with mock_source '2026-07-31T10:05:00+08:00' 'non-production data source'
assert_fails_with mock_source '2026-08-02T10:05:00+08:00' 'non-production data source'
assert_fails_with mock_ranking_source '2026-07-31T10:05:00+08:00' 'non-production data source'
assert_fails_with invalid_ranking_row '2026-07-31T10:05:00+08:00' 'gainers row is not a real market ranking'
assert_passes lunch_break '2026-07-31T12:15:00+08:00'
assert_fails_with lunch_stale_market_time '2026-07-31T12:15:00+08:00' 'latest market minute is stale for lunch break'
assert_passes after_close '2026-07-31T16:05:00+08:00'
assert_fails_with after_close_stale_market_time '2026-07-31T16:05:00+08:00' 'latest market minute is stale after close'
assert_passes weekend '2026-08-02T10:05:00+08:00'
assert_fails_with weekend_stale_quote_fetch '2026-08-02T10:05:00+08:00' 'quote fetched_at is stale'
assert_passes intraday_unavailable_weekend '2026-08-02T10:05:00+08:00'
assert_passes holiday '2026-10-01T10:05:00+08:00'

echo 'PASS: strict AKShare smoke freshness and trading-session rules'
