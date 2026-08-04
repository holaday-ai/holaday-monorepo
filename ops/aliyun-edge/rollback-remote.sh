#!/usr/bin/env bash

set -euo pipefail

DOMAIN="${1:?domain is required}"
RELEASE_ID="${2:?release id is required}"

EDGE_ROOT="${HOLADAY_EDGE_ROOT:-/opt/holaday-edge}"
NGINX_ROOT="${HOLADAY_NGINX_ROOT:-/etc/nginx}"
NGINX_BIN="${HOLADAY_NGINX_BIN:-nginx}"
FLOCK_BIN="${HOLADAY_FLOCK_BIN:-flock}"
LOCK_PATH="${HOLADAY_LOCK_PATH:-$EDGE_ROOT/deploy.lock}"

RELEASE_ROOT="$EDGE_ROOT/releases/$RELEASE_ID"
BACKUP_ROOT="$EDGE_ROOT/backups/$RELEASE_ID"
CURRENT_PATH="$EDGE_ROOT/current"
CONFIG_PATH="$NGINX_ROOT/sites-available/$DOMAIN"
ENABLED_PATH="$NGINX_ROOT/sites-enabled/$DOMAIN"
MAP_PATH="$NGINX_ROOT/conf.d/00-holaday-upgrade.conf"
RELEASE_CONFIG="$RELEASE_ROOT/ops/aliyun-edge/nginx-hd-app.conf"

CONFIG_BACKUP="$BACKUP_ROOT/sites-available"
ENABLED_BACKUP="$BACKUP_ROOT/sites-enabled"
CURRENT_TARGET_BACKUP="$BACKUP_ROOT/current-target"

move_into_place() {
  local source=$1
  local destination=$2

  if mv -Tf "$source" "$destination" 2>/dev/null; then
    return 0
  fi
  mv -fh "$source" "$destination"
}

replace_link() {
  local target=$1
  local link_path=$2
  local candidate="${link_path}.rollback-$RELEASE_ID"

  rm -f "$candidate"
  ln -s "$target" "$candidate"
  move_into_place "$candidate" "$link_path"
}

restore_path() {
  local backup=$1
  local destination=$2
  local candidate="${destination}.rollback-$RELEASE_ID"

  rm -f "$candidate"
  cp -aP "$backup" "$candidate"
  move_into_place "$candidate" "$destination"
}

write_upgrade_map() {
  cat >"$MAP_PATH" <<'MAP'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
MAP
}

restore_previous_config() {
  if [[ -f "$BACKUP_ROOT/had-config" ]]; then
    restore_path "$CONFIG_BACKUP" "$CONFIG_PATH" || return 1
  else
    rm -f "$CONFIG_PATH" || return 1
  fi

  if [[ -f "$BACKUP_ROOT/had-enabled" ]]; then
    restore_path "$ENABLED_BACKUP" "$ENABLED_PATH" || return 1
  else
    rm -f "$ENABLED_PATH" || return 1
  fi

  if [[ -f "$BACKUP_ROOT/created-map" ]]; then
    rm -f "$MAP_PATH" || return 1
  fi
}

restore_previous_current() {
  if [[ -f "$BACKUP_ROOT/had-current" ]]; then
    replace_link "$(cat "$CURRENT_TARGET_BACKUP")" "$CURRENT_PATH"
  else
    rm -f "$CURRENT_PATH"
  fi
}

restore_failed_release() {
  replace_link "$RELEASE_CONFIG" "$CONFIG_PATH" || return 1
  replace_link "$CONFIG_PATH" "$ENABLED_PATH" || return 1
  replace_link "$RELEASE_ROOT" "$CURRENT_PATH" || return 1

  if [[ -f "$BACKUP_ROOT/created-map" ]]; then
    write_upgrade_map || return 1
  fi
}

recover_failed_release() {
  if ! restore_failed_release; then
    return 1
  fi
  if ! "$NGINX_BIN" -t; then
    return 1
  fi
  "$NGINX_BIN" -s reload
}

mkdir -p "$EDGE_ROOT"
exec 9>"$LOCK_PATH"
if ! "$FLOCK_BIN" -n 9; then
  echo "error: another edge deployment or rollback is active" >&2
  exit 75
fi

if [[ ! -d "$RELEASE_ROOT" || ! -d "$BACKUP_ROOT" ]]; then
  echo "error: release or backup not found for $RELEASE_ID" >&2
  exit 2
fi
if [[ ! -f "$RELEASE_CONFIG" ]]; then
  echo "error: release config missing at $RELEASE_CONFIG" >&2
  exit 2
fi
if [[ ! -L "$CURRENT_PATH" || "$(readlink "$CURRENT_PATH")" != "$RELEASE_ROOT" ]]; then
  echo "error: $RELEASE_ID is not the active web release" >&2
  exit 3
fi
if [[ ! -L "$CONFIG_PATH" || "$(readlink "$CONFIG_PATH")" != "$RELEASE_CONFIG" ]]; then
  echo "error: $RELEASE_ID is not the active nginx release" >&2
  exit 3
fi
if [[ ! -L "$ENABLED_PATH" || "$(readlink "$ENABLED_PATH")" != "$CONFIG_PATH" ]]; then
  echo "error: enabled vhost does not match the active release" >&2
  exit 3
fi
if [[ -f "$BACKUP_ROOT/had-config" && ! -e "$CONFIG_BACKUP" && ! -L "$CONFIG_BACKUP" ]]; then
  echo "error: previous nginx config backup is missing" >&2
  exit 4
fi
if [[ -f "$BACKUP_ROOT/had-enabled" && ! -e "$ENABLED_BACKUP" && ! -L "$ENABLED_BACKUP" ]]; then
  echo "error: previous enabled-vhost backup is missing" >&2
  exit 4
fi
if [[ -f "$BACKUP_ROOT/had-current" && ! -f "$CURRENT_TARGET_BACKUP" ]]; then
  echo "error: previous current-release target is missing" >&2
  exit 4
fi

if ! restore_previous_config || ! "$NGINX_BIN" -t; then
  echo "error: previous nginx configuration is invalid; restoring active release" >&2
  if ! recover_failed_release; then
    echo "error: recovery incomplete; inspect $BACKUP_ROOT before changing nginx" >&2
    exit 70
  fi
  exit 1
fi

if ! restore_previous_current || ! "$NGINX_BIN" -s reload; then
  echo "error: rollback reload failed; restoring active release" >&2
  if ! recover_failed_release; then
    echo "error: recovery incomplete; inspect $BACKUP_ROOT before changing nginx" >&2
    exit 70
  fi
  exit 1
fi

touch "$BACKUP_ROOT/rolled-back"
echo "edge release $RELEASE_ID rolled back; recovery data retained at $BACKUP_ROOT"
