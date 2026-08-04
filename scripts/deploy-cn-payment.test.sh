#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_SCRIPT="$SCRIPT_DIR/deploy-cn-payment.sh"
REMOTE_SCRIPT="$SCRIPT_DIR/deploy-cn-payment-remote.sh"
VERIFY_SCRIPT="$SCRIPT_DIR/verify-cn-payment-production.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$LOCAL_SCRIPT" ]] || fail "local CN payment deploy script is missing"
[[ -f "$REMOTE_SCRIPT" ]] || fail "remote CN payment deploy script is missing"
[[ -f "$VERIFY_SCRIPT" ]] || fail "CN payment production verifier is missing"

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
grep -Fq 'wait_for_gateway_health' "$REMOTE_SCRIPT" \
  || fail "remote smoke must retry during the gateway cold-start window"
grep -Fq 'GATEWAY_HEALTH_ATTEMPTS' "$REMOTE_SCRIPT" \
  || fail "remote smoke retries must remain explicitly bounded"
grep -Fq 'pm2 restart holaday-cn-payment --update-env' "$REMOTE_SCRIPT" \
  || fail "remote deploy must reload the gateway process environment"
grep -Fq 'StrictHostKeyChecking=yes' "$LOCAL_SCRIPT" \
  || fail "CN payment deploy must enforce the pinned known_hosts entry"
grep -Fq 'StrictHostKeyChecking=yes' "$VERIFY_SCRIPT" \
  || fail "CN payment verifier must enforce the pinned known_hosts entry"
! grep -Fq 'StrictHostKeyChecking=no' "$LOCAL_SCRIPT" \
  || fail "CN payment deploy must not disable SSH host verification"
! grep -Fq 'StrictHostKeyChecking=no' "$VERIFY_SCRIPT" \
  || fail "CN payment verifier must not disable SSH host verification"

echo "PASS: CN payment deploy validates, atomically activates, smokes and rolls back releases"
