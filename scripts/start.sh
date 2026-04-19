#!/usr/bin/env bash
#
# scripts/start.sh — bring the whole HOLA DAY stack up from nothing.
#
# What it does, in order:
#   1. git pull --rebase (with proxy env stripped — see refresh.sh notes).
#   2. pnpm install (idempotent; skips when lockfile is in sync).
#   3. pnpm --filter @holaday/extension build.
#   4. Verify HTTPS_PROXY is set (orchestrator needs it to reach Anthropic
#      from mainland-China dogfood boxes; warn, don't fail, because CI
#      may legitimately not need it).
#   5. Verify MariaDB + Redis are listening on their standard ports. If
#      they're not running AND we're in a Linux sandbox that has the
#      daemons installed, start them in the background. On macOS we
#      fail loud because brew-services is the expected pattern.
#   6. pnpm --filter @holaday/orchestrator sync-skills — pushes the
#      `skills/` folder manifests into the DB (new `allowedOrigins`
#      entries won't land without this).
#   7. Start `pnpm --filter @holaday/orchestrator dev` in the background
#      with a PID file + log file. If it's already listening on port
#      3001 we leave it alone.
#
# Exits 0 when everything is ready to accept requests on 3001/3002.
# Non-zero on any step failure with a pointer at what to fix.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Colours — gated on TTY for clean CI logs.
if [ -t 1 ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; NC=$'\033[0m'
else
  BOLD=""; GREEN=""; RED=""; YELLOW=""; NC=""
fi
step()   { printf '\n%s▶ %s%s\n' "$BOLD" "$1" "$NC"; }
ok()     { printf '%s✔ %s%s\n' "$GREEN" "$1" "$NC"; }
info()   { printf '%sℹ %s%s\n' "$YELLOW" "$1" "$NC"; }
fail()   { printf '%s✘ %s%s\n' "$RED" "$1" "$NC" >&2; exit 1; }

HTTP_PORT="${HOLADAY_HTTP_PORT:-3001}"
WS_PORT="${HOLADAY_WS_PORT:-3002}"
MARIADB_PORT=3306
REDIS_PORT=6379
ORCH_PID_FILE="${HOLADAY_ORCH_PID_FILE:-/tmp/holaday-orchestrator.pid}"
ORCH_LOG_FILE="${HOLADAY_ORCH_LOG_FILE:-/tmp/holaday-orchestrator.log}"

port_in_use() {
  # Portable TCP port probe. `nc -z` works on macOS + Linux + BSD.
  nc -z 127.0.0.1 "$1" 2>/dev/null
}

# ---------- 1. git pull ----------
step "git pull --rebase"
if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "working tree has uncommitted changes — stash or commit before starting"
fi
# Strip proxy env vars just for git — the proxy that orchestrator needs
# to hit Anthropic typically breaks GitHub's HTTP/2 push (same logic as
# scripts/refresh.sh; see commit f13da7f for the diagnosis).
env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy \
    -u ALL_PROXY -u all_proxy \
    git pull --rebase \
  || fail "git pull --rebase failed (conflict? network? rerun after fixing)"
ok "pulled $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

# ---------- 2. pnpm install ----------
step "pnpm install (workspace)"
pnpm install --frozen-lockfile >/dev/null 2>&1 \
  && ok "install clean (frozen lockfile)" \
  || {
    info "frozen-lockfile refused; falling back to plain install"
    pnpm install >/dev/null 2>&1 || fail "pnpm install failed — see pnpm log"
    ok "install done"
  }

# ---------- 3. extension build ----------
step "pnpm --filter @holaday/extension build"
pnpm --filter @holaday/extension build >/dev/null 2>&1 \
  || fail "extension build failed — rerun without redirect to see output"
ok "extension dist rebuilt"

# ---------- 4. HTTPS_PROXY check (soft) ----------
step "HTTPS_PROXY check"
if [ -n "${HTTPS_PROXY:-}" ] || [ -n "${https_proxy:-}" ]; then
  ok "HTTPS_PROXY set (orchestrator will reach Anthropic through it)"
else
  info "HTTPS_PROXY not set — if you're in a region where api.anthropic.com"
  info "is blocked, the planner will fail with 403 'Request not allowed'."
  info "Export a proxy before running if needed: export HTTPS_PROXY=http://127.0.0.1:7890"
fi

# ---------- 5. daemons ----------
step "MariaDB + Redis"
for probe in "mariadb:$MARIADB_PORT" "redis:$REDIS_PORT"; do
  name="${probe%%:*}"; port="${probe##*:}"
  if port_in_use "$port"; then
    ok "$name on :$port"
    continue
  fi
  # Try to auto-start when running in a Linux sandbox with the daemons
  # installed (apt / docker). Founder's macOS should have these running
  # via brew-services; we don't try to manage those.
  if [ "$(uname)" = "Linux" ] && [ "$name" = "mariadb" ] && command -v mariadbd >/dev/null; then
    info "auto-starting mariadbd (Linux sandbox path)"
    mariadbd --user=mysql --datadir=/var/lib/mysql \
      --socket=/tmp/mariadb.sock --pid-file=/tmp/mariadb.pid \
      --port=$MARIADB_PORT --bind-address=127.0.0.1 \
      > /tmp/mariadb.log 2>&1 &
    sleep 2
    port_in_use "$port" && ok "$name auto-started on :$port" || fail "mariadbd failed to bind :$port"
  elif [ "$(uname)" = "Linux" ] && [ "$name" = "redis" ] && command -v redis-server >/dev/null; then
    info "auto-starting redis-server (Linux sandbox path)"
    redis-server --bind 127.0.0.1 --port $REDIS_PORT --daemonize no \
      > /tmp/redis.log 2>&1 &
    sleep 1
    port_in_use "$port" && ok "$name auto-started on :$port" || fail "redis-server failed to bind :$port"
  else
    fail "$name not running on :$port. On macOS: brew services start $name. On Linux: install + start the daemon."
  fi
done

# ---------- 6. sync-skills ----------
step "pnpm sync-skills"
pnpm --filter @holaday/orchestrator sync-skills >/tmp/holaday-sync-skills.log 2>&1 \
  || { cat /tmp/holaday-sync-skills.log >&2; fail "sync-skills failed — see output above"; }
tail -1 /tmp/holaday-sync-skills.log
ok "skills manifest synced to DB"

# ---------- 7. orchestrator ----------
# `HOLADAY_SKIP_ORCHESTRATOR=1` keeps everything up to this point
# (daemons + sync-skills) and then exits. The integration suite needs
# MariaDB/Redis running but spins up its own orchestrator internally,
# so `test-all.sh` calls start.sh with this flag before the integration
# block to avoid the :3002 port clash.
if [ "${HOLADAY_SKIP_ORCHESTRATOR:-0}" = "1" ]; then
  step "orchestrator (skipped via HOLADAY_SKIP_ORCHESTRATOR=1)"
  ok "daemons ready; skipping orchestrator start"
  exit 0
fi

step "orchestrator (port $HTTP_PORT)"
if port_in_use "$HTTP_PORT"; then
  existing_pid="$(lsof -ti "tcp:$HTTP_PORT" 2>/dev/null || true)"
  info "orchestrator already running on :$HTTP_PORT (pid $existing_pid); leaving it alone"
else
  info "starting orchestrator in background"
  # Use setsid (or just `&`) to fully detach; nohup guards against the
  # parent terminal hanging up. Log goes to $ORCH_LOG_FILE; PID to
  # $ORCH_PID_FILE so downstream scripts / shutdowns can find it.
  : > "$ORCH_LOG_FILE"
  nohup pnpm --filter @holaday/orchestrator dev >> "$ORCH_LOG_FILE" 2>&1 &
  echo $! > "$ORCH_PID_FILE"
  # Wait up to 15s for the server to bind. Fail fast if it doesn't.
  for _ in $(seq 1 30); do
    sleep 0.5
    port_in_use "$HTTP_PORT" && break
  done
  if ! port_in_use "$HTTP_PORT"; then
    fail "orchestrator didn't bind :$HTTP_PORT within 15s — tail -50 $ORCH_LOG_FILE"
  fi
  ok "orchestrator up (pid $(cat "$ORCH_PID_FILE")); logs: $ORCH_LOG_FILE"
fi
port_in_use "$WS_PORT" && ok "WS listening on :$WS_PORT" || info "WS port $WS_PORT not up yet — give it a second"

# ---------- done ----------
step "ready"
cat <<EOF
${GREEN}✔ stack up${NC}

  HTTP     http://127.0.0.1:$HTTP_PORT
  WS       ws://127.0.0.1:$WS_PORT
  log      $ORCH_LOG_FILE
  stop     kill \$(cat $ORCH_PID_FILE)
EOF
