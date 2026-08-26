#!/usr/bin/env bash
# Run the portless account-closure worker in the PM2-owned Node process.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="${ORCHESTRATOR_REPO_ROOT:-$DEFAULT_REPO_ROOT}"
ORCHESTRATOR_DIR="$REPO_ROOT/apps/orchestrator"
NODE_BIN="${ORCHESTRATOR_NODE_BIN:-/opt/node22/bin/node}"
BUILT_ENTRY="$ORCHESTRATOR_DIR/dist/account-closure/worker-entry.js"

export PATH="/opt/node22/bin:$PATH"
unset PM2_HOME

[[ "$REPO_ROOT" == /* && "$REPO_ROOT" != "/" ]] || {
  echo "start-account-closure-worker: invalid repository root" >&2
  exit 1
}
[[ -x "$NODE_BIN" ]] || {
  echo "start-account-closure-worker: node executable missing" >&2
  exit 1
}
[[ -f "$BUILT_ENTRY" ]] || {
  echo "start-account-closure-worker: built entrypoint missing" >&2
  exit 1
}

cd "$ORCHESTRATOR_DIR"
exec "$NODE_BIN" "$BUILT_ENTRY"
