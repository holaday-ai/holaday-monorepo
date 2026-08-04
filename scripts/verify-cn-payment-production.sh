#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="$SCRIPT_DIR/cn-payment-production-preflight.mjs"
VULTR_HOST="${VULTR_HOST:-root@207.148.70.106}"
EXPECTED_AMOUNT_CENTS="${CN_PAYMENT_PREFLIGHT_EXPECTED_AMOUNT_CENTS:-2900}"

# shellcheck source=scripts/load-deploy-env.sh
source "$SCRIPT_DIR/load-deploy-env.sh"
# shellcheck source=scripts/ssh-password-auth.sh
source "$SCRIPT_DIR/ssh-password-auth.sh"

if [[ -z "${VULTR_PASSWORD:-}" ]]; then
  echo "CN payment production preflight failed: VULTR_PASSWORD is unset" >&2
  exit 1
fi
if [[ ! -f "$CHECK_SCRIPT" ]]; then
  echo "CN payment production preflight failed: checker is missing" >&2
  exit 1
fi
if [[ ! "$EXPECTED_AMOUNT_CENTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "CN payment production preflight failed: CN_PAYMENT_PREFLIGHT_EXPECTED_AMOUNT_CENTS must be a positive integer" >&2
  exit 1
fi
export CN_PAYMENT_PREFLIGHT_EXPECTED_AMOUNT_CENTS="$EXPECTED_AMOUNT_CENTS"

build_ssh_password_prefix "$VULTR_PASSWORD"
CHECK_SCRIPT_B64="$(base64 < "$CHECK_SCRIPT" | tr -d '\n')"

echo "→ Verifying production WeChat Pay and Alipay order creation"
if ! PREFLIGHT_OUTPUT=$("${SSH_PASSWORD_PREFIX[@]}" ssh \
  -o StrictHostKeyChecking=no \
  -o ConnectTimeout=20 \
  -o ServerAliveInterval=10 \
  -o ServerAliveCountMax=3 \
  "$VULTR_HOST" \
  "set -e; cd /opt/holaday-monorepo; set -a; . apps/orchestrator/.env; set +a; printf '%s' '$CHECK_SCRIPT_B64' | base64 --decode | CN_PAYMENT_PREFLIGHT_EXPECTED_AMOUNT_CENTS='$EXPECTED_AMOUNT_CENTS' node --input-type=module"); then
  exit 1
fi

printf '%s\n' "$PREFLIGHT_OUTPUT"
if ! grep -Eq "^CN_PAYMENT_PREFLIGHT=ready wechat=ready alipay=ready amountCents=$EXPECTED_AMOUNT_CENTS$" <<< "$PREFLIGHT_OUTPUT"; then
  echo "CN payment production preflight failed: verifier returned no readiness marker" >&2
  exit 1
fi
