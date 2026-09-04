#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_SCRIPT="$SCRIPT_DIR/deploy-current.sh"
AKSHARE_SCRIPT="$SCRIPT_DIR/deploy-akshare-mcp.sh"
ORCHESTRATOR_SCRIPT="$SCRIPT_DIR/deploy-orchestrator.sh"
AUTO_SMOKE_SUMMARY_SCRIPT="$SCRIPT_DIR/auto-smoke-summary.sh"
DEPLOY_SAFETY_HELPER="$SCRIPT_DIR/team-task-lifecycle-deploy-safety.mjs"
QWEN_INITIAL_CUTOVER_POLICY_HELPER="$SCRIPT_DIR/qwen-initial-cutover-policy.mjs"
CN_PAYMENT_SCRIPT="$SCRIPT_DIR/deploy-cn-payment.sh"
export DEPLOY_REMOTE_RETRY_SLEEP="${DEPLOY_REMOTE_RETRY_SLEEP:-0}"

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

assert_event_count() {
  local event_log="$1"
  local event="$2"
  local expected_count="$3"
  local actual_count

  actual_count="$(grep -cFx "$event" "$event_log" || true)"
  (( actual_count == expected_count )) \
    || fail "event '$event' count: got $actual_count, want $expected_count"
}

write_common_deploy_stubs() {
  local harness_dir="$1"

  mkdir -p "$harness_dir/repo/scripts" "$harness_dir/bin"
  cp "$QWEN_INITIAL_CUTOVER_POLICY_HELPER" \
    "$harness_dir/repo/scripts/qwen-initial-cutover-policy.mjs"
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
paypal_attempts="$(grep -cFx "paypal" "$TEST_EVENT_LOG" || true)"
if (( paypal_attempts <= ${TEST_PAYPAL_FAILURES:-0} )); then
  exit 71
fi
STUB
  cat > "$harness_dir/repo/scripts/verify-cn-payment-production.sh" <<'STUB'
#!/usr/bin/env bash
echo "cn-payment-preflight" >> "$TEST_EVENT_LOG"
cn_payment_attempts="$(grep -cFx "cn-payment-preflight" "$TEST_EVENT_LOG" || true)"
if (( cn_payment_attempts <= ${TEST_CN_PAYMENT_PREFLIGHT_FAILURES:-0} )); then
  exit 72
fi
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
  capture_attempts="$(grep -cFx "capture-head" "$TEST_EVENT_LOG" || true)"
  if (( capture_attempts <= ${TEST_CAPTURE_FAILURES:-0} )); then
    exit 255
  fi
  echo "1111111111111111111111111111111111111111"
elif [[ "$command_text" == *"merge-base --is-ancestor"* ]]; then
  echo "preflight" >> "$TEST_EVENT_LOG"
  [[ "$command_text" == *"1111111111111111111111111111111111111111"* ]] || exit 9
  preflight_attempts="$(grep -cFx "preflight" "$TEST_EVENT_LOG" || true)"
  if (( preflight_attempts <= ${TEST_RELEASE_PREFLIGHT_FAILURES:-0} )); then
    exit 255
  fi
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

test_deploy_current_retries_transient_release_ssh() {
  local harness_dir event_log output
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_deploy_current_harness "$harness_dir"

  if ! PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_CAPTURE_FAILURES=1 \
    TEST_RELEASE_PREFLIGHT_FAILURES=1 \
    DEPLOY_REMOTE_RETRIES=2 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    VULTR_PASSWORD="unit-secret" \
    BRANCH="codex/release-candidate" \
    "$harness_dir/repo/scripts/deploy-current.sh" akshare > "$output" 2>&1; then
    cat "$output" >&2
    fail "deploy-current must recover from one transient SSH failure per release gate"
  fi

  assert_event_count "$event_log" capture-head 2
  assert_event_count "$event_log" preflight 2
  assert_event_order "$event_log" capture-head preflight akshare
  ! grep -Fq "unit-secret" "$output" \
    || fail "release-gate retries must not print credentials"
  rm -rf "$harness_dir"
}

test_deploy_current_retries_transient_paypal_preflight() {
  local harness_dir event_log output
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_deploy_current_harness "$harness_dir"

  if ! PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_PAYPAL_FAILURES=1 \
    DEPLOY_REMOTE_RETRIES=2 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    VULTR_PASSWORD="unit-secret" \
    BRANCH="codex/release-candidate" \
    "$harness_dir/repo/scripts/deploy-current.sh" orchestrator > "$output" 2>&1; then
    cat "$output" >&2
    fail "deploy-current must recover from a transient PayPal production preflight failure"
  fi

  assert_event_count "$event_log" paypal 2
  assert_event_order "$event_log" capture-head preflight paypal akshare orchestrator
  ! grep -Fq "unit-secret" "$output" \
    || fail "PayPal preflight retries must not print credentials"
  rm -rf "$harness_dir"
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

test_deploy_current_initializes_ssh_for_explicit_rollback_head() {
  local harness_dir event_log output
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_deploy_current_harness "$harness_dir"

  if ! PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    RELEASE_ROLLBACK_HEAD="1111111111111111111111111111111111111111" \
    VULTR_PASSWORD="unit-secret" \
    BRANCH="codex/release-candidate" \
    "$harness_dir/repo/scripts/deploy-current.sh" akshare > "$output" 2>&1; then
    cat "$output" >&2
    fail "deploy-current must initialize SSH before preflighting an explicit rollback HEAD"
  fi

  assert_event_order "$event_log" preflight akshare
  ! grep -Fxq "capture-head" "$event_log" \
    || fail "an explicit rollback HEAD must not be captured again"
  ! grep -Fq "unit-secret" "$output" \
    || fail "explicit rollback handling must not print credentials"
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

test_orchestrator_retries_transient_payment_preflights() {
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_common_deploy_stubs "$harness_dir"
  cp "$ORCHESTRATOR_SCRIPT" "$harness_dir/repo/scripts/deploy-orchestrator.sh"
  cp "$AUTO_SMOKE_SUMMARY_SCRIPT" "$harness_dir/repo/scripts/auto-smoke-summary.sh"
  cp "$DEPLOY_SAFETY_HELPER" "$harness_dir/repo/scripts/team-task-lifecycle-deploy-safety.mjs"
  : > "$harness_dir/repo/scripts/orchestrator-runtime.sh"
  : > "$harness_dir/repo/scripts/start-orchestrator-production.sh"
  : > "$harness_dir/repo/scripts/start-account-closure-worker-production.sh"
  chmod +x "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
    "$harness_dir/repo/scripts/orchestrator-runtime.sh" \
    "$harness_dir/repo/scripts/start-orchestrator-production.sh" \
    "$harness_dir/repo/scripts/start-account-closure-worker-production.sh"

  cat > "$harness_dir/bin/ssh" <<'STUB'
#!/usr/bin/env bash
echo "remote-stage" >> "$TEST_EVENT_LOG"
exit 88
STUB
  cat > "$harness_dir/bin/scp" <<'STUB'
#!/usr/bin/env bash
echo "remote-upload" >> "$TEST_EVENT_LOG"
exit 89
STUB
  chmod +x "$harness_dir/bin/ssh" "$harness_dir/bin/scp"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_CN_PAYMENT_PREFLIGHT_FAILURES=1 \
    TEST_PAYPAL_FAILURES=1 \
    DEPLOY_REMOTE_RETRIES=2 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
      "codex/release-candidate" > "$output" 2>&1
  rc=$?
  set -e

  (( rc == 88 )) || fail "orchestrator should reach the first remote deploy step after recovered payment preflights"
  assert_event_count "$event_log" cn-payment-preflight 2
  assert_event_count "$event_log" paypal 2
  assert_event_count "$event_log" remote-stage 2
  assert_event_order "$event_log" cn-payment-preflight paypal remote-stage
  ! grep -Fq "unit-secret" "$output" \
    || fail "orchestrator preflight retries must not print credentials"
  rm -rf "$harness_dir"
}

write_orchestrator_gate_retry_harness() {
  local harness_dir="$1"

  write_common_deploy_stubs "$harness_dir"
  cp "$ORCHESTRATOR_SCRIPT" "$harness_dir/repo/scripts/deploy-orchestrator.sh"
  cp "$AUTO_SMOKE_SUMMARY_SCRIPT" "$harness_dir/repo/scripts/auto-smoke-summary.sh"
  cp "$DEPLOY_SAFETY_HELPER" "$harness_dir/repo/scripts/team-task-lifecycle-deploy-safety.mjs"
  : > "$harness_dir/repo/scripts/orchestrator-runtime.sh"
  : > "$harness_dir/repo/scripts/start-orchestrator-production.sh"
  : > "$harness_dir/repo/scripts/start-account-closure-worker-production.sh"
  chmod +x "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
    "$harness_dir/repo/scripts/orchestrator-runtime.sh" \
    "$harness_dir/repo/scripts/start-orchestrator-production.sh" \
    "$harness_dir/repo/scripts/start-account-closure-worker-production.sh"

  cat > "$harness_dir/bin/scp" <<'STUB'
#!/usr/bin/env bash
echo "runtime-upload" >> "$TEST_EVENT_LOG"
exit 0
STUB
  cat > "$harness_dir/bin/ssh" <<'STUB'
#!/usr/bin/env bash
command_text="${!#}"

if [[ "$command_text" == *"git reset --hard '1111111111111111111111111111111111111111'"* ]]; then
  echo "rollback-build" >> "$TEST_EVENT_LOG"
  exit 0
elif [[ "$command_text" == *"git reset --hard origin/codex/release-candidate"* ]]; then
  echo "reset-new" >> "$TEST_EVENT_LOG"
  exit "${TEST_RESET_RC:-87}"
elif [[ "$command_text" == *"deploy-preflight.sh"* ]]; then
  echo "gate-check" >> "$TEST_EVENT_LOG"
  gate_check_attempts="$(grep -cFx "gate-check" "$TEST_EVENT_LOG" || true)"
  if (( gate_check_attempts <= ${TEST_GATE_CHECK_FAILURES:-0} )); then
    exit 255
  fi
  exit 0
elif [[ "$command_text" == *"git fetch origin"* ]]; then
  echo "gate-fetch" >> "$TEST_EVENT_LOG"
  gate_fetch_attempts="$(grep -cFx "gate-fetch" "$TEST_EVENT_LOG" || true)"
  if (( gate_fetch_attempts <= ${TEST_GATE_FETCH_FAILURES:-0} )); then
    exit 255
  fi
  exit 0
elif [[ "$command_text" == *"git cat-file -e"* ]]; then
  echo "rollback-validate" >> "$TEST_EVENT_LOG"
  echo "${TEST_ROLLBACK_QWEN_ONLY:-1}"
  exit 0
elif [[ "$command_text" == *"origin/codex/release-candidate:apps/orchestrator/src/config/env.ts"* ]]; then
  echo "${TEST_CANDIDATE_QWEN_ONLY:-1}"
  exit 0
elif [[ "$command_text" == *"QWEN_CORE_ROLLOUT_MODE"* ]]; then
  echo "${TEST_QWEN_ROLLOUT_MODE:-synthetic}"
  exit 0
elif [[ "$command_text" == *"team-task-lifecycle-deploy-safety.mjs' persist"* ]]; then
  [[ "$command_text" == *"flock --exclusive --timeout 60"* ]] || exit 92
  echo "lifecycle-safety-off" >> "$TEST_EVENT_LOG"
  exit 0
elif [[ "$command_text" == *"orchestrator-runtime.sh' restart"* ]]; then
  [[ "$command_text" == *"team-task-lifecycle-deploy-safety.mjs' verify-process holaday-orchestrator"* ]] \
    || exit 91
  echo "runtime-restart" >> "$TEST_EVENT_LOG"
  exit 0
elif [[ "$command_text" == *"install -d"* ]]; then
  [[ "$command_text" == *"-m 700 '/var/lib/holaday-deploy/locks'"* ]] || exit 93
  [[ "$command_text" == *"command -v flock"* ]] || exit 94
  echo "runtime-directory" >> "$TEST_EVENT_LOG"
  exit 0
elif [[ "$command_text" == *"chown root:root"* ]]; then
  echo "runtime-permissions" >> "$TEST_EVENT_LOG"
  exit 0
fi

echo "unexpected-remote-command" >> "$TEST_EVENT_LOG"
exit 90
STUB
  chmod +x "$harness_dir/bin/ssh" "$harness_dir/bin/scp"
}

test_orchestrator_retries_transient_ancestor_gate() {
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_orchestrator_gate_retry_harness "$harness_dir"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_GATE_CHECK_FAILURES=1 \
    DEPLOY_REMOTE_RETRIES=2 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    CN_PAYMENT_PREFLIGHT_VERIFIED=1 \
    PAYPAL_PREFLIGHT_VERIFIED=1 \
    ORCHESTRATOR_ROLLBACK_HEAD="1111111111111111111111111111111111111111" \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
      "codex/release-candidate" > "$output" 2>&1
  rc=$?
  set -e

  (( rc == 1 )) || fail "orchestrator should pass a recovered ancestor gate and reach rollback-safe deploy handling"
  assert_event_count "$event_log" gate-check 2
  assert_event_count "$event_log" reset-new 2
  assert_event_order "$event_log" runtime-directory runtime-upload runtime-permissions gate-fetch rollback-validate gate-check reset-new lifecycle-safety-off rollback-build runtime-restart
  ! grep -Fq "unit-secret" "$output" \
    || fail "ancestor-gate retries must not print credentials"
  rm -rf "$harness_dir"
}

test_orchestrator_classifies_exhausted_gate_fetch() {
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_orchestrator_gate_retry_harness "$harness_dir"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_GATE_FETCH_FAILURES=2 \
    DEPLOY_REMOTE_RETRIES=2 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    CN_PAYMENT_PREFLIGHT_VERIFIED=1 \
    PAYPAL_PREFLIGHT_VERIFIED=1 \
    ORCHESTRATOR_ROLLBACK_HEAD="1111111111111111111111111111111111111111" \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
      "codex/release-candidate" > "$output" 2>&1
  rc=$?
  set -e

  (( rc == 4 )) || fail "exhausted gate fetch must preserve the fail-closed verification exit"
  assert_event_count "$event_log" gate-fetch 2
  assert_event_count "$event_log" gate-check 0
  assert_event_count "$event_log" reset-new 0
  grep -Fq "refusing to reset blind" "$output" \
    || fail "exhausted gate fetch must explain the fail-closed refusal"
  ! grep -Fq "unit-secret" "$output" \
    || fail "exhausted gate retries must not print credentials"
  rm -rf "$harness_dir"
}

write_orchestrator_release_smoke_harness() {
  local harness_dir="$1"

  write_common_deploy_stubs "$harness_dir"
  cp "$ORCHESTRATOR_SCRIPT" "$harness_dir/repo/scripts/deploy-orchestrator.sh"
  cp "$AUTO_SMOKE_SUMMARY_SCRIPT" "$harness_dir/repo/scripts/auto-smoke-summary.sh"
  cp "$DEPLOY_SAFETY_HELPER" "$harness_dir/repo/scripts/team-task-lifecycle-deploy-safety.mjs"
  : > "$harness_dir/repo/scripts/orchestrator-runtime.sh"
  : > "$harness_dir/repo/scripts/start-orchestrator-production.sh"
  : > "$harness_dir/repo/scripts/start-account-closure-worker-production.sh"
  chmod +x "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
    "$harness_dir/repo/scripts/orchestrator-runtime.sh" \
    "$harness_dir/repo/scripts/start-orchestrator-production.sh" \
    "$harness_dir/repo/scripts/start-account-closure-worker-production.sh"

  cat > "$harness_dir/bin/scp" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  cat > "$harness_dir/bin/ssh" <<'STUB'
#!/usr/bin/env bash
command_text="${!#}"

if [[ "$command_text" == *"eval:release"* ]]; then
  echo "release-gate" >> "$TEST_EVENT_LOG"
  case "${TEST_RELEASE_GATE_STATE:-healthy}" in
    healthy) echo "[eval] 4/4 passed (12.0s)" ;;
    failures)
      echo "[eval] 3/4 passed (12.0s)"
      [[ "$command_text" == *"__HOLADAY_RELEASE_GATE_CAPTURE__"* ]] || exit 1
      ;;
    unparseable) echo "release gate crashed" ;;
  esac
elif [[ "$command_text" == *"eval:smoke"* ]]; then
  echo "full-smoke" >> "$TEST_EVENT_LOG"
  case "${TEST_FULL_SMOKE_STATE:-healthy}" in
    healthy) echo "[eval] 11/11 passed (180.0s)" ;;
    failures) echo "[eval] 10/11 passed (180.0s)"; exit 1 ;;
    unparseable) echo "full smoke crashed" ;;
  esac
elif [[ "$command_text" == *"qwen-only-release-contract.mjs"* ]]; then
  echo "qwen-dark-gate" >> "$TEST_EVENT_LOG"
  if [[ "${TEST_QWEN_DARK_GATE_STATE:-healthy}" == "failures" ]]; then
    echo '{"status":"fail","check":"qwen-only-release-contract"}'
    exit 1
  fi
  printf '%s\n' \
    '{"status":"pass","check":"qwen-only-release-contract"}' \
    '{"status":"pass","region":"international","protocol":"messages"}' \
    '{"status":"pass","region":"international","protocol":"responses"}'
elif [[ "$command_text" == *"git reset --hard '1111111111111111111111111111111111111111'"* ]]; then
  echo "rollback-build" >> "$TEST_EVENT_LOG"
elif [[ "$command_text" == *"install -d"* ]]; then
  [[ "$command_text" == *"-m 700 '/var/lib/holaday-deploy/locks'"* ]] || exit 93
  [[ "$command_text" == *"command -v flock"* ]] || exit 94
  echo "runtime-directory" >> "$TEST_EVENT_LOG"
elif [[ "$command_text" == *"chown root:root"* ]]; then
  echo "runtime-permissions" >> "$TEST_EVENT_LOG"
elif [[ "$command_text" == *"git cat-file -e '1111111111111111111111111111111111111111"* ]]; then
  echo "${TEST_ROLLBACK_QWEN_ONLY:-1}"
  exit 0
elif [[ "$command_text" == *"origin/codex/release-candidate:apps/orchestrator/src/config/env.ts"* ]]; then
  echo "${TEST_CANDIDATE_QWEN_ONLY:-1}"
elif [[ "$command_text" == *"QWEN_CORE_ROLLOUT_MODE"* && "$command_text" != *"/proc/"* ]]; then
  echo "${TEST_QWEN_ROLLOUT_MODE:-synthetic}"
elif [[ "$command_text" == *"deploy-preflight.sh"* ]]; then
  exit 0
elif [[ "$command_text" == *"git fetch origin"* && "$command_text" != *"git reset --hard"* ]]; then
  exit 0
elif [[ "$command_text" == *"git reset --hard origin/codex/release-candidate"* ]]; then
  echo "2222222222222222222222222222222222222222"
elif [[ "$command_text" == *"git rev-parse --short HEAD"* ]]; then
  echo "2222222"
elif [[ "$command_text" == *"git rev-parse HEAD"* ]]; then
  echo "1111111111111111111111111111111111111111"
elif [[ "$command_text" == *"pnpm install"* ]]; then
  exit 0
elif [[ "$command_text" == *"db:migrate:numbered"* ]]; then
  exit 0
elif [[ "$command_text" == *"team-task-lifecycle-deploy-safety.mjs' persist"* ]]; then
  [[ "$command_text" == *"flock --exclusive --timeout 60"* ]] || exit 92
  echo "lifecycle-safety-off" >> "$TEST_EVENT_LOG"
elif [[ "$command_text" == *"orchestrator-runtime.sh' restart"* ]]; then
  [[ "$command_text" == *"team-task-lifecycle-deploy-safety.mjs' verify-process holaday-orchestrator"* ]] \
    || exit 91
  if grep -Fxq "rollback-build" "$TEST_EVENT_LOG"; then
    if [[ "${TEST_EXPECT_LEGACY_KEYS_DISABLED:-0}" == "1" ]]; then
      [[ "$command_text" == *"ANTHROPIC_API_KEY=''"* ]] || exit 95
      [[ "$command_text" == *"OPENAI_API_KEY=''"* ]] || exit 96
      [[ "$command_text" == *"GEMINI_API_KEY=''"* ]] || exit 97
      [[ "$command_text" == *"GOOGLE_API_KEY=''"* ]] || exit 98
    fi
    echo "rollback-restart" >> "$TEST_EVENT_LOG"
  else
    echo "runtime-restart" >> "$TEST_EVENT_LOG"
  fi
elif [[ "$command_text" == *"curl -sf"* ]]; then
  echo '{"status":"ok"}'
elif [[ "$command_text" == *"restart_time"* ]]; then
  echo "0"
elif [[ "$command_text" == *"/proc/"* && "$command_text" == *"environ"* ]]; then
  printf '%s\n' \
    "__QWEN_ROLLOUT_MODE__=${TEST_QWEN_ROLLOUT_MODE:-synthetic}" \
    MODEL_RUNTIME_POLICY QWEN_CORE_ROLLOUT_MODE QWEN_CORE_ENABLED_LANES \
    DASHSCOPE_INTL_API_KEY DASHSCOPE_INTL_ANTHROPIC_BASE_URL \
    DASHSCOPE_INTL_RESPONSES_BASE_URL
else
  echo "unexpected:$command_text" >> "$TEST_EVENT_LOG"
  exit 90
fi
STUB
  chmod +x "$harness_dir/bin/ssh" "$harness_dir/bin/scp"
}

test_orchestrator_fast_release_gate_rolls_back_on_failure() {
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_orchestrator_release_smoke_harness "$harness_dir"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_RELEASE_GATE_STATE=failures \
    DEPLOY_REMOTE_RETRIES=3 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    CN_PAYMENT_PREFLIGHT_VERIFIED=1 \
    PAYPAL_PREFLIGHT_VERIFIED=1 \
    ORCHESTRATOR_ROLLBACK_HEAD="1111111111111111111111111111111111111111" \
    SKIP_AUTO_SMOKE=1 \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
      "codex/release-candidate" > "$output" 2>&1
  rc=$?
  set -e

  (( rc == 1 )) || fail "failed fast release gate must fail the deploy and restore the previous release"
  assert_event_count "$event_log" release-gate 1
  assert_event_order "$event_log" release-gate rollback-build rollback-restart
  ! grep -Fxq "full-smoke" "$event_log" \
    || fail "legacy SKIP_AUTO_SMOKE must keep the optional full suite disabled"
  grep -Fq "fast release gate failed" "$output" \
    || fail "release-gate rollback must explain the failure"
  rm -rf "$harness_dir"
}

test_orchestrator_fast_release_gate_runs_without_full_smoke() {
  local harness_dir event_log output
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_orchestrator_release_smoke_harness "$harness_dir"

  if ! PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    DEPLOY_REMOTE_RETRIES=1 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    CN_PAYMENT_PREFLIGHT_VERIFIED=1 \
    PAYPAL_PREFLIGHT_VERIFIED=1 \
    ORCHESTRATOR_ROLLBACK_HEAD="1111111111111111111111111111111111111111" \
    SKIP_AUTO_SMOKE=1 \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
      "codex/release-candidate" > "$output" 2>&1; then
    cat "$output" >&2
    fail "healthy fast release gate must allow the deploy"
  fi

  assert_event_count "$event_log" release-gate 1
  ! grep -Fxq "full-smoke" "$event_log" \
    || fail "the full smoke suite must remain opt-in"
  grep -Fq "Fast release gate 4/4" "$output" \
    || fail "successful release gate must report its dynamic pass count"
  rm -rf "$harness_dir"
}

test_orchestrator_full_smoke_is_opt_in_and_informational() {
  local harness_dir event_log output
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_orchestrator_release_smoke_harness "$harness_dir"

  if ! PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_FULL_SMOKE_STATE=failures \
    DEPLOY_REMOTE_RETRIES=1 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    CN_PAYMENT_PREFLIGHT_VERIFIED=1 \
    PAYPAL_PREFLIGHT_VERIFIED=1 \
    ORCHESTRATOR_ROLLBACK_HEAD="1111111111111111111111111111111111111111" \
    RUN_FULL_AUTO_SMOKE=1 \
    SKIP_AUTO_SMOKE=0 \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
      "codex/release-candidate" > "$output" 2>&1; then
    cat "$output" >&2
    fail "optional full smoke failures must remain informational"
  fi

  assert_event_order "$event_log" release-gate full-smoke
  ! grep -Fxq "rollback-build" "$event_log" \
    || fail "optional full smoke failure must not roll back a healthy fast gate"
  grep -Fq "Full P0 smoke 10/11 had failures" "$output" \
    || fail "optional full smoke must report failures without hiding them"
  rm -rf "$harness_dir"
}

test_orchestrator_rejects_unapproved_initial_qwen_cutover() {
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_orchestrator_release_smoke_harness "$harness_dir"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_ROLLBACK_QWEN_ONLY=0 \
    TEST_QWEN_ROLLOUT_MODE=off \
    DEPLOY_REMOTE_RETRIES=1 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    CN_PAYMENT_PREFLIGHT_VERIFIED=1 \
    PAYPAL_PREFLIGHT_VERIFIED=1 \
    ORCHESTRATOR_ROLLBACK_HEAD="1111111111111111111111111111111111111111" \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
      "codex/release-candidate" > "$output" 2>&1
  rc=$?
  set -e

  (( rc == 1 )) || fail "an initial Qwen-only cutover must require explicit authorization"
  grep -Fq 'qwen_only_rollback_missing' "$output" \
    || fail "initial-cutover refusal must identify the missing Qwen-only rollback"
  assert_event_count "$event_log" qwen-dark-gate 0
  assert_event_count "$event_log" runtime-restart 0
  rm -rf "$harness_dir"
}

test_orchestrator_initial_qwen_cutover_runs_dark_gate() {
  local harness_dir event_log output
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_orchestrator_release_smoke_harness "$harness_dir"

  if ! PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_ROLLBACK_QWEN_ONLY=0 \
    TEST_QWEN_ROLLOUT_MODE=off \
    ALLOW_INITIAL_QWEN_CUTOVER=1 \
    DEPLOY_REMOTE_RETRIES=1 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    CN_PAYMENT_PREFLIGHT_VERIFIED=1 \
    PAYPAL_PREFLIGHT_VERIFIED=1 \
    ORCHESTRATOR_ROLLBACK_HEAD="1111111111111111111111111111111111111111" \
    SKIP_AUTO_SMOKE=1 \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
      "codex/release-candidate" > "$output" 2>&1; then
    cat "$output" >&2
    fail "an explicitly authorized dark Qwen-only cutover should pass"
  fi

  assert_event_count "$event_log" qwen-dark-gate 1
  assert_event_count "$event_log" release-gate 0
  grep -Fq 'Qwen-only dark-release gate passed' "$output" \
    || fail "initial cutover must report its blocking dark gate"
  rm -rf "$harness_dir"
}

test_orchestrator_initial_qwen_cutover_rolls_back_without_legacy_models() {
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_orchestrator_release_smoke_harness "$harness_dir"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_ROLLBACK_QWEN_ONLY=0 \
    TEST_QWEN_ROLLOUT_MODE=off \
    TEST_QWEN_DARK_GATE_STATE=failures \
    TEST_EXPECT_LEGACY_KEYS_DISABLED=1 \
    ALLOW_INITIAL_QWEN_CUTOVER=1 \
    DEPLOY_REMOTE_RETRIES=1 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    CN_PAYMENT_PREFLIGHT_VERIFIED=1 \
    PAYPAL_PREFLIGHT_VERIFIED=1 \
    ORCHESTRATOR_ROLLBACK_HEAD="1111111111111111111111111111111111111111" \
    SKIP_AUTO_SMOKE=1 \
    VULTR_PASSWORD="unit-secret" \
    "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
      "codex/release-candidate" > "$output" 2>&1
  rc=$?
  set -e

  (( rc == 1 )) || fail "a failed dark gate must fail the initial cutover"
  assert_event_order "$event_log" qwen-dark-gate rollback-build rollback-restart
  grep -Fq 'disable legacy provider credentials' "$output" \
    || fail "initial-cutover rollback must disclose its legacy-provider safety boundary"
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
test_deploy_current_retries_transient_release_ssh
test_deploy_current_retries_transient_paypal_preflight
test_deploy_current_initializes_ssh_for_explicit_rollback_head
test_combined_orchestrator_failure_rolls_back_akshare 0 7
test_combined_orchestrator_failure_rolls_back_akshare 29 2
test_cn_payment_deploy_failure_stops_before_preflight
test_application_deploy_skips_unrelated_service_restarts
test_orchestrator_retries_transient_payment_preflights
test_orchestrator_retries_transient_ancestor_gate
test_orchestrator_classifies_exhausted_gate_fetch
test_orchestrator_fast_release_gate_rolls_back_on_failure
test_orchestrator_fast_release_gate_runs_without_full_smoke
test_orchestrator_full_smoke_is_opt_in_and_informational
test_orchestrator_rejects_unapproved_initial_qwen_cutover
test_orchestrator_initial_qwen_cutover_runs_dark_gate
test_orchestrator_initial_qwen_cutover_rolls_back_without_legacy_models
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
grep -Fq 'MODEL_RUNTIME_POLICY must be qwen_only in production' "$ORCHESTRATOR_SCRIPT" \
  || fail "orchestrator deploy and rollback must require a Qwen-only revision"
grep -Fq 'ALLOW_INITIAL_QWEN_CUTOVER' "$ORCHESTRATOR_SCRIPT" \
  && grep -Fq 'Qwen-only dark-release gate' "$ORCHESTRATOR_SCRIPT" \
  && grep -Fq "export ANTHROPIC_API_KEY=''" "$ORCHESTRATOR_SCRIPT" \
  || fail "initial Qwen-only cutover must stay explicit, dark-gated, and legacy-provider-safe"
grep -Fq 'MODEL_RUNTIME_POLICY QWEN_CORE_ROLLOUT_MODE QWEN_CORE_ENABLED_LANES DASHSCOPE_INTL_API_KEY DASHSCOPE_INTL_ANTHROPIC_BASE_URL DASHSCOPE_INTL_RESPONSES_BASE_URL' "$ORCHESTRATOR_SCRIPT" \
  || fail "orchestrator deploy must require the Qwen-only international process contract"
grep -Fq "sed 's/^QWEN_CORE_ROLLOUT_MODE=/__QWEN_ROLLOUT_MODE__=/'" "$ORCHESTRATOR_SCRIPT" \
  || fail "orchestrator deploy must extract only the Qwen rollout-mode value"
! grep -Fq 'GEMINI_API_KEY ANTHROPIC_API_KEY DASHSCOPE_API_KEY' "$ORCHESTRATOR_SCRIPT" \
  || fail "orchestrator deploy must not require retired core provider credentials"
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
