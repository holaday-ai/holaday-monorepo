#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/run-team-task-lifecycle-canary.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

file_owner_group() {
  stat -c '%u:%g' "$1" 2>/dev/null || stat -f '%u:%g' "$1"
}

assert_event_order() {
  local event_log="$1"
  shift
  local expected actual
  expected="$(printf '%s\n' "$@")"
  actual="$(cat "$event_log")"
  [[ "$actual" == "$expected" ]] || {
    echo "expected events:" >&2
    printf '%s\n' "$expected" >&2
    echo "actual events:" >&2
    printf '%s\n' "$actual" >&2
    fail "command order mismatch"
  }
}

make_harness() {
  local harness="$1"
  local repo="$harness/repo"
  local bin="$harness/bin"
  mkdir -p "$repo/apps/orchestrator/canary-state" "$repo/scripts" "$bin"

  cat > "$repo/apps/orchestrator/.env" <<'ENV'
TEAM_PROJECTS_ENABLED=true
TEAM_TASK_LIFECYCLE_ENABLED=false
JWT_SECRET=env-secret-must-not-leak
ENV
  printf 'TEAM_TASK_LIFECYCLE_QA_RECEIPT_FILE=%s\n' \
    "$repo/apps/orchestrator/canary-state/receipt.json" \
    >> "$repo/apps/orchestrator/.env"
  chmod 640 "$repo/apps/orchestrator/.env"
  chmod 700 "$repo/apps/orchestrator/canary-state"
  printf '{}\n' > "$repo/apps/orchestrator/canary-state/receipt.json"
  chmod 600 "$repo/apps/orchestrator/canary-state/receipt.json"

  : > "$repo/scripts/team-task-lifecycle-production-preflight.mjs"
  : > "$repo/scripts/team-task-lifecycle-root-supervisor.mjs"
  : > "$repo/apps/orchestrator/scripts-team-task-lifecycle-canary.ts"
  : > "$bin/pnpm"
  cat > "$bin/setsid" <<'STUB'
#!/usr/bin/env bash
if [[ "${TEST_SIGNAL_DURING_START:-0}" == "1" ]]; then
  kill -TERM "$TEAM_TASK_LIFECYCLE_WRAPPER_PID"
fi
if [[ "${TEST_INVALID_IDENTITY_REPORT:-0}" == "1" ]]; then
  printf '%s\n' 'not-a-pid' > "${6:-}"
fi
exec /usr/bin/perl -MPOSIX -e '
  shift @ARGV if $ARGV[0] eq "--fork";
  shift @ARGV if $ARGV[0] eq "--wait";
  my $pid = fork();
  defined($pid) or die "fork failed";
  if ($pid) {
    waitpid($pid, 0);
    exit(($? & 127) ? 128 + ($? & 127) : $? >> 8);
  }
  defined(POSIX::setsid()) or die "setsid failed";
  open(my $ready, ">", $ENV{TEST_SESSION_READY}) or die "ready failed";
  print {$ready} "$$\n";
  close($ready) or die "ready close failed";
  if (($ENV{TEST_NO_IDENTITY_CHILD} // "0") eq "1") {
    $SIG{TERM} = "IGNORE";
    while (1) { sleep 1; }
  }
  exec @ARGV;
' -- "$@"
STUB
  cat > "$bin/chown" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == 0:* ]]; then
  exit 0
fi
exec /usr/sbin/chown "$@"
STUB
  chmod +x "$bin/pnpm" "$bin/chown"

  cat > "$bin/id" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "-u" && -n "${2:-}" ]]; then
  printf '%s\n' "${TEST_RUNTIME_UID:-998}"
elif [[ "${1:-}" == "-g" && -n "${2:-}" ]]; then
  printf '%s\n' "${TEST_RUNTIME_GID:-998}"
else
  printf '%s\n' "${TEST_CURRENT_UID:-0}"
fi
STUB

  cat > "$bin/stat" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
target="${3:-}"
if [[ "$target" == "$TEST_RECEIPT_PATH" || "$target" == "$TEST_RECEIPT_DIRECTORY" ]]; then
  case "${2:-}" in
    %a|%Lp)
      [[ "$target" == "$TEST_RECEIPT_PATH" ]] && printf '600\n' || printf '700\n'
      exit 0
      ;;
    %u:%g)
      printf '998:998\n'
      exit 0
      ;;
  esac
fi
exec /usr/bin/stat "$@"
STUB

  cat > "$bin/runuser" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == "-u" && "${2:-}" == "holaday" && "${3:-}" == "--" ]] || exit 81
shift 3
if [[ "${1:-}" == "$TEST_NODE_BIN" ]]; then
  [[ "${2:-}" == "--import" && "${3:-}" == "tsx" ]] || exit 90
  [[ "${4:-}" == "$TEST_CANARY_ENTRY" && "${5:-}" == "run" ]] || exit 91
  [[ ! -e "$TEST_RECEIPT_PATH" ]] || exit 93
  [[ ! -e /dev/fd/7 && ! -e /dev/fd/8 && ! -e /dev/fd/9 ]] || exit 94
  IFS= read -r supervisor_marker
  [[ "$supervisor_marker" == "holaday-team-task-lifecycle-root-supervisor-v1" ]] || exit 92
  echo "canary-run" >> "$TEST_EVENT_LOG"
  echo "stub-secret-must-not-leak" >&2
  if [[ "${TEST_STUBBORN_GRANDCHILD:-0}" == "1" ]]; then
    trap 'exit 143' TERM INT HUP
    /bin/sh -c '
      trap "" TERM INT HUP
      printf "%s\n" "$$" > "$TEST_STUBBORN_GRANDCHILD_PID_FILE"
      while :; do sleep 1; done
    ' &
    while [[ ! -s "$TEST_STUBBORN_GRANDCHILD_PID_FILE" ]]; do sleep 0.01; done
    echo "stubborn-grandchild-started" >> "$TEST_EVENT_LOG"
    kill -TERM "$TEAM_TASK_LIFECYCLE_WRAPPER_PID"
    while :; do sleep 1; done
  fi
  if [[ "${TEST_SIGNAL_DURING_RUN:-0}" == "1" || \
    "${TEST_DOUBLE_SIGNAL_DURING_RUN:-0}" == "1" ]]; then
    grandchild_pid=""
    stop_canary() {
      [[ -n "$grandchild_pid" ]] && wait "$grandchild_pid" 2>/dev/null || true
      echo "canary-stopped" >> "$TEST_EVENT_LOG"
      exit 143
    }
    trap stop_canary TERM INT HUP
    (
      trap 'echo "canary-grandchild-stopped" >> "$TEST_EVENT_LOG"; exit 143' TERM INT HUP
      child_attempts=0
      while (( child_attempts < 4 )); do
        sleep 0.05
        child_attempts=$((child_attempts + 1))
      done
      echo "canary-grandchild-timeout" >> "$TEST_EVENT_LOG"
      exit 97
    ) &
    grandchild_pid=$!
    kill -TERM "$TEAM_TASK_LIFECYCLE_WRAPPER_PID"
    if [[ "${TEST_DOUBLE_SIGNAL_DURING_RUN:-0}" == "1" ]]; then
      kill -TERM "$TEAM_TASK_LIFECYCLE_WRAPPER_PID"
    fi
    attempts=0
    while (( attempts < 4 )); do
      sleep 0.05
      attempts=$((attempts + 1))
    done
    echo "canary-timeout" >> "$TEST_EVENT_LOG"
    exit 97
  fi
  exit "${TEST_RUN_RC:-0}"
fi
[[ "${1:-}" == "$TEST_PNPM_BIN" ]] || exit 82
shift
[[ "${1:-}" == "--dir" && "${2:-}" == "$TEST_ORCHESTRATOR_DIR" ]] || exit 83
shift 2
[[ "${1:-}" == "canary:team-task-lifecycle" ]] || exit 84
shift
case "${1:-}" in
  prepare)
    echo "canary-prepare" >> "$TEST_EVENT_LOG"
    echo "stub-secret-must-not-leak" >&2
    exit "${TEST_PREPARE_RC:-0}"
    ;;
  *) exit 85 ;;
esac
STUB

  cat > "$repo/scripts/orchestrator-runtime.sh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == "restart" && "${2:-}" == "$TEST_REPO_ROOT" ]] || exit 86
echo "runtime-restart" >> "$TEST_EVENT_LOG"
echo "runtime-secret-must-not-leak" >&2
if grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=true' "$TEST_ENV_FILE"; then
  if [[ "${TEST_SIGNAL_AFTER_ENABLE:-0}" == "1" ]]; then
    kill -TERM "$PPID"
  fi
  exit "${TEST_ENABLE_RUNTIME_RC:-0}"
fi
if [[ "${TEST_STUBBORN_GRANDCHILD:-0}" == "1" && \
  -s "$TEST_STUBBORN_GRANDCHILD_PID_FILE" ]]; then
  stubborn_pid="$(cat "$TEST_STUBBORN_GRANDCHILD_PID_FILE")"
  if kill -0 "$stubborn_pid" 2>/dev/null; then
    exit 41
  fi
fi
if [[ "${TEST_ROLLBACK_RUNTIME_FAIL_ONCE:-0}" == "1" && \
  "$(grep -c '^runtime-restart$' "$TEST_EVENT_LOG")" == "2" ]]; then
  exit 27
fi
exit "${TEST_ROLLBACK_RUNTIME_RC:-0}"
STUB

cat > "$bin/node" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "$TEST_SUPERVISOR_HELPER" ]]; then
  case "${2:-}" in
    claim)
      [[ "${3:-}" == "$TEST_RECEIPT_PATH" && "${4:-}" == "$TEST_SUPERVISOR_DIR" ]] || exit 95
      [[ "${5:-}" == "998" ]] || exit 96
      claimed_path="$TEST_SUPERVISOR_DIR/claimed.stub"
      printf '%s\n' 'holaday-team-task-lifecycle-root-supervisor-v1' > "$claimed_path"
      cat "$TEST_RECEIPT_PATH" >> "$claimed_path"
      chmod 600 "$claimed_path"
      rm -f "$TEST_RECEIPT_PATH"
      printf '%s\n' "$claimed_path"
      exit 0
      ;;
    remove)
      [[ "${3:-}" == "$TEST_SUPERVISOR_DIR/claimed.stub" ]] || exit 97
      [[ "${4:-}" == "$TEST_SUPERVISOR_DIR" ]] || exit 98
      rm -f "$3"
      exit 0
      ;;
    identity)
      pid="${3:-}"
      [[ "$(cat "$TEST_SESSION_READY" 2>/dev/null || true)" == "$pid" ]] || exit 100
      kill -0 "$pid" 2>/dev/null || exit 101
      printf '%s:%s:%s:123456\n' "$pid" "$pid" "$pid"
      if [[ "${TEST_EXIT_AFTER_IDENTITY:-0}" == "1" ]]; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
      exit 0
      ;;
    supervisor-identity)
      pid="${3:-}"
      kill -0 "$pid" 2>/dev/null || exit 102
      printf '%s:123455\n' "$pid"
      exit 0
      ;;
    discover-child)
      [[ "${TEST_DISCOVERY_FAIL:-0}" != "1" ]] || exit 103
      pid="$(cat "$TEST_SESSION_READY" 2>/dev/null || true)"
      [[ "$pid" =~ ^[1-9][0-9]*$ ]] || exit 104
      kill -0 "$pid" 2>/dev/null || exit 105
      printf '%s:%s:%s:123456\n' "$pid" "$pid" "$pid"
      exit 0
      ;;
    group-state)
      identity="${3:-}"
      pid="${identity%%:*}"
      if kill -0 "$pid" 2>/dev/null; then
        printf '%s\n' active
        exit 0
      fi
      if [[ -n "${TEST_STUBBORN_GRANDCHILD_PID_FILE:-}" && \
        -s "$TEST_STUBBORN_GRANDCHILD_PID_FILE" ]]; then
        stubborn_pid="$(cat "$TEST_STUBBORN_GRANDCHILD_PID_FILE")"
        if kill -0 "$stubborn_pid" 2>/dev/null; then
          printf '%s\n' active
          exit 0
        fi
      fi
      printf '%s\n' empty
      exit 0
      ;;
    abort-start)
      supervisor_identity="${3:-}"
      supervisor_pid="${supervisor_identity%%:*}"
      session_pid="$(cat "$TEST_SESSION_READY" 2>/dev/null || true)"
      if [[ "$session_pid" =~ ^[1-9][0-9]*$ ]]; then
        kill -KILL "-$session_pid" 2>/dev/null || true
        printf '%s:%s:%s:123456\n' "$session_pid" "$session_pid" "$session_pid"
      else
        printf '%s\n' none
      fi
      kill -KILL "$supervisor_pid" 2>/dev/null || true
      exit 0
      ;;
    *) exit 99 ;;
  esac
fi
[[ "${1:-}" == "$TEST_PREFLIGHT_SCRIPT" ]] || exit 87
  case "${2:-}" in
  collect)
    [[ "${3:-}" == "$TEST_ENV_FILE" ]] || exit 88
    collect_count="$(grep -c '^health-collect$' "$TEST_EVENT_LOG" || true)"
    echo "health-collect" >> "$TEST_EVENT_LOG"
    echo "node-secret-must-not-leak" >&2
    printf '{"health":{"holaday":true,"orangebench":true}}\n'
    if grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=true' "$TEST_ENV_FILE"; then
      exit "${TEST_RUNNING_COLLECT_RC:-0}"
    fi
    if [[ "$collect_count" == "0" ]]; then
      exit "${TEST_READY_COLLECT_RC:-0}"
    fi
    exit "${TEST_ROLLBACK_COLLECT_RC:-0}"
    ;;
  dormant)
    cat >/dev/null
    echo "dormant-preflight" >> "$TEST_EVENT_LOG"
    echo "node-secret-must-not-leak" >&2
    exit "${TEST_DORMANT_RC:-0}"
    ;;
  canary-ready)
    cat >/dev/null
    echo "canary-ready-preflight" >> "$TEST_EVENT_LOG"
    echo "node-secret-must-not-leak" >&2
    exit "${TEST_READY_RC:-0}"
    ;;
  canary-running)
    cat >/dev/null
    echo "canary-running-preflight" >> "$TEST_EVENT_LOG"
    echo "node-secret-must-not-leak" >&2
    exit "${TEST_RUNNING_RC:-0}"
    ;;
  *) exit 89 ;;
esac
STUB

  chmod +x \
    "$bin/id" \
    "$bin/stat" \
    "$bin/runuser" \
    "$bin/node" \
    "$bin/setsid" \
    "$repo/scripts/orchestrator-runtime.sh"
}

run_wrapper() {
  local harness="$1"
  shift
  local repo="$harness/repo"
  local bin="$harness/bin"
  local output="$harness/output"
  local event_log="$harness/events"
  : > "$event_log"

  set +e
  PATH="$bin:/usr/sbin:/usr/bin:/bin" \
  TEAM_TASK_LIFECYCLE_REPO_ROOT="$repo" \
  TEAM_TASK_LIFECYCLE_RUNUSER_BIN="$bin/runuser" \
  TEAM_TASK_LIFECYCLE_PNPM_BIN="$bin/pnpm" \
  TEAM_TASK_LIFECYCLE_NODE_BIN="$bin/node" \
  TEAM_TASK_LIFECYCLE_CHOWN_BIN="$bin/chown" \
  TEAM_TASK_LIFECYCLE_SETSID_BIN="$bin/setsid" \
  TEAM_TASK_LIFECYCLE_MKFIFO_BIN="/usr/bin/mkfifo" \
  TEAM_TASK_LIFECYCLE_CANARY_ENTRY="$repo/apps/orchestrator/scripts-team-task-lifecycle-canary.ts" \
  TEAM_TASK_LIFECYCLE_SUPERVISOR_HELPER="$repo/scripts/team-task-lifecycle-root-supervisor.mjs" \
  TEAM_TASK_LIFECYCLE_SUPERVISOR_DIR="$harness/supervisor" \
  TEST_REPO_ROOT="$repo" \
  TEST_ORCHESTRATOR_DIR="$repo/apps/orchestrator" \
  TEST_PREFLIGHT_SCRIPT="$repo/scripts/team-task-lifecycle-production-preflight.mjs" \
  TEST_ENV_FILE="$repo/apps/orchestrator/.env" \
  TEST_PNPM_BIN="$bin/pnpm" \
  TEST_NODE_BIN="$bin/node" \
  TEST_CANARY_ENTRY="$repo/apps/orchestrator/scripts-team-task-lifecycle-canary.ts" \
  TEST_SUPERVISOR_HELPER="$repo/scripts/team-task-lifecycle-root-supervisor.mjs" \
  TEST_RECEIPT_PATH="$repo/apps/orchestrator/canary-state/receipt.json" \
  TEST_RECEIPT_DIRECTORY="$repo/apps/orchestrator/canary-state" \
  TEST_SUPERVISOR_DIR="$harness/supervisor" \
  TEST_SESSION_READY="$harness/session-ready" \
  TEST_STUBBORN_GRANDCHILD_PID_FILE="$harness/stubborn-grandchild.pid" \
  TEST_EVENT_LOG="$event_log" \
    "$@" "$WRAPPER" > "$output" 2>&1
  WRAPPER_RC=$?
  set -e
}

test_success_keeps_lifecycle_enabled_and_skips_rollback() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_RUN_RC=0

  (( WRAPPER_RC == 0 )) || fail "successful canary exit: got $WRAPPER_RC, want 0"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    canary-run \
    health-collect \
    canary-running-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=true' "$harness/repo/apps/orchestrator/.env" \
    || fail "successful canary must not disable the lifecycle flag"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=passed' "$harness/output" \
    || fail "successful canary must emit the fixed safe status"
  ! grep -Fq 'secret-must-not-leak' "$harness/output" \
    || fail "successful canary must suppress subprocess secrets"
  rm -rf "$harness"
}

test_successful_runner_with_failed_running_gate_rolls_back() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_RUN_RC=0 TEST_RUNNING_RC=31

  (( WRAPPER_RC == 1 )) || fail "failed running gate rollback exit: got $WRAPPER_RC, want 1"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    canary-run \
    health-collect \
    canary-running-preflight \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "failed running gate must disable the lifecycle flag"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=failed rollback=complete' "$harness/output" \
    || fail "failed running gate must emit rollback-complete"
  rm -rf "$harness"
}

test_failed_canary_rolls_back_in_fixed_order() {
  local alternate_group harness original_mode original_owner_group primary_group
  harness="$(mktemp -d)"
  make_harness "$harness"
  primary_group="$(id -g)"
  alternate_group="$(id -G | tr ' ' '\n' | awk -v primary="$primary_group" '$0 != primary { print; exit }')"
  [[ -n "$alternate_group" ]] || fail "ownership test requires a secondary group"
  chgrp "$alternate_group" "$harness/repo/apps/orchestrator/.env"
  original_mode="$(file_mode "$harness/repo/apps/orchestrator/.env")"
  original_owner_group="$(file_owner_group "$harness/repo/apps/orchestrator/.env")"

  run_wrapper "$harness" env TEST_RUN_RC=19

  (( WRAPPER_RC == 1 )) || fail "recovered canary failure exit: got $WRAPPER_RC, want 1"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    canary-run \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  [[ "$(grep -c '^TEAM_TASK_LIFECYCLE_ENABLED=' "$harness/repo/apps/orchestrator/.env")" == "1" ]] \
    || fail "rollback must leave exactly one lifecycle flag"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "rollback must atomically disable the lifecycle flag"
  grep -Fxq 'JWT_SECRET=env-secret-must-not-leak' "$harness/repo/apps/orchestrator/.env" \
    || fail "rollback must preserve unrelated environment values"
  [[ "$(file_mode "$harness/repo/apps/orchestrator/.env")" == "$original_mode" ]] \
    || fail "rollback must preserve environment file permissions"
  [[ "$(file_owner_group "$harness/repo/apps/orchestrator/.env")" == "$original_owner_group" ]] \
    || fail "rollback must preserve environment file ownership"
  ! find "$harness/repo/apps/orchestrator" -name '.team-task-lifecycle-env.*' -print -quit \
    | grep -q . || fail "rollback must not leave environment temp files"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=failed rollback=complete' "$harness/output" \
    || fail "recovered failure must emit the fixed safe status"
  ! grep -Fq 'secret-must-not-leak' "$harness/output" \
    || fail "rollback must suppress environment and subprocess secrets"
  rm -rf "$harness"
}

test_rollback_stage_failures_use_exit_two_and_stop() {
  local stage harness expected_events
  for stage in runtime prepare collect dormant; do
    harness="$(mktemp -d)"
    make_harness "$harness"
    case "$stage" in
      runtime)
        run_wrapper "$harness" env TEST_RUN_RC=19 TEST_ROLLBACK_RUNTIME_RC=23
        expected_events=$'health-collect\ncanary-ready-preflight\nruntime-restart\ncanary-run\nruntime-restart\nruntime-restart'
        ;;
      prepare)
        run_wrapper "$harness" env TEST_RUN_RC=19 TEST_PREPARE_RC=24
        expected_events=$'health-collect\ncanary-ready-preflight\nruntime-restart\ncanary-run\nruntime-restart\ncanary-prepare\nruntime-restart\ncanary-prepare'
        ;;
      collect)
        run_wrapper "$harness" env TEST_RUN_RC=19 TEST_ROLLBACK_COLLECT_RC=25
        expected_events=$'health-collect\ncanary-ready-preflight\nruntime-restart\ncanary-run\nruntime-restart\ncanary-prepare\nhealth-collect\nruntime-restart\ncanary-prepare\nhealth-collect'
        ;;
      dormant)
        run_wrapper "$harness" env TEST_RUN_RC=19 TEST_DORMANT_RC=26
        expected_events=$'health-collect\ncanary-ready-preflight\nruntime-restart\ncanary-run\nruntime-restart\ncanary-prepare\nhealth-collect\ndormant-preflight\nruntime-restart\ncanary-prepare\nhealth-collect\ndormant-preflight'
        ;;
    esac

    (( WRAPPER_RC == 2 )) || fail "$stage rollback failure exit: got $WRAPPER_RC, want 2"
    [[ "$(cat "$harness/events")" == "$expected_events" ]] \
      || fail "$stage rollback failure must be retried once by the exit guard"
    grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
      || fail "$stage rollback failure must leave lifecycle disabled"
    grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=failed rollback=incomplete' "$harness/output" \
      || fail "$stage rollback failure must emit the independent fixed status"
    ! grep -Fq 'secret-must-not-leak' "$harness/output" \
      || fail "$stage rollback failure must suppress sensitive output"
    rm -rf "$harness"
  done
}

test_second_rollback_attempt_reports_the_final_success() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_RUN_RC=19 TEST_ROLLBACK_RUNTIME_FAIL_ONCE=1

  (( WRAPPER_RC == 1 )) || fail "retried rollback exit: got $WRAPPER_RC, want 1"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    canary-run \
    runtime-restart \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=failed rollback=complete' \
    "$harness/output" \
    || fail "successful rollback retry must report its final outcome"
  rm -rf "$harness"
}

test_invalid_env_flag_fails_closed_without_restart() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"
  printf '%s\n' 'TEAM_TASK_LIFECYCLE_ENABLED=true' >> "$harness/repo/apps/orchestrator/.env"

  run_wrapper "$harness" env TEST_RUN_RC=19

  (( WRAPPER_RC == 2 )) || fail "duplicate flag rollback exit: got $WRAPPER_RC, want 2"
  [[ ! -s "$harness/events" ]] || fail "invalid env must fail before canary commands"
  grep -Fxq \
    'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=error reason=invalid-start-state rollback=incomplete' \
    "$harness/output" \
    || fail "invalid env rollback must emit the fixed incomplete status"
  ! grep -Fq 'secret-must-not-leak' "$harness/output" \
    || fail "invalid env rollback must not expose sensitive values"
  rm -rf "$harness"
}

test_env_write_failure_has_one_fixed_safe_line() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"
  chmod 500 "$harness/repo/apps/orchestrator"

  run_wrapper "$harness" env TEST_RUN_RC=19

  chmod 700 "$harness/repo/apps/orchestrator"
  (( WRAPPER_RC == 64 )) || fail "pre-enable write failure exit: got $WRAPPER_RC, want 64"
  [[ "$(cat "$harness/output")" == \
    'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=error reason=invalid-runtime-boundary' ]] \
    || fail "pre-enable failure output must be exactly one fixed safe line"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "pre-enable failure must leave lifecycle disabled"
  rm -rf "$harness"
}

test_requires_root_and_exact_runtime_uid() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_CURRENT_UID=501
  (( WRAPPER_RC == 64 )) || fail "non-root exit: got $WRAPPER_RC, want 64"
  [[ ! -s "$harness/events" ]] || fail "non-root invocation must not run canary commands"

  run_wrapper "$harness" env TEST_RUNTIME_UID=999
  (( WRAPPER_RC == 64 )) || fail "wrong runtime uid exit: got $WRAPPER_RC, want 64"
  [[ ! -s "$harness/events" ]] || fail "wrong runtime uid must not run canary commands"
  ! grep -Fq 'secret-must-not-leak' "$harness/output" \
    || fail "configuration failure must not expose sensitive values"
  rm -rf "$harness"
}

test_missing_prepare_receipt_never_enables_lifecycle() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"
  rm -f "$harness/repo/apps/orchestrator/canary-state/receipt.json"

  run_wrapper "$harness" env TEST_RUN_RC=0

  (( WRAPPER_RC == 64 )) || fail "missing receipt exit: got $WRAPPER_RC, want 64"
  assert_event_order "$harness/events" health-collect canary-ready-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "missing prepare receipt must never enable lifecycle"
  rm -rf "$harness"
}

test_enabled_start_state_is_rolled_back_before_canary() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"
  awk '
    $0 == "TEAM_TASK_LIFECYCLE_ENABLED=false" {
      print "TEAM_TASK_LIFECYCLE_ENABLED=true"
      next
    }
    { print }
  ' "$harness/repo/apps/orchestrator/.env" > "$harness/repo/apps/orchestrator/.env.next"
  mv "$harness/repo/apps/orchestrator/.env.next" "$harness/repo/apps/orchestrator/.env"
  chmod 640 "$harness/repo/apps/orchestrator/.env"

  run_wrapper "$harness" env TEST_RUN_RC=0

  (( WRAPPER_RC == 64 )) || fail "enabled start exit: got $WRAPPER_RC, want 64"
  assert_event_order \
    "$harness/events" \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "enabled start state must be rolled back to dormant"
  grep -Fxq \
    'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=error reason=invalid-start-state rollback=complete' \
    "$harness/output" \
    || fail "enabled start must report a completed fail-closed rollback"
  rm -rf "$harness"
}

test_signal_after_enable_runs_exit_guard_rollback() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_SIGNAL_AFTER_ENABLE=1

  (( WRAPPER_RC == 143 )) || fail "signal exit: got $WRAPPER_RC, want 143"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "signal after enable must restore dormant lifecycle"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=interrupted rollback=complete' \
    "$harness/output" \
    || fail "signal after enable must report guarded rollback"
  rm -rf "$harness"
}

test_signal_during_long_canary_stops_child_before_rollback() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_SIGNAL_DURING_RUN=1

  (( WRAPPER_RC == 143 )) || fail "active canary signal exit: got $WRAPPER_RC, want 143"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    canary-run \
    canary-grandchild-stopped \
    canary-stopped \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "signal during canary must restore dormant lifecycle"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=interrupted rollback=complete' \
    "$harness/output" \
    || fail "signal during canary must report guarded rollback"
  rm -rf "$harness"
}

test_signal_during_process_group_start_never_releases_canary() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_SIGNAL_DURING_START=1

  (( WRAPPER_RC == 143 )) || fail "starting canary signal exit: got $WRAPPER_RC, want 143"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "signal during process-group start must restore dormant lifecycle"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=interrupted rollback=complete' \
    "$harness/output" \
    || fail "signal during process-group start must report guarded rollback"
  rm -rf "$harness"
}

test_repeated_signals_cannot_interrupt_process_group_cleanup_and_rollback() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_DOUBLE_SIGNAL_DURING_RUN=1

  (( WRAPPER_RC == 143 )) || fail "repeated signal exit: got $WRAPPER_RC, want 143"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    canary-run \
    canary-grandchild-stopped \
    canary-stopped \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "repeated signals must not interrupt dormant rollback"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=interrupted rollback=complete' \
    "$harness/output" \
    || fail "repeated signals must preserve the final rollback report"
  rm -rf "$harness"
}

test_invalid_identity_report_uses_bounded_proc_discovery() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_INVALID_IDENTITY_REPORT=1 TEST_RUN_RC=0

  (( WRAPPER_RC == 0 )) || fail "discovered identity exit: got $WRAPPER_RC, want 0"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    canary-run \
    health-collect \
    canary-running-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=passed' "$harness/output" \
    || fail "proc-discovered identity must complete the canary"
  rm -rf "$harness"
}

test_missing_identity_times_out_aborts_child_and_rolls_back() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_NO_IDENTITY_CHILD=1 TEST_DISCOVERY_FAIL=1

  (( WRAPPER_RC == 1 )) || fail "missing identity exit: got $WRAPPER_RC, want 1"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "identity timeout must restore dormant lifecycle"
  rm -rf "$harness"
}

test_leader_exit_does_not_leave_term_ignoring_grandchild_before_rollback() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper "$harness" env TEST_STUBBORN_GRANDCHILD=1

  (( WRAPPER_RC == 143 )) || fail "stubborn grandchild exit: got $WRAPPER_RC, want 143"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    canary-run \
    stubborn-grandchild-started \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  stubborn_pid="$(cat "$harness/stubborn-grandchild.pid")"
  ! kill -0 "$stubborn_pid" 2>/dev/null \
    || fail "TERM-ignoring grandchild must be gone before rollback"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=interrupted rollback=complete' \
    "$harness/output" \
    || fail "stubborn grandchild cleanup must preserve complete rollback"
  rm -rf "$harness"
}

test_child_exit_after_identity_cannot_block_start_gate() {
  local harness
  harness="$(mktemp -d)"
  make_harness "$harness"

  run_wrapper \
    "$harness" \
    env \
    TEST_EXIT_AFTER_IDENTITY=1 \
    /usr/bin/perl \
    -e \
    'alarm 10; exec @ARGV' \
    --

  (( WRAPPER_RC == 1 )) || fail "post-identity child exit: got $WRAPPER_RC, want 1"
  assert_event_order \
    "$harness/events" \
    health-collect \
    canary-ready-preflight \
    runtime-restart \
    runtime-restart \
    canary-prepare \
    health-collect \
    dormant-preflight
  grep -Fxq 'TEAM_TASK_LIFECYCLE_ENABLED=false' "$harness/repo/apps/orchestrator/.env" \
    || fail "post-identity child exit must restore dormant lifecycle"
  grep -Fxq 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER status=failed rollback=complete' \
    "$harness/output" \
    || fail "post-identity child exit must report bounded complete rollback"
  rm -rf "$harness"
}

test_success_keeps_lifecycle_enabled_and_skips_rollback
test_successful_runner_with_failed_running_gate_rolls_back
test_failed_canary_rolls_back_in_fixed_order
test_rollback_stage_failures_use_exit_two_and_stop
test_second_rollback_attempt_reports_the_final_success
test_invalid_env_flag_fails_closed_without_restart
test_env_write_failure_has_one_fixed_safe_line
test_requires_root_and_exact_runtime_uid
test_missing_prepare_receipt_never_enables_lifecycle
test_enabled_start_state_is_rolled_back_before_canary
test_signal_after_enable_runs_exit_guard_rollback
test_signal_during_long_canary_stops_child_before_rollback
test_signal_during_process_group_start_never_releases_canary
test_repeated_signals_cannot_interrupt_process_group_cleanup_and_rollback
test_invalid_identity_report_uses_bounded_proc_discovery
test_missing_identity_times_out_aborts_child_and_rolls_back
test_leader_exit_does_not_leave_term_ignoring_grandchild_before_rollback
test_child_exit_after_identity_cannot_block_start_gate

echo "PASS: team task lifecycle canary auto-rolls back without exposing secrets"
