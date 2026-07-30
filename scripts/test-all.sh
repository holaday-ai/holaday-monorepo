#!/usr/bin/env bash
#
# scripts/test-all.sh — release gate that must pass before pushing.
#
# Runs, in order:
#
#   1. Typechecks (shared-types / browser-driver / orchestrator /
#      web-workbench / cn-payment / extension)
#   2. Unit tests
#        browser-driver / skill-sdk / orchestrator / web-workbench /
#        cn-payment
#   3. Integration tests
#        orchestrator (real MariaDB + Redis + real Express+tRPC+WS)
#   4. Database schema verification
#   5. Production builds (orchestrator / web-workbench / extension)
#   6. Web lint + deploy/ops tests + git diff whitespace check
#   7. E2E smoke (HTTP-side only, no live Chrome required)
#        - boots orchestrator via scripts/start.sh if not up
#        - curl registers + logs in a test user
#        - curl POSTs /trpc/tasks.smokeTest (Baidu hardcoded plan —
#          deterministic, doesn't need a logged-in Douyin session)
#        - verifies the HTTP response shape + that a task row exists
#          in DB with the expected 7 steps
#        - does NOT wait for steps to finish executing (that needs a
#          real Chrome running the extension; covered by the live
#          Douyin dogfood path in DEV_WORKFLOW.md)
#
# Exit codes:
#   0  — every check passed
#   1  — at least one check failed; summary block at the bottom names
#        every failing suite
#
# Env toggles:
#   HOLADAY_SKIP_E2E=1       skip the HTTP-side E2E check (everything
#                            else still runs). Default: 0.
#   HOLADAY_SKIP_INTEGRATION=1  skip the orchestrator integration suite
#                            (needs MariaDB + Redis). Default: 0.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -t 1 ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; NC=$'\033[0m'
else
  BOLD=""; GREEN=""; RED=""; YELLOW=""; NC=""
fi

# A check is a pair (label, command). We run each, capture output to a
# tmpfile, note pass/fail, and print a summary at the end. This avoids
# bailing out on the first failure (set -e disabled above) — Claude
# Code reads the full summary to decide what to fix.
RESULTS_FILE="$(mktemp)"
declare -a FAILED_LABELS=()
declare -a FAILED_LOGS=()

run_check() {
  local label="$1"; shift
  local logfile; logfile="$(mktemp)"
  printf '\n%s▶ %s%s\n' "$BOLD" "$label" "$NC"
  if "$@" >"$logfile" 2>&1; then
    # Extract a short result line when it's a vitest run; otherwise tail.
    local summary
    summary="$(grep -E 'Test Files|Tests ' "$logfile" | tail -3 || true)"
    if [ -n "$summary" ]; then
      echo "$summary"
    fi
    printf '%s✔ %s%s\n' "$GREEN" "$label" "$NC"
    echo "PASS|$label" >> "$RESULTS_FILE"
    rm -f "$logfile"
  else
    printf '%s✘ %s%s — see output below\n' "$RED" "$label" "$NC"
    tail -40 "$logfile"
    echo "FAIL|$label|$logfile" >> "$RESULTS_FILE"
    FAILED_LABELS+=("$label")
    FAILED_LOGS+=("$logfile")
  fi
}

# ---------- typechecks ----------
run_check 'typecheck @holaday/shared-types'   pnpm --filter @holaday/shared-types  typecheck
run_check 'typecheck @holaday/browser-driver' pnpm --filter @holaday/browser-driver typecheck
run_check 'typecheck @holaday/orchestrator'   pnpm --filter @holaday/orchestrator   typecheck
run_check 'typecheck @holaday/web-workbench'  pnpm --filter @holaday/web-workbench typecheck
run_check 'typecheck @holaday/cn-payment'      pnpm --filter @holaday/cn-payment    typecheck
run_check 'typecheck @holaday/extension'      pnpm --filter @holaday/extension      typecheck

# ---------- unit tests ----------
run_check 'unit @holaday/browser-driver'      pnpm --filter @holaday/browser-driver test
run_check 'unit @holaday/skill-sdk'           pnpm --filter @holaday/skill-sdk      test
run_check 'unit @holaday/orchestrator'        pnpm --filter @holaday/orchestrator   test
run_check 'unit @holaday/web-workbench'       pnpm --filter @holaday/web-workbench  test
run_check 'unit @holaday/cn-payment'           pnpm --filter @holaday/cn-payment     test

# ---------- integration tests ----------
# Integration tests spin up their OWN WS server on :3002 and an
# Express/tRPC app on a transient port. They need MariaDB + Redis up
# but MUST NOT share port 3002 with a live orchestrator. We call
# start.sh with HOLADAY_SKIP_ORCHESTRATOR=1 so daemons get started
# (and sync-skills runs) without binding 3002.
if [ "${HOLADAY_SKIP_INTEGRATION:-0}" = "1" ]; then
  printf '\n%s▶ integration (SKIPPED via HOLADAY_SKIP_INTEGRATION=1)%s\n' "$YELLOW" "$NC"
else
  # Clear :3001 + :3002 before integration tests. The integration
  # suite spins up its own Express+WS servers on those ports, so a
  # previous test-all.sh run's backgrounded orchestrator (still
  # holding 3002) would cause EADDRINUSE. Kill is idempotent:
  # nothing to kill = no-op.
  printf '\n%s▶ pre-integration: clear :3001 + :3002%s\n' "$BOLD" "$NC"
  if [ -f /tmp/holaday-orchestrator.pid ]; then
    kill "$(cat /tmp/holaday-orchestrator.pid)" 2>/dev/null || true
    rm -f /tmp/holaday-orchestrator.pid
  fi
  for port in 3001 3002; do
    pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  sleep 1
  printf '%s✔ ports cleared%s\n' "$GREEN" "$NC"

  run_check 'integration setup (daemons only)' \
    env HOLADAY_SKIP_ORCHESTRATOR=1 HOLADAY_SKIP_PULL=1 HOLADAY_SKIP_INSTALL=1 HOLADAY_SKIP_EXT_BUILD=1 bash "$SCRIPT_DIR/start.sh"
  run_check 'integration @holaday/orchestrator' \
    env DATABASE_URL='mysql://holaday:holaday-dev@127.0.0.1:3306/holaday' \
        REDIS_URL='redis://127.0.0.1:6379/0' \
        JWT_SECRET='integration-test-secret-must-be-32-chars-or-more-please' \
    pnpm --filter @holaday/orchestrator test:integration
fi

# ---------- database contract ----------
run_check 'database schema verify' pnpm --filter @holaday/orchestrator db:verify

# ---------- production builds ----------
run_check 'orchestrator build' pnpm --filter @holaday/orchestrator build
run_check 'web-workbench build' pnpm --filter @holaday/web-workbench build
run_check 'extension build (vite)' pnpm --filter @holaday/extension build

# ---------- repository quality ----------
# The root Biome command intentionally scans every directory, including local
# worktrees and protected draft folders. Keep the release gate focused on the
# production web sources; typecheck/test/build cover the remaining packages.
run_check 'lint @holaday/web-workbench' pnpm --filter @holaday/web-workbench lint
run_check 'deploy/ops tests' pnpm test:ops
run_check 'git diff whitespace check' git diff --check

# ---------- E2E smoke (HTTP-side only) ----------
# Now bring the live orchestrator up (integration tests are done and
# have released :3002), then run the HTTP-side smoke against it.
if [ "${HOLADAY_SKIP_E2E:-0}" = "1" ]; then
  printf '\n%s▶ e2e-http-smoke (SKIPPED via HOLADAY_SKIP_E2E=1)%s\n' "$YELLOW" "$NC"
else
  run_check 'e2e setup (orchestrator up)' \
    env HOLADAY_SKIP_PULL=1 HOLADAY_SKIP_INSTALL=1 HOLADAY_SKIP_EXT_BUILD=1 bash "$SCRIPT_DIR/start.sh"
  run_check 'e2e HTTP smoke (curl + DB)' bash "$SCRIPT_DIR/e2e-smoke.sh"
fi

# ---------- summary ----------
echo
printf '%s════════════════════════════════════════════════════════════%s\n' "$BOLD" "$NC"
printf '%sSummary%s\n' "$BOLD" "$NC"
printf '%s════════════════════════════════════════════════════════════%s\n' "$BOLD" "$NC"
awk -F'|' '
  $1=="PASS" { p++; printf "  ✔ %s\n", $2 }
  $1=="FAIL" { f++; printf "  ✘ %s (log: %s)\n", $2, $3 }
  END {
    printf "\n  %d passed, %d failed\n", p+0, f+0
    if (f > 0) exit 1
  }
' "$RESULTS_FILE"
summary_exit=$?

# Cleanup: results file always, but keep FAILED_LOGS on disk so the
# operator can `cat /tmp/tmp.XXXX` to read what broke. We print those
# paths inside the summary already.
rm -f "$RESULTS_FILE"

if [ "$summary_exit" -ne 0 ]; then
  printf '\n%s✘ test-all.sh: some checks failed; fix before push.%s\n' "$RED" "$NC" >&2
  printf '%sFail logs kept at the /tmp paths above for inspection.%s\n' "$RED" "$NC" >&2
  exit 1
fi
# All green: clean up any residual temp logs (there shouldn't be any).
for log in "${FAILED_LOGS[@]:-}"; do
  [ -n "$log" ] && rm -f "$log"
done
printf '\n%s✔ test-all.sh: every check passed. Safe to push.%s\n' "$GREEN" "$NC"
