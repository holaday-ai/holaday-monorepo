#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_SCRIPT="$SCRIPT_DIR/deploy-current.sh"
ORCHESTRATOR_SCRIPT="$SCRIPT_DIR/deploy-orchestrator.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

grep -Fq 'capture_release_rollback_head' "$CURRENT_SCRIPT" \
  || fail "combined deploy must capture the live HEAD before any remote checkout changes"
grep -Fq 'ORCHESTRATOR_ROLLBACK_HEAD="$RELEASE_ROLLBACK_HEAD"' "$CURRENT_SCRIPT" \
  || fail "combined deploy must pass the original live HEAD to orchestrator deploy"
grep -Fq 'ORCHESTRATOR_ROLLBACK_HEAD:-' "$ORCHESTRATOR_SCRIPT" \
  || fail "orchestrator deploy must accept an explicit pre-release rollback HEAD"
grep -Fq 'git cat-file -e' "$ORCHESTRATOR_SCRIPT" \
  && grep -Fq 'PREV_HEAD^{commit}' "$ORCHESTRATOR_SCRIPT" \
  || fail "orchestrator deploy must validate an explicit rollback commit"
grep -Fq 'REMOTE_START_HELPER' "$ORCHESTRATOR_SCRIPT" \
  || fail "deploy must stage the direct Node entrypoint outside the checkout"
grep -Fq 'ORCHESTRATOR_START_SCRIPT=' "$ORCHESTRATOR_SCRIPT" \
  || fail "runtime restart must use the staged entrypoint during deploy and rollback"

echo "PASS: combined deploy preserves the pre-release rollback target"
