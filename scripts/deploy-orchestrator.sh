#!/bin/bash
# Orchestrator deploy with healthz smoke check.
#
# Standard Vultr cycle (pre-approved per memory): fetch → reset →
# install → build → restart → smoke check. Fails loudly if /healthz
# doesn't respond with status=ok within 5s of restart so a busted
# build doesn't silently leave clients hanging.
#
# Usage:   ./scripts/deploy-orchestrator.sh [BRANCH]
#          BRANCH defaults to claude/musing-keller-ae1d05
# Env:     VULTR_PASSWORD (password auth)
# Exits:   0 on success, 1 on health-check failure (no auto-rollback;
#          PM2 keeps last-good binary running unless build broke,
#          in which case re-run after fixing).

set -euo pipefail

# Optional local credentials. The file is ignored by git when using
# .env.deploy.local, so deploys no longer need passwords pasted in chat.
DEPLOY_ENV_LOADER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/load-deploy-env.sh"
if [[ -f "$DEPLOY_ENV_LOADER" ]]; then
  # shellcheck source=scripts/load-deploy-env.sh
  source "$DEPLOY_ENV_LOADER"
fi
unset DEPLOY_ENV_LOADER

# shellcheck source=scripts/ssh-password-auth.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ssh-password-auth.sh"

VULTR_HOST="root@207.148.70.106"
BRANCH="${1:-claude/musing-keller-ae1d05}"
HEALTH_URL="http://localhost:4001/healthz"
HEALTH_MARKER='"status":"ok"'

build_ssh_password_prefix "${VULTR_PASSWORD:-}"
VULTR_AUTH_PREFIX=("${SSH_PASSWORD_PREFIX[@]}")
SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o ConnectTimeout=20
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=3
  -o TCPKeepAlive=yes
)
REMOTE_RETRIES="${DEPLOY_REMOTE_RETRIES:-3}"
REMOTE_RETRY_SLEEP="${DEPLOY_REMOTE_RETRY_SLEEP:-5}"

if ! [[ "$REMOTE_RETRIES" =~ ^[1-9][0-9]*$ ]]; then
  echo "❌ DEPLOY_REMOTE_RETRIES must be a positive integer" >&2
  exit 1
fi
if ! [[ "$REMOTE_RETRY_SLEEP" =~ ^[0-9]+$ ]]; then
  echo "❌ DEPLOY_REMOTE_RETRY_SLEEP must be a non-negative integer" >&2
  exit 1
fi

run_with_retry() {
  local label="$1"
  shift
  local attempt rc

  for ((attempt = 1; attempt <= REMOTE_RETRIES; attempt++)); do
    set +e
    "$@"
    rc=$?
    set -e
    if ((rc == 0)); then
      return 0
    fi
    if ((attempt == REMOTE_RETRIES)); then
      echo "❌ $label failed after $attempt attempt(s) (exit $rc)" >&2
      return "$rc"
    fi
    echo "⚠️  $label failed (exit $rc); retrying in ${REMOTE_RETRY_SLEEP}s ($attempt/$REMOTE_RETRIES)" >&2
    sleep "$REMOTE_RETRY_SLEEP"
  done
}

# Roll the live deploy back to a known-good commit + rebuild + restart
# with the env reloaded. Called when a post-deploy verification fails so
# we never silently leave a broken / keyless binary serving traffic.
rollback() {
  local target="$1"
  if [[ -z "$target" ]]; then
    echo "⚠️  No rollback target captured — manual intervention needed" >&2
    return
  fi
  echo "→ Rolling back to $target" >&2
  run_with_retry "Vultr rollback" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
    cd /opt/holaday-monorepo && \
    git reset --hard $target && \
    pnpm --filter @holaday/orchestrator build && \
    set -a && . apps/orchestrator/.env && set +a && \
    pm2 restart holaday-orchestrator --update-env" 2>&1 | tail -5 >&2 || true
}

echo "→ Capturing current HEAD for rollback"
PREV_HEAD=$(run_with_retry "Vultr prev-head" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "cd /opt/holaday-monorepo && git rev-parse HEAD" | tail -1 | tr -d '[:space:]')
echo "   prev HEAD: ${PREV_HEAD:-unknown}"

echo "→ Fetching $BRANCH on Vultr"
run_with_retry "Vultr fetch" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
  cd /opt/holaday-monorepo && \
  git fetch origin '+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH' && \
  git reset --hard origin/$BRANCH && \
  git rev-parse HEAD" | tail -5

echo "→ Installing + building"
run_with_retry "Vultr install/build" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
  cd /opt/holaday-monorepo && \
  pnpm install && \
  pnpm --filter @holaday/orchestrator build" 2>&1 | tail -5

echo "→ pm2 restart (--update-env so new .env keys load into the process)"
run_with_retry "Vultr pm2 restart" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "cd /opt/holaday-monorepo && set -a && . apps/orchestrator/.env && set +a && pm2 restart holaday-orchestrator --update-env"

echo "→ Health check ($HEALTH_URL must return '$HEALTH_MARKER')"
sleep 3
HEALTH_OUT=$(run_with_retry "Vultr healthz" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "curl -sf --max-time 10 $HEALTH_URL || echo 'FAIL'")
if echo "$HEALTH_OUT" | grep -q "$HEALTH_MARKER"; then
  echo "✅ Health check passed"
else
  echo "❌ Health check FAILED"
  echo "Response: $HEALTH_OUT" >&2
  echo "→ Last 10 error log lines:"
  run_with_retry "Vultr pm2 error logs" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "pm2 logs holaday-orchestrator --lines 10 --nostream --err 2>&1 | tail -15" >&2
  rollback "$PREV_HEAD"
  echo "❌ Deploy FAILED (health check) — rolled back to ${PREV_HEAD:-unknown}" >&2
  exit 1
fi

RESTART=$(run_with_retry "Vultr restart count" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "node -e \"const list=JSON.parse(require('child_process').execFileSync('pm2',['jlist'],{encoding:'utf8'})); const app=list.find((p)=>p.name==='holaday-orchestrator'); process.stdout.write(String(app?.pm2_env?.restart_time ?? 'unknown'));\"")
echo "✅ Orchestrator deployed — restart count: $RESTART"

# Verify the required LLM keys actually made it INTO the running process
# (not just the .env file). A plain `pm2 restart` reuses pm2's cached env
# and silently drops a newly-added key — hence the --update-env above +
# this guard. We only print key NAMES that have a non-empty value (never
# the secret). Failure rolls back rather than leaving the image lane
# keyless (image intents would silently degrade to generate).
REQUIRED_PROCESS_KEYS="${DEPLOY_REQUIRED_PROCESS_KEYS:-GEMINI_API_KEY ANTHROPIC_API_KEY}"
echo "→ Verifying keys loaded in process: $REQUIRED_PROCESS_KEYS"
PROC_KEYS=$(run_with_retry "Vultr key-check" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "PID=\$(pm2 pid holaday-orchestrator | head -1); tr '\\0' '\\n' < /proc/\$PID/environ 2>/dev/null | grep -oE '^[A-Z_]+=.' | grep -oE '^[A-Z_]+'" | tr -d '\r')
KEY_MISS=""
for k in $REQUIRED_PROCESS_KEYS; do
  echo "$PROC_KEYS" | grep -qx "$k" || KEY_MISS="$KEY_MISS $k"
done
if [[ -n "$KEY_MISS" ]]; then
  echo "❌ Required keys missing/empty in process:$KEY_MISS" >&2
  rollback "$PREV_HEAD"
  echo "❌ Deploy FAILED (keys not loaded into process) — rolled back to ${PREV_HEAD:-unknown}" >&2
  exit 1
fi
echo "✅ Keys present in process"

# Phase 1 follow-up — auto-run P0 smoke after every deploy. Failure
# does NOT block the deploy (smoke runs against a live orchestrator
# and depends on Anthropic API health which fluctuates). The result
# is logged + the JSON / markdown report is left on disk for
# follow-up triage. Skip with SKIP_AUTO_SMOKE=1 (e.g. urgent hotfix
# where you don't want to wait the ~3min for a full P0 cycle).
if [[ "${SKIP_AUTO_SMOKE:-0}" == "1" ]]; then
  echo "→ Auto-smoke skipped (SKIP_AUTO_SMOKE=1)"
else
  echo "→ Running P0 smoke (informational; failure does NOT block deploy)"
  SMOKE_OUT=$(run_with_retry "Vultr auto-smoke" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "cd /opt/holaday-monorepo && \
     set -a && . apps/orchestrator/.env && set +a && \
     EVAL_BASE_URL=http://127.0.0.1:4001 \
     pnpm --filter @holaday/orchestrator eval:smoke 2>&1 | tail -25" \
    || true)
  echo "$SMOKE_OUT"
  if echo "$SMOKE_OUT" | grep -qE '\[eval\] [0-9]+/[0-9]+ passed'; then
    if echo "$SMOKE_OUT" | grep -qE '\[eval\] 10/10 passed'; then
      echo "✅ Auto-smoke 10/10 — pipeline healthy"
    else
      echo "⚠️  Auto-smoke had failures (see output above) — deploy NOT rolled back"
      echo "   Likely flaky LLM (Anthropic overloaded) or a real regression — investigate."
    fi
  else
    echo "⚠️  Auto-smoke did not produce a parseable summary line — eval runner may have errored"
  fi
fi
