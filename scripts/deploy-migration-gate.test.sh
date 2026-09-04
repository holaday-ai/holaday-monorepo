#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-orchestrator.sh"
SAFETY_HELPER="$SCRIPT_DIR/team-task-lifecycle-deploy-safety.mjs"
LIVE_HEAD="1111111111111111111111111111111111111111"

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

write_orchestrator_harness() {
  local harness_dir="$1"

  mkdir -p "$harness_dir/repo/scripts" "$harness_dir/bin"
  cp "$DEPLOY_SCRIPT" "$harness_dir/repo/scripts/deploy-orchestrator.sh"
  cp "$SAFETY_HELPER" "$harness_dir/repo/scripts/team-task-lifecycle-deploy-safety.mjs"
  cp "$SCRIPT_DIR/auto-smoke-summary.sh" "$harness_dir/repo/scripts/auto-smoke-summary.sh"
  chmod +x "$harness_dir/repo/scripts/deploy-orchestrator.sh"

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
  cat > "$harness_dir/repo/scripts/orchestrator-runtime.sh" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  cat > "$harness_dir/repo/scripts/start-orchestrator-production.sh" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  cat > "$harness_dir/repo/scripts/start-account-closure-worker-production.sh" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "$harness_dir/repo/scripts/"*.sh

  cat > "$harness_dir/bin/scp" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

  cat > "$harness_dir/bin/ssh" <<'STUB'
#!/usr/bin/env bash
command_text="${!#}"

if [[ "$command_text" == *"git reset --hard origin/"* ]]; then
  echo "reset-new" >> "$TEST_EVENT_LOG"
  [[ "$TEST_FAIL_PHASE" != "checkout" ]] || exit 41
  echo "2222222222222222222222222222222222222222"
elif [[ "$command_text" == *"git rev-parse --short HEAD"* ]]; then
  echo "2222222"
elif [[ "$command_text" == *"pnpm install"* ]]; then
  [[ "$command_text" == *"pnpm --filter @holaday/orchestrator clean"*"pnpm --filter @holaday/orchestrator build"* ]] \
    || exit 52
  echo "build-new" >> "$TEST_EVENT_LOG"
  [[ "$TEST_FAIL_PHASE" != "build" ]] || exit 42
elif [[ "$command_text" == *"db:migrate:numbered"* ]]; then
  if [[ "$command_text" != *"db:migrate:numbered"*"db:verify"* ]]; then
    echo "migration-contract-error" >> "$TEST_EVENT_LOG"
    exit 44
  fi
  if [[ "$command_text" != *"test -f apps/orchestrator/drizzle/0051_account_closures.sql"* ]]; then
    echo "migration-0051-gate-missing" >> "$TEST_EVENT_LOG"
    exit 46
  fi
  if [[ "$command_text" != *"test -f apps/orchestrator/drizzle/0052_feedback_cases.sql"* ]]; then
    echo "migration-0052-gate-missing" >> "$TEST_EVENT_LOG"
    exit 48
  fi
  if [[ "$command_text" != *"test -f apps/orchestrator/drizzle/0056_team_work_item_lifecycle.sql"* ]]; then
    echo "migration-0056-gate-missing" >> "$TEST_EVENT_LOG"
    exit 50
  fi
  echo "migration" >> "$TEST_EVENT_LOG"
  [[ "$TEST_FAIL_PHASE" != "migration" ]] || exit 43
elif [[ "$command_text" == *"team-task-lifecycle-deploy-safety.mjs' persist"* ]]; then
  [[ "$command_text" == *"flock --exclusive --timeout 60"* ]] || exit 58
  [[ "$command_text" == *"/var/lib/holaday-deploy/locks/team-task-lifecycle.lock"* ]] || exit 59
  echo "lifecycle-safety-off" >> "$TEST_EVENT_LOG"
  exit "${TEST_PERSIST_RC:-0}"
elif [[ "$command_text" == *"git reset --hard '$TEST_LIVE_HEAD'"* ]]; then
  [[ "$command_text" == *"pnpm --filter @holaday/orchestrator clean"*"pnpm --filter @holaday/orchestrator build"* ]] \
    || exit 53
  echo "rollback-checkout" >> "$TEST_EVENT_LOG"
  [[ "${TEST_ROLLBACK_BUILD_RC:-0}" == "0" ]] || exit "$TEST_ROLLBACK_BUILD_RC"
elif [[ "$command_text" == *"orchestrator-runtime.sh' restart"* ]]; then
  [[ "$command_text" == *"team-task-lifecycle-deploy-safety.mjs' verify-process holaday-orchestrator"* ]] \
    || exit 56
  if grep -Fxq "rollback-checkout" "$TEST_EVENT_LOG"; then
    [[ "$command_text" == *"ACCOUNT_CLOSURE_WORKER_ENABLED=false"* ]] || exit 47
    [[ "$command_text" == *"TEAM_TASK_LIFECYCLE_ENABLED=false"* ]] || exit 49
    echo "rollback-restart" >> "$TEST_EVENT_LOG"
    exit "${TEST_ROLLBACK_RESTART_RC:-0}"
  fi
  echo "restart-new" >> "$TEST_EVENT_LOG"
  [[ "$TEST_FAIL_PHASE" != "restart" ]] || exit 45
  [[ "$TEST_FAIL_PHASE" != "process-verify" ]] || exit 57
elif [[ "$command_text" == *"git cat-file -e"* ]]; then
  exit 0
elif [[ "$command_text" == *"git fetch origin"* ]]; then
  exit 0
elif [[ "$command_text" == *"deploy-preflight.sh"* ]]; then
  exit 0
fi
STUB
  chmod +x "$harness_dir/bin/scp" "$harness_dir/bin/ssh"
}

run_failure_case() {
  local fail_phase="$1"
  local rollback_restart_rc="$2"
  local expected_rc="$3"
  local rollback_build_rc="${4:-0}"
  local persist_rc="${5:-0}"
  local harness_dir event_log output rc
  harness_dir="$(mktemp -d)"
  event_log="$harness_dir/events"
  output="$harness_dir/output"
  : > "$event_log"
  write_orchestrator_harness "$harness_dir"

  set +e
  PATH="$harness_dir/bin:$PATH" \
    TEST_EVENT_LOG="$event_log" \
    TEST_LIVE_HEAD="$LIVE_HEAD" \
    TEST_FAIL_PHASE="$fail_phase" \
    TEST_ROLLBACK_RESTART_RC="$rollback_restart_rc" \
    TEST_ROLLBACK_BUILD_RC="$rollback_build_rc" \
    TEST_PERSIST_RC="$persist_rc" \
    VULTR_PASSWORD="unit-secret" \
    CN_PAYMENT_PREFLIGHT_VERIFIED=1 \
    PAYPAL_PREFLIGHT_VERIFIED=1 \
    DEPLOY_REMOTE_RETRIES=1 \
    DEPLOY_REMOTE_RETRY_SLEEP=0 \
    ORCHESTRATOR_ROLLBACK_HEAD="$LIVE_HEAD" \
    "$harness_dir/repo/scripts/deploy-orchestrator.sh" \
      "codex/release-candidate" > "$output" 2>&1
  rc=$?
  set -e

  (( rc == expected_rc )) || {
    cat "$output" >&2
    fail "$fail_phase failure exit: got $rc, want $expected_rc"
  }
  if (( persist_rc != 0 )); then
    assert_event_order "$event_log" reset-new lifecycle-safety-off
    ! grep -Fxq "rollback-checkout" "$event_log" \
      || fail "persist failure must stop before rollback checkout"
    ! grep -Fxq "rollback-restart" "$event_log" \
      || fail "persist failure must stop before rollback restart"
  elif (( rollback_build_rc != 0 )); then
    assert_event_order "$event_log" reset-new lifecycle-safety-off rollback-checkout
    ! grep -Fxq "rollback-restart" "$event_log" \
      || fail "rollback build failure must not claim a completed restart"
  elif [[ "$fail_phase" == "checkout" ]]; then
    assert_event_order "$event_log" reset-new lifecycle-safety-off rollback-checkout rollback-restart
  elif [[ "$fail_phase" == "build" ]]; then
    assert_event_order "$event_log" reset-new build-new lifecycle-safety-off rollback-checkout rollback-restart
  elif [[ "$fail_phase" == "migration" ]]; then
    assert_event_order "$event_log" reset-new build-new migration lifecycle-safety-off rollback-checkout rollback-restart
    ! grep -Fxq "restart-new" "$event_log" \
      || fail "migration failure must not restart the candidate orchestrator"
    grep -Fq "Database changes are forward-only" "$output" \
      || fail "migration rollback must disclose forward-only database changes"
  elif [[ "$fail_phase" == "restart" || "$fail_phase" == "process-verify" ]]; then
    assert_event_order "$event_log" reset-new build-new migration lifecycle-safety-off restart-new rollback-checkout rollback-restart
  fi
  if (( persist_rc != 0 )); then
    grep -Fq "could not persist the lifecycle safety default" "$output" \
      || fail "persist failure must be reported"
  elif (( rollback_build_rc != 0 )); then
    grep -Fq "Rollback checkout/build failed" "$output" \
      || fail "rollback build failure must be reported"
  elif (( rollback_restart_rc == 0 )); then
    grep -Fq "checkout and Orchestrator restored" "$output" \
      || fail "$fail_phase failure must report a completed rollback"
  else
    grep -Fq "Rollback restart failed" "$output" \
      || fail "rollback restart failure must be surfaced"
    grep -Fq "manual recovery is required" "$output" \
      || fail "rollback restart failure must request manual recovery"
  fi
  ! grep -Fq "unit-secret" "$output" || fail "deploy output must not print credentials"
  rm -rf "$harness_dir"
}

run_failure_case checkout 0 1
run_failure_case build 0 1
run_failure_case migration 0 1
run_failure_case restart 0 1
run_failure_case process-verify 0 1
run_failure_case migration 51 2
run_failure_case build 0 2 51
run_failure_case checkout 0 2 0 56

echo "PASS: orchestrator deploy restores checkout and surfaces rollback restart failure"
