#!/usr/bin/env bash
# Start the production orchestrator through root-owned PM2 while dropping the
# application process to a dedicated OS user. The browser pool inherits that
# identity, which keeps Chromium's sandbox enabled.

set -euo pipefail

ACTION="${1:-restart}"
REPO_ROOT="${2:-/opt/holaday-monorepo}"
APP_NAME="${ORCHESTRATOR_PM2_NAME:-holaday-orchestrator}"
RUN_USER="${ORCHESTRATOR_RUN_USER:-holaday}"
RUN_GROUP="${ORCHESTRATOR_RUN_GROUP:-$RUN_USER}"
NODE_BIN="${ORCHESTRATOR_NODE_BIN:-/opt/node22/bin/node}"
BROWSER_DIR="${BROWSER_POOL_DIR:-/var/lib/holaday-browsers}"
PM2_HOME="${ORCHESTRATOR_PM2_HOME:-/root/.pm2}"
START_SCRIPT="$REPO_ROOT/scripts/start-orchestrator-production.sh"

die() {
  echo "orchestrator-runtime: $*" >&2
  exit 1
}

[[ "$ACTION" == "restart" ]] || die "unsupported action: $ACTION"
[[ "${EUID:-$(id -u)}" == "0" ]] || die "must run as root to configure PM2 uid/gid"
[[ "$RUN_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "invalid runtime user"
[[ "$RUN_GROUP" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "invalid runtime group"
[[ "$BROWSER_DIR" == /* && "$BROWSER_DIR" != "/" ]] || die "unsafe browser pool directory"
[[ "$PM2_HOME" == /* && "$PM2_HOME" != "/" ]] || die "unsafe PM2 home directory"
[[ -x "$NODE_BIN" ]] || die "node interpreter not executable: $NODE_BIN"
[[ -f "$REPO_ROOT/apps/orchestrator/dist/index.js" ]] || die "orchestrator build missing"
[[ -x "$START_SCRIPT" ]] || die "production start script missing or not executable"

if [[ "${BROWSER_VNC_WS_ENABLED:-false}" != "false" && "${ALLOW_BROWSER_VNC_WS:-0}" != "1" ]]; then
  die "BROWSER_VNC_WS_ENABLED must remain false in the standard production environment"
fi
export BROWSER_VNC_WS_ENABLED="${BROWSER_VNC_WS_ENABLED:-false}"
export BROWSER_POOL_DIR="$BROWSER_DIR"

if ! getent group "$RUN_GROUP" >/dev/null 2>&1; then
  groupadd --system "$RUN_GROUP"
fi

if ! id "$RUN_USER" >/dev/null 2>&1; then
  useradd \
    --system \
    --gid "$RUN_GROUP" \
    --home-dir "/var/lib/$RUN_USER" \
    --create-home \
    --shell /usr/sbin/nologin \
    "$RUN_USER"
fi

RUN_UID="$(id -u "$RUN_USER")"
RUN_GID="$(id -g "$RUN_USER")"
EXPECTED_GID="$(getent group "$RUN_GROUP" | cut -d: -f3)"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
[[ "$RUN_GID" == "$EXPECTED_GID" ]] || die "runtime user primary group does not match $RUN_GROUP"
[[ -n "$RUN_HOME" ]] || die "runtime user has no home directory"

install -d -o "$RUN_USER" -g "$RUN_GROUP" -m 0750 "$RUN_HOME"
install -d -o "$RUN_USER" -g "$RUN_GROUP" -m 0750 "$BROWSER_DIR"
install -d -o "$RUN_USER" -g "$RUN_GROUP" -m 0700 "$RUN_HOME/.runtime"

# Existing browser profiles may have been created by the historical root
# process. Transfer only the dedicated pool tree before the first non-root run.
chown -R "$RUN_USER:$RUN_GROUP" "$BROWSER_DIR"

export HOME="$RUN_HOME"
export USER="$RUN_USER"
export LOGNAME="$RUN_USER"
export XDG_RUNTIME_DIR="$RUN_HOME/.runtime"
export PM2_HOME

# Recreate the PM2 entry deterministically. `pm2 restart` preserves the old
# root identity, while `--uid/--gid` on start records the intended runtime
# identity in PM2's process definition and survives `pm2 save`.
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start "$START_SCRIPT" \
  --name "$APP_NAME" \
  --interpreter /usr/bin/bash \
  --cwd "$REPO_ROOT/apps/orchestrator" \
  --uid "$RUN_UID" \
  --gid "$RUN_GID" \
  --update-env >/dev/null
pm2 save --force >/dev/null

PID=""
for _ in $(seq 1 20); do
  PID="$(pm2 pid "$APP_NAME" | head -1 | tr -d '[:space:]')"
  if [[ "$PID" =~ ^[1-9][0-9]*$ ]] && kill -0 "$PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

[[ "$PID" =~ ^[1-9][0-9]*$ ]] || die "PM2 did not publish an orchestrator pid"
ACTUAL_UID="$(ps -o uid= -p "$PID" | tr -d '[:space:]')"
[[ "$ACTUAL_UID" == "$RUN_UID" ]] || die "runtime uid mismatch: expected $RUN_UID, got ${ACTUAL_UID:-missing}"

printf 'ORCHESTRATOR_RUNTIME user=%s uid=%s gid=%s pid=%s vnc=%s browser_dir=%s\n' \
  "$RUN_USER" "$RUN_UID" "$RUN_GID" "$PID" "$BROWSER_VNC_WS_ENABLED" "$BROWSER_DIR"
