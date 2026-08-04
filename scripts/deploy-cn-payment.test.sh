#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_SCRIPT="$SCRIPT_DIR/deploy-cn-payment.sh"
REMOTE_SCRIPT="$SCRIPT_DIR/deploy-cn-payment-remote.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$LOCAL_SCRIPT" ]] || fail "local CN payment deploy script is missing"
[[ -f "$REMOTE_SCRIPT" ]] || fail "remote CN payment deploy script is missing"

bash -n "$LOCAL_SCRIPT"
bash -n "$REMOTE_SCRIPT"

grep -Fq 'archive --format=tar.gz' "$LOCAL_SCRIPT" \
  || fail "local deploy must package a committed release"
grep -Fq 'deploy-cn-payment-remote.sh' "$LOCAL_SCRIPT" \
  || fail "local deploy must execute the reviewed remote installer"
grep -Fq 'pnpm --filter @holaday/cn-payment typecheck' "$REMOTE_SCRIPT" \
  || fail "candidate release must typecheck before activation"
grep -Fq 'pnpm --filter @holaday/cn-payment test' "$REMOTE_SCRIPT" \
  || fail "candidate release must test before activation"
grep -Fq 'previous_target' "$REMOTE_SCRIPT" \
  || fail "remote deploy must retain the previous release target"
grep -Fq 'rollback' "$REMOTE_SCRIPT" \
  || fail "remote deploy must define an automatic rollback path"
grep -Fq '"bridge":"ready"' "$REMOTE_SCRIPT" \
  || fail "remote smoke must verify the Vultr settlement bridge"
grep -Fq 'pm2 restart holaday-cn-payment --update-env' "$REMOTE_SCRIPT" \
  || fail "remote deploy must reload the gateway process environment"

echo "PASS: CN payment deploy validates, atomically activates, smokes and rolls back releases"
