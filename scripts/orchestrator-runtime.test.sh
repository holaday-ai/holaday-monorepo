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

# PM2 must own the actual long-lived Node server. Running through tsx leaves a
# loader child behind when PM2's managed PID is force-killed, which can split
# HTTP and WebSocket traffic across two orchestrator instances.
grep -Fq 'DIST_ENTRY="$ORCHESTRATOR_DIR/dist/index.js"' "$START_SCRIPT" \
  || fail "production entrypoint must target the compiled orchestrator"
grep -Fq 'exec "$NODE_BIN" "$DIST_ENTRY"' "$START_SCRIPT" \
  || fail "production entrypoint must exec the compiled server directly"
if grep -Ev '^[[:space:]]*#' "$START_SCRIPT" | grep -Eq 'tsx|src/index\.ts'; then
  fail "production entrypoint must not spawn the tsx loader"
fi

# A deploy from the historical tsx setup can inherit orphan listeners. The
# runtime transition must remove only verified stale orchestrators, then prove
# that both public service ports belong to the single PM2-managed PID.
grep -Fq 'stop_verified_stale_orchestrators' "$RUNTIME_SCRIPT" \
  || fail "runtime must clean verified stale orchestrator listeners"
grep -Fq 'verify_single_listener_owner' "$RUNTIME_SCRIPT" \
  || fail "runtime must verify one owner for HTTP and WebSocket ports"
grep -Fq 'ORCHESTRATOR_START_SCRIPT:-' "$RUNTIME_SCRIPT" \
  || fail "runtime must support a deploy-staged production entrypoint"
grep -Fq 'ORCHESTRATOR_REPO_ROOT:-' "$START_SCRIPT" \
  || fail "staged entrypoint must accept the live repository root"

echo "PASS: orchestrator runtime keeps one root-owned PM2 daemon and a non-root application child"
