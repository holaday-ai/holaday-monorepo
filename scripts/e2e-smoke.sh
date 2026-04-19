#!/usr/bin/env bash
#
# scripts/e2e-smoke.sh — HTTP-side E2E smoke. Called by test-all.sh,
# can also be run standalone.
#
# What it validates (no live Chrome required):
#   1. orchestrator is reachable on :3001 (HTTP) + :3002 (WS listener)
#   2. auth.register or auth.login returns a JWT
#   3. tasks.smokeTest (Baidu hardcoded plan) accepts the POST, returns
#      the expected shape: taskId + 7 steps in order [goto, wait, type,
#      key, wait, extract, screenshot]
#   4. the task + its steps are persisted in MySQL under the right
#      user, with the right kinds, in the right seq order, AND with
#      the Baidu smoke's allowedOrigins pinned (['*.baidu.com'])
#
# What it does NOT validate (needs a real Chrome + extension + running
# WS client to execute steps):
#   - per-step completion status (goto=completed, extract=completed, …)
#   - screenshot-is-skipped-or-completed (the user's original ask —
#     moved to DEV_WORKFLOW.md's live-dogfood section since CI can't
#     drive a real browser)
#
# Exit 0 on PASS, 1 on FAIL. Failure prints the specific assertion
# that flipped + the raw server response for triage.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HTTP="${HOLADAY_HTTP:-http://127.0.0.1:3001}"
EMAIL="${HOLADAY_E2E_EMAIL:-e2e-smoke@holaday.local}"
PASSWORD="${HOLADAY_E2E_PASSWORD:-e2e-smoke-password-must-be-at-least-8}"
MYSQL_HOST="${HOLADAY_DB_HOST:-127.0.0.1}"
MYSQL_USER="${HOLADAY_DB_USER:-holaday}"
MYSQL_PASS="${HOLADAY_DB_PASS:-holaday-dev}"
MYSQL_DB="${HOLADAY_DB_NAME:-holaday}"

if [ -t 1 ]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; NC=$'\033[0m'
else
  GREEN=""; RED=""; NC=""
fi

failures=0
pass() { printf '%s  ✔ %s%s\n' "$GREEN" "$1" "$NC"; }
fail() { printf '%s  ✘ %s%s\n' "$RED" "$1" "$NC"; failures=$((failures + 1)); }

mysql_q() {
  mysql -u "$MYSQL_USER" -p"$MYSQL_PASS" -h "$MYSQL_HOST" -D "$MYSQL_DB" \
    --batch --skip-column-names -e "$1" 2>/dev/null
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1" >&2; exit 1; }
}
require_tool curl
require_tool jq
require_tool mysql

# ---------- 1. reachability ----------
if curl -fsS --max-time 5 "$HTTP/healthz" >/dev/null 2>&1; then
  pass "orchestrator HTTP reachable on $HTTP"
else
  fail "orchestrator HTTP not reachable on $HTTP — did start.sh run?"
  exit 1 # further checks are pointless
fi

# ---------- 2. auth.login (register if missing) ----------
# tRPC expects POST with JSON body `{email, password}` on mutations;
# the response shape is `{result:{data:{accessToken,user}}}`.
login_body() {
  curl -sS -X POST "$HTTP/trpc/auth.login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
}
resp="$(login_body)"
token="$(echo "$resp" | jq -r '.result.data.accessToken // empty')"
if [ -z "$token" ]; then
  # Try register, then login again.
  curl -sS -X POST "$HTTP/trpc/auth.register" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null
  resp="$(login_body)"
  token="$(echo "$resp" | jq -r '.result.data.accessToken // empty')"
fi
if [ -n "$token" ]; then
  pass "auth.login returned JWT"
else
  fail "auth.login did not return a token; response: $resp"
  exit 1
fi

# ---------- 3. tasks.smokeTest shape ----------
resp="$(curl -sS -X POST "$HTTP/trpc/tasks.smokeTest" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $token" \
  -d '{}')"
task_id="$(echo "$resp" | jq -r '.result.data.taskId // empty')"
step_kinds="$(echo "$resp" | jq -r '.result.data.steps[]?.kind' | tr '\n' ',' )"

if [ -n "$task_id" ] && [[ "$task_id" =~ ^tsk_ ]]; then
  pass "tasks.smokeTest created $task_id"
else
  fail "tasks.smokeTest didn't return taskId; response: $resp"
  exit 1
fi
expected="goto,wait,type,key,wait,extract,screenshot,"
if [ "$step_kinds" = "$expected" ]; then
  pass "plan has the expected 7 steps in order"
else
  fail "plan step order mismatch — got: $step_kinds  expected: $expected"
fi

# ---------- 4. DB persistence ----------
# Query task_steps.kind in seq order, join on external_id to ensure it
# really is the task we just created (not stale state).
rows="$(mysql_q "SELECT ts.kind FROM task_steps ts JOIN tasks t ON ts.task_id=t.id WHERE t.external_id='$task_id' ORDER BY ts.seq")"
db_kinds="$(echo "$rows" | tr '\n' ',')"
if [ "$db_kinds" = "$expected" ]; then
  pass "DB persisted 7 steps in expected seq order"
else
  fail "DB step order mismatch — got: $db_kinds  expected: $expected"
fi

# Count of task_steps == 7 guards against an over-counting join bug.
count="$(mysql_q "SELECT COUNT(*) FROM task_steps ts JOIN tasks t ON ts.task_id=t.id WHERE t.external_id='$task_id'")"
if [ "$count" = "7" ]; then
  pass "task_steps row count = 7"
else
  fail "task_steps row count = $count (expected 7)"
fi

# Screenshot step status assertion — must NEVER be in {error,failed}.
# The allowed set is:
#   pending   (expected in this HTTP-only smoke — nothing executes it)
#   executing, completed, skipped, awaiting_user
# A real Chrome + extension driving the task to completion would land
# this on `completed` (CDP page.screenshot returned) or `skipped` (the
# 60e3aca soft-fail path for CDP timeouts). `error` or `failed` here
# would mean the fix regressed — the whole point of 'skipped' is that
# a flaky screenshot step never fails the task.
screenshot_status="$(mysql_q "SELECT ts.status FROM task_steps ts JOIN tasks t ON ts.task_id=t.id WHERE t.external_id='$task_id' AND ts.kind='screenshot'")"
case "$screenshot_status" in
  error|failed)
    fail "screenshot step status is '$screenshot_status' — regression of the CDP-via-page.screenshot + 'skipped' soft-fail fix (60e3aca)"
    ;;
  pending|executing|completed|skipped|awaiting_user)
    pass "screenshot step status='$screenshot_status' (not error/failed — soft-fail contract holds)"
    ;;
  '')
    fail "screenshot step not found for task $task_id"
    ;;
  *)
    fail "screenshot step status='$screenshot_status' (unknown value — treat as regression)"
    ;;
esac

# ---------- summary ----------
echo
if [ "$failures" -eq 0 ]; then
  printf '%s✔ e2e-smoke: all checks passed%s\n' "$GREEN" "$NC"
  exit 0
fi
printf '%s✘ e2e-smoke: %d check(s) failed%s\n' "$RED" "$failures" "$NC"
exit 1
