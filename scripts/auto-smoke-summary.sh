#!/usr/bin/env bash

# Parse the last eval summary line. Exported globals keep this usable from the
# deploy script without a subshell, while the parser remains independently
# testable. The suite size is intentionally dynamic: adding/removing cases must
# not require changing deployment logic.
parse_auto_smoke_summary() {
  local output="$1"
  local line
  local passed=''
  local total=''

  while IFS= read -r line; do
    if [[ "$line" =~ \[eval\][[:space:]]+([0-9]+)/([0-9]+)[[:space:]]+passed ]]; then
      passed="${BASH_REMATCH[1]}"
      total="${BASH_REMATCH[2]}"
    fi
  done <<< "$output"

  AUTO_SMOKE_PASSED="$passed"
  AUTO_SMOKE_TOTAL="$total"
  if [[ -z "$passed" || -z "$total" ]]; then
    AUTO_SMOKE_STATE='unparseable'
  elif [[ "$passed" == "$total" && "$total" != '0' ]]; then
    AUTO_SMOKE_STATE='healthy'
  else
    AUTO_SMOKE_STATE='failures'
  fi
}
