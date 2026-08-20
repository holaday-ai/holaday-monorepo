#!/bin/bash
# Orchestrator deploy with a pre-reset safety gate + healthz smoke check.
#
# Standard Vultr cycle: preflight-gate → fetch → reset → install → build →
# restart → smoke. Fails loudly if /healthz doesn't return status=ok after
# restart so a busted build doesn't silently leave clients hanging.
#
# 协作铁律 / SESSION_STATUS hard rule 7 (2026-06-13, born from a real
# incident): NEVER assume the prod branch from memory / SESSION_STATUS. This
# script runs scripts/deploy-preflight.sh ON the server BEFORE any reset —
# it reads the LIVE HEAD, prints which origin branch(es) contain it, and
# REFUSES if the live HEAD is NOT an ancestor of origin/$BRANCH (a reset
# would discard commits currently live). Override an intentional cutover /
# rollback with ALLOW_DIVERGENT_DEPLOY=1. After a green deploy it prints the
# authoritative `PROD LIVE REF = <branch>@<hash>` line for SESSION_STATUS.
#
# Usage:   ./scripts/deploy-orchestrator.sh [BRANCH]
#          BRANCH defaults to claude/musing-keller-ae1d05
# Env:     VULTR_PASSWORD             password auth
#          ALLOW_DIVERGENT_DEPLOY=1   proceed despite a non-fast-forward
#                                     (divergent) target — required for an
#                                     intentional branch cutover / rollback.
# Exits:   0 success; 1 deploy failed and rollback completed;
#          2 automatic rollback failed; 3 divergent-target gate tripped;
#          4 could-not-verify-live-state.

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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/auto-smoke-summary.sh
source "$SCRIPT_DIR/auto-smoke-summary.sh"
RUNTIME_HELPER="$SCRIPT_DIR/orchestrator-runtime.sh"
START_HELPER="$SCRIPT_DIR/start-orchestrator-production.sh"
REMOTE_RUNTIME_DIR="/var/lib/holaday-deploy"
REMOTE_RUNTIME_HELPER="$REMOTE_RUNTIME_DIR/orchestrator-runtime.sh"
REMOTE_START_HELPER="$REMOTE_RUNTIME_DIR/start-orchestrator-production.sh"
ORCHESTRATOR_RUN_USER="${ORCHESTRATOR_RUN_USER:-holaday}"
ORCHESTRATOR_RUN_GROUP="${ORCHESTRATOR_RUN_GROUP:-$ORCHESTRATOR_RUN_USER}"

if [[ -z "${VULTR_PASSWORD:-}" ]]; then
  echo "❌ VULTR_PASSWORD unset — refusing orchestrator deploy" >&2
  exit 1
fi
if [[ ! -f "$RUNTIME_HELPER" ]]; then
  echo "❌ Runtime helper missing: $RUNTIME_HELPER" >&2
  exit 1
fi
if [[ ! -f "$START_HELPER" ]]; then
  echo "❌ Production start helper missing: $START_HELPER" >&2
  exit 1
fi
if ! [[ "$ORCHESTRATOR_RUN_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "❌ ORCHESTRATOR_RUN_USER is invalid" >&2
  exit 1
fi
if ! [[ "$ORCHESTRATOR_RUN_GROUP" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "❌ ORCHESTRATOR_RUN_GROUP is invalid" >&2
  exit 1
fi
build_ssh_password_prefix "$VULTR_PASSWORD"
VULTR_AUTH_PREFIX=("${SSH_PASSWORD_PREFIX[@]}")
SSH_OPTS=(
  -o StrictHostKeyChecking=yes
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
    if "$@"; then
      return 0
    else
      rc=$?
    fi
    if ((attempt == REMOTE_RETRIES)); then
      echo "❌ $label failed after $attempt attempt(s) (exit $rc)" >&2
      return "$rc"
    fi
    echo "⚠️  $label failed (exit $rc); retrying in ${REMOTE_RETRY_SLEEP}s ($attempt/$REMOTE_RETRIES)" >&2
    sleep "$REMOTE_RETRY_SLEEP"
  done
}

if [[ "${CN_PAYMENT_PREFLIGHT_VERIFIED:-0}" != "1" ]]; then
  run_with_retry "CN payment production preflight" \
    "$SCRIPT_DIR/verify-cn-payment-production.sh"
fi
if [[ "${PAYPAL_PREFLIGHT_VERIFIED:-0}" != "1" ]]; then
  run_with_retry "PayPal production preflight" \
    "$SCRIPT_DIR/verify-paypal-production.sh"
fi

stage_runtime_helper() {
  echo "→ Staging non-root runtime helpers"
  run_with_retry "Vultr runtime-helper directory" \
    "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "install -d -o root -g root -m 755 '$REMOTE_RUNTIME_DIR'"
  run_with_retry "Vultr runtime-helper upload" \
    "${VULTR_AUTH_PREFIX[@]}" scp "${SSH_OPTS[@]}" \
    "$RUNTIME_HELPER" "$START_HELPER" "$VULTR_HOST:$REMOTE_RUNTIME_DIR/"
  run_with_retry "Vultr runtime-helper permissions" \
    "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "chown root:root '$REMOTE_RUNTIME_HELPER' '$REMOTE_START_HELPER' && \
     chmod 700 '$REMOTE_RUNTIME_HELPER' && chmod 755 '$REMOTE_START_HELPER'"
}

restart_orchestrator_as_runtime_user() {
  local label="$1"
  run_with_retry "$label" \
    "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
      cd /opt/holaday-monorepo && \
      set -a && . apps/orchestrator/.env && set +a && \
      ORCHESTRATOR_RUN_USER='$ORCHESTRATOR_RUN_USER' \
      ORCHESTRATOR_RUN_GROUP='$ORCHESTRATOR_RUN_GROUP' \
      ORCHESTRATOR_START_SCRIPT='$REMOTE_START_HELPER' \
      '$REMOTE_RUNTIME_HELPER' restart /opt/holaday-monorepo"
}

# Roll the live deploy back to a known-good commit + rebuild + restart
# with the env reloaded. Called when a post-deploy verification fails so
# we never silently leave a broken / keyless binary serving traffic.
rollback() {
  local target="$1"
  local rollback_output rollback_rc

  echo "⚠️  Database changes are forward-only; code rollback does not revert applied migrations." >&2
  if [[ -z "$target" ]]; then
    echo "❌ No rollback target captured — manual recovery is required" >&2
    return 1
  fi
  echo "→ Rolling back to $target" >&2

  set +e
  rollback_output=$(run_with_retry "Vultr rollback build" \
    "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
      cd /opt/holaday-monorepo && \
      git reset --hard '$target' && \
      pnpm --filter @holaday/orchestrator build" 2>&1)
  rollback_rc=$?
  set -e
  echo "$rollback_output" | tail -5 >&2
  if (( rollback_rc != 0 )); then
    echo "❌ Rollback checkout/build failed; manual recovery is required" >&2
    return 1
  fi

  set +e
  rollback_output=$(restart_orchestrator_as_runtime_user "Vultr rollback restart" 2>&1)
  rollback_rc=$?
  set -e
  echo "$rollback_output" | tail -5 >&2
  if (( rollback_rc != 0 )); then
    echo "❌ Rollback restart failed; checkout is restored but manual recovery is required" >&2
    return 1
  fi

  echo "✅ Previous checkout and Orchestrator restored to $target" >&2
}

abort_with_rollback() {
  local reason="$1"

  echo "❌ $reason — rolling back" >&2
  if rollback "$PREV_HEAD"; then
    echo "❌ Deploy FAILED ($reason) — checkout and Orchestrator restored" >&2
    exit 1
  fi

  echo "❌ Deploy FAILED ($reason) — rollback is incomplete; manual recovery is required" >&2
  exit 2
}

stage_runtime_helper

echo "→ Capturing current HEAD for rollback"
PREV_HEAD="${ORCHESTRATOR_ROLLBACK_HEAD:-}"
if [[ -z "$PREV_HEAD" ]]; then
  PREV_HEAD=$(run_with_retry "Vultr prev-head" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "cd /opt/holaday-monorepo && git rev-parse HEAD" | tail -1 | tr -d '[:space:]')
fi
if ! [[ "$PREV_HEAD" =~ ^[0-9a-f]{40}$ ]]; then
  echo "❌ Invalid rollback HEAD — refusing deploy" >&2
  exit 1
fi
run_with_retry "Vultr rollback-head validation" \
  "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "cd /opt/holaday-monorepo && git cat-file -e '$PREV_HEAD^{commit}'"
echo "   prev HEAD (LIVE): ${PREV_HEAD:-unknown}"

# ── Pre-reset safety gate — SESSION_STATUS hard rule 7 (2026-06-13) ──────
# Enforce the rule automatically: run scripts/deploy-preflight.sh (the single
# source of truth) ON the server BEFORE reset. It reads the LIVE HEAD, prints
# which origin branches contain it, and exits 1 if that HEAD is NOT an
# ancestor of origin/$BRANCH (a reset would discard live commits) / 2 if it
# can't fetch the source. The live checkout may predate the preflight script,
# so we run it straight from the freshly-fetched ref (inline fallback if the
# deploy branch doesn't carry it yet). Override with ALLOW_DIVERGENT_DEPLOY=1.
echo "→ Pre-reset gate (hard rule 7): deploy-preflight.sh on the live server"
set +e
run_with_retry "Vultr gate-fetch" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "cd /opt/holaday-monorepo && git fetch origin '+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH' >/dev/null 2>&1"
FETCH_RC=$?
if (( FETCH_RC == 0 )); then
  run_with_retry "Vultr ancestor gate" \
    "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
    cd /opt/holaday-monorepo && \
    if git cat-file -e 'origin/$BRANCH:scripts/deploy-preflight.sh' 2>/dev/null; then \
      git show 'origin/$BRANCH:scripts/deploy-preflight.sh' | bash -s -- '$BRANCH'; \
    else \
      echo '(preflight not on origin/$BRANCH — inline ancestor check)'; \
      echo \"current LIVE HEAD : \$(git rev-parse HEAD)\"; \
      echo '  contained in origin branches:'; \
      git branch -r --contains HEAD 2>/dev/null | sed 's/^/    /' || true; \
      git merge-base --is-ancestor HEAD 'origin/$BRANCH'; \
    fi"
  GATE_RC=$?
else
  GATE_RC=2
fi
set -e
case "$GATE_RC" in
  0) echo "   ✅ preflight passed — forward (fast-forward) deploy, safe to reset" ;;
  1)
    echo "⛔ STOP (hard rule 7): live prod HEAD (${PREV_HEAD:-unknown}) is NOT an ancestor of" >&2
    echo "   origin/$BRANCH — a reset would DISCARD commits currently live (wrong branch /" >&2
    echo "   revert / divergence). The branch(es) prod actually lives on are printed above." >&2
    echo "   Reconcile (merge the live HEAD into your source), or for an INTENTIONAL cutover /" >&2
    echo "   rollback re-run with ALLOW_DIVERGENT_DEPLOY=1." >&2
    if [[ "${ALLOW_DIVERGENT_DEPLOY:-0}" != "1" ]]; then
      exit 3
    fi
    echo "⚠️  ALLOW_DIVERGENT_DEPLOY=1 set — proceeding despite divergence." >&2 ;;
  2)
    echo "⛔ STOP: could not fetch origin/$BRANCH on the server — refusing to reset blind." >&2
    exit 4 ;;
  *)
    echo "⛔ STOP: gate check errored (ssh/git exit $GATE_RC) — refusing to reset blind." >&2
    exit 4 ;;
esac

echo "→ Fetching $BRANCH on Vultr"
if ! run_with_retry "Vultr fetch" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
    cd /opt/holaday-monorepo && \
    git fetch origin '+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH' && \
    git reset --hard origin/$BRANCH && \
    git rev-parse HEAD" | tail -5; then
  abort_with_rollback "checkout sync failed"
fi

if ! NEW_HEAD=$(run_with_retry "Vultr new-head" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "cd /opt/holaday-monorepo && git rev-parse --short HEAD" | tail -1 | tr -d '[:space:]'); then
  abort_with_rollback "deployed HEAD verification failed"
fi

echo "→ Installing + building"
if ! run_with_retry "Vultr install/build" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
    cd /opt/holaday-monorepo && \
    pnpm install && \
    pnpm --filter @holaday/orchestrator build" 2>&1 | tail -5; then
  abort_with_rollback "install/build failed"
fi

echo "→ Applying numbered migrations and verifying the production schema"
if ! run_with_retry "Vultr database migration gate" \
  "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
    cd /opt/holaday-monorepo && \
    set -a && . apps/orchestrator/.env && set +a && \
    pnpm --filter @holaday/orchestrator db:migrate:numbered && \
    pnpm --filter @holaday/orchestrator db:verify"; then
  abort_with_rollback "database migration/schema verification failed"
fi

echo "→ PM2 restart as dedicated non-root runtime user"
if ! restart_orchestrator_as_runtime_user "Vultr non-root PM2 restart"; then
  abort_with_rollback "non-root runtime start failed"
fi

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
    "pm2 logs holaday-orchestrator --lines 10 --nostream --err 2>&1 | tail -15" >&2 || true
  abort_with_rollback "health check failed"
fi

if ! RESTART=$(run_with_retry "Vultr restart count" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "node -e \"const list=JSON.parse(require('child_process').execFileSync('pm2',['jlist'],{encoding:'utf8'})); const app=list.find((p)=>p.name==='holaday-orchestrator'); process.stdout.write(String(app?.pm2_env?.restart_time ?? 'unknown'));\""); then
  abort_with_rollback "restart count verification failed"
fi
echo "✅ Orchestrator deployed — restart count: $RESTART"

# Verify the required LLM keys actually made it INTO the running process
# (not just the .env file). A plain `pm2 restart` reuses pm2's cached env
# and silently drops a newly-added key — hence the --update-env above +
# this guard. We only print key NAMES that have a non-empty value (never
# the secret). Failure rolls back rather than leaving the image lane
# keyless (image intents would silently degrade to generate).
REQUIRED_PROCESS_KEYS="${DEPLOY_REQUIRED_PROCESS_KEYS:-GEMINI_API_KEY ANTHROPIC_API_KEY DASHSCOPE_API_KEY}"
echo "→ Verifying keys loaded in process: $REQUIRED_PROCESS_KEYS"
if ! PROC_KEYS=$(run_with_retry "Vultr key-check" "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "PID=\$(pm2 pid holaday-orchestrator | head -1); tr '\\0' '\\n' < /proc/\$PID/environ 2>/dev/null | grep -oE '^[A-Z_]+=.' | grep -oE '^[A-Z_]+'" | tr -d '\r'); then
  abort_with_rollback "process key verification failed"
fi
KEY_MISS=""
for k in $REQUIRED_PROCESS_KEYS; do
  echo "$PROC_KEYS" | grep -qx "$k" || KEY_MISS="$KEY_MISS $k"
done
if [[ -n "$KEY_MISS" ]]; then
  echo "❌ Required keys missing/empty in process:$KEY_MISS" >&2
  abort_with_rollback "keys not loaded into process"
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
  parse_auto_smoke_summary "$SMOKE_OUT"
  case "$AUTO_SMOKE_STATE" in
    healthy)
      echo "✅ Auto-smoke $AUTO_SMOKE_PASSED/$AUTO_SMOKE_TOTAL — pipeline healthy"
      ;;
    failures)
      echo "⚠️  Auto-smoke $AUTO_SMOKE_PASSED/$AUTO_SMOKE_TOTAL had failures (see output above) — deploy NOT rolled back"
      echo "   Likely flaky LLM (Anthropic overloaded) or a real regression — investigate."
      ;;
    *)
      echo "⚠️  Auto-smoke did not produce a parseable summary line — eval runner may have errored"
      ;;
  esac
fi

# Authoritative post-deploy reference (hard rule 7). Copy this into the
# `PROD LIVE REF = …` line at the TOP of docs/daily/SESSION_STATUS.md so the
# next session reads the truth instead of guessing the prod branch.
echo ""
echo "────────────────────────────────────────────────────────────"
echo "PROD LIVE REF = $BRANCH@${NEW_HEAD:-unknown}"
echo "  → update the 'PROD LIVE REF =' line at the TOP of docs/daily/SESSION_STATUS.md"
echo "────────────────────────────────────────────────────────────"
