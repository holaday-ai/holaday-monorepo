#!/bin/bash
# Orchestrator deploy with healthz smoke check.
#
# Standard Vultr cycle (pre-approved per memory): fetch → reset →
# install → build → restart → smoke check. Fails loudly if /healthz
# doesn't respond with status=ok within 5s of restart so a busted
# build doesn't silently leave clients hanging.
#
# Usage:   ./scripts/deploy-orchestrator.sh [BRANCH]
#          BRANCH defaults to claude/chrome-extension-poc-biwr6
# Env:     VULTR_PASSWORD (sshpass)
# Exits:   0 on success, 1 on health-check failure (no auto-rollback;
#          PM2 keeps last-good binary running unless build broke,
#          in which case re-run after fixing).

set -euo pipefail

VULTR_HOST="root@207.148.70.106"
BRANCH="${1:-claude/chrome-extension-poc-biwr6}"
HEALTH_URL="http://localhost:4001/healthz"
HEALTH_MARKER='"status":"ok"'

SSHPASS_ARGS=()
if [[ -n "${VULTR_PASSWORD:-}" ]]; then
  SSHPASS_ARGS=(sshpass -p "$VULTR_PASSWORD")
fi
SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=20)

echo "→ Fetching $BRANCH on Vultr"
"${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
  cd /opt/holaday-monorepo && \
  git fetch origin $BRANCH && \
  git reset --hard origin/$BRANCH && \
  git rev-parse HEAD" | tail -5

echo "→ Installing + building"
"${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
  cd /opt/holaday-monorepo && \
  pnpm install && \
  pnpm --filter @holaday/orchestrator build" 2>&1 | tail -5

echo "→ pm2 restart"
"${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "pm2 restart holaday-orchestrator"

echo "→ Health check ($HEALTH_URL must return '$HEALTH_MARKER')"
sleep 3
HEALTH_OUT=$("${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "curl -sf --max-time 10 $HEALTH_URL || echo 'FAIL'")
if echo "$HEALTH_OUT" | grep -q "$HEALTH_MARKER"; then
  echo "✅ Health check passed"
else
  echo "❌ Health check FAILED"
  echo "Response: $HEALTH_OUT" >&2
  echo "→ Last 10 error log lines:"
  "${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "pm2 logs holaday-orchestrator --lines 10 --nostream --err 2>&1 | tail -15" >&2
  exit 1
fi

RESTART=$("${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "pm2 list | grep holaday-orchestrator | awk '{print \$10}'" | head -1)
echo "✅ Orchestrator deployed — restart count: $RESTART"

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
  SMOKE_OUT=$("${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
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
