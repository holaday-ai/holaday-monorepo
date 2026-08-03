#!/usr/bin/env bash
# akshare-mcp 薄 HTTP 部署：venv 装依赖 → pm2 (re)start → 真实数据 smoke check。
# 照 deploy-orchestrator.sh 模式（load-deploy-env + ssh-password-auth + smoke）。
#
# 本脚本在任何生产 reset 前独立校验 LIVE HEAD，并在失败时恢复旧版本。
#
# ⚠️ 服务仅监听 127.0.0.1:8848（无鉴权数据接口，不对公网暴露）。
#
# Usage:   scripts/deploy-akshare-mcp.sh
# Env:     VULTR_PASSWORD（经 load-deploy-env.sh）
# Exits:   0 成功；1 smoke 失败。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-deploy-env.sh"
source "$SCRIPT_DIR/ssh-password-auth.sh"

VULTR_HOST="root@207.148.70.106"
BRANCH="${1:-${BRANCH:-}}"
REPO_DIR="/opt/holaday-monorepo"
APP_DIR="/opt/holaday-monorepo/apps/akshare-mcp"
HEALTH_URL="http://127.0.0.1:8848/healthz"
AKSHARE_HTTP_URL="${AKSHARE_HTTP_URL:-http://127.0.0.1:8848}"
AKSHARE_ROLLBACK_HEAD="${AKSHARE_ROLLBACK_HEAD:-}"

if [[ -z "${VULTR_PASSWORD:-}" ]]; then
  echo "❌ VULTR_PASSWORD unset — refusing akshare-mcp deploy" >&2
  exit 1
fi
build_ssh_password_prefix "$VULTR_PASSWORD"
VULTR_AUTH_PREFIX=("${SSH_PASSWORD_PREFIX[@]}")
SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=10)

capture_rollback_head() {
  if [[ -z "$AKSHARE_ROLLBACK_HEAD" ]]; then
    AKSHARE_ROLLBACK_HEAD=$("${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
      "cd '$REPO_DIR' && git rev-parse HEAD" | tail -1 | tr -d '[:space:]')
  fi
  if ! [[ "$AKSHARE_ROLLBACK_HEAD" =~ ^[0-9a-f]{40}$ ]]; then
    echo "❌ Invalid AKShare rollback HEAD — refusing deploy" >&2
    exit 1
  fi
  "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "cd '$REPO_DIR' && git cat-file -e '$AKSHARE_ROLLBACK_HEAD^{commit}'"
  echo "→ akshare-mcp rollback HEAD: $AKSHARE_ROLLBACK_HEAD"
}

preflight_remote_checkout() {
  local gate_rc

  [[ -n "$BRANCH" ]] || return 0
  echo "→ akshare-mcp: pre-reset branch safety gate"
  set +e
  "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
    cd '$REPO_DIR'; \
    git fetch origin '+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH' >/dev/null 2>&1 || exit 2; \
    git cat-file -e '$AKSHARE_ROLLBACK_HEAD^{commit}' || exit 2; \
    git merge-base --is-ancestor '$AKSHARE_ROLLBACK_HEAD' 'origin/$BRANCH'"
  gate_rc=$?
  set -e

  case "$gate_rc" in
    0)
      echo "   ✅ akshare-mcp branch preflight passed"
      ;;
    1)
      if [[ "${ALLOW_DIVERGENT_DEPLOY:-0}" != "1" ]]; then
        echo "⛔ LIVE HEAD is not an ancestor of origin/$BRANCH; refusing AKShare reset." >&2
        exit 3
      fi
      echo "⚠️  ALLOW_DIVERGENT_DEPLOY=1 set — proceeding despite divergence." >&2
      ;;
    *)
      echo "⛔ Could not verify origin/$BRANCH against the LIVE HEAD; refusing AKShare reset." >&2
      exit 4
      ;;
  esac
}

rollback_akshare() {
  local reason="$1"

  echo "→ AKShare deploy failed during $reason; restoring $AKSHARE_ROLLBACK_HEAD" >&2
  if "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
      cd '$REPO_DIR' && \
      git cat-file -e '$AKSHARE_ROLLBACK_HEAD^{commit}' && \
      git reset --hard '$AKSHARE_ROLLBACK_HEAD' && \
      cd '$APP_DIR' && \
      ( [ -d .venv ] || python3 -m venv .venv ) && \
      .venv/bin/python -m pip install -q --upgrade pip && \
      .venv/bin/pip install -q -e . && \
      pm2 startOrReload ecosystem.config.cjs --update-env && \
      pm2 save"; then
    echo "✅ AKShare restored to the original LIVE version" >&2
  else
    echo "❌ AKShare automatic rollback failed; manual recovery is required" >&2
  fi
}

capture_rollback_head
preflight_remote_checkout

if [[ -n "$BRANCH" ]]; then
  echo "→ akshare-mcp: syncing remote repo to $BRANCH"
  if ! "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
      cd '$REPO_DIR' && \
      git fetch origin '+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH' && \
      git reset --hard 'origin/$BRANCH'"; then
    rollback_akshare "checkout sync"
    exit 1
  fi
fi

echo "→ akshare-mcp: venv install + pm2 (re)start on Vultr"
set +e
INSTALL_OUTPUT=$("${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
  mkdir -p /var/log/holaday && \
  cd '$APP_DIR' && \
  ( [ -d .venv ] || python3 -m venv .venv ) && \
  .venv/bin/python -m pip install -q --upgrade pip && \
  .venv/bin/pip install -q -e . && \
  pm2 startOrReload ecosystem.config.cjs --update-env && \
  pm2 save" 2>&1)
INSTALL_RC=$?
set -e
echo "$INSTALL_OUTPUT" | tail -8
if (( INSTALL_RC != 0 )); then
  rollback_akshare "installation or restart"
  exit 1
fi

echo "→ Smoke check $HEALTH_URL + rankings"
RANK_TIMEOUT="${AKSHARE_SMOKE_RANK_TIMEOUT:-120}"
SMOKE=$("${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "cd '$REPO_DIR' && AKSHARE_HTTP_URL='$AKSHARE_HTTP_URL' AKSHARE_SMOKE_RANK_TIMEOUT='$RANK_TIMEOUT' scripts/smoke-akshare-mcp.sh" 2>&1 || true)
if echo "$SMOKE" | grep -q 'akshare-mcp smoke OK'; then
  echo "$SMOKE" | tail -8
else
  echo "❌ akshare-mcp smoke failed" >&2
  echo "${SMOKE:-<no response>}" >&2
  echo "→ Last akshare-mcp logs" >&2
  "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "pm2 logs akshare-mcp-http --lines 40 --nostream" >&2 || true
  rollback_akshare "smoke verification"
  exit 1
fi
