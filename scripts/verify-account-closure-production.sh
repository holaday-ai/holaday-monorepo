#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="$SCRIPT_DIR/account-closure-rollout-preflight.mjs"
MODE="${1:-dormant}"
VULTR_HOST="${VULTR_HOST:-root@207.148.70.106}"
ALIYUN_HOST="${ALIYUN_HOST:-root@47.99.169.186}"

# shellcheck source=scripts/load-deploy-env.sh
if ! source "$SCRIPT_DIR/load-deploy-env.sh" >/dev/null 2>&1; then
  echo 'ACCOUNT_CLOSURE_PREFLIGHT status=error reason=deployment-auth-load-failed' >&2
  exit 1
fi
# shellcheck source=scripts/ssh-password-auth.sh
if ! source "$SCRIPT_DIR/ssh-password-auth.sh" >/dev/null 2>&1; then
  echo 'ACCOUNT_CLOSURE_PREFLIGHT status=error reason=ssh-helper-load-failed' >&2
  exit 1
fi

case "$MODE" in
  dormant | canary-ready | canary-running) ;;
  *)
    echo 'ACCOUNT_CLOSURE_PREFLIGHT status=error reason=invalid-mode' >&2
    exit 2
    ;;
esac

if [[ ! -f "$CHECK_SCRIPT" ]]; then
  echo 'ACCOUNT_CLOSURE_PREFLIGHT status=error reason=checker-missing' >&2
  exit 1
fi
if [[ -z "${VULTR_PASSWORD:-}" || -z "${ALIYUN_PASSWORD:-}" ]]; then
  echo 'ACCOUNT_CLOSURE_PREFLIGHT status=error reason=deployment-auth-unavailable' >&2
  exit 1
fi

build_ssh_password_prefix "$VULTR_PASSWORD"
VULTR_AUTH=("${SSH_PASSWORD_PREFIX[@]}")
build_ssh_password_prefix "$ALIYUN_PASSWORD"
ALIYUN_AUTH=("${SSH_PASSWORD_PREFIX[@]}")
SSH_OPTS=(
  -o StrictHostKeyChecking=yes
  -o ConnectTimeout=20
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=3
)
if ! CHECK_SCRIPT_B64="$(base64 <"$CHECK_SCRIPT" 2>/dev/null | tr -d '\n')"; then
  echo 'ACCOUNT_CLOSURE_PREFLIGHT status=error reason=checker-read-failed' >&2
  exit 1
fi

health_ok() {
  local body
  if ! body="$(curl -fsS --max-time 15 "$1" 2>/dev/null)"; then
    return 1
  fi
  printf '%s' "$body" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try { process.exit(JSON.parse(input)?.status === "ok" ? 0 : 1); }
      catch { process.exit(1); }
    });
  ' >/dev/null 2>&1
}

HOLADAY_HEALTH=false
ORANGEBENCH_HEALTH=false
if health_ok 'https://holaday.ai/api/healthz'; then HOLADAY_HEALTH=true; fi
if health_ok 'https://hd-app.orangebench.tech/api/healthz'; then ORANGEBENCH_HEALTH=true; fi
HEALTH_JSON="{\"holaday\":$HOLADAY_HEALTH,\"orangebench\":$ORANGEBENCH_HEALTH}"

if ! ORCHESTRATOR_JSON="$("${VULTR_AUTH[@]}" ssh "${SSH_OPTS[@]}" "$VULTR_HOST" \
  "set -e; cd /opt/holaday-monorepo; printf '%s' '$CHECK_SCRIPT_B64' | base64 --decode | node --input-type=module - collect-orchestrator /opt/holaday-monorepo/apps/orchestrator/.env" 2>/dev/null)"; then
  echo 'ACCOUNT_CLOSURE_PREFLIGHT status=error reason=orchestrator-read-failed' >&2
  exit 1
fi

if ! CN_PAYMENT_JSON="$("${ALIYUN_AUTH[@]}" ssh "${SSH_OPTS[@]}" "$ALIYUN_HOST" \
  "set -e; cd /opt/holaday-cn-payment/src; printf '%s' '$CHECK_SCRIPT_B64' | base64 --decode | node --input-type=module - collect-cn-payment /opt/holaday-cn-payment/src/apps/cn-payment/.env" 2>/dev/null)"; then
  echo 'ACCOUNT_CLOSURE_PREFLIGHT status=error reason=cn-payment-read-failed' >&2
  exit 1
fi

if ! SNAPSHOT="$(node -e '
  try {
    const [health, orchestrator, cnPayment] = process.argv.slice(1).map(JSON.parse);
    process.stdout.write(JSON.stringify({ health, ...orchestrator, ...cnPayment }));
  } catch {
    process.exit(1);
  }
' "$HEALTH_JSON" "$ORCHESTRATOR_JSON" "$CN_PAYMENT_JSON" 2>/dev/null)"; then
  echo 'ACCOUNT_CLOSURE_PREFLIGHT status=error reason=invalid-safe-snapshot' >&2
  exit 1
fi

if ! printf '%s' "$SNAPSHOT" | \
  ACCOUNT_CLOSURE_PREFLIGHT_SYNTHETIC_ALLOWLIST_CONFIRMED="${ACCOUNT_CLOSURE_PREFLIGHT_SYNTHETIC_ALLOWLIST_CONFIRMED:-false}" \
  node "$CHECK_SCRIPT" "$MODE"; then
  exit 1
fi
