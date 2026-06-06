#!/bin/bash
# One-command deploy entrypoint for the current Holaday branch.
#
# Usage:
#   ./scripts/deploy-current.sh spa
#   ./scripts/deploy-current.sh orchestrator
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
  "$ROOT_DIR/scripts/deploy-orchestrator.sh" "$BRANCH"
}

case "$TARGET" in
  spa)
    fetch_current
    deploy_spa
    ;;
  orchestrator)
    fetch_current
    deploy_orchestrator
    ;;
  both)
    fetch_current
    deploy_spa
    deploy_orchestrator
    ;;
  *)
    echo "Usage: $0 [spa|orchestrator|both]" >&2
    exit 2
    ;;
esac
