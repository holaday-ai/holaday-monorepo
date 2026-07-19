#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_SCRIPT="$SCRIPT_DIR/orchestrator-runtime.sh"
START_SCRIPT="$SCRIPT_DIR/start-orchestrator-production.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

runtime_pm2_home_line="$(grep -n 'ORCHESTRATOR_PM2_HOME:-/root/.pm2' "$RUNTIME_SCRIPT" | head -1 | cut -d: -f1 || true)"
runtime_pm2_start_line="$(grep -n 'pm2 start ' "$RUNTIME_SCRIPT" | head -1 | cut -d: -f1 || true)"

[[ "$runtime_pm2_home_line" =~ ^[1-9][0-9]*$ ]] || fail "runtime must pin PM2 to the root-owned process home"
[[ "$runtime_pm2_start_line" =~ ^[1-9][0-9]*$ ]] || fail "runtime must start the PM2 application"
(( runtime_pm2_home_line < runtime_pm2_start_line )) || fail "PM2 home must be selected before PM2 is invoked"

grep -Eq '^export PM2_HOME$' "$RUNTIME_SCRIPT" || fail "runtime must export the pinned PM2 home"
grep -Eq '^unset PM2_HOME$' "$START_SCRIPT" || fail "application child must not inherit root PM2 state"

echo "PASS: orchestrator runtime keeps one root-owned PM2 daemon and a non-root application child"
