#!/usr/bin/env bash
# Run the compiled production entrypoint as the PM2-owned process. Avoiding the
# tsx loader prevents a force-killed PM2 process from leaving its Node child
# alive with one of the service ports.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ORCHESTRATOR_DIR="$REPO_ROOT/apps/orchestrator"
NODE_BIN="${ORCHESTRATOR_NODE_BIN:-/opt/node22/bin/node}"
DIST_ENTRY="$ORCHESTRATOR_DIR/dist/index.js"

export PATH="/opt/node22/bin:$PATH"

# PM2 remains root-owned, but the application child must not use or expose its
# control directory after PM2 has dropped the process to the runtime user.
unset PM2_HOME

[[ -x "$NODE_BIN" ]] || {
  echo "start-orchestrator-production: node executable missing: $NODE_BIN" >&2
  exit 1
}
[[ -f "$DIST_ENTRY" ]] || {
  echo "start-orchestrator-production: compiled entrypoint missing: $DIST_ENTRY" >&2
  exit 1
}

cd "$ORCHESTRATOR_DIR"
exec "$NODE_BIN" "$DIST_ENTRY"
