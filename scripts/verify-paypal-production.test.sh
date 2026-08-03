#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="$(mktemp -d)"
trap 'rm -rf "$HARNESS_DIR"' EXIT

mkdir -p "$HARNESS_DIR/repo/scripts" "$HARNESS_DIR/bin"
cp "$SCRIPT_DIR/verify-paypal-production.sh" \
  "$SCRIPT_DIR/paypal-production-preflight.mjs" \
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
  ready) echo 'PAYPAL_PREFLIGHT=ready environment=live' ;;
  disabled) echo 'PAYPAL_PREFLIGHT=disabled environment=sandbox' ;;
  empty) exit 0 ;;
  error) echo 'PayPal production preflight failed: OAuth returned HTTP 401' >&2; exit 1 ;;
esac
STUB

chmod +x "$HARNESS_DIR/repo/scripts/verify-paypal-production.sh" \
  "$HARNESS_DIR/repo/scripts/load-deploy-env.sh" \
  "$HARNESS_DIR/repo/scripts/ssh-password-auth.sh" \
  "$HARNESS_DIR/bin/ssh"

for result in ready disabled; do
  output="$HARNESS_DIR/$result.out"
  PATH="$HARNESS_DIR/bin:$PATH" \
    TEST_SSH_RESULT="$result" \
    VULTR_PASSWORD='unit-secret' \
    "$HARNESS_DIR/repo/scripts/verify-paypal-production.sh" > "$output" 2>&1
  grep -Fq "PAYPAL_PREFLIGHT=$result" "$output"
  ! grep -Fq 'unit-secret' "$output"
done

for result in empty error; do
  output="$HARNESS_DIR/$result.out"
  if PATH="$HARNESS_DIR/bin:$PATH" \
    TEST_SSH_RESULT="$result" \
    VULTR_PASSWORD='unit-secret' \
    "$HARNESS_DIR/repo/scripts/verify-paypal-production.sh" > "$output" 2>&1; then
    echo "FAIL: PayPal wrapper accepted $result verifier output" >&2
    exit 1
  fi
  ! grep -Fq 'unit-secret' "$output"
done

echo 'PASS: PayPal deployment preflight fails closed on empty or invalid remote checks'
