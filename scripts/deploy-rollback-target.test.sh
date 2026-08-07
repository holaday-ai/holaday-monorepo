#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_SCRIPT="$SCRIPT_DIR/deploy-current.sh"
AKSHARE_SCRIPT="$SCRIPT_DIR/deploy-akshare-mcp.sh"
ORCHESTRATOR_SCRIPT="$SCRIPT_DIR/deploy-orchestrator.sh"
CN_PAYMENT_SCRIPT="$SCRIPT_DIR/deploy-cn-payment.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_event_order() {
  local event_log="$1"
  shift
  local previous_line=0 event line

  for event in "$@"; do
    line="$(grep -nFx "$event" "$event_log" | head -1 | cut -d: -f1 || true)"
    [[ "$line" =~ ^[1-9][0-9]*$ ]] || fail "missing event '$event' in $(tr '\n' ' ' < "$event_log")"
    (( line > previous_line )) || fail "event '$event' ran out of order"
    previous_line="$line"
  done
}

write_common_deploy_stubs() {
  local harness_dir="$1"

  mkdir -p "$harness_dir/repo/scripts" "$harness_dir/bin"
  cat > "$harness_dir/repo/scripts/load-deploy-env.sh" <<'STUB'
#!/usr/bin/env bash
: "${VULTR_PASSWORD:=unit-secret}"
export VULTR_PASSWORD
STUB
  cat > "$harness_dir/repo/scripts/ssh-password-auth.sh" <<'STUB'
#!/usr/bin/env bash
build_ssh_password_prefix() {
  SSH_PASSWORD_PREFIX=(env)
}
STUB
  cat > "$harness_dir/repo/scripts/verify-paypal-production.sh" <<'STUB'
#!/usr/bin/env bash
echo "paypal" >> "$TEST_EVENT_LOG"
STUB
  cat > "$harness_dir/repo/scripts/verify-cn-payment-production.sh" <<'STUB'
#!/usr/bin/env bash
echo "cn-payment-preflight" >> "$TEST_EVENT_LOG"
STUB
  chmod +x "$harness_dir/repo/scripts/load-deploy-env.sh" \
    "$harness_dir/repo/scripts/ssh-password-auth.sh" \
    "$harness_dir/repo/scripts/verify-cn-payment-production.sh" \
    "$harness_dir/repo/scripts/verify-paypal-production.sh"
}

write_deploy_current_harness() {
  local harness_dir="$1"

  write_common_deploy_stubs "$harness_dir"
  cp "$CURRENT_SCRIPT" "$harness_dir/repo/scripts/deploy-current.sh"
  chmod +x "$harness_dir/repo/scripts/deploy-current.sh"

  cat > "$harness_dir/repo/scripts/deploy-akshare-mcp.sh" <<'STUB'
#!/usr/bin/env bash
if [[ "${AKSHARE_ROLLBACK_ONLY:-0}" == "1" ]]; then
  echo "akshare-rollback" >> "$TEST_EVENT_LOG"
  [[ "$AKSHARE_ROLLBACK_HEAD" == "1111111111111111111111111111111111111111" ]] || exit 19
  exit "${TEST_AKSHARE_ROLLBACK_RC:-0}"
fi
echo "akshare" >> "$TEST_EVENT_LOG"
STUB
  chmod +x "$harness_dir/repo/scripts/deploy-akshare-mcp.sh"

  cat > "$harness_dir/repo/scripts/deploy-orchestrator.sh" <<'STUB'
#!/usr/bin/env bash
echo "orchestrator" >> "$TEST_EVENT_LOG"
if [[ "${TEST_EXPECT_DIRECT_ORCHESTRATOR:-0}" == "1" ]]; then
  [[ "${CN_PAYMENT_PREFLIGHT_VERIFIED:-0}" != "1" ]]
  [[ "${PAYPAL_PREFLIGHT_VERIFIED:-0}" != "1" ]]
else
  [[ "${CN_PAYMENT_PREFLIGHT_VERIFIED:-0}" == "1" ]]
  [[ "${PAYPAL_PREFLIGHT_VERIFIED:-0}" == "1" ]]
fi
exit "${TEST_ORCHESTRATOR_RC:-0}"
STUB
  chmod +x "$harness_dir/repo/scripts/deploy-orchestrator.sh"

  cat > "$harness_dir/repo/scripts/deploy-cn-payment.sh" <<'STUB'
#!/usr/bin/env bash
echo "cn-payment-deploy" >> "$TEST_EVENT_LOG"
if [[ "${TEST_CN_PAYMENT_RC:-0}" == "0" ]]; then
  echo "cn-payment-preflight" >> "$TEST_EVENT_LOG"
fi
exit "${TEST_CN_PAYMENT_RC:-0}"
STUB
  chmod +x "$harness_dir/repo/scripts/deploy-cn-payment.sh"

  cat > "$harness_dir/repo/scripts/deploy-spa.sh" <<'STUB'
#!/usr/bin/env bash
echo "spa" >> "$TEST_EVENT_LOG"
STUB
  chmod +x "$harness_dir/repo/scripts/deploy-spa.sh"

  cat > "$harness_dir/bin/git" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  status|fetch|reset) exit 0 ;;
  rev-parse)
    if [[ "${2:-}" == "--short" ]]; then
      echo "2222222"
    else
      echo "2222222222222222222222222222222222222222"
    fi
    ;;
  log) echo "candidate release" ;;
  *) exit 0 ;;
esac
STUB

  cat > "$harness_dir/bin/ssh" <<'STUB'
#!/usr/bin/env bash
command_text="${!#}"
if [[ "$command_text" == *"git rev-parse HEAD"* ]]; then
  echo "capture-head" >> "$TEST_EVENT_LOG"
  echo "1111111111111111111111111111111111111111"
elif [[ "$command_text" == *"merge-base --is-ancestor"* ]]; then
  echo "preflight" >> "$TEST_EVENT_LOG"
  [[ "$command_text" == *"1111111111111111111111111111111111111111"* ]] || exit 9
  exit "${TEST_PREFLIGHT_RC:-0}"
fi
STUB
  chmod +x "$harness_dir/bin/git" "$harness_dir/bin/ssh"

  cat > "$harness_dir/bin/curl" <<'STUB'
#!/usr/bin/env bash
output_file=""
while (($#)); do
  if [[ "$1" == "-o" ]]; then
    output_file="$2"
    shift 2
    continue
  fi
  shift
done
printf '%s' '{"status":"ok"}' > "$output_file"
printf '200'
STUB
  chmod +x "$harness_dir/bin/curl"
}

test_deploy_current_preflights_before_akshare() {
  local harness_dir event_log output refuse_rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_deploy_current_harness "$harness_dir"

  if ! PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    VULTR_PASSWORD="unit-secret" \
    BRANCH="codex/release-candidate" \
    "$harness_dir/repo/scripts/deploy-current.sh" orchestrator > "$output" 2>&1; then
    cat "$output" >&2
    fail "deploy-current orchestrator harness should complete"
  fi

  assert_event_order "$event_log" capture-head preflight paypal akshare orchestrator cn-payment-deploy cn-payment-preflight
  ! grep -Fq "unit-secret" "$output" || fail "deploy-current must not print credentials"

  : > "$event_log"
  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_PREFLIGHT_RC=1 \
    ALLOW_DIVERGENT_DEPLOY=0 \
    VULTR_PASSWORD="unit-secret" \
    BRANCH="codex/release-candidate" \
    "$harness_dir/repo/scripts/deploy-current.sh" akshare > "$output" 2>&1
  refuse_rc=$?
  set -e
  (( refuse_rc == 3 )) || fail "deploy-current must refuse divergence without an override"
  assert_event_order "$event_log" capture-head preflight
  ! grep -Fxq "akshare" "$event_log" || fail "deploy-current divergence gate must run before AKShare"

  : > "$event_log"
  if ! PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_PREFLIGHT_RC=1 \
    ALLOW_DIVERGENT_DEPLOY=1 \
    VULTR_PASSWORD="unit-secret" \
    BRANCH="codex/release-candidate" \
    "$harness_dir/repo/scripts/deploy-current.sh" akshare > "$output" 2>&1; then
    fail "deploy-current must preserve the explicit divergent cutover override"
  fi
  assert_event_order "$event_log" capture-head preflight akshare
  rm -rf "$harness_dir"
}

test_combined_orchestrator_failure_rolls_back_akshare() {
  local rollback_rc="$1"
  local expected_rc="$2"
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_deploy_current_harness "$harness_dir"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_ORCHESTRATOR_RC=7 \
    TEST_AKSHARE_ROLLBACK_RC="$rollback_rc" \
    VULTR_PASSWORD="unit-secret" \
    BRANCH="codex/release-candidate" \
    "$harness_dir/repo/scripts/deploy-current.sh" orchestrator > "$output" 2>&1
  rc=$?
  set -e

  (( rc == expected_rc )) || fail "combined rollback exit: got $rc, want $expected_rc"
  assert_event_order "$event_log" capture-head preflight paypal akshare orchestrator akshare-rollback
  if (( rollback_rc == 0 )); then
    grep -Fq "AKShare restored after Orchestrator deploy failure" "$output" \
      || fail "combined deploy must report successful AKShare restoration"
  else
    grep -Fq "combined rollback is incomplete" "$output" \
      || fail "combined deploy must surface AKShare rollback failure"
  fi
  ! grep -Fq "unit-secret" "$output" || fail "combined rollback must not print credentials"
  rm -rf "$harness_dir"
}

test_cn_payment_deploy_failure_stops_before_preflight() {
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_deploy_current_harness "$harness_dir"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_CN_PAYMENT_RC=23 \
    VULTR_PASSWORD="unit-secret" \
    BRANCH="codex/release-candidate" \
    "$harness_dir/repo/scripts/deploy-current.sh" orchestrator > "$output" 2>&1
  rc=$?
  set -e

  (( rc == 23 )) || fail "CN payment deploy failure exit: got $rc, want 23"
  assert_event_order "$event_log" capture-head preflight paypal akshare orchestrator cn-payment-deploy
  ! grep -Fxq "cn-payment-preflight" "$event_log" \
    || fail "CN payment preflight must not run after its deploy failed"
  rm -rf "$harness_dir"
}

test_application_deploy_skips_unrelated_service_restarts() {
  local harness_dir event_log output
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_deploy_current_harness "$harness_dir"

  if ! PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_EXPECT_DIRECT_ORCHESTRATOR=1 \
    VULTR_PASSWORD="unit-secret" \
    BRANCH="codex/release-candidate" \
    "$harness_dir/repo/scripts/deploy-current.sh" application > "$output" 2>&1; then
    cat "$output" >&2
    fail "application deploy harness should complete"
  fi

  assert_event_order "$event_log" capture-head preflight orchestrator spa
  ! grep -Fxq "paypal" "$event_log" \
    || fail "application deploy must let the orchestrator run its own payment preflight"
  ! grep -Fxq "akshare" "$event_log" \
    || fail "application deploy must not restart AKShare"
  ! grep -Fxq "cn-payment-deploy" "$event_log" \
    || fail "application deploy must not restart CN payment"
  ! grep -Fq "unit-secret" "$output" \
    || fail "application deploy must not print credentials"
  rm -rf "$harness_dir"
}

test_akshare_divergence_override() {
  local allow_divergence="$1"
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_common_deploy_stubs "$harness_dir"
  cp "$AKSHARE_SCRIPT" "$harness_dir/repo/scripts/deploy-akshare-mcp.sh"
  chmod +x "$harness_dir/repo/scripts/deploy-akshare-mcp.sh"
  write_akshare_ssh_stub "$harness_dir"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_LIVE_HEAD="1111111111111111111111111111111111111111" \
    TEST_FAIL_PHASE="none" \
    TEST_PREFLIGHT_RC=1 \
    ALLOW_DIVERGENT_DEPLOY="$allow_divergence" \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-akshare-mcp.sh" \
      "codex/release-candidate" > "$output" 2>&1
  rc=$?
  set -e

  if [[ "$allow_divergence" == "1" ]]; then
    (( rc == 0 )) || fail "explicit divergent deploy override should preserve cutover behavior"
    assert_event_order "$event_log" capture-head preflight reset-new install-new smoke
  else
    (( rc == 3 )) || fail "divergent deploy without override must stop with exit 3"
    assert_event_order "$event_log" capture-head preflight
    ! grep -Fxq "reset-new" "$event_log" || fail "divergence refusal must happen before reset"
  fi
  ! grep -Fq "unit-secret" "$output" || fail "divergence handling must not print credentials"
  rm -rf "$harness_dir"
}

write_akshare_ssh_stub() {
  local harness_dir="$1"

  cat > "$harness_dir/bin/ssh" <<'STUB'
#!/usr/bin/env bash
command_text="${!#}"

if [[ "$command_text" == *"git rev-parse HEAD"* ]]; then
  echo "capture-head" >> "$TEST_EVENT_LOG"
  echo "$TEST_LIVE_HEAD"
elif [[ "$command_text" == *"merge-base --is-ancestor"* ]]; then
  echo "preflight" >> "$TEST_EVENT_LOG"
  [[ "$command_text" == *"$TEST_LIVE_HEAD"* ]] || exit 9
  exit "${TEST_PREFLIGHT_RC:-0}"
elif [[ "$command_text" == *"git reset --hard"* ]]; then
  if [[ "$command_text" == *"$TEST_LIVE_HEAD"* ]]; then
    [[ "$command_text" == *"pm2 startOrReload ecosystem.config.cjs"* ]] || exit 10
    echo "rollback-restart" >> "$TEST_EVENT_LOG"
  else
    echo "reset-new" >> "$TEST_EVENT_LOG"
  fi
elif [[ "$command_text" == *"git cat-file -e"* ]]; then
  exit 0
elif [[ "$command_text" == *"pip install"* ]]; then
  echo "install-new" >> "$TEST_EVENT_LOG"
  [[ "$TEST_FAIL_PHASE" != "install" ]] || exit 42
elif [[ "$command_text" == *"smoke-akshare-mcp.sh"* ]]; then
  echo "smoke" >> "$TEST_EVENT_LOG"
  if [[ "$TEST_FAIL_PHASE" == "smoke" ]]; then
    echo "upstream unavailable"
  else
    echo "akshare-mcp smoke OK"
  fi
elif [[ "$command_text" == *"pm2 logs"* ]]; then
  exit 0
fi
STUB
  chmod +x "$harness_dir/bin/ssh"
}

test_akshare_failure_restores_live_head() {
  local fail_phase="$1"
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_common_deploy_stubs "$harness_dir"
  cp "$AKSHARE_SCRIPT" "$harness_dir/repo/scripts/deploy-akshare-mcp.sh"
  chmod +x "$harness_dir/repo/scripts/deploy-akshare-mcp.sh"
  write_akshare_ssh_stub "$harness_dir"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_LIVE_HEAD="1111111111111111111111111111111111111111" \
    TEST_FAIL_PHASE="$fail_phase" \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-akshare-mcp.sh" \
      "codex/release-candidate" > "$output" 2>&1
  rc=$?
  set -e

  (( rc != 0 )) || fail "AKShare $fail_phase failure must fail the deploy"
  if [[ "$fail_phase" == "install" ]]; then
    assert_event_order "$event_log" capture-head preflight reset-new install-new rollback-restart
  else
    assert_event_order "$event_log" capture-head preflight reset-new install-new smoke rollback-restart
  fi
  ! grep -Fq "unit-secret" "$output" || fail "AKShare deploy must not print credentials"
  rm -rf "$harness_dir"
}

test_akshare_rollback_only_restores_without_deploying() {
  local harness_dir event_log output
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_common_deploy_stubs "$harness_dir"
  cp "$AKSHARE_SCRIPT" "$harness_dir/repo/scripts/deploy-akshare-mcp.sh"
  chmod +x "$harness_dir/repo/scripts/deploy-akshare-mcp.sh"
  write_akshare_ssh_stub "$harness_dir"

  if ! PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_LIVE_HEAD="1111111111111111111111111111111111111111" \
    TEST_FAIL_PHASE="none" \
    AKSHARE_ROLLBACK_ONLY=1 \
    AKSHARE_ROLLBACK_HEAD="1111111111111111111111111111111111111111" \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-akshare-mcp.sh" > "$output" 2>&1; then
    cat "$output" >&2
    fail "AKShare rollback-only mode should restore the requested release"
  fi

  assert_event_order "$event_log" rollback-restart
  ! grep -Fxq "reset-new" "$event_log" || fail "rollback-only mode must not deploy a new checkout"
  ! grep -Fxq "install-new" "$event_log" || fail "rollback-only mode must not run the candidate install"
  ! grep -Fxq "smoke" "$event_log" || fail "rollback-only mode must not run the candidate smoke"
  rm -rf "$harness_dir"
}

test_deploy_current_preflights_before_akshare
test_combined_orchestrator_failure_rolls_back_akshare 0 7
test_combined_orchestrator_failure_rolls_back_akshare 29 2
test_cn_payment_deploy_failure_stops_before_preflight
test_application_deploy_skips_unrelated_service_restarts
test_akshare_rollback_only_restores_without_deploying
test_akshare_failure_restores_live_head install
test_akshare_failure_restores_live_head smoke
test_akshare_divergence_override 0
test_akshare_divergence_override 1

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
grep -Fq 'deploy-cn-payment.sh' "$CURRENT_SCRIPT" \
  || fail "combined deploy must publish the CN gateway before its production preflight"
[[ -f "$CN_PAYMENT_SCRIPT" ]] || fail "CN payment deploy script is missing"
for secure_script in "$CURRENT_SCRIPT" "$AKSHARE_SCRIPT" "$ORCHESTRATOR_SCRIPT"; do
  grep -Fq 'StrictHostKeyChecking=yes' "$secure_script" \
    || fail "$(basename "$secure_script") must enforce known_hosts verification"
  ! grep -Fq 'StrictHostKeyChecking=no' "$secure_script" \
    || fail "$(basename "$secure_script") must not disable SSH host verification"
done

echo "PASS: combined deploy preserves the pre-release rollback target"
