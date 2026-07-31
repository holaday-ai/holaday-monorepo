#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-orchestrator.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

migrate_line="$(grep -n 'db:migrate:numbered' "$DEPLOY_SCRIPT" | head -1 | cut -d: -f1 || true)"
verify_line="$(grep -n 'db:verify' "$DEPLOY_SCRIPT" | head -1 | cut -d: -f1 || true)"
restart_line="$(grep -n 'restart_orchestrator_as_runtime_user "Vultr non-root PM2 restart"' "$DEPLOY_SCRIPT" | head -1 | cut -d: -f1 || true)"

[[ "$migrate_line" =~ ^[1-9][0-9]*$ ]] || fail "deploy must apply numbered migrations"
[[ "$verify_line" =~ ^[1-9][0-9]*$ ]] || fail "deploy must verify the resulting schema"
[[ "$restart_line" =~ ^[1-9][0-9]*$ ]] || fail "deploy must restart the orchestrator"
(( migrate_line < verify_line )) || fail "schema verification must run after migrations"
(( verify_line < restart_line )) || fail "migrations and schema verification must pass before restart"

grep -Fq 'Database changes are forward-only' "$DEPLOY_SCRIPT" \
  || fail "rollback output must state that database changes are not reverted"

echo "PASS: orchestrator deploy gates restart on migrations and schema verification"
