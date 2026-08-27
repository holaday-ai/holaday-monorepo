#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_SCRIPT="$SCRIPT_DIR/orchestrator-runtime.sh"
START_SCRIPT="$SCRIPT_DIR/start-orchestrator-production.sh"
WORKER_START_SCRIPT="$SCRIPT_DIR/start-account-closure-worker-production.sh"
LOG_SECURITY_HELPER="$SCRIPT_DIR/secure-pm2-logs.mjs"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

runtime_pm2_home_line="$(grep -n 'ORCHESTRATOR_PM2_HOME:-/root/.pm2' "$RUNTIME_SCRIPT" | head -1 | cut -d: -f1 || true)"
runtime_pm2_start_line="$(grep -n 'pm2 start ' "$RUNTIME_SCRIPT" | head -1 | cut -d: -f1 || true)"
runtime_log_permissions_line="$(grep -n '"$NODE_BIN" "$LOG_SECURITY_HELPER" "${LOG_APPS\[@\]}"' "$RUNTIME_SCRIPT" | head -1 | cut -d: -f1 || true)"

[[ "$runtime_pm2_home_line" =~ ^[1-9][0-9]*$ ]] || fail "runtime must pin PM2 to the root-owned process home"
[[ "$runtime_pm2_start_line" =~ ^[1-9][0-9]*$ ]] || fail "runtime must start the PM2 application"
[[ "$runtime_log_permissions_line" =~ ^[1-9][0-9]*$ ]] || fail "runtime must secure actual PM2 log paths"
(( runtime_pm2_home_line < runtime_pm2_start_line )) || fail "PM2 home must be selected before PM2 is invoked"
(( runtime_pm2_start_line < runtime_log_permissions_line )) || fail "log permissions must be secured after PM2 creates the files"

grep -Eq '^export PM2_HOME$' "$RUNTIME_SCRIPT" || fail "runtime must export the pinned PM2 home"
grep -Fq 'PM2_LOG_SECURITY_HELPER:-' "$RUNTIME_SCRIPT" \
  || fail "runtime must support the validated PM2 log security helper"
[[ -f "$LOG_SECURITY_HELPER" ]] || fail "PM2 log security helper must ship with the runtime"
grep -Eq '^unset PM2_HOME$' "$START_SCRIPT" || fail "application child must not inherit root PM2 state"

# PM2 must own the actual long-lived Node server. The tsx CLI spawns a loader
# child; importing tsx into the PM2-managed Node process preserves workspace
# TypeScript resolution without creating a second process.
grep -Fq 'SOURCE_ENTRY="$ORCHESTRATOR_DIR/src/index.ts"' "$START_SCRIPT" \
  || fail "production entrypoint must target the orchestrator source entry"
grep -Fq 'exec "$NODE_BIN" --import tsx "$SOURCE_ENTRY"' "$START_SCRIPT" \
  || fail "production entrypoint must load TypeScript in the PM2-owned Node process"
if grep -Ev '^[[:space:]]*#' "$START_SCRIPT" | grep -Eq 'pnpm.*tsx|tsx.*src/index\.ts'; then
  fail "production entrypoint must not invoke the child-spawning tsx CLI"
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

# Closure deletion is a separate, portless, single-concurrency process. It
# shares uid 998 with the application but has its own memory ceiling and is
# removed from PM2 whenever the dark-launch flag is false.
grep -Fq 'ORCHESTRATOR_EXPECTED_UID:-998' "$RUNTIME_SCRIPT" \
  || fail "runtime must enforce the reviewed production uid 998"
grep -Fq 'holaday-account-closure-worker' "$RUNTIME_SCRIPT" \
  || fail "runtime must use a separate closure worker process"
grep -Fq 'pm2 delete "$WORKER_APP_NAME"' "$RUNTIME_SCRIPT" \
  || fail "disabled deployments must delete a stale worker entry"
grep -Fq '[[ "$WORKER_ENABLED" == "true" ]]' "$RUNTIME_SCRIPT" \
  || fail "worker startup must remain behind its independent flag"
grep -Fq -- '--instances 1' "$RUNTIME_SCRIPT" \
  || fail "PM2 must run exactly one worker instance"
grep -Fq -- '--max-memory-restart 512M' "$RUNTIME_SCRIPT" \
  || fail "worker must retain the 512M PM2 ceiling"
grep -Fq -- '--kill-timeout 660000' "$RUNTIME_SCRIPT" \
  || fail "PM2 must allow the reviewed 600s page bound plus 60s checkpoint drain margin"
grep -Fq -- '--uid "$RUN_UID"' "$RUNTIME_SCRIPT" \
  || fail "worker and application must share the dedicated uid"
grep -Fq 'BUILT_ENTRY="$ORCHESTRATOR_DIR/dist/account-closure/worker-entry.js"' "$WORKER_START_SCRIPT" \
  || fail "worker start helper must target the built portless worker entry"

# The built worker imports workspace packages whose production exports still
# point at TypeScript source. Exercise the helper itself and prove it registers
# the same in-process tsx loader used by the healthy orchestrator runtime while
# keeping the built worker as the PM2-owned entrypoint.
worker_harness="$(mktemp -d)"
worker_repo="$worker_harness/repo"
worker_node="$worker_harness/node"
worker_args="$worker_harness/node-args"
mkdir -p "$worker_repo/scripts" "$worker_repo/apps/orchestrator/dist/account-closure"
cp "$WORKER_START_SCRIPT" "$worker_repo/scripts/start-account-closure-worker-production.sh"
: > "$worker_repo/apps/orchestrator/dist/account-closure/worker-entry.js"
cat > "$worker_node" <<'FAKE_NODE'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$WORKER_NODE_ARGS_FILE"
FAKE_NODE
chmod +x "$worker_node" "$worker_repo/scripts/start-account-closure-worker-production.sh"
WORKER_NODE_ARGS_FILE="$worker_args" \
ORCHESTRATOR_NODE_BIN="$worker_node" \
ORCHESTRATOR_REPO_ROOT="$worker_repo" \
  "$worker_repo/scripts/start-account-closure-worker-production.sh"
worker_node_args=()
while IFS= read -r worker_arg; do
  worker_node_args[${#worker_node_args[@]}]="$worker_arg"
done < "$worker_args"
[[ "${#worker_node_args[@]}" == 3 ]] \
  || fail "worker Node process must receive the tsx loader and built entry"
[[ "${worker_node_args[0]}" == "--import" && "${worker_node_args[1]}" == "tsx" ]] \
  || fail "worker must register the in-process tsx workspace loader"
[[ "${worker_node_args[2]}" == "$worker_repo/apps/orchestrator/dist/account-closure/worker-entry.js" ]] \
  || fail "worker must remain the PM2-owned built Node process"
rm -rf "$worker_harness"
grep -Eq '^unset PM2_HOME$' "$WORKER_START_SCRIPT" \
  || fail "worker child must not inherit root PM2 state"
if grep -Eq 'HTTP_PORT|WS_PORT|listen\(' "$WORKER_START_SCRIPT"; then
  fail "worker start helper must not open or configure a public port"
fi

echo "PASS: orchestrator runtime keeps one application and one bounded portless closure worker"
