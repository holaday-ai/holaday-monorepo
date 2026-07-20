#!/usr/bin/env bash

set -euo pipefail

DOMAIN="${1:?domain is required}"
BUNDLE="${2:?bundle path is required}"
RELEASE_ID="${3:?release id is required}"
INSTALLER_PATH="${4:-}"

EDGE_ROOT="${HOLADAY_EDGE_ROOT:-/opt/holaday-edge}"
NGINX_ROOT="${HOLADAY_NGINX_ROOT:-/etc/nginx}"
CERT_ROOT="${HOLADAY_CERT_ROOT:-/etc/letsencrypt/live}"
NGINX_BIN="${HOLADAY_NGINX_BIN:-nginx}"
FLOCK_BIN="${HOLADAY_FLOCK_BIN:-flock}"
LOCK_PATH="${HOLADAY_LOCK_PATH:-$EDGE_ROOT/deploy.lock}"

CERT_PATH="$CERT_ROOT/$DOMAIN/fullchain.pem"
KEY_PATH="$CERT_ROOT/$DOMAIN/privkey.pem"
CONFIG_PATH="$NGINX_ROOT/sites-available/$DOMAIN"
ENABLED_PATH="$NGINX_ROOT/sites-enabled/$DOMAIN"
MAP_PATH="$NGINX_ROOT/conf.d/00-holaday-upgrade.conf"
RELEASES_ROOT="$EDGE_ROOT/releases"
RELEASE_ROOT="$RELEASES_ROOT/$RELEASE_ID"
CURRENT_PATH="$EDGE_ROOT/current"
BACKUP_ROOT="$EDGE_ROOT/backups/$RELEASE_ID"
RELEASE_CONFIG="$RELEASE_ROOT/ops/aliyun-edge/nginx-hd-app.conf"
RELEASE_ROLLBACK="$RELEASE_ROOT/ops/aliyun-edge/rollback-remote.sh"

CONFIG_BACKUP="$BACKUP_ROOT/sites-available"
ENABLED_BACKUP="$BACKUP_ROOT/sites-enabled"
CURRENT_TARGET_BACKUP="$BACKUP_ROOT/current-target"

HAD_CONFIG=false
HAD_ENABLED=false
HAD_CURRENT=false
CREATED_MAP=false
ACTIVE_CHANGES=false
COMMITTED=false

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
  local candidate="${link_path}.next-$RELEASE_ID"

  rm -f "$candidate"
  ln -s "$target" "$candidate"
  move_into_place "$candidate" "$link_path"
}

restore_path() {
  local backup=$1
  local destination=$2
  local candidate="${destination}.restore-$RELEASE_ID"

  rm -f "$candidate"
  cp -aP "$backup" "$candidate"
  move_into_place "$candidate" "$destination"
}

rollback() {
  local failed=0

  if [[ "$HAD_CURRENT" == true ]]; then
    replace_link "$(cat "$CURRENT_TARGET_BACKUP")" "$CURRENT_PATH" || failed=1
  else
    rm -f "$CURRENT_PATH" || failed=1
  fi

  if [[ "$HAD_CONFIG" == true ]]; then
    restore_path "$CONFIG_BACKUP" "$CONFIG_PATH" || failed=1
  else
    rm -f "$CONFIG_PATH" || failed=1
  fi

  if [[ "$HAD_ENABLED" == true ]]; then
    restore_path "$ENABLED_BACKUP" "$ENABLED_PATH" || failed=1
  else
    rm -f "$ENABLED_PATH" || failed=1
  fi

  if [[ "$CREATED_MAP" == true ]]; then
    rm -f "$MAP_PATH" || failed=1
  fi

  if "$NGINX_BIN" -t; then
    "$NGINX_BIN" -s reload || failed=1
  else
    failed=1
  fi

  return "$failed"
}

cleanup_inputs() {
  rm -f "$BUNDLE"
  if [[ -n "$INSTALLER_PATH" ]]; then
    rm -f "$INSTALLER_PATH"
  fi
  rm -f "${CURRENT_PATH}.next-$RELEASE_ID"
  rm -f "${CONFIG_PATH}.next-$RELEASE_ID" "${CONFIG_PATH}.restore-$RELEASE_ID"
  rm -f "${ENABLED_PATH}.next-$RELEASE_ID" "${ENABLED_PATH}.restore-$RELEASE_ID"
}

on_exit() {
  local status=$?
  trap - EXIT

  if [[ "$status" -ne 0 && "$ACTIVE_CHANGES" == true && "$COMMITTED" != true ]]; then
    if ! rollback; then
      echo "error: rollback incomplete; recovery data retained at $BACKUP_ROOT" >&2
      status=70
    fi
  fi

  cleanup_inputs
  exit "$status"
}

trap on_exit EXIT

mkdir -p "$EDGE_ROOT"
exec 9>"$LOCK_PATH"
if ! "$FLOCK_BIN" -n 9; then
  echo "error: another edge deployment is active" >&2
  exit 75
fi

if [[ ! -f "$CERT_PATH" ]]; then
  echo "error: TLS certificate missing at $CERT_PATH" >&2
  echo "provision it with certbot certonly --webroot before deploying the TLS vhost" >&2
  exit 2
fi
if [[ ! -f "$KEY_PATH" ]]; then
  echo "error: TLS private key missing at $KEY_PATH" >&2
  exit 2
fi
if [[ -e "$RELEASE_ROOT" || -L "$RELEASE_ROOT" ]]; then
  echo "error: release already exists at $RELEASE_ROOT" >&2
  exit 3
fi
if [[ -e "$CURRENT_PATH" && ! -L "$CURRENT_PATH" ]]; then
  echo "error: $CURRENT_PATH exists and is not a symlink" >&2
  exit 4
fi

mkdir -p "$RELEASE_ROOT" "$BACKUP_ROOT"
tar xzf "$BUNDLE" -C "$RELEASE_ROOT" \
  apps/web-workbench/dist \
  apps/holaday-landing \
  ops/aliyun-edge/nginx-hd-app.conf \
  ops/aliyun-edge/rollback-remote.sh

test -f "$RELEASE_ROOT/apps/web-workbench/dist/index.html"
test -f "$RELEASE_ROOT/apps/holaday-landing/index.html"
test -f "$RELEASE_CONFIG"
test -f "$RELEASE_ROLLBACK"

mkdir -p "$NGINX_ROOT/sites-available" "$NGINX_ROOT/sites-enabled" "$NGINX_ROOT/conf.d"

if [[ -e "$CONFIG_PATH" || -L "$CONFIG_PATH" ]]; then
  cp -aP "$CONFIG_PATH" "$CONFIG_BACKUP"
  touch "$BACKUP_ROOT/had-config"
  HAD_CONFIG=true
fi
if [[ -e "$ENABLED_PATH" || -L "$ENABLED_PATH" ]]; then
  cp -aP "$ENABLED_PATH" "$ENABLED_BACKUP"
  touch "$BACKUP_ROOT/had-enabled"
  HAD_ENABLED=true
fi
if [[ -L "$CURRENT_PATH" ]]; then
  readlink "$CURRENT_PATH" >"$CURRENT_TARGET_BACKUP"
  touch "$BACKUP_ROOT/had-current"
  HAD_CURRENT=true
fi

NEEDS_MAP=false
if ! grep -q 'connection_upgrade' "$NGINX_ROOT"/conf.d/*.conf 2>/dev/null; then
  if [[ -e "$MAP_PATH" || -L "$MAP_PATH" ]]; then
    echo "error: refusing to overwrite existing map file at $MAP_PATH" >&2
    exit 5
  fi
  NEEDS_MAP=true
fi

ACTIVE_CHANGES=true

if [[ "$NEEDS_MAP" == true ]]; then
  cat >"$MAP_PATH" <<'MAP'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
MAP
  touch "$BACKUP_ROOT/created-map"
  CREATED_MAP=true
fi

replace_link "$RELEASE_ROOT" "$CURRENT_PATH"
replace_link "$RELEASE_CONFIG" "$CONFIG_PATH"
replace_link "$CONFIG_PATH" "$ENABLED_PATH"

if ! "$NGINX_BIN" -t; then
  exit 1
fi
if ! "$NGINX_BIN" -s reload; then
  exit 1
fi

COMMITTED=true
echo "edge release installed for $DOMAIN at $RELEASE_ROOT"
