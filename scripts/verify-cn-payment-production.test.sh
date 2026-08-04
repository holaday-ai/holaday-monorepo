#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="$(mktemp -d)"
trap 'rm -rf "$HARNESS_DIR"' EXIT

mkdir -p "$HARNESS_DIR/repo/scripts" "$HARNESS_DIR/bin"
cp "$SCRIPT_DIR/verify-cn-payment-production.sh" \
  "$SCRIPT_DIR/cn-payment-production-preflight.mjs" \
  "$HARNESS_DIR/repo/scripts/"

cat > "$HARNESS_DIR/repo/scripts/load-deploy-env.sh" <<'STUB'
#!/usr/bin/env bash
: "${VULTR_PASSWORD:=unit-secret}"
export VULTR_PASSWORD
STUB

cat > "$HARNESS_DIR/repo/scripts/ssh-password-auth.sh" <<'STUB'
#!/usr/bin/env bash
build_ssh_password_prefix() {
  SSH_PASSWORD_PREFIX=(env)
}
STUB

cat > "$HARNESS_DIR/bin/ssh" <<'STUB'
#!/usr/bin/env bash
case "${TEST_SSH_RESULT:-ready}" in
  ready) echo "CN_PAYMENT_PREFLIGHT=ready wechat=ready alipay=ready amountCents=${CN_PAYMENT_PREFLIGHT_EXPECTED_AMOUNT_CENTS:-2900}" ;;
  wechat_down) echo 'CN_PAYMENT_PREFLIGHT=ready wechat=unavailable alipay=ready amountCents=2900' ;;
  wrong_amount) echo 'CN_PAYMENT_PREFLIGHT=ready wechat=ready alipay=ready amountCents=1' ;;
  empty) exit 0 ;;
  error) echo 'CN payment production preflight failed: gateway health check returned HTTP 503' >&2; exit 1 ;;
esac
STUB

chmod +x "$HARNESS_DIR/repo/scripts/verify-cn-payment-production.sh" \
  "$HARNESS_DIR/repo/scripts/load-deploy-env.sh" \
  "$HARNESS_DIR/repo/scripts/ssh-password-auth.sh" \
  "$HARNESS_DIR/bin/ssh"

output="$HARNESS_DIR/ready.out"
PATH="$HARNESS_DIR/bin:$PATH" \
  TEST_SSH_RESULT=ready \
  VULTR_PASSWORD='unit-secret' \
  "$HARNESS_DIR/repo/scripts/verify-cn-payment-production.sh" > "$output" 2>&1
grep -Fq 'CN_PAYMENT_PREFLIGHT=ready wechat=ready alipay=ready amountCents=2900' "$output"
! grep -Fq 'unit-secret' "$output"

output="$HARNESS_DIR/custom-amount.out"
PATH="$HARNESS_DIR/bin:$PATH" \
  TEST_SSH_RESULT=ready \
  CN_PAYMENT_PREFLIGHT_EXPECTED_AMOUNT_CENTS=4900 \
  VULTR_PASSWORD='unit-secret' \
  "$HARNESS_DIR/repo/scripts/verify-cn-payment-production.sh" > "$output" 2>&1
grep -Fq 'CN_PAYMENT_PREFLIGHT=ready wechat=ready alipay=ready amountCents=4900' "$output"

output="$HARNESS_DIR/invalid-amount.out"
if PATH="$HARNESS_DIR/bin:$PATH" \
  TEST_SSH_RESULT=ready \
  CN_PAYMENT_PREFLIGHT_EXPECTED_AMOUNT_CENTS=invalid \
  VULTR_PASSWORD='unit-secret' \
  "$HARNESS_DIR/repo/scripts/verify-cn-payment-production.sh" > "$output" 2>&1; then
  echo 'FAIL: CN payment wrapper accepted an invalid expected amount' >&2
  exit 1
fi

for result in wechat_down wrong_amount empty error; do
  output="$HARNESS_DIR/$result.out"
  if PATH="$HARNESS_DIR/bin:$PATH" \
    TEST_SSH_RESULT="$result" \
    VULTR_PASSWORD='unit-secret' \
    "$HARNESS_DIR/repo/scripts/verify-cn-payment-production.sh" > "$output" 2>&1; then
    echo "FAIL: CN payment wrapper accepted $result verifier output" >&2
    exit 1
  fi
  ! grep -Fq 'unit-secret' "$output"
done

echo 'PASS: CN payment deployment preflight fails closed unless both providers create production orders'
