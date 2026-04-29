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
#   - extracts the SPA bundle to /opt/holaday-spa/dist
#   - drops the nginx vhost into /etc/nginx/sites-available/
#   - symlinks into sites-enabled
#   - reloads nginx
#   - issues TLS cert via certbot
#
# Usage (run from your laptop, AFTER pre-conditions are met):
#   ./ops/aliyun-edge/deploy.sh
#
# The script tars the current SPA dist + this nginx config and uses
# scp + ssh to install. SSH password lives in $SSHPASS (export it
# before invoking).

set -euo pipefail

ALIYUN_HOST="root@47.99.169.186"
SPA_DIR="apps/web-workbench/dist"
NGINX_CONF="ops/aliyun-edge/nginx-hd-app.conf"
DOMAIN="hd-app.orangebench.tech"
BUNDLE="/tmp/holaday-edge-bundle.tar.gz"

if [[ -z "${SSHPASS:-}" ]]; then
  echo "error: export SSHPASS=<aliyun root password> first" >&2
  exit 1
fi
if [[ ! -d "$SPA_DIR" ]]; then
  echo "error: $SPA_DIR not found — run \`pnpm --filter @holaday/web-workbench build\` first" >&2
  exit 1
fi
if [[ ! -f "$NGINX_CONF" ]]; then
  echo "error: $NGINX_CONF not found — run from monorepo root" >&2
  exit 1
fi

echo "==> packing SPA dist + nginx config"
tar czf "$BUNDLE" -C "$(dirname "$SPA_DIR")" "$(basename "$SPA_DIR")" "$NGINX_CONF"
ls -lh "$BUNDLE"

echo "==> uploading bundle to Aliyun"
sshpass -e scp -O -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no \
  "$BUNDLE" "$ALIYUN_HOST:/tmp/"

echo "==> installing on Aliyun"
sshpass -e ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no \
  "$ALIYUN_HOST" "set -euo pipefail
    # 1. Unpack SPA → /opt/holaday-spa/dist
    mkdir -p /opt/holaday-spa
    rm -rf /opt/holaday-spa/dist
    cd /opt/holaday-spa
    tar xzf /tmp/holaday-edge-bundle.tar.gz dist
    ls dist | head -5
    # 2. Drop the nginx vhost (rename ops/... path to short name)
    mkdir -p /tmp/edge-extract
    tar xzf /tmp/holaday-edge-bundle.tar.gz -C /tmp/edge-extract ops/aliyun-edge/nginx-hd-app.conf
    cp /tmp/edge-extract/ops/aliyun-edge/nginx-hd-app.conf /etc/nginx/sites-available/$DOMAIN
    ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
    rm -rf /tmp/edge-extract
    rm -f /tmp/holaday-edge-bundle.tar.gz
    # 3. Make sure the upgrade map exists (idempotent)
    if ! grep -q 'connection_upgrade' /etc/nginx/conf.d/*.conf 2>/dev/null; then
      cat > /etc/nginx/conf.d/00-upgrade.conf <<'MAP'
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}
MAP
    fi
    # 4. Test + reload (vhost references certs that don't exist yet —
    #    nginx will fail; uncomment after certbot succeeds)
    # nginx -t && nginx -s reload
    echo 'NEXT STEPS (run on the Aliyun box):'
    echo '  certbot --nginx -d $DOMAIN --redirect --non-interactive --agree-tos -m ops@orangebench.tech'
    echo '  nginx -t && nginx -s reload'
"

rm -f "$BUNDLE"
echo "==> bundle uploaded + installed (cert + reload pending)"
