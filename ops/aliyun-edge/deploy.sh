#!/usr/bin/env bash
# Aliyun edge deploy — bring hd-app.orangebench.tech online so users in
# China can reach HOLA DAY without a VPN.
#
# Pre-conditions BOSS handles MANUALLY before running this script:
#   1. DNS A record:  hd-app.orangebench.tech  →  47.99.169.186
#      (propagate before running, otherwise certbot fails)
#   2. Google Cloud Console → OAuth 2.0 Client → Authorized redirect URIs
#      add: https://hd-app.orangebench.tech/api/auth/google/callback
#   3. SSH into Aliyun (47.99.169.186) and have:
#      - nginx running (already serves hd-pay.orangebench.tech)
#      - certbot installed (already used for hd-pay)
#      - /var/www/certbot/ exists (or http-01 webroot path)
#
# What this script does on the Aliyun box:
#   - stages and validates the SPA, landing site, and nginx vhost
#   - swaps the active release with rollback on validation failure
#   - tests and reloads nginx
#
# Usage (run from your laptop, AFTER pre-conditions are met):
#   ./ops/aliyun-edge/deploy.sh
#
# The script tars the current SPA dist + this nginx config and uses
# scp + ssh to install. SSH password lives in $SSHPASS (export it
# before invoking). Authentication uses sshpass when available and
# falls back to the system expect binary on macOS.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ALIYUN_HOST="root@47.99.169.186"
SPA_DIR="apps/web-workbench/dist"
LANDING_DIR="apps/holaday-landing"
NGINX_CONF="ops/aliyun-edge/nginx-hd-app.conf"
REMOTE_INSTALL_SCRIPT="ops/aliyun-edge/install-remote.sh"
REMOTE_ROLLBACK_SCRIPT="ops/aliyun-edge/rollback-remote.sh"
DOMAIN="hd-app.orangebench.tech"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-$$"
BUNDLE="/tmp/holaday-edge-$RELEASE_ID.tar.gz"
INSTALL_UPLOAD="/tmp/install-remote-$RELEASE_ID.sh"
PASSWORD_TRANSPORT=""
EXPECT_BIN=""

cleanup() {
  rm -f "$BUNDLE" "$INSTALL_UPLOAD"
}

trap cleanup EXIT

if command -v sshpass >/dev/null 2>&1; then
  PASSWORD_TRANSPORT="sshpass"
elif command -v expect >/dev/null 2>&1; then
  PASSWORD_TRANSPORT="expect"
  EXPECT_BIN="$(command -v expect)"
else
  echo "error: neither sshpass nor expect is available for password authentication" >&2
  exit 127
fi

run_scp() {
  if [[ "$PASSWORD_TRANSPORT" == "sshpass" ]]; then
    sshpass -e scp -O -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      "$BUNDLE" "$INSTALL_UPLOAD" "$ALIYUN_HOST:/tmp/"
    return
  fi

  export ALIYUN_HOST BUNDLE INSTALL_UPLOAD
  "$EXPECT_BIN" <<'EXPECT'
set timeout 300
set password_sent 0

spawn scp -O -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no $env(BUNDLE) $env(INSTALL_UPLOAD) "$env(ALIYUN_HOST):/tmp/"
expect {
  -re {(?i)are you sure you want to continue connecting} {
    send -- "yes\r"
    exp_continue
  }
  -re {(?i)password:} {
    if {$password_sent} {
      puts stderr "error: Aliyun rejected the supplied root password"
      exit 5
    }
    set password_sent 1
    send -- "$env(SSHPASS)\r"
    exp_continue
  }
  timeout {
    puts stderr "error: timed out while uploading the edge bundle"
    exit 124
  }
  eof
}

set wait_result [wait]
exit [lindex $wait_result 3]
EXPECT
}

run_ssh() {
  local remote_command
  remote_command="bash '$INSTALL_UPLOAD' '$DOMAIN' '$BUNDLE' '$RELEASE_ID' '$INSTALL_UPLOAD'"

  if [[ "$PASSWORD_TRANSPORT" == "sshpass" ]]; then
    sshpass -e ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      "$ALIYUN_HOST" "$remote_command"
    return
  fi

  export ALIYUN_HOST
  export REMOTE_COMMAND="$remote_command"
  "$EXPECT_BIN" <<'EXPECT'
set timeout 300
set password_sent 0

spawn ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no $env(ALIYUN_HOST) $env(REMOTE_COMMAND)
expect {
  -re {(?i)are you sure you want to continue connecting} {
    send -- "yes\r"
    exp_continue
  }
  -re {(?i)password:} {
    if {$password_sent} {
      puts stderr "error: Aliyun rejected the supplied root password"
      exit 5
    }
    set password_sent 1
    send -- "$env(SSHPASS)\r"
    exp_continue
  }
  timeout {
    puts stderr "error: timed out while installing the edge release"
    exit 124
  }
  eof
}

set wait_result [wait]
exit [lindex $wait_result 3]
EXPECT
}

if [[ -z "${SSHPASS:-}" ]]; then
  echo "error: export SSHPASS=<aliyun root password> first" >&2
  exit 1
fi
if [[ ! -d "$SPA_DIR" ]]; then
  echo "error: $SPA_DIR not found — run \`pnpm --filter @holaday/web-workbench build\` first" >&2
  exit 1
fi
if [[ ! -d "$LANDING_DIR" ]]; then
  echo "error: $LANDING_DIR not found" >&2
  exit 1
fi
if [[ ! -f "$NGINX_CONF" ]]; then
  echo "error: $NGINX_CONF not found — run from monorepo root" >&2
  exit 1
fi
if [[ ! -f "$REMOTE_INSTALL_SCRIPT" ]]; then
  echo "error: $REMOTE_INSTALL_SCRIPT not found" >&2
  exit 1
fi
if [[ ! -f "$REMOTE_ROLLBACK_SCRIPT" ]]; then
  echo "error: $REMOTE_ROLLBACK_SCRIPT not found" >&2
  exit 1
fi

echo "==> running edge release gate"
pnpm test:ops

echo "==> packing SPA, landing site, and nginx config"
tar czf "$BUNDLE" "$SPA_DIR" "$NGINX_CONF" "$LANDING_DIR" "$REMOTE_ROLLBACK_SCRIPT"
cp "$REMOTE_INSTALL_SCRIPT" "$INSTALL_UPLOAD"
ls -lh "$BUNDLE"

echo "==> uploading bundle to Aliyun"
run_scp

echo "==> installing on Aliyun"
run_ssh

echo "==> edge bundle uploaded and installed"
