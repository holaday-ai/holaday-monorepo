#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=auto-smoke-summary.sh
source "$SCRIPT_DIR/auto-smoke-summary.sh"

assert_summary() {
  local expected_state="$1"
  local expected_passed="$2"
  local expected_total="$3"
  local output="$4"

  parse_auto_smoke_summary "$output"
  [[ "$AUTO_SMOKE_STATE" == "$expected_state" ]] || {
    echo "expected state=$expected_state, got $AUTO_SMOKE_STATE" >&2
    exit 1
  }
  [[ "$AUTO_SMOKE_PASSED" == "$expected_passed" ]] || {
    echo "expected passed=$expected_passed, got $AUTO_SMOKE_PASSED" >&2
    exit 1
  }
  [[ "$AUTO_SMOKE_TOTAL" == "$expected_total" ]] || {
    echo "expected total=$expected_total, got $AUTO_SMOKE_TOTAL" >&2
    exit 1
  }
}

assert_summary healthy 11 11 $'[eval] report written\n[eval] 11/11 passed'
assert_summary failures 10 11 $'[eval] report written\n[eval] 10/11 passed'
assert_summary failures 9 10 '[eval] 9/10 passed'
assert_summary healthy 11 11 $'[eval] 10/11 passed\nretrying\n[eval] 11/11 passed'
assert_summary unparseable '' '' 'runner failed before producing a summary'

echo 'auto-smoke summary parser tests passed'
