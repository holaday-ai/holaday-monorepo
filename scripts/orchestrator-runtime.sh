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
START_SCRIPT="${ORCHESTRATOR_START_SCRIPT:-$REPO_ROOT/scripts/start-orchestrator-production.sh}"
ORCHESTRATOR_DIR="$REPO_ROOT/apps/orchestrator"
HTTP_PORT="${ORCHESTRATOR_HTTP_PORT:-4001}"
WS_PORT="${ORCHESTRATOR_WS_PORT:-4002}"

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
[[ "$HTTP_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || die "invalid HTTP port"
[[ "$WS_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || die "invalid WebSocket port"
[[ "$HTTP_PORT" != "$WS_PORT" ]] || die "HTTP and WebSocket ports must differ"
[[ -x "$NODE_BIN" ]] || die "node interpreter not executable: $NODE_BIN"
[[ -f "$REPO_ROOT/apps/orchestrator/dist/index.js" ]] || die "orchestrator build missing"
[[ -x "$START_SCRIPT" ]] || die "production start script missing or not executable"
command -v ss >/dev/null 2>&1 || die "ss is required for listener ownership checks"

listener_pids() {
  local port="$1"
  ss -H -ltnp "sport = :$port" 2>/dev/null \
    | grep -oE 'pid=[0-9]+' \
    | cut -d= -f2 \
    | sort -un \
    || true
}

is_verified_orchestrator_pid() {
  local pid="$1"
  local actual_uid cwd cmdline

  [[ "$pid" =~ ^[1-9][0-9]*$ && -d "/proc/$pid" ]] || return 1
  actual_uid="$(ps -o uid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
  [[ "$actual_uid" == "$RUN_UID" ]] || return 1
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$cwd" == "$ORCHESTRATOR_DIR" ]] || return 1
  cmdline="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$cmdline" == *"$ORCHESTRATOR_DIR/dist/index.js"* || "$cmdline" == *" src/index.ts"* ]]
}

stop_verified_stale_orchestrators() {
  local pid port_owner
  local -a stale_pids=()

  # Refuse to disturb an unrelated service that happens to own a configured
  # port. Only the dedicated runtime UID, exact cwd and known entrypoint are
  # eligible for cleanup.
  while read -r port_owner; do
    [[ -n "$port_owner" ]] || continue
    is_verified_orchestrator_pid "$port_owner" \
      || die "port $HTTP_PORT/$WS_PORT is owned by unrecognized pid $port_owner"
  done < <({ listener_pids "$HTTP_PORT"; listener_pids "$WS_PORT"; } | sort -un)

  for proc_dir in /proc/[0-9]*; do
    pid="${proc_dir##*/}"
    if is_verified_orchestrator_pid "$pid"; then
      stale_pids+=("$pid")
    fi
  done

  ((${#stale_pids[@]} > 0)) || return 0
  printf 'orchestrator-runtime: stopping verified stale pids: %s\n' "${stale_pids[*]}"
  kill -TERM "${stale_pids[@]}" 2>/dev/null || true
  for _ in $(seq 1 20); do
    local alive=0
    for pid in "${stale_pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
        break
      fi
    done
    ((alive == 0)) && return 0
    sleep 0.25
  done
  for pid in "${stale_pids[@]}"; do
    kill -KILL "$pid" 2>/dev/null || true
  done
  for _ in $(seq 1 20); do
    local alive=0
    for pid in "${stale_pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
        break
      fi
    done
    ((alive == 0)) && return 0
    sleep 0.1
  done
  die "verified stale orchestrator processes did not exit"
}

verify_single_listener_owner() {
  local expected_pid="$1"
  local -a http_pids ws_pids

  for _ in $(seq 1 60); do
    mapfile -t http_pids < <(listener_pids "$HTTP_PORT")
    mapfile -t ws_pids < <(listener_pids "$WS_PORT")
    if ((${#http_pids[@]} == 1 && ${#ws_pids[@]} == 1)) \
      && [[ "${http_pids[0]}" == "$expected_pid" && "${ws_pids[0]}" == "$expected_pid" ]]; then
      return 0
    fi
    sleep 1
  done

  printf 'orchestrator-runtime: listener ownership mismatch: expected=%s http=%s ws=%s\n' \
    "$expected_pid" "${http_pids[*]:-none}" "${ws_pids[*]:-none}" >&2
  return 1
}

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
export ORCHESTRATOR_REPO_ROOT="$REPO_ROOT"

# Recreate the PM2 entry deterministically. `pm2 restart` preserves the old
# root identity, while `--uid/--gid` on start records the intended runtime
# identity in PM2's process definition and survives `pm2 save`.
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
stop_verified_stale_orchestrators
pm2 start "$START_SCRIPT" \
  --name "$APP_NAME" \
  --interpreter /usr/bin/bash \
  --cwd "$REPO_ROOT/apps/orchestrator" \
  --uid "$RUN_UID" \
  --gid "$RUN_GID" \
  --update-env >/dev/null
pm2 save --force >/dev/null

# PM2 creates service logs with the daemon's default umask. Keep request and
# error logs readable only by root even after a fresh entry is created.
chmod 0600 "$PM2_HOME/logs/$APP_NAME-out.log" "$PM2_HOME/logs/$APP_NAME-error.log"

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
verify_single_listener_owner "$PID" || die "orchestrator ports are not owned by the PM2 process"

printf 'ORCHESTRATOR_RUNTIME user=%s uid=%s gid=%s pid=%s vnc=%s browser_dir=%s\n' \
  "$RUN_USER" "$RUN_UID" "$RUN_GID" "$PID" "$BROWSER_VNC_WS_ENABLED" "$BROWSER_DIR"
