#!/usr/bin/env bash
# Run the bounded production lifecycle canary. A failed canary is fail-closed:
# the lifecycle flag is atomically disabled, Orchestrator is restarted, and a
# Phase 1-only receipt plus dormant production preflight are rebuilt.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="${TEAM_TASK_LIFECYCLE_REPO_ROOT:-$DEFAULT_REPO_ROOT}"
ORCHESTRATOR_DIR="$REPO_ROOT/apps/orchestrator"
ENV_FILE="$ORCHESTRATOR_DIR/.env"
RUNTIME_SCRIPT="$REPO_ROOT/scripts/orchestrator-runtime.sh"
PREFLIGHT_SCRIPT="$REPO_ROOT/scripts/team-task-lifecycle-production-preflight.mjs"
RUNUSER_BIN="${TEAM_TASK_LIFECYCLE_RUNUSER_BIN:-/usr/sbin/runuser}"
PNPM_BIN="${TEAM_TASK_LIFECYCLE_PNPM_BIN:-/opt/node22/bin/pnpm}"
NODE_BIN="${TEAM_TASK_LIFECYCLE_NODE_BIN:-/opt/node22/bin/node}"
CHOWN_BIN="${TEAM_TASK_LIFECYCLE_CHOWN_BIN:-/usr/sbin/chown}"
SETSID_BIN="${TEAM_TASK_LIFECYCLE_SETSID_BIN:-/usr/bin/setsid}"
MKFIFO_BIN="${TEAM_TASK_LIFECYCLE_MKFIFO_BIN:-/usr/bin/mkfifo}"
CANARY_ENTRY="${TEAM_TASK_LIFECYCLE_CANARY_ENTRY:-$ORCHESTRATOR_DIR/scripts/team-task-lifecycle-canary.ts}"
SUPERVISOR_HELPER="${TEAM_TASK_LIFECYCLE_SUPERVISOR_HELPER:-$REPO_ROOT/scripts/team-task-lifecycle-root-supervisor.mjs}"
RUN_USER="${ORCHESTRATOR_RUN_USER:-holaday}"
EXPECTED_RUN_UID=998
SUPERVISOR_DIR="${TEAM_TASK_LIFECYCLE_SUPERVISOR_DIR:-/var/lib/holaday/team-task-lifecycle-supervisor}"

if [[ "${1:-}" == "--session-child" ]]; then
  gate_path="${2:-}"
  identity_path="${3:-}"
  shift 3
  [[ "$(id -u 2>/dev/null || true)" == "0" ]] || exit 70
  [[ "$gate_path" == "$SUPERVISOR_DIR"/start.* && -p "$gate_path" ]] || exit 71
  [[ "$identity_path" == "$SUPERVISOR_DIR"/identity.* && -p "$identity_path" && \
    ! -L "$identity_path" && "$#" -gt 0 ]] || exit 74
  exec 7<> "$gate_path" || exit 76
  printf '%s\n' "$$" > "$identity_path" || exit 75
  IFS= read -r -u 7 start_token || exit 72
  [[ "$start_token" == "start" ]] || exit 73
  exec 7>&-
  exec "$@"
fi

TEMPORARY_PATH=""
CLAIMED_RECEIPT_PATH=""
START_GATE_PATH=""
START_GATE_FD_OPEN=false
PROCESS_IDENTITY_PATH=""
PROCESS_IDENTITY_FD_OPEN=false
ACTIVATED=false
SUCCESS=false
CANARY_SUPERVISOR_PID=""
CANARY_SUPERVISOR_IDENTITY=""
CANARY_PROCESS_PID=""
CANARY_PROCESS_IDENTITY=""
PROCESS_GROUP_CLEANUP_CONFIRMED=true
CANARY_STATE="idle"
PENDING_SIGNAL_STATUS=""
TERMINATING=false

remove_root_supervisor_claim() {
  [[ -n "$CLAIMED_RECEIPT_PATH" ]] || return 0
  "$NODE_BIN" \
    "$SUPERVISOR_HELPER" \
    remove \
    "$CLAIMED_RECEIPT_PATH" \
    "$SUPERVISOR_DIR" \
    >/dev/null 2>&1 || return 1
  CLAIMED_RECEIPT_PATH=""
}

valid_canary_process_identity() {
  local identity="$1"
  local pid=""
  local process_group_id=""
  local session_id=""
  local start_time_ticks=""
  local extra=""
  IFS=: read -r pid process_group_id session_id start_time_ticks extra <<< "$identity"
  [[ -z "$extra" && "$pid" =~ ^[1-9][0-9]*$ && "$process_group_id" == "$pid" && \
    "$session_id" == "$pid" && "$start_time_ticks" =~ ^[0-9]+$ ]]
}

bind_discovered_canary_process() {
  local discovered_identity=""
  [[ -n "$CANARY_SUPERVISOR_PID" ]] || return 1
  discovered_identity="$(
    "$NODE_BIN" "$SUPERVISOR_HELPER" discover-child "$CANARY_SUPERVISOR_PID" 2>/dev/null
  )" || return 1
  valid_canary_process_identity "$discovered_identity" || return 1
  CANARY_PROCESS_PID="${discovered_identity%%:*}"
  CANARY_PROCESS_IDENTITY="$discovered_identity"
}

abort_unregistered_canary_start() {
  local aborted_identity=""
  [[ -n "$CANARY_SUPERVISOR_IDENTITY" ]] || return 1
  aborted_identity="$(
    "$NODE_BIN" \
      "$SUPERVISOR_HELPER" \
      abort-start \
      "$CANARY_SUPERVISOR_IDENTITY" \
      2>/dev/null
  )" || return 1
  if [[ "$aborted_identity" != "none" ]]; then
    valid_canary_process_identity "$aborted_identity" || return 1
    CANARY_PROCESS_PID="${aborted_identity%%:*}"
    CANARY_PROCESS_IDENTITY="$aborted_identity"
  fi
}

canary_process_group_state() {
  [[ -n "$CANARY_PROCESS_IDENTITY" ]] || return 1
  "$NODE_BIN" \
    "$SUPERVISOR_HELPER" \
    group-state \
    "$CANARY_PROCESS_IDENTITY" \
    2>/dev/null
}

terminate_canary_process_group() {
  local pid="$CANARY_PROCESS_PID"
  local attempt=0
  local group_state=""
  if [[ -z "$pid" && -z "$CANARY_SUPERVISOR_PID" ]]; then
    [[ "$PROCESS_GROUP_CLEANUP_CONFIRMED" == "true" ]]
    return
  fi
  PROCESS_GROUP_CLEANUP_CONFIRMED=false
  if [[ -z "$CANARY_PROCESS_IDENTITY" && -n "$CANARY_SUPERVISOR_PID" ]]; then
    abort_unregistered_canary_start || return 1
    pid="$CANARY_PROCESS_PID"
  fi

  if [[ -n "$pid" && -n "$CANARY_PROCESS_IDENTITY" ]]; then
    group_state="$(canary_process_group_state)" || return 1
    case "$group_state" in
      active) kill -TERM "-$pid" 2>/dev/null || true ;;
      empty) ;;
      *) return 1 ;;
    esac
    sleep 0.2
    group_state="$(canary_process_group_state)" || return 1
    case "$group_state" in
      active) kill -KILL "-$pid" 2>/dev/null || true ;;
      empty) ;;
      *) return 1 ;;
    esac
    for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      group_state="$(canary_process_group_state)" || return 1
      [[ "$group_state" == "empty" ]] && break
      [[ "$group_state" == "active" ]] || return 1
      sleep 0.1
    done
    if [[ "$group_state" != "empty" ]]; then
      return 1
    fi
  fi

  if [[ -n "$CANARY_SUPERVISOR_PID" ]]; then
    wait "$CANARY_SUPERVISOR_PID" 2>/dev/null || true
  fi
  CANARY_SUPERVISOR_PID=""
  CANARY_SUPERVISOR_IDENTITY=""
  CANARY_PROCESS_PID=""
  CANARY_PROCESS_IDENTITY=""
  CANARY_STATE="idle"
  PROCESS_GROUP_CLEANUP_CONFIRMED=true
}

cleanup() {
  if [[ -n "$TEMPORARY_PATH" && -e "$TEMPORARY_PATH" ]]; then
    rm -f -- "$TEMPORARY_PATH"
  fi
  if [[ "$START_GATE_FD_OPEN" == "true" ]]; then
    exec 8>&-
    START_GATE_FD_OPEN=false
  fi
  if [[ -n "$START_GATE_PATH" && ( -p "$START_GATE_PATH" || -e "$START_GATE_PATH" ) ]]; then
    rm -f -- "$START_GATE_PATH"
  fi
  START_GATE_PATH=""
  if [[ -n "$PROCESS_IDENTITY_PATH" && -f "$PROCESS_IDENTITY_PATH" && \
    ! -L "$PROCESS_IDENTITY_PATH" ]]; then
    rm -f -- "$PROCESS_IDENTITY_PATH"
  fi
  if [[ "$PROCESS_IDENTITY_FD_OPEN" == "true" ]]; then
    exec 9>&-
    PROCESS_IDENTITY_FD_OPEN=false
  fi
  if [[ -n "$PROCESS_IDENTITY_PATH" && -p "$PROCESS_IDENTITY_PATH" ]]; then
    rm -f -- "$PROCESS_IDENTITY_PATH"
  fi
  PROCESS_IDENTITY_PATH=""
  remove_root_supervisor_claim || true
}

on_exit() {
  local status="$1"
  local rollback_status=0
  trap - EXIT
  trap ':' INT TERM HUP
  TERMINATING=true
  terminate_canary_process_group || PROCESS_GROUP_CLEANUP_CONFIRMED=false
  if [[ "$ACTIVATED" == "true" && "$SUCCESS" != "true" ]]; then
    rollback_to_dormant >/dev/null 2>&1 || rollback_status=$?
    if (( rollback_status != 0 )); then
      rollback_status=0
      rollback_to_dormant >/dev/null 2>&1 || rollback_status=$?
    fi
    if [[ "$status" == "129" || "$status" == "130" || "$status" == "143" ]]; then
      if (( rollback_status == 0 )); then
        safe_status 'status=interrupted rollback=complete'
      else
        safe_status 'status=interrupted rollback=incomplete'
      fi
    fi
  fi
  cleanup
  exit "$status"
}

trap 'on_exit "$?"' EXIT

on_signal() {
  local status="$1"
  if [[ "$TERMINATING" == "true" ]]; then
    return
  fi
  if [[ -z "$PENDING_SIGNAL_STATUS" ]]; then
    PENDING_SIGNAL_STATUS="$status"
  fi
  if [[ "$CANARY_STATE" != "idle" ]]; then
    return
  fi
  TERMINATING=true
  trap ':' INT TERM HUP
  terminate_canary_process_group || PROCESS_GROUP_CLEANUP_CONFIRMED=false
  exit "$status"
}

honor_pending_signal() {
  local status="$PENDING_SIGNAL_STATUS"
  [[ -n "$status" ]] || return 0
  TERMINATING=true
  trap ':' INT TERM HUP
  terminate_canary_process_group || PROCESS_GROUP_CLEANUP_CONFIRMED=false
  exit "$status"
}

trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap 'on_signal 129' HUP

safe_status() {
  printf 'TEAM_TASK_LIFECYCLE_CANARY_WRAPPER %s\n' "$1"
}

fail_configuration() {
  safe_status 'status=error reason=invalid-runtime-boundary'
  exit 64
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

file_owner_group() {
  stat -c '%u:%g' "$1" 2>/dev/null || stat -f '%u:%g' "$1" 2>/dev/null
}

load_environment() {
  set -a
  # The fixed production environment file is root-controlled. Its contents are
  # never copied to stdout/stderr by this wrapper.
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

run_canary_as_runtime_user() {
  local mode="$1"
  if [[ "$mode" == "run" ]]; then
    local attempt=0
    local claim_suffix=""
    local process_pid=""
    local run_status=0
    [[ -n "$CLAIMED_RECEIPT_PATH" && -f "$CLAIMED_RECEIPT_PATH" && \
      ! -L "$CLAIMED_RECEIPT_PATH" ]] || return 1
    claim_suffix="${CLAIMED_RECEIPT_PATH##*/claimed.}"
    START_GATE_PATH="$SUPERVISOR_DIR/start.$claim_suffix"
    [[ "$START_GATE_PATH" == "$SUPERVISOR_DIR"/start.* ]] || return 1
    [[ ! -e "$START_GATE_PATH" && ! -L "$START_GATE_PATH" ]] || return 1
    "$MKFIFO_BIN" -m 0600 "$START_GATE_PATH" || return 1
    if ! exec 8<> "$START_GATE_PATH"; then
      return 1
    fi
    START_GATE_FD_OPEN=true
    PROCESS_IDENTITY_PATH="$SUPERVISOR_DIR/identity.$claim_suffix"
    [[ ! -e "$PROCESS_IDENTITY_PATH" && ! -L "$PROCESS_IDENTITY_PATH" ]] || return 1
    "$MKFIFO_BIN" -m 0600 "$PROCESS_IDENTITY_PATH" || return 1
    exec 9<> "$PROCESS_IDENTITY_PATH"
    PROCESS_IDENTITY_FD_OPEN=true
    export TEAM_TASK_LIFECYCLE_WRAPPER_PID="$$"
    CANARY_STATE="starting"
    PROCESS_GROUP_CLEANUP_CONFIRMED=false
    (
      exec 8>&- 9>&-
      cd "$ORCHESTRATOR_DIR"
      exec "$SETSID_BIN" \
        --fork \
        --wait \
        "$SCRIPT_DIR/run-team-task-lifecycle-canary.sh" \
        --session-child \
        "$START_GATE_PATH" \
        "$PROCESS_IDENTITY_PATH" \
        "$RUNUSER_BIN" \
        -u "$RUN_USER" \
        -- \
        "$NODE_BIN" \
        --import tsx \
        "$CANARY_ENTRY" \
        "$mode"
    ) < <(cat -- "$CLAIMED_RECEIPT_PATH") >/dev/null 2>&1 &
    CANARY_SUPERVISOR_PID=$!
    for attempt in 1 2 3 4 5; do
      CANARY_SUPERVISOR_IDENTITY="$(
        "$NODE_BIN" \
          "$SUPERVISOR_HELPER" \
          supervisor-identity \
          "$CANARY_SUPERVISOR_PID" \
          2>/dev/null
      )" || CANARY_SUPERVISOR_IDENTITY=""
      [[ "$CANARY_SUPERVISOR_IDENTITY" =~ ^${CANARY_SUPERVISOR_PID}:[0-9]+$ ]] && break
      CANARY_SUPERVISOR_IDENTITY=""
      kill -0 "$CANARY_SUPERVISOR_PID" 2>/dev/null || break
      sleep 0.1
    done
    if [[ ! "$CANARY_SUPERVISOR_IDENTITY" =~ ^${CANARY_SUPERVISOR_PID}:[0-9]+$ ]]; then
      CANARY_SUPERVISOR_IDENTITY=""
      terminate_canary_process_group || true
      CANARY_STATE="idle"
      return 1
    fi

    # The FIFO is read once. A missing or malformed report falls back to the
    # root-only /proc child relationship; identity verification itself is
    # retried against the retained PID and never waits for a second FIFO write.
    IFS= read -r -t 2 -u 9 process_pid || process_pid=""
    [[ "$process_pid" =~ ^[1-9][0-9]*$ ]] || process_pid=""
    for attempt in 1 2 3 4 5; do
      if [[ -n "$process_pid" ]]; then
        CANARY_PROCESS_PID="$process_pid"
        CANARY_PROCESS_IDENTITY="$(
          "$NODE_BIN" "$SUPERVISOR_HELPER" identity "$CANARY_PROCESS_PID" 2>/dev/null
        )" || CANARY_PROCESS_IDENTITY=""
        valid_canary_process_identity "$CANARY_PROCESS_IDENTITY" \
          || CANARY_PROCESS_IDENTITY=""
      fi
      if [[ -z "$CANARY_PROCESS_IDENTITY" ]]; then
        bind_discovered_canary_process || true
      fi
      [[ -n "$CANARY_PROCESS_IDENTITY" ]] && break
      if [[ -n "$PENDING_SIGNAL_STATUS" ]]; then
        abort_unregistered_canary_start || true
        honor_pending_signal
      fi
      if ! kill -0 "$CANARY_SUPERVISOR_PID" 2>/dev/null; then
        wait "$CANARY_SUPERVISOR_PID" 2>/dev/null || true
        CANARY_SUPERVISOR_PID=""
        CANARY_SUPERVISOR_IDENTITY=""
        CANARY_PROCESS_PID=""
        CANARY_STATE="idle"
        return 1
      fi
      sleep 1
    done
    exec 9>&-
    PROCESS_IDENTITY_FD_OPEN=false
    rm -f -- "$PROCESS_IDENTITY_PATH"
    PROCESS_IDENTITY_PATH=""
    if [[ -z "$CANARY_PROCESS_IDENTITY" ]]; then
      abort_unregistered_canary_start || true
      terminate_canary_process_group || true
      CANARY_STATE="idle"
      honor_pending_signal
      return 1
    fi
    honor_pending_signal
    printf 'start\n' >&8 || return 1
    exec 8>&-
    START_GATE_FD_OPEN=false
    rm -f -- "$START_GATE_PATH"
    START_GATE_PATH=""
    CANARY_STATE="waiting"
    honor_pending_signal
    wait "$CANARY_SUPERVISOR_PID" || run_status=$?
    CANARY_STATE="finishing"
    honor_pending_signal
    local final_group_state=""
    final_group_state="$(canary_process_group_state)" || final_group_state=""
    if [[ "$final_group_state" == "active" ]]; then
      terminate_canary_process_group || run_status=1
      run_status=1
    elif [[ "$final_group_state" == "empty" ]]; then
      PROCESS_GROUP_CLEANUP_CONFIRMED=true
    else
      PROCESS_GROUP_CLEANUP_CONFIRMED=false
      run_status=1
    fi
    if [[ "$PROCESS_GROUP_CLEANUP_CONFIRMED" == "true" ]]; then
      CANARY_SUPERVISOR_PID=""
      CANARY_SUPERVISOR_IDENTITY=""
      CANARY_PROCESS_PID=""
      CANARY_PROCESS_IDENTITY=""
    fi
    CANARY_STATE="idle"
    honor_pending_signal
    remove_root_supervisor_claim || return 1
    return "$run_status"
  fi
  "$RUNUSER_BIN" \
    -u "$RUN_USER" \
    -- \
    "$PNPM_BIN" \
    --dir "$ORCHESTRATOR_DIR" \
    canary:team-task-lifecycle \
    "$mode"
}

create_root_supervisor_claim() {
  local receipt_path
  receipt_path="${TEAM_TASK_LIFECYCLE_QA_RECEIPT_FILE:-}"
  [[ "$receipt_path" == /* && "$receipt_path" != "/" ]] || return 1
  [[ "$SUPERVISOR_DIR" == /* && "$SUPERVISOR_DIR" != "/" ]] || return 1
  if [[ -e "$SUPERVISOR_DIR" || -L "$SUPERVISOR_DIR" ]]; then
    [[ -d "$SUPERVISOR_DIR" && ! -L "$SUPERVISOR_DIR" ]] || return 1
  else
    mkdir -p -- "$SUPERVISOR_DIR" || return 1
  fi
  "$CHOWN_BIN" "0:0" "$SUPERVISOR_DIR" || return 1
  chmod 0700 "$SUPERVISOR_DIR" || return 1
  CLAIMED_RECEIPT_PATH="$(
    "$NODE_BIN" \
      "$SUPERVISOR_HELPER" \
      claim \
      "$receipt_path" \
      "$SUPERVISOR_DIR" \
      "$EXPECTED_RUN_UID" \
      2>/dev/null
  )" || return 1
  [[ "$CLAIMED_RECEIPT_PATH" == "$SUPERVISOR_DIR"/claimed.* ]] || return 1
  [[ -f "$CLAIMED_RECEIPT_PATH" && ! -L "$CLAIMED_RECEIPT_PATH" ]] || return 1
}

validate_canary_ready() {
  local snapshot_file

  snapshot_file="$(mktemp "$ORCHESTRATOR_DIR/.team-task-lifecycle-snapshot.XXXXXX")"
  TEMPORARY_PATH="$snapshot_file"
  "$NODE_BIN" "$PREFLIGHT_SCRIPT" collect "$ENV_FILE" > "$snapshot_file" 2>/dev/null \
    || return 1
  "$NODE_BIN" "$PREFLIGHT_SCRIPT" canary-ready < "$snapshot_file" >/dev/null 2>&1 \
    || return 1
  rm -f -- "$snapshot_file"
  TEMPORARY_PATH=""
}

validate_canary_running() {
  local snapshot_file

  snapshot_file="$(mktemp "$ORCHESTRATOR_DIR/.team-task-lifecycle-snapshot.XXXXXX")"
  TEMPORARY_PATH="$snapshot_file"
  "$NODE_BIN" "$PREFLIGHT_SCRIPT" collect "$ENV_FILE" > "$snapshot_file" 2>/dev/null \
    || return 1
  "$NODE_BIN" "$PREFLIGHT_SCRIPT" canary-running < "$snapshot_file" >/dev/null 2>&1 \
    || return 1
  rm -f -- "$snapshot_file"
  TEMPORARY_PATH=""
}

set_lifecycle_atomically() {
  local desired="$1"
  local mode owner_group
  [[ "$desired" == "true" || "$desired" == "false" ]] || return 1
  [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || return 1
  mode="$(file_mode "$ENV_FILE")"
  owner_group="$(file_owner_group "$ENV_FILE")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  [[ "$owner_group" =~ ^[0-9]+:[0-9]+$ ]] || return 1

  TEMPORARY_PATH="$(mktemp "$ORCHESTRATOR_DIR/.team-task-lifecycle-env.XXXXXX")"
  if ! awk '
    BEGIN { count = 0 }
    /^[[:space:]]*TEAM_TASK_LIFECYCLE_ENABLED[[:space:]]*=/ {
      count += 1
      print "TEAM_TASK_LIFECYCLE_ENABLED=" desired
      next
    }
    { print }
    END { if (count != 1) exit 42 }
  ' desired="$desired" "$ENV_FILE" > "$TEMPORARY_PATH"; then
    return 1
  fi
  chmod "$mode" "$TEMPORARY_PATH" || return 1
  chown "$owner_group" "$TEMPORARY_PATH" || return 1
  mv -f -- "$TEMPORARY_PATH" "$ENV_FILE" || return 1
  TEMPORARY_PATH=""

  awk '
    BEGIN { count = 0 }
    $0 == "TEAM_TASK_LIFECYCLE_ENABLED=" desired { count += 1; next }
    /^[[:space:]]*TEAM_TASK_LIFECYCLE_ENABLED[[:space:]]*=/ { exit 43 }
    END { if (count != 1) exit 44 }
  ' desired="$desired" "$ENV_FILE" >/dev/null
}

rollback_to_dormant() {
  local snapshot_file

  set_lifecycle_atomically false >/dev/null 2>&1 || return 1
  export TEAM_TASK_LIFECYCLE_ENABLED=false

  "$RUNTIME_SCRIPT" restart "$REPO_ROOT" >/dev/null 2>&1 || return 1
  [[ "$PROCESS_GROUP_CLEANUP_CONFIRMED" == "true" ]] || return 1
  run_canary_as_runtime_user prepare >/dev/null 2>&1 || return 1

  snapshot_file="$(mktemp "$ORCHESTRATOR_DIR/.team-task-lifecycle-snapshot.XXXXXX")"
  TEMPORARY_PATH="$snapshot_file"
  "$NODE_BIN" "$PREFLIGHT_SCRIPT" collect "$ENV_FILE" > "$snapshot_file" 2>/dev/null \
    || return 1
  "$NODE_BIN" "$PREFLIGHT_SCRIPT" dormant < "$snapshot_file" >/dev/null 2>&1 \
    || return 1
  rm -f -- "$snapshot_file"
  TEMPORARY_PATH=""
  ACTIVATED=false
}

[[ "$REPO_ROOT" == /* && "$REPO_ROOT" != "/" ]] || fail_configuration
[[ -d "$ORCHESTRATOR_DIR" ]] || fail_configuration
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail_configuration
[[ -x "$RUNTIME_SCRIPT" && -f "$PREFLIGHT_SCRIPT" ]] || fail_configuration
[[ -x "$RUNUSER_BIN" && -x "$PNPM_BIN" && -x "$NODE_BIN" ]] \
  || fail_configuration
[[ -x "$CHOWN_BIN" ]] || fail_configuration
[[ -x "$SETSID_BIN" ]] || fail_configuration
[[ -x "$MKFIFO_BIN" ]] || fail_configuration
[[ -f "$CANARY_ENTRY" ]] || fail_configuration
[[ -f "$SUPERVISOR_HELPER" ]] || fail_configuration

CURRENT_UID="$(id -u 2>/dev/null || true)"
[[ "$CURRENT_UID" == "0" ]] || fail_configuration
RUNTIME_UID="$(id -u "$RUN_USER" 2>/dev/null || true)"
[[ "$RUNTIME_UID" == "$EXPECTED_RUN_UID" ]] || fail_configuration

load_environment >/dev/null 2>&1 || fail_configuration
if [[ "${TEAM_TASK_LIFECYCLE_ENABLED:-}" != "false" ]]; then
  if rollback_to_dormant || rollback_to_dormant; then
    safe_status 'status=error reason=invalid-start-state rollback=complete'
    exit 64
  fi
  safe_status 'status=error reason=invalid-start-state rollback=incomplete'
  exit 2
fi
validate_canary_ready >/dev/null 2>&1 || fail_configuration
create_root_supervisor_claim || fail_configuration

ACTIVATED=true
if ! set_lifecycle_atomically true >/dev/null 2>&1; then
  if rollback_to_dormant || rollback_to_dormant; then
    safe_status 'status=failed rollback=complete'
    exit 1
  fi
  ACTIVATED=false
  safe_status 'status=failed rollback=incomplete'
  exit 2
fi
export TEAM_TASK_LIFECYCLE_ENABLED=true
if ! "$RUNTIME_SCRIPT" restart "$REPO_ROOT" >/dev/null 2>&1; then
  if rollback_to_dormant || rollback_to_dormant; then
    safe_status 'status=failed rollback=complete'
    exit 1
  fi
  ACTIVATED=false
  safe_status 'status=failed rollback=incomplete'
  exit 2
fi

set +e
run_canary_as_runtime_user run
CANARY_RC=$?
set -e

if (( CANARY_RC == 0 )) && validate_canary_running; then
  SUCCESS=true
  safe_status 'status=passed'
  exit 0
fi

if rollback_to_dormant || rollback_to_dormant; then
  safe_status 'status=failed rollback=complete'
  exit 1
fi

ACTIVATED=false
safe_status 'status=failed rollback=incomplete'
exit 2
