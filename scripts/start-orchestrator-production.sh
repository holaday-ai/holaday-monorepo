#!/usr/bin/env bash
# Keep production startup aligned with the existing tsx runtime while making
# the entrypoint versioned and reproducible instead of relying on an untracked
# server-local wrapper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ORCHESTRATOR_DIR="$REPO_ROOT/apps/orchestrator"
TSX_BIN="$ORCHESTRATOR_DIR/node_modules/.bin/tsx"

export PATH="/opt/node22/bin:$PATH"

[[ -x "$TSX_BIN" ]] || {
  echo "start-orchestrator-production: tsx executable missing: $TSX_BIN" >&2
  exit 1
}

cd "$ORCHESTRATOR_DIR"
exec "$TSX_BIN" src/index.ts
