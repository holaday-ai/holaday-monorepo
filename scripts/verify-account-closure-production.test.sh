#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="$(mktemp -d)"
trap 'rm -rf "$HARNESS_DIR"' EXIT

mkdir -p "$HARNESS_DIR/repo/scripts" "$HARNESS_DIR/bin"
cp "$SCRIPT_DIR/verify-account-closure-production.sh" \
  "$SCRIPT_DIR/account-closure-rollout-preflight.mjs" \
  "$HARNESS_DIR/repo/scripts/"

cat > "$HARNESS_DIR/repo/scripts/load-deploy-env.sh" <<'STUB'
#!/usr/bin/env bash
: "${VULTR_PASSWORD:=unit-vultr-secret}"
: "${ALIYUN_PASSWORD:=unit-aliyun-secret}"
export VULTR_PASSWORD ALIYUN_PASSWORD
echo 'source-private-diagnostic' >&2
STUB

cat > "$HARNESS_DIR/repo/scripts/ssh-password-auth.sh" <<'STUB'
#!/usr/bin/env bash
build_ssh_password_prefix() {
  SSH_PASSWORD_PREFIX=(env)
}
STUB

cat > "$HARNESS_DIR/bin/curl" <<'STUB'
#!/usr/bin/env bash
if [[ "${TEST_HEALTH:-ready}" == "ready" ]]; then
  printf '%s\n' '{"status":"ok","ignored":"private-health-payload"}'
else
  printf '%s\n' '{"status":"degraded","ignored":"private-health-payload"}'
fi
STUB

cat > "$HARNESS_DIR/bin/ssh" <<'STUB'
#!/usr/bin/env bash
echo 'ssh-private-diagnostic' >&2
if [[ "$*" == *"207.148.70.106"* ]]; then
  case "${TEST_PROFILE:-dormant}" in
    dormant)
      printf '%s\n' '{"orchestrator":{"processCount":1,"uid":998,"rssBytes":377487360,"accountClosureEnabled":false,"accountClosureWorkerEnabled":false,"legacyFeedbackSanitized":false,"legacyAnalyticsLogsSanitized":false,"hmacPresent":false,"hmacLength":0,"allowlistCount":0,"privateEmailReady":false,"workerCount":0,"workerUid":null,"workerRssBytes":0,"workerListenerCount":0,"workerManaged":true,"workerConfigurationMatchesOrchestrator":true,"configurationMatchesFile":true,"ignoredSecret":"remote-private-secret"},"database":{"verified":true,"closureTableCount":5,"queueTotal":0}}'
      ;;
    ready)
      printf '%s\n' '{"orchestrator":{"processCount":1,"uid":998,"rssBytes":377487360,"accountClosureEnabled":false,"accountClosureWorkerEnabled":false,"legacyFeedbackSanitized":true,"legacyAnalyticsLogsSanitized":true,"hmacPresent":true,"hmacLength":40,"allowlistCount":1,"privateEmailReady":true,"workerCount":0,"workerUid":null,"workerRssBytes":0,"workerListenerCount":0,"workerManaged":true,"workerConfigurationMatchesOrchestrator":true,"configurationMatchesFile":true,"ignoredSecret":"remote-private-secret"},"database":{"verified":true,"closureTableCount":5,"queueTotal":0}}'
      ;;
    running)
      printf '%s\n' '{"orchestrator":{"processCount":1,"uid":998,"rssBytes":377487360,"accountClosureEnabled":true,"accountClosureWorkerEnabled":true,"legacyFeedbackSanitized":true,"legacyAnalyticsLogsSanitized":true,"hmacPresent":true,"hmacLength":40,"allowlistCount":1,"privateEmailReady":true,"workerCount":1,"workerUid":998,"workerRssBytes":492830720,"workerListenerCount":0,"workerManaged":true,"workerConfigurationMatchesOrchestrator":true,"configurationMatchesFile":true,"ignoredSecret":"remote-private-secret"},"database":{"verified":true,"closureTableCount":5,"queueTotal":0}}'
      ;;
  esac
else
  printf '%s\n' '{"cnPayment":{"processCount":1,"configurationMatchesFile":true,"accountClosureSmsEnabled":true,"credentialsPresent":true,"signPresent":true,"verifyTemplatePresent":true,"completeTemplatePresent":true,"ignoredTemplate":"SMS_PRIVATE_TEMPLATE"}}'
fi
STUB

chmod +x "$HARNESS_DIR/repo/scripts/verify-account-closure-production.sh" \
  "$HARNESS_DIR/repo/scripts/load-deploy-env.sh" \
  "$HARNESS_DIR/repo/scripts/ssh-password-auth.sh" \
  "$HARNESS_DIR/bin/curl" \
  "$HARNESS_DIR/bin/ssh"

output="$HARNESS_DIR/dormant.out"
PATH="$HARNESS_DIR/bin:$PATH" \
  TEST_PROFILE=dormant \
  "$HARNESS_DIR/repo/scripts/verify-account-closure-production.sh" dormant >"$output" 2>&1
if ! grep -Fq 'ACCOUNT_CLOSURE_PREFLIGHT mode=dormant status=ready' "$output"; then
  echo 'FAIL: dormant profile did not pass' >&2
  sed -E 's/(unit|remote|SMS)_[A-Za-z0-9_-]+/[redacted]/g' "$output" >&2
  exit 1
fi

output="$HARNESS_DIR/canary-ready.out"
PATH="$HARNESS_DIR/bin:$PATH" \
  TEST_PROFILE=ready \
  ACCOUNT_CLOSURE_PREFLIGHT_SYNTHETIC_ALLOWLIST_CONFIRMED=true \
  "$HARNESS_DIR/repo/scripts/verify-account-closure-production.sh" canary-ready >"$output" 2>&1
grep -Fq 'ACCOUNT_CLOSURE_PREFLIGHT mode=canary-ready status=ready' "$output"

output="$HARNESS_DIR/confirmation-missing.out"
if PATH="$HARNESS_DIR/bin:$PATH" \
  TEST_PROFILE=ready \
  "$HARNESS_DIR/repo/scripts/verify-account-closure-production.sh" canary-ready >"$output" 2>&1; then
  echo 'FAIL: canary-ready accepted an unconfirmed synthetic allowlist' >&2
  exit 1
fi
grep -Fq 'failed=single-synthetic-allowlist' "$output"

output="$HARNESS_DIR/canary-running.out"
PATH="$HARNESS_DIR/bin:$PATH" \
  TEST_PROFILE=running \
  ACCOUNT_CLOSURE_PREFLIGHT_SYNTHETIC_ALLOWLIST_CONFIRMED=true \
  "$HARNESS_DIR/repo/scripts/verify-account-closure-production.sh" canary-running >"$output" 2>&1
grep -Fq 'ACCOUNT_CLOSURE_PREFLIGHT mode=canary-running status=ready' "$output"

output="$HARNESS_DIR/health-failure.out"
if PATH="$HARNESS_DIR/bin:$PATH" \
  TEST_PROFILE=dormant \
  TEST_HEALTH=degraded \
  "$HARNESS_DIR/repo/scripts/verify-account-closure-production.sh" dormant >"$output" 2>&1; then
  echo 'FAIL: dormant accepted degraded public health' >&2
  exit 1
fi
grep -Fq 'failed=public-health' "$output"

output="$HARNESS_DIR/invalid-mode.out"
if PATH="$HARNESS_DIR/bin:$PATH" \
  "$HARNESS_DIR/repo/scripts/verify-account-closure-production.sh" invalid >"$output" 2>&1; then
  echo 'FAIL: wrapper accepted an invalid mode' >&2
  exit 1
fi

for value in \
  unit-vultr-secret \
  unit-aliyun-secret \
  remote-private-secret \
  SMS_PRIVATE_TEMPLATE \
  private-health-payload \
  source-private-diagnostic \
  ssh-private-diagnostic; do
  if grep -RFq "$value" "$HARNESS_DIR"/*.out; then
    echo "FAIL: sensitive probe value leaked: $value" >&2
    exit 1
  fi
done

echo 'PASS: account closure production preflight is mode-aware, fail-closed, and privacy-safe'
