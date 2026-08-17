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
  local screening_source="akshare:sina-full-market-screening"
  local screening_count=3
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
    cross_minute_clock)
      quote_time="2026-07-31 10:06:00"
      quote_fetched="2026-07-31T02:05:30+00:00"
      minute_fetched="2026-07-31T02:05:30+00:00"
      gainers_fetched="2026-07-31T02:05:30+00:00"
      amount_fetched="2026-07-31T02:05:30+00:00"
      minute_one="2026-07-31 10:05:00"
      minute_two="2026-07-31 10:06:00"
      ;;
    screening_delays_rankings)
      quote_time="2026-07-31 10:09:00"
      quote_fetched="2026-07-31T02:08:30+00:00"
      minute_fetched="2026-07-31T02:08:30+00:00"
      gainers_fetched="2026-07-31T02:05:30+00:00"
      amount_fetched="2026-07-31T02:05:30+00:00"
      minute_one="2026-07-31 10:08:00"
      minute_two="2026-07-31 10:09:00"
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
    mock_screening_source)
      screening_source="mock:screening-universe"
      ;;
    small_screening_universe)
      screening_count=1
      ;;
  esac

  case "$url" in
    */healthz)
      printf '%s\n' '{"status":"ok","adapter_ready":true}'
      ;;
    */stock-rankings/gainers*)
      if [[ "$scenario" == screening_delays_rankings && -f "${SMOKE_TEST_SCREENING_STATE:?}" ]]; then
        gainers_fetched="2026-07-31T02:08:30+00:00"
      fi
      printf '{"data":[%s],"count":1,"source":"%s","fetched_at":"%s"}\n' \
        "$gainers_row" "$gainers_source" "$gainers_fetched"
      ;;
    */stock-rankings/amount*)
      if [[ "$scenario" == screening_delays_rankings && -f "${SMOKE_TEST_SCREENING_STATE:?}" ]]; then
        amount_fetched="2026-07-31T02:08:30+00:00"
      fi
      printf '{"data":[%s],"count":1,"source":"%s","fetched_at":"%s"}\n' \
        "$amount_row" "$amount_source" "$amount_fetched"
      ;;
    */trading-day/*)
      printf '{"data":[{"date":"%s","is_trading_day":%s}],"count":1,"source":"akshare:tool_trade_date_hist_sina","fetched_at":"2026-07-31T02:04:30+00:00"}\n' \
        "${url##*/}" "$trading_day"
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
    */screening-universe)
      if [[ "$scenario" == screening_delays_rankings ]]; then
        : >"${SMOKE_TEST_SCREENING_STATE:?}"
      fi
      if [[ "$scenario" == screening_never_ready ]]; then
        printf '%s\n' '{"error":"真实数据源响应超时","error_code":"SINGLE_FLIGHT_TIMEOUT","data":[],"count":0,"source":"akshare:get_screening_universe","fetched_at":"2026-07-31T02:04:30+00:00"}'
        return
      fi
      if [[ "$scenario" == screening_cold_follower && ! -f "${SMOKE_TEST_SCREENING_STATE:?}" ]]; then
        : >"$SMOKE_TEST_SCREENING_STATE"
        printf '%s\n' '{"error":"真实数据源响应超时","error_code":"SINGLE_FLIGHT_TIMEOUT","data":[],"count":0,"source":"akshare:get_screening_universe","fetched_at":"2026-07-31T02:04:30+00:00"}'
        return
      fi
      if [[ "$screening_count" == 1 ]]; then
        printf '{"data":[{"代码":"600000"}],"count":1,"source":"%s","fetched_at":"%s"}\n' \
          "$screening_source" "$gainers_fetched"
      else
        printf '{"data":[{"代码":"600000"},{"代码":"000001"},{"代码":"300001"}],"count":3,"source":"%s","fetched_at":"%s"}\n' \
          "$screening_source" "$gainers_fetched"
      fi
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

if [[ "$(basename "$0")" == "date" ]]; then
  state_file="${SMOKE_TEST_DATE_STATE:?}"
  if [[ -f "$state_file" ]]; then
    if [[ "${SMOKE_TEST_SCENARIO:-}" == screening_delays_rankings ]]; then
      printf '%s\n' '2026-07-31T10:09:00+0800'
    else
      printf '%s\n' '2026-07-31T10:06:00+0800'
    fi
  else
    : >"$state_file"
    printf '%s\n' '2026-07-31T10:05:00+0800'
  fi
  exit
fi

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
ln -s "$TEST_SCRIPT" "$TMP_DIR/curl"
ln -s "$TEST_SCRIPT" "$TMP_DIR/date"

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
    export AKSHARE_SMOKE_MIN_UNIVERSE_COUNT=2
    export AKSHARE_SMOKE_SCREENING_TIMEOUT=3
    export AKSHARE_SMOKE_SCREENING_REQUEST_TIMEOUT=1
    export AKSHARE_SMOKE_SCREENING_POLL_SECONDS=1
    export SMOKE_TEST_SCREENING_STATE="$TMP_DIR/screening-$scenario-state"
    rm -f "$SMOKE_TEST_SCREENING_STATE"
    bash "$SMOKE_SCRIPT"
  ) 2>&1
}

run_smoke_auto_clock() {
  local scenario="${1:-cross_minute_clock}"
  (
    export PATH="$TMP_DIR:$PATH"
    export SMOKE_TEST_SCENARIO="$scenario"
    export SMOKE_TEST_DATE_STATE="$TMP_DIR/date-$scenario-state"
    export SMOKE_TEST_SCREENING_STATE="$TMP_DIR/screening-$scenario-state"
    export AKSHARE_SMOKE_REQUIRE_INTRADAY=auto
    export AKSHARE_SMOKE_MAX_FETCH_AGE_SECONDS=120
    export AKSHARE_SMOKE_MAX_MARKET_LAG_SECONDS=300
    export AKSHARE_SMOKE_MIN_UNIVERSE_COUNT=2
    rm -f "$SMOKE_TEST_DATE_STATE" "$SMOKE_TEST_SCREENING_STATE"
    unset AKSHARE_SMOKE_NOW
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

assert_auto_clock_passes() {
  local output
  if ! output="$(run_smoke_auto_clock)"; then
    echo "$output" >&2
    fail "cross-minute live clock should pass"
  fi
  grep -Fq 'akshare-mcp smoke OK' <<<"$output" || fail "auto clock did not report success"
}

assert_delayed_screening_does_not_stale_rankings() {
  local output
  if ! output="$(run_smoke_auto_clock screening_delays_rankings)"; then
    echo "$output" >&2
    fail "slow screening should not stale rankings fetched afterward"
  fi
  grep -Fq 'akshare-mcp smoke OK' <<<"$output" \
    || fail "slow-screening clock did not report success"
}

assert_passes open_session '2026-07-31T10:05:00+08:00' active
assert_passes open_session '2026-07-31T10:05:00+0800' active
assert_passes screening_cold_follower '2026-07-31T10:05:00+08:00' active
assert_auto_clock_passes
assert_delayed_screening_does_not_stale_rankings
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
assert_fails_with mock_screening_source '2026-07-31T10:05:00+08:00' 'screening universe has a non-production data source'
assert_fails_with small_screening_universe '2026-07-31T10:05:00+08:00' 'screening universe is unexpectedly small'
assert_fails_with screening_never_ready '2026-07-31T10:05:00+08:00' 'screening universe did not become ready within 3s'
assert_passes lunch_break '2026-07-31T12:15:00+08:00'
assert_fails_with lunch_stale_market_time '2026-07-31T12:15:00+08:00' 'latest market minute is stale for lunch break'
assert_passes after_close '2026-07-31T16:05:00+08:00'
assert_fails_with after_close_stale_market_time '2026-07-31T16:05:00+08:00' 'latest market minute is stale after close'
assert_passes weekend '2026-08-02T10:05:00+08:00'
assert_fails_with weekend_stale_quote_fetch '2026-08-02T10:05:00+08:00' 'quote fetched_at is stale'
assert_passes intraday_unavailable_weekend '2026-08-02T10:05:00+08:00'
assert_passes holiday '2026-10-01T10:05:00+08:00'

echo 'PASS: strict AKShare smoke freshness and trading-session rules'
