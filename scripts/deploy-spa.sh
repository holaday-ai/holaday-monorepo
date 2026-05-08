#!/bin/bash
# SPA deploy with smoke check + auto-rollback.
#
# White-screen postmortem (1de57cc) made this gate non-negotiable:
# build, ship, then verify the live HTML responds with our marker
# string. If the smoke check fails, restore dist.bak in ~10s — much
# faster than re-deploying from a fresh build.
#
# Usage:   ./scripts/deploy-spa.sh
# Env:     ALIYUN_PASSWORD (or rely on sshpass + interactive)
# Exits:   0 on success, 1 on smoke-check failure (after rollback)
#
# Caller is expected to have built `apps/web-workbench/dist` already
# (build pre-runs ESLint via the package script). The script itself
# does NOT rebuild — keeps deploy decoupled from build environment.

set -euo pipefail

ALIYUN_HOST="root@47.99.169.186"
SPA_PATH="/opt/holaday-spa/dist"
BACKUP_PATH="/opt/holaday-spa/dist.bak"
DIST_DIR="apps/web-workbench/dist"
SMOKE_URL="https://hd-app.orangebench.tech/"
SMOKE_MARKER="HOLA DAY"
TARBALL="/tmp/holaday-spa-dist.tar.gz"

# sshpass + non-interactive password — pulled from env so the
# password doesn't end up in shell history. Falls back to interactive
# if ALIYUN_PASSWORD isn't set.
SSHPASS_ARGS=()
if [[ -n "${ALIYUN_PASSWORD:-}" ]]; then
  SSHPASS_ARGS=(sshpass -p "$ALIYUN_PASSWORD")
fi
SSH_OPTS=(-o StrictHostKeyChecking=no -o NumberOfPasswordPrompts=1 -o ConnectTimeout=15)

if [[ ! -d "$DIST_DIR" ]]; then
  echo "❌ $DIST_DIR not found. Run: pnpm --filter @holaday/web-workbench build" >&2
  exit 1
fi

NEW_HASH=$(grep -o 'index-[^"]*\.js' "$DIST_DIR/index.html" | head -1 || echo unknown)
echo "📦 Local bundle: $NEW_HASH"

echo "→ Backing up current dist on Aliyun"
"${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$ALIYUN_HOST" \
  "rm -rf $BACKUP_PATH && cp -r $SPA_PATH $BACKUP_PATH"

echo "→ Packing + uploading $DIST_DIR"
rm -f "$TARBALL"
tar czf "$TARBALL" -C apps/web-workbench dist
"${SSHPASS_ARGS[@]}" scp "${SSH_OPTS[@]}" "$TARBALL" "$ALIYUN_HOST:/tmp/" >/dev/null

echo "→ Extracting on Aliyun"
"${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$ALIYUN_HOST" \
  "cd /opt/holaday-spa && tar xzf /tmp/holaday-spa-dist.tar.gz" \
  2>&1 | grep -v 'LIBARCHIVE.xattr' || true

echo "→ Smoke check ($SMOKE_URL must return '$SMOKE_MARKER')"
sleep 2
# 2 attempts so a transient network blip on the first try doesn't
# nuke a healthy deploy. The actual page test is identical: HTML
# response must contain the marker string.
SMOKE_OK=0
SMOKE_LOG=""
for attempt in 1 2; do
  SMOKE_LOG=$(curl -s --max-time 15 -o /tmp/smoke-resp.html -w '%{http_code}' "$SMOKE_URL" 2>&1)
  if [[ "$SMOKE_LOG" == "200" ]] && grep -q "$SMOKE_MARKER" /tmp/smoke-resp.html; then
    SMOKE_OK=1
    break
  fi
  echo "   attempt $attempt: http=$SMOKE_LOG, marker=$(grep -c "$SMOKE_MARKER" /tmp/smoke-resp.html 2>/dev/null || echo 0)"
  sleep 3
done
if [[ "$SMOKE_OK" == "1" ]]; then
  echo "✅ Smoke check passed"
else
  echo "❌ Smoke check FAILED — rolling back"
  echo "Last response head:"
  head -5 /tmp/smoke-resp.html 2>/dev/null | sed 's/^/   /'
  "${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$ALIYUN_HOST" \
    "rm -rf $SPA_PATH && mv $BACKUP_PATH $SPA_PATH"
  echo "🔄 Rolled back to previous version"
  exit 1
fi

DEPLOYED_HASH=$("${SSHPASS_ARGS[@]}" ssh "${SSH_OPTS[@]}" "$ALIYUN_HOST" \
  "grep -o 'index-[^\"]*\.js' $SPA_PATH/index.html | head -1")
echo "✅ Deployed bundle: $DEPLOYED_HASH"
if [[ "$DEPLOYED_HASH" != "$NEW_HASH" ]]; then
  echo "⚠️  Hash mismatch — local $NEW_HASH vs server $DEPLOYED_HASH" >&2
  exit 1
fi
