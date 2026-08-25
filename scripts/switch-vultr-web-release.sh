#!/usr/bin/env bash

set -euo pipefail

ACTION="${1:-}"
MV_BIN="${VULTR_WEB_MV_BIN:-mv}"

sha256_file() {
  local path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    shasum -a 256 "$path" | awk '{print $1}'
  fi
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

web_manifest() {
  local spa_root="$1"
  local landing_root="$2"
  local surface root relative_path content_hash

  if [[ ! -d "$spa_root" || ! -d "$landing_root" ]]; then return 1; fi

  {
    for surface in spa landing; do
      if [[ "$surface" == "spa" ]]; then root="$spa_root"; else root="$landing_root"; fi
      while IFS= read -r relative_path; do
        content_hash=$(sha256_file "$root/$relative_path")
        printf '%s  %s/%s\n' "$content_hash" "$surface" "$relative_path"
      done < <(cd "$root" && find . -type f -print | sed 's#^\./##' | LC_ALL=C sort)
    done
  } | sha256_stream
}

canonical_path() {
  node -e '
const fs = require("node:fs");
const path = require("node:path");
let candidate = path.resolve(process.argv[1]);
const suffix = [];
while (!fs.existsSync(candidate)) {
  const parent = path.dirname(candidate);
  if (parent === candidate) break;
  suffix.unshift(path.basename(candidate));
  candidate = parent;
}
candidate = fs.realpathSync.native(candidate);
process.stdout.write(path.join(candidate, ...suffix));
' "$1"
}

validate_allowed_path() {
  local candidate="$1"

  if [[ "$candidate" != /* || "$candidate" == "/" || ${#candidate} -lt 6 ]]; then
    echo "invalid Vultr web path" >&2
    exit 2
  fi
  case "$candidate" in
    /opt/* | /tmp/* | /private/tmp/* | /var/folders/* | /private/var/folders/* | /var/lib/holaday-deploy/*)
      ;;
    *)
      echo "Vultr web path is outside approved roots" >&2
      exit 2
      ;;
  esac
}

assert_disjoint_paths() {
  local left_index right_index left right
  local -a paths=("$@")

  for ((left_index = 0; left_index < ${#paths[@]}; left_index++)); do
    for ((right_index = left_index + 1; right_index < ${#paths[@]}; right_index++)); do
      left="${paths[$left_index]}"
      right="${paths[$right_index]}"
      if [[ "$left" == "$right" ]]; then
        echo "Vultr web paths must be pairwise distinct" >&2
        exit 2
      fi
      if [[ "$right" == "$left/"* || "$left" == "$right/"* ]]; then
        echo "Vultr web paths must not overlap" >&2
        exit 2
      fi
    done
  done
}

if [[ "$ACTION" == "manifest" ]]; then
  if (( $# != 3 )); then
    echo "usage: $0 manifest <spa-root> <landing-root>" >&2
    exit 2
  fi
  web_manifest "$2" "$3"
  exit
fi

SPA_PATH=$(canonical_path "${VULTR_WEB_SPA_PATH:-/opt/holaday-monorepo/apps/web-workbench/dist}")
LANDING_PATH=$(canonical_path "${VULTR_WEB_LANDING_PATH:-/opt/holaday-landing}")
SPA_BACKUP_PATH=$(canonical_path "${VULTR_WEB_SPA_BACKUP_PATH:-${SPA_PATH}.bak}")
LANDING_BACKUP_PATH=$(canonical_path "${VULTR_WEB_LANDING_BACKUP_PATH:-${LANDING_PATH}.bak}")
STATE_PATH=$(canonical_path "${VULTR_WEB_STATE_PATH:-/var/lib/holaday-deploy/vultr-web-release.state}")
SPA_ROLLBACK_TEMP=$(canonical_path "${SPA_PATH}.rollback-candidate")
LANDING_ROLLBACK_TEMP=$(canonical_path "${LANDING_PATH}.rollback-candidate")

for approved_path in \
  "$SPA_PATH" \
  "$LANDING_PATH" \
  "$SPA_BACKUP_PATH" \
  "$LANDING_BACKUP_PATH" \
  "$STATE_PATH" \
  "$SPA_ROLLBACK_TEMP" \
  "$LANDING_ROLLBACK_TEMP"; do
  validate_allowed_path "$approved_path"
done
assert_disjoint_paths \
  "$SPA_PATH" \
  "$LANDING_PATH" \
  "$SPA_BACKUP_PATH" \
  "$LANDING_BACKUP_PATH" \
  "$STATE_PATH" \
  "$SPA_ROLLBACK_TEMP" \
  "$LANDING_ROLLBACK_TEMP"

STATE_STATUS=""
STATE_PREVIOUS_MANIFEST=""
STATE_CANDIDATE_MANIFEST=""

read_state() {
  STATE_STATUS=""
  STATE_PREVIOUS_MANIFEST=""
  STATE_CANDIDATE_MANIFEST=""
  if [[ ! -f "$STATE_PATH" ]]; then return 1; fi

  STATE_STATUS=$(sed -n 's/^status=//p' "$STATE_PATH" | head -1)
  STATE_PREVIOUS_MANIFEST=$(sed -n 's/^previous_manifest=//p' "$STATE_PATH" | head -1)
  STATE_CANDIDATE_MANIFEST=$(sed -n 's/^candidate_manifest=//p' "$STATE_PATH" | head -1)
  if [[ ! "$STATE_STATUS" =~ ^(activating|activated|rolling_back|rolled_back)$ ]] ||
    [[ ! "$STATE_PREVIOUS_MANIFEST" =~ ^[0-9a-f]{64}$ ]] ||
    [[ ! "$STATE_CANDIDATE_MANIFEST" =~ ^[0-9a-f]{64}$ ]]; then
    echo "invalid Vultr web release state" >&2
    return 1
  fi
}

write_state() {
  local status="$1"
  local previous_manifest="$2"
  local candidate_manifest="$3"
  local state_dir state_tmp

  state_dir=$(dirname "$STATE_PATH")
  state_tmp="${STATE_PATH}.tmp.$$"
  mkdir -p "$state_dir"
  umask 077
  printf 'status=%s\nprevious_manifest=%s\ncandidate_manifest=%s\n' \
    "$status" "$previous_manifest" "$candidate_manifest" >"$state_tmp"
  mv "$state_tmp" "$STATE_PATH"
}

current_manifest() {
  web_manifest "$SPA_PATH" "$LANDING_PATH"
}

backup_manifest() {
  web_manifest "$SPA_BACKUP_PATH" "$LANDING_BACKUP_PATH"
}

case "$ACTION" in
  activate)
    if (( $# != 4 )); then
      echo "usage: $0 activate <stage-root> <bundle-file> <web-manifest>" >&2
      exit 2
    fi

    STAGE_ROOT=$(canonical_path "$2")
    EXPECTED_BUNDLE="$3"
    EXPECTED_MANIFEST="$4"
    STAGED_SPA="$STAGE_ROOT/apps/web-workbench/dist"
    STAGED_LANDING="$STAGE_ROOT/apps/holaday-landing"

    validate_allowed_path "$STAGE_ROOT"
    assert_disjoint_paths \
      "$SPA_PATH" \
      "$LANDING_PATH" \
      "$SPA_BACKUP_PATH" \
      "$LANDING_BACKUP_PATH" \
      "$STATE_PATH" \
      "$SPA_ROLLBACK_TEMP" \
      "$LANDING_ROLLBACK_TEMP" \
      "$STAGE_ROOT"
    if [[ ! "$EXPECTED_BUNDLE" =~ ^index-[A-Za-z0-9_-]+\.js$ ]]; then
      echo "invalid expected bundle name" >&2
      exit 2
    fi
    if [[ ! "$EXPECTED_MANIFEST" =~ ^[0-9a-f]{64}$ ]]; then
      echo "invalid expected web manifest" >&2
      exit 2
    fi

    LIVE_MANIFEST=$(current_manifest 2>/dev/null || true)
    if read_state 2>/dev/null && [[ "$STATE_STATUS" == "activating" ]]; then
      if [[ ! -d "$STAGED_SPA" || ! -d "$STAGED_LANDING" ]] ||
        [[ ! -f "$STAGED_SPA/index.html" ]] ||
        ! grep -Fq "$EXPECTED_BUNDLE" "$STAGED_SPA/index.html" ||
        [[ ! -f "$STAGED_LANDING/index.html" || ! -f "$STAGED_LANDING/privacy.html" || ! -f "$STAGED_LANDING/terms.html" ]] ||
        [[ "$(web_manifest "$STAGED_SPA" "$STAGED_LANDING" 2>/dev/null || true)" != "$EXPECTED_MANIFEST" ]]; then
        echo "a complete staged release is required to recover an interrupted activation" >&2
        exit 1
      fi

      recover_interrupted_activation_surface() {
        local live_path="$1"
        local backup_path="$2"

        if [[ ! -d "$backup_path" ]]; then return 0; fi
        rm -rf "$live_path"
        "$MV_BIN" "$backup_path" "$live_path"
      }

      recover_interrupted_activation_surface "$LANDING_PATH" "$LANDING_BACKUP_PATH"
      recover_interrupted_activation_surface "$SPA_PATH" "$SPA_BACKUP_PATH"
      LIVE_MANIFEST=$(current_manifest 2>/dev/null || true)
      if [[ "$LIVE_MANIFEST" != "$STATE_PREVIOUS_MANIFEST" ]]; then
        echo "interrupted Vultr web activation could not restore the previous release" >&2
        exit 1
      fi
      write_state rolled_back "$STATE_PREVIOUS_MANIFEST" "$STATE_CANDIDATE_MANIFEST"
      echo "Recovered the previous Vultr web release after an interrupted activation"
    fi

    if [[ "$LIVE_MANIFEST" == "$EXPECTED_MANIFEST" ]]; then
      if read_state 2>/dev/null &&
        [[ "$STATE_STATUS" == "activated" ]] &&
        [[ "$STATE_CANDIDATE_MANIFEST" == "$EXPECTED_MANIFEST" ]] &&
        [[ "$(backup_manifest 2>/dev/null || true)" == "$STATE_PREVIOUS_MANIFEST" ]]; then
        echo "Vultr web release already active with its original rollback pair"
      else
        echo "Vultr web release already active; no switch was performed"
      fi
      exit 0
    fi

    if [[ ! -d "$STAGED_SPA" || ! -d "$STAGED_LANDING" ]]; then
      echo "staged Vultr web release is incomplete" >&2
      exit 1
    fi
    if [[ ! -f "$STAGED_SPA/index.html" ]] || ! grep -Fq "$EXPECTED_BUNDLE" "$STAGED_SPA/index.html"; then
      echo "staged SPA does not contain the expected bundle" >&2
      exit 1
    fi
    if [[ ! -f "$STAGED_LANDING/index.html" || ! -f "$STAGED_LANDING/privacy.html" || ! -f "$STAGED_LANDING/terms.html" ]]; then
      echo "staged landing site is incomplete" >&2
      exit 1
    fi
    if [[ "$(web_manifest "$STAGED_SPA" "$STAGED_LANDING")" != "$EXPECTED_MANIFEST" ]]; then
      echo "staged Vultr web release does not match its manifest" >&2
      exit 1
    fi
    if [[ ! -d "$SPA_PATH" || ! -d "$LANDING_PATH" || ! "$LIVE_MANIFEST" =~ ^[0-9a-f]{64}$ ]]; then
      echo "current Vultr web surfaces are missing; refusing a partial first install" >&2
      exit 1
    fi

    PREVIOUS_MANIFEST="$LIVE_MANIFEST"
    restore_activation_surface() {
      local live_path="$1"
      local backup_path="$2"
      local staged_path="$3"

      if [[ ! -d "$backup_path" ]]; then return 0; fi
      if [[ -e "$live_path" || -L "$live_path" ]]; then
        if [[ -e "$staged_path" || -L "$staged_path" ]]; then return 1; fi
        mkdir -p "$(dirname "$staged_path")"
        "$MV_BIN" "$live_path" "$staged_path" || return 1
      fi
      "$MV_BIN" "$backup_path" "$live_path"
    }

    restore_failed_activation() {
      local original_rc="${1:-1}"
      local recovery_ok=1

      trap - ERR HUP INT TERM
      set +e
      restore_activation_surface "$LANDING_PATH" "$LANDING_BACKUP_PATH" "$STAGED_LANDING" || recovery_ok=0
      restore_activation_surface "$SPA_PATH" "$SPA_BACKUP_PATH" "$STAGED_SPA" || recovery_ok=0
      if [[ "$(current_manifest 2>/dev/null || true)" != "$PREVIOUS_MANIFEST" ]]; then recovery_ok=0; fi
      if (( recovery_ok == 1 )); then
        write_state rolled_back "$PREVIOUS_MANIFEST" "$EXPECTED_MANIFEST" 2>/dev/null || recovery_ok=0
      fi
      if (( original_rc == 0 )); then original_rc=1; fi
      if (( recovery_ok == 0 )); then original_rc=2; fi
      exit "$original_rc"
    }

    trap 'restore_failed_activation "$?"' ERR
    trap 'restore_failed_activation 129' HUP
    trap 'restore_failed_activation 130' INT
    trap 'restore_failed_activation 143' TERM
    rm -rf "$SPA_BACKUP_PATH" "$LANDING_BACKUP_PATH"
    write_state activating "$PREVIOUS_MANIFEST" "$EXPECTED_MANIFEST"
    "$MV_BIN" "$SPA_PATH" "$SPA_BACKUP_PATH"
    "$MV_BIN" "$LANDING_PATH" "$LANDING_BACKUP_PATH"
    "$MV_BIN" "$STAGED_SPA" "$SPA_PATH"
    "$MV_BIN" "$STAGED_LANDING" "$LANDING_PATH"
    [[ "$(current_manifest)" == "$EXPECTED_MANIFEST" ]]
    [[ "$(backup_manifest)" == "$PREVIOUS_MANIFEST" ]]
    write_state activated "$PREVIOUS_MANIFEST" "$EXPECTED_MANIFEST"
    trap - ERR HUP INT TERM
    echo "Vultr SPA and landing site activated"
    ;;
  rollback)
    if (( $# != 1 )); then
      echo "usage: $0 rollback" >&2
      exit 2
    fi
    if ! read_state; then
      echo "Vultr web rollback state is unavailable" >&2
      exit 1
    fi

    restore_rollback_surface() {
      local live_path="$1"
      local backup_path="$2"
      local candidate_temp="$3"

      if [[ ! -d "$candidate_temp" ]]; then return 0; fi
      if [[ -e "$live_path" || -L "$live_path" ]]; then
        if [[ -e "$backup_path" || -L "$backup_path" ]]; then return 1; fi
        "$MV_BIN" "$live_path" "$backup_path" || return 1
      fi
      if [[ ! -d "$backup_path" ]]; then return 1; fi
      "$MV_BIN" "$candidate_temp" "$live_path"
    }

    restore_failed_rollback() {
      local original_rc="${1:-1}"
      local recovery_ok=1

      trap - ERR HUP INT TERM
      set +e
      restore_rollback_surface "$LANDING_PATH" "$LANDING_BACKUP_PATH" "$LANDING_ROLLBACK_TEMP" || recovery_ok=0
      restore_rollback_surface "$SPA_PATH" "$SPA_BACKUP_PATH" "$SPA_ROLLBACK_TEMP" || recovery_ok=0
      if [[ "$(current_manifest 2>/dev/null || true)" != "$STATE_CANDIDATE_MANIFEST" ]]; then recovery_ok=0; fi
      if [[ "$(backup_manifest 2>/dev/null || true)" != "$STATE_PREVIOUS_MANIFEST" ]]; then recovery_ok=0; fi
      if (( recovery_ok == 1 )); then
        write_state activated "$STATE_PREVIOUS_MANIFEST" "$STATE_CANDIDATE_MANIFEST" 2>/dev/null || recovery_ok=0
      fi
      if (( original_rc == 0 )); then original_rc=1; fi
      if (( recovery_ok == 0 )); then original_rc=2; fi
      exit "$original_rc"
    }

    LIVE_MANIFEST=$(current_manifest 2>/dev/null || true)
    if [[ "$STATE_STATUS" == "rolled_back" && "$LIVE_MANIFEST" == "$STATE_PREVIOUS_MANIFEST" ]]; then
      rm -rf "$SPA_ROLLBACK_TEMP" "$LANDING_ROLLBACK_TEMP"
      echo "Vultr SPA and landing site are already rolled back"
      exit 0
    fi
    if [[ "$STATE_STATUS" == "rolling_back" ]]; then
      restore_failed_rollback 1
    fi
    if [[ "$STATE_STATUS" != "activated" ]] ||
      [[ "$LIVE_MANIFEST" != "$STATE_CANDIDATE_MANIFEST" ]] ||
      [[ "$(backup_manifest 2>/dev/null || true)" != "$STATE_PREVIOUS_MANIFEST" ]]; then
      echo "Vultr web rollback pair does not match the recorded release" >&2
      exit 1
    fi

    trap 'restore_failed_rollback "$?"' ERR
    trap 'restore_failed_rollback 129' HUP
    trap 'restore_failed_rollback 130' INT
    trap 'restore_failed_rollback 143' TERM
    rm -rf "$SPA_ROLLBACK_TEMP" "$LANDING_ROLLBACK_TEMP"
    write_state rolling_back "$STATE_PREVIOUS_MANIFEST" "$STATE_CANDIDATE_MANIFEST"
    "$MV_BIN" "$SPA_PATH" "$SPA_ROLLBACK_TEMP"
    "$MV_BIN" "$LANDING_PATH" "$LANDING_ROLLBACK_TEMP"
    "$MV_BIN" "$SPA_BACKUP_PATH" "$SPA_PATH"
    "$MV_BIN" "$LANDING_BACKUP_PATH" "$LANDING_PATH"
    [[ "$(current_manifest)" == "$STATE_PREVIOUS_MANIFEST" ]]
    write_state rolled_back "$STATE_PREVIOUS_MANIFEST" "$STATE_CANDIDATE_MANIFEST"
    trap - ERR HUP INT TERM
    rm -rf "$SPA_ROLLBACK_TEMP" "$LANDING_ROLLBACK_TEMP"
    echo "Vultr SPA and landing site rolled back"
    ;;
  *)
    echo "usage: $0 [manifest|activate|rollback] ..." >&2
    exit 2
    ;;
esac
