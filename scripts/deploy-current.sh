#!/bin/bash
# One-command deploy entrypoint for the current Holaday branch.
#
# Usage:
#   ./scripts/deploy-current.sh spa
#   ./scripts/deploy-current.sh orchestrator
#   ./scripts/deploy-current.sh akshare
#   ./scripts/deploy-current.sh both
#
# Env:
#   BRANCH defaults to claude/musing-keller-ae1d05
#   Credentials are loaded by scripts/load-deploy-env.sh.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${BRANCH:-claude/musing-keller-ae1d05}"
TARGET="${1:-spa}"

cd "$ROOT_DIR"
# shellcheck source=scripts/load-deploy-env.sh
source "$ROOT_DIR/scripts/load-deploy-env.sh"
# shellcheck source=scripts/ssh-password-auth.sh
source "$ROOT_DIR/scripts/ssh-password-auth.sh"

VULTR_HOST="root@207.148.70.106"
RELEASE_ROLLBACK_HEAD="${RELEASE_ROLLBACK_HEAD:-}"

capture_release_rollback_head() {
  if [[ -n "$RELEASE_ROLLBACK_HEAD" ]]; then
    return 0
  fi
  if [[ -z "${VULTR_PASSWORD:-}" ]]; then
    echo "❌ VULTR_PASSWORD unset — cannot capture the release rollback point" >&2
    exit 1
  fi

  build_ssh_password_prefix "$VULTR_PASSWORD"
  RELEASE_ROLLBACK_HEAD=$("${SSH_PASSWORD_PREFIX[@]}" ssh \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=20 \
    -o ServerAliveInterval=10 \
    -o ServerAliveCountMax=3 \
    "$VULTR_HOST" \
    "cd /opt/holaday-monorepo && git rev-parse HEAD" \
    | tail -1 \
    | tr -d '[:space:]')
  if ! [[ "$RELEASE_ROLLBACK_HEAD" =~ ^[0-9a-f]{40}$ ]]; then
    echo "❌ Could not capture a valid production rollback HEAD" >&2
    exit 1
  fi
  echo "→ Release rollback HEAD: $RELEASE_ROLLBACK_HEAD"
}

preflight_release_branch() {
  local gate_rc

  capture_release_rollback_head
  echo "→ Pre-reset production gate: $RELEASE_ROLLBACK_HEAD must be an ancestor of origin/$BRANCH"
  set +e
  "${SSH_PASSWORD_PREFIX[@]}" ssh \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=20 \
    -o ServerAliveInterval=10 \
    -o ServerAliveCountMax=3 \
    "$VULTR_HOST" \
    "set -e; cd /opt/holaday-monorepo; \
      git fetch origin '+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH' >/dev/null 2>&1 || exit 2; \
      git cat-file -e '$RELEASE_ROLLBACK_HEAD^{commit}' || exit 2; \
      git merge-base --is-ancestor '$RELEASE_ROLLBACK_HEAD' 'origin/$BRANCH'" \
    >/dev/null
  gate_rc=$?
  set -e

  case "$gate_rc" in
    0)
      echo "   ✅ Production branch preflight passed"
      ;;
    1)
      if [[ "${ALLOW_DIVERGENT_DEPLOY:-0}" != "1" ]]; then
        echo "⛔ LIVE HEAD is not an ancestor of origin/$BRANCH; refusing production reset." >&2
        echo "   Reconcile the branch or set ALLOW_DIVERGENT_DEPLOY=1 for an intentional cutover." >&2
        exit 3
      fi
      echo "⚠️  ALLOW_DIVERGENT_DEPLOY=1 set — proceeding despite divergence." >&2
      ;;
    *)
      echo "⛔ Could not verify origin/$BRANCH against the LIVE HEAD; refusing production reset." >&2
      exit 4
      ;;
  esac
}

fetch_current() {
  if [[ -n "$(git status --porcelain --untracked-files=no)" && "${ALLOW_DIRTY_DEPLOY:-0}" != "1" ]]; then
    echo "❌ Refusing deploy with uncommitted tracked changes." >&2
    echo "   Commit/stash first, or set ALLOW_DIRTY_DEPLOY=1 to keep the old reset-hard behavior." >&2
    exit 1
  fi
  echo "→ Fetching $BRANCH"
  git fetch origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
  echo "→ HEAD $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
}

deploy_spa() {
  echo "→ Building web-workbench"
  pnpm --filter @holaday/web-workbench build
  echo "→ Deploying SPA"
  "$ROOT_DIR/scripts/deploy-spa.sh"
}

deploy_orchestrator() {
  echo "→ Deploying orchestrator"
  ORCHESTRATOR_ROLLBACK_HEAD="$RELEASE_ROLLBACK_HEAD" \
    "$ROOT_DIR/scripts/deploy-orchestrator.sh" "$BRANCH"
}

deploy_akshare() {
  echo "→ Deploying akshare-mcp"
  AKSHARE_ROLLBACK_HEAD="$RELEASE_ROLLBACK_HEAD" \
    "$ROOT_DIR/scripts/deploy-akshare-mcp.sh" "$BRANCH"
}

verify_healthz() {
  local urls=(
    "https://holaday.ai/api/healthz"
    "https://hd-app.orangebench.tech/api/healthz"
  )
  local url response http_code attempt

  for url in "${urls[@]}"; do
    response=$(mktemp)
    for attempt in 1 2 3; do
      http_code=$(curl -sS --max-time 15 -o "$response" -w '%{http_code}' "$url" 2>&1 || true)
      if [[ "$http_code" == "200" ]] && grep -Fq '"status":"ok"' "$response"; then
        echo "✅ $url healthz 200"
        rm -f "$response"
        continue 2
      fi
      echo "   $url attempt $attempt: http=$http_code"
      sleep 2
    done
    echo "❌ $url healthz check failed" >&2
    echo "Last response head:" >&2
    head -5 "$response" 2>/dev/null | sed 's/^/   /' >&2
    rm -f "$response"
    exit 1
  done
}

case "$TARGET" in
  spa)
    fetch_current
    deploy_spa
    verify_healthz
    ;;
  orchestrator)
    fetch_current
    preflight_release_branch
    deploy_akshare
    deploy_orchestrator
    verify_healthz
    ;;
  akshare)
    fetch_current
    preflight_release_branch
    deploy_akshare
    ;;
  both)
    fetch_current
    preflight_release_branch
    deploy_akshare
    deploy_orchestrator
    # Orchestrator deploy resets the shared Vultr checkout. Keep SPA last
    # so tracked/stale dist files in the checkout cannot overwrite the
    # freshly uploaded web bundle.
    deploy_spa
    verify_healthz
    ;;
  *)
    echo "Usage: $0 [spa|orchestrator|akshare|both]" >&2
    exit 2
    ;;
esac
