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
# before invoking).

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

cleanup() {
  rm -f "$BUNDLE" "$INSTALL_UPLOAD"
}

trap cleanup EXIT

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
sshpass -e scp -O -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no \
  "$BUNDLE" "$INSTALL_UPLOAD" "$ALIYUN_HOST:/tmp/"

echo "==> installing on Aliyun"
sshpass -e ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no \
  "$ALIYUN_HOST" "bash '$INSTALL_UPLOAD' '$DOMAIN' '$BUNDLE' '$RELEASE_ID' '$INSTALL_UPLOAD'"

echo "==> edge bundle uploaded and installed"
