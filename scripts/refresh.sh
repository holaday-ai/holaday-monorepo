#!/usr/bin/env bash
#
# scripts/refresh.sh — one-shot "pull + rebuild + restart orchestrator"
# for the founder's Mac dogfood loop. Run this from the repo root:
#
#     ./scripts/refresh.sh
#
# Then flip chrome://extensions → HOLA DAY → Reload (Chrome has no CLI
# hook to reload an unpacked extension, so that step stays manual).
#
# What it does:
#   1. git pull --rebase (fails loud if working tree is dirty)
#   2. pnpm --filter @holaday/extension build
#   3. if something is listening on HTTP_PORT (default 3001) — the
#      orchestrator — kill it so you can restart with the new code;
#      otherwise skip. Does NOT auto-start the orchestrator — that's a
#      foreground process you want to see logs from. Restart it
#      yourself (`pnpm --filter @holaday/orchestrator dev`) after this
#      script exits.
#
# Error handling: any failed step aborts the run with a loud message.
# Nothing is rolled back — partial state (e.g. a successful pull but
# failed build) is fine to inspect and retry from.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Colours. Gated on TTY so log-scraping in CI stays clean.
if [ -t 1 ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; NC=$'\033[0m'
else
  BOLD=""; GREEN=""; RED=""; YELLOW=""; NC=""
fi

step()   { printf '\n%s▶ %s%s\n' "$BOLD" "$1" "$NC"; }
ok()     { printf '%s✔ %s%s\n' "$GREEN" "$1" "$NC"; }
fail()   { printf '%s✘ %s%s\n' "$RED"   "$1" "$NC" >&2; exit 1; }
info()   { printf '%sℹ %s%s\n' "$YELLOW" "$1" "$NC"; }

HTTP_PORT="${HOLADAY_HTTP_PORT:-3001}"

# ---------- 1. git pull --rebase ----------
step "git pull --rebase"
if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "working tree has uncommitted changes — stash or commit before refresh"
fi
git pull --rebase || fail "git pull --rebase failed (conflict? network?) — resolve and rerun"
ok "pulled $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

# ---------- 2. rebuild the extension ----------
step "pnpm --filter @holaday/extension build"
pnpm --filter @holaday/extension build || fail "extension build failed — see output above"
ok "extension dist rebuilt"

# ---------- 3. restart orchestrator if it's up ----------
step "orchestrator restart check (port $HTTP_PORT)"
# `lsof -ti` prints the PIDs holding the port, one per line. Portable
# across macOS + Linux. `|| true` so an empty result isn't a pipefail.
pids="$(lsof -ti "tcp:$HTTP_PORT" 2>/dev/null || true)"
if [ -n "$pids" ]; then
  info "port $HTTP_PORT is in use by pid(s): $pids — sending SIGTERM"
  # SIGTERM first so pino flushes + SIGINT shutdown hooks fire; if the
  # process ignores it for 3s we escalate to SIGKILL.
  kill $pids 2>/dev/null || true
  for _ in 1 2 3; do
    sleep 1
    still="$(lsof -ti "tcp:$HTTP_PORT" 2>/dev/null || true)"
    [ -z "$still" ] && break
  done
  still="$(lsof -ti "tcp:$HTTP_PORT" 2>/dev/null || true)"
  if [ -n "$still" ]; then
    info "still alive after 3s, SIGKILL"
    kill -9 $still 2>/dev/null || true
  fi
  ok "old orchestrator killed; start a fresh one yourself with:"
  echo "    pnpm --filter @holaday/orchestrator dev"
else
  info "no process on port $HTTP_PORT — orchestrator wasn't running; start it when you're ready:"
  echo "    pnpm --filter @holaday/orchestrator dev"
fi

# ---------- 4. final hand-off ----------
step "done"
cat <<EOF
${GREEN}✔ refresh complete${NC}

Next steps (manual):
  1. ${BOLD}chrome://extensions${NC} → HOLA DAY → ${BOLD}Reload${NC} (reload button on the card)
  2. start orchestrator if needed: ${BOLD}pnpm --filter @holaday/orchestrator dev${NC}
  3. open the extension popup → Sign in (if logged out) → Smoke Test or Run
EOF
