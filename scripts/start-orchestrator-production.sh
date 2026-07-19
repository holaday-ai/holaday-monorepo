#!/usr/bin/env bash
# Run TypeScript in the PM2-owned Node process. Invoking the tsx CLI creates a
# child process that can survive a force-killed PM2 wrapper; importing tsx keeps
# workspace source resolution and both service ports in one managed process.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="${ORCHESTRATOR_REPO_ROOT:-$DEFAULT_REPO_ROOT}"
ORCHESTRATOR_DIR="$REPO_ROOT/apps/orchestrator"
NODE_BIN="${ORCHESTRATOR_NODE_BIN:-/opt/node22/bin/node}"
SOURCE_ENTRY="$ORCHESTRATOR_DIR/src/index.ts"

export PATH="/opt/node22/bin:$PATH"

[[ "$REPO_ROOT" == /* && "$REPO_ROOT" != "/" ]] || {
  echo "start-orchestrator-production: invalid repository root: $REPO_ROOT" >&2
  exit 1
}

# PM2 remains root-owned, but the application child must not use or expose its
# control directory after PM2 has dropped the process to the runtime user.
unset PM2_HOME

[[ -x "$NODE_BIN" ]] || {
  echo "start-orchestrator-production: node executable missing: $NODE_BIN" >&2
  exit 1
}
[[ -f "$SOURCE_ENTRY" ]] || {
  echo "start-orchestrator-production: source entrypoint missing: $SOURCE_ENTRY" >&2
  exit 1
}

cd "$ORCHESTRATOR_DIR"
exec "$NODE_BIN" --import tsx "$SOURCE_ENTRY"
