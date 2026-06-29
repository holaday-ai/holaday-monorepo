#!/usr/bin/env bash
# akshare-mcp 薄 HTTP 部署：venv 装依赖 → pm2 (re)start → 真实数据 smoke check。
# 照 deploy-orchestrator.sh 模式（load-deploy-env + ssh-password-auth + smoke）。
#
# 前置：monorepo 已在目标分支（由 deploy-orchestrator.sh 的 git reset 拉到位；
#       akshare-mcp 与 orchestrator 同分支、同次部署）。本脚本只管 venv + pm2。
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

if [[ -z "${VULTR_PASSWORD:-}" ]]; then
  echo "❌ VULTR_PASSWORD unset — refusing akshare-mcp deploy" >&2
  exit 1
fi
build_ssh_password_prefix "$VULTR_PASSWORD"
VULTR_AUTH_PREFIX=("${SSH_PASSWORD_PREFIX[@]}")
SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=10)

if [[ -n "$BRANCH" ]]; then
  echo "→ akshare-mcp: syncing remote repo to $BRANCH"
  "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
    cd '$REPO_DIR' && \
    git fetch origin '+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH' && \
    git reset --hard 'origin/$BRANCH'"
fi

echo "→ akshare-mcp: venv install + pm2 (re)start on Vultr"
"${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" "set -e; \
  mkdir -p /var/log/holaday && \
  cd '$APP_DIR' && \
  ( [ -d .venv ] || python3 -m venv .venv ) && \
  .venv/bin/python -m pip install -q --upgrade pip && \
  .venv/bin/pip install -q -e . && \
  pm2 startOrReload ecosystem.config.cjs --update-env && \
  pm2 save" 2>&1 | tail -8

echo "→ Smoke check $HEALTH_URL + rankings"
SMOKE=$("${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "cd '$REPO_DIR' && AKSHARE_HTTP_URL='$AKSHARE_HTTP_URL' AKSHARE_SMOKE_RANK_TIMEOUT=75 scripts/smoke-akshare-mcp.sh" 2>&1 || true)
if echo "$SMOKE" | grep -q 'akshare-mcp smoke OK'; then
  echo "$SMOKE" | tail -8
else
  echo "❌ akshare-mcp smoke failed" >&2
  echo "${SMOKE:-<no response>}" >&2
  echo "→ Last akshare-mcp logs" >&2
  "${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
    "pm2 logs akshare-mcp-http --lines 40 --nostream" >&2 || true
  exit 1
fi
