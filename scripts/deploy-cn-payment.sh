#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$ROOT_DIR/scripts"
ALIYUN_HOST="${ALIYUN_HOST:-root@47.99.169.186}"
REMOTE_ROOT="/opt/holaday-cn-payment"
REMOTE_INSTALLER="$SCRIPT_DIR/deploy-cn-payment-remote.sh"

# shellcheck source=scripts/load-deploy-env.sh
source "$SCRIPT_DIR/load-deploy-env.sh"
# shellcheck source=scripts/ssh-password-auth.sh
source "$SCRIPT_DIR/ssh-password-auth.sh"

if [[ -z "${ALIYUN_PASSWORD:-}" ]]; then
  echo "CN payment deploy failed: ALIYUN_PASSWORD is unset" >&2
  exit 1
fi
if [[ ! -f "$REMOTE_INSTALLER" ]]; then
  echo "CN payment deploy failed: remote installer is missing" >&2
  exit 1
fi
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=no)" && "${ALLOW_DIRTY_DEPLOY:-0}" != "1" ]]; then
  echo "CN payment deploy failed: tracked worktree changes are not committed" >&2
  exit 1
fi

release_id="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)-$(date -u +%Y%m%d%H%M%S)"
archive="$(mktemp -t holaday-cn-payment.XXXXXX).tar.gz"
remote_archive="/tmp/holaday-cn-payment-$release_id.tar.gz"
remote_installer="/tmp/deploy-cn-payment-$release_id.sh"
cleanup() {
  rm -f "$archive"
}
trap cleanup EXIT

git -C "$ROOT_DIR" archive --format=tar.gz --output="$archive" HEAD
build_ssh_password_prefix "$ALIYUN_PASSWORD"
AUTH=("${SSH_PASSWORD_PREFIX[@]}")
SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o ConnectTimeout=20
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=3
)

echo "→ Uploading CN payment release $release_id"
"${AUTH[@]}" scp "${SSH_OPTS[@]}" "$archive" "$ALIYUN_HOST:$remote_archive"
"${AUTH[@]}" scp "${SSH_OPTS[@]}" "$REMOTE_INSTALLER" "$ALIYUN_HOST:/tmp/"
"${AUTH[@]}" ssh "${SSH_OPTS[@]}" "$ALIYUN_HOST" \
  "mv '/tmp/$(basename "$REMOTE_INSTALLER")' '$remote_installer' && chmod 700 '$remote_installer' && bash '$remote_installer' deploy '$release_id' '$remote_archive'"

echo "→ Running live WeChat Pay and Alipay readiness checks"
if ! "$SCRIPT_DIR/verify-cn-payment-production.sh"; then
  echo "CN payment production preflight failed; rolling back $release_id" >&2
  "${AUTH[@]}" ssh "${SSH_OPTS[@]}" "$ALIYUN_HOST" \
    "bash '$remote_installer' rollback '$release_id'" || {
      echo "CN payment rollback failed; manual recovery is required" >&2
      exit 2
    }
  exit 1
fi

"${AUTH[@]}" ssh "${SSH_OPTS[@]}" "$ALIYUN_HOST" \
  "rm -f '$remote_archive' '$remote_installer'" >/dev/null
echo "CN payment deploy complete: $release_id"
