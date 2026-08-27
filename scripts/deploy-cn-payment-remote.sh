#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="/opt/holaday-cn-payment"
CURRENT="$ROOT/src"
RELEASES="$ROOT/releases"
ACTION="${1:-deploy}"
RELEASE_ID="${2:-}"
ARCHIVE_PATH="${3:-}"
NPM_REGISTRY="${4:-https://registry.npmjs.org}"
GATEWAY_HEALTH_ATTEMPTS="${GATEWAY_HEALTH_ATTEMPTS:-12}"
GATEWAY_HEALTH_RETRY_SECONDS="${GATEWAY_HEALTH_RETRY_SECONDS:-1}"

if [[ ! "$RELEASE_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "CN payment deploy failed: invalid release id" >&2
  exit 2
fi
if [[ ! "$GATEWAY_HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "CN payment deploy failed: GATEWAY_HEALTH_ATTEMPTS must be a positive integer" >&2
  exit 2
fi
if [[ ! "$GATEWAY_HEALTH_RETRY_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "CN payment deploy failed: GATEWAY_HEALTH_RETRY_SECONDS must be non-negative" >&2
  exit 2
fi
case "$NPM_REGISTRY" in
  https://registry.npmjs.org | https://registry.npmmirror.com) ;;
  *)
    echo "CN payment deploy failed: registry is not allowlisted" >&2
    exit 2
    ;;
esac

wait_for_gateway_health() {
  local required_marker="${1:-}"
  local attempt health=""

  for ((attempt = 1; attempt <= GATEWAY_HEALTH_ATTEMPTS; attempt++)); do
    if health="$(curl -sf --max-time 10 http://127.0.0.1:4010/healthz 2>/dev/null)" &&
      grep -Fq '"status":"ok"' <<< "$health" &&
      { [[ -z "$required_marker" ]] || grep -Fq "$required_marker" <<< "$health"; }; then
      return 0
    fi
    if (( attempt < GATEWAY_HEALTH_ATTEMPTS )); then
      sleep "$GATEWAY_HEALTH_RETRY_SECONDS"
    fi
  done

  [[ -z "$health" ]] || echo "Last gateway health response: $health" >&2
  return 1
}

switch_current() {
  local target="$1"
  local next_link="$ROOT/.src-$RELEASE_ID-$$"
  ln -s "$target" "$next_link"
  mv -Tf "$next_link" "$CURRENT"
}

rollback_release() {
  local release="$RELEASES/$RELEASE_ID"
  local previous_file="$release/.previous-target"
  [[ -f "$previous_file" ]] || {
    echo "CN payment rollback failed: previous target is unavailable" >&2
    return 2
  }
  local previous_target
  previous_target="$(<"$previous_file")"
  [[ -d "$previous_target" ]] || {
    echo "CN payment rollback failed: previous release is missing" >&2
    return 2
  }
  switch_current "$previous_target"
  pm2 restart holaday-cn-payment --update-env >/dev/null
  wait_for_gateway_health
  echo "CN payment rollback complete"
}

if [[ "$ACTION" == "rollback" ]]; then
  rollback_release
  exit $?
fi
if [[ "$ACTION" != "deploy" || -z "$ARCHIVE_PATH" || ! -f "$ARCHIVE_PATH" ]]; then
  echo "CN payment deploy failed: release archive is missing" >&2
  exit 2
fi

install -d -m 755 "$RELEASES"
STAGE="$RELEASES/$RELEASE_ID"
if [[ -e "$STAGE" ]]; then
  echo "CN payment deploy failed: release already exists" >&2
  exit 2
fi
install -d -m 755 "$STAGE"
tar xzf "$ARCHIVE_PATH" -C "$STAGE"

if [[ ! -e "$CURRENT" ]]; then
  echo "CN payment deploy failed: current release is missing" >&2
  exit 2
fi
current_real="$(readlink -f "$CURRENT")"
if [[ ! -f "$current_real/apps/cn-payment/.env" ]]; then
  echo "CN payment deploy failed: current gateway env is missing" >&2
  exit 2
fi
cp "$current_real/apps/cn-payment/.env" "$STAGE/apps/cn-payment/.env"

cd "$STAGE"
NPM_CONFIG_REGISTRY="$NPM_REGISTRY" pnpm install --frozen-lockfile
pnpm --filter @holaday/cn-payment typecheck
pnpm --filter @holaday/cn-payment test

previous_target="$current_real"
if [[ ! -L "$CURRENT" ]]; then
  previous_target="$RELEASES/legacy-$RELEASE_ID"
  mv "$CURRENT" "$previous_target"
fi
printf '%s\n' "$previous_target" > "$STAGE/.previous-target"

activated=0
rollback_on_error() {
  local rc=$?
  if (( activated == 1 )); then
    echo "CN payment candidate failed; restoring previous release" >&2
    rollback_release || rc=2
  fi
  exit "$rc"
}
trap rollback_on_error ERR

switch_current "$STAGE"
activated=1
pm2 restart holaday-cn-payment --update-env >/dev/null
wait_for_gateway_health '"bridge":"ready"'

activated=0
trap - ERR
echo "CN payment release active: $RELEASE_ID"
