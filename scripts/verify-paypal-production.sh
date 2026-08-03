#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="$SCRIPT_DIR/paypal-production-preflight.mjs"
VULTR_HOST="${VULTR_HOST:-root@207.148.70.106}"

# shellcheck source=scripts/load-deploy-env.sh
source "$SCRIPT_DIR/load-deploy-env.sh"
# shellcheck source=scripts/ssh-password-auth.sh
source "$SCRIPT_DIR/ssh-password-auth.sh"

if [[ -z "${VULTR_PASSWORD:-}" ]]; then
  echo "PayPal production preflight failed: VULTR_PASSWORD is unset" >&2
  exit 1
fi
if [[ ! -f "$CHECK_SCRIPT" ]]; then
  echo "PayPal production preflight failed: checker is missing" >&2
  exit 1
fi

build_ssh_password_prefix "$VULTR_PASSWORD"
CHECK_SCRIPT_B64="$(base64 < "$CHECK_SCRIPT" | tr -d '\n')"

echo "→ Verifying production PayPal credentials and webhook"
if ! PREFLIGHT_OUTPUT=$("${SSH_PASSWORD_PREFIX[@]}" ssh \
  -o StrictHostKeyChecking=no \
  -o ConnectTimeout=20 \
  -o ServerAliveInterval=10 \
  -o ServerAliveCountMax=3 \
  "$VULTR_HOST" \
  "set -e; cd /opt/holaday-monorepo; set -a; . apps/orchestrator/.env; set +a; printf '%s' '$CHECK_SCRIPT_B64' | base64 --decode | node --input-type=module"); then
  exit 1
fi

printf '%s\n' "$PREFLIGHT_OUTPUT"
if ! grep -Eq '^PAYPAL_PREFLIGHT=(ready|disabled) environment=(live|sandbox)$' <<< "$PREFLIGHT_OUTPUT"; then
  echo "PayPal production preflight failed: verifier returned no readiness marker" >&2
  exit 1
fi
