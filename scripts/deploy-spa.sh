#!/bin/bash
# SPA deploy with smoke check + auto-rollback.
#
# White-screen postmortem (1de57cc) made the smoke check
# non-negotiable: build, ship, then verify the live HTML responds
# with our marker string. If smoke fails, restore dist.bak in ~10s.
#
# BOSS-feedback follow-up (2026-05-18) — script now pushes to BOTH
# Aliyun AND Vultr. The Aliyun-only flow let Vultr's SPA dist sit
# 15 days stale; holaday.ai (which hits Vultr nginx directly, no
# CF in front yet) silently served the old bundle until BOSS noticed
# a hash mismatch. Vultr push uses the same tarball + smoke pattern.
#
# Usage:   ./scripts/deploy-spa.sh
# Env:     ALIYUN_PASSWORD + VULTR_PASSWORD (both required)
# Exits:   0 on success, 1 on smoke failure (auto-rollback first)
#
# Caller is expected to have built `apps/web-workbench/dist`
# already. The script itself does NOT rebuild.

set -euo pipefail

ALIYUN_HOST="root@47.99.169.186"
SPA_PATH="/opt/holaday-spa/dist"
BACKUP_PATH="/opt/holaday-spa/dist.bak"
DIST_DIR="apps/web-workbench/dist"
SMOKE_URL="https://hd-app.orangebench.tech/"
SMOKE_MARKER="HOLA DAY"
TARBALL="/tmp/holaday-spa-dist.tar.gz"

# Vultr SPA mirror — holaday.ai serves this directly until Phase 28
# Cloudflare migration is done.
VULTR_HOST="root@207.148.70.106"
VULTR_SPA_PATH="/opt/holaday-monorepo/apps/web-workbench/dist"
VULTR_BACKUP_PATH="/opt/holaday-monorepo/apps/web-workbench/dist.bak"
VULTR_SMOKE_URL="https://holaday.ai/app"

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
echo "✅ Aliyun bundle: $DEPLOYED_HASH"
if [[ "$DEPLOYED_HASH" != "$NEW_HASH" ]]; then
  echo "⚠️  Hash mismatch — local $NEW_HASH vs Aliyun $DEPLOYED_HASH" >&2
  exit 1
fi

# ───────────────────────── Vultr mirror ─────────────────────────
#
# Vultr's password has special chars that bork `sshpass -p`; we use
# `sshpass -e` reading from $SSHPASS env var. Same tarball, different
# extract path. Smoke probes a deep route (/app — under the SPA
# fallback) since `/` lands on the marketing landing page.
echo
echo "→ Mirroring to Vultr (holaday.ai)"
if [[ -z "${VULTR_PASSWORD:-}" ]]; then
  echo "⚠️  VULTR_PASSWORD unset — skipping Vultr mirror (Aliyun-only deploy)" >&2
  echo "    holaday.ai will stay on its current bundle until next push." >&2
  exit 0
fi

VULTR_SSH=(sshpass -e ssh "${SSH_OPTS[@]}")
VULTR_SCP=(sshpass -e scp "${SSH_OPTS[@]}")
export SSHPASS="$VULTR_PASSWORD"

echo "→ Backing up Vultr dist"
"${VULTR_SSH[@]}" "$VULTR_HOST" \
  "rm -rf $VULTR_BACKUP_PATH && \
   if [ -d $VULTR_SPA_PATH ]; then cp -r $VULTR_SPA_PATH $VULTR_BACKUP_PATH; fi"

echo "→ Uploading tarball to Vultr"
"${VULTR_SCP[@]}" "$TARBALL" "$VULTR_HOST:/tmp/" >/dev/null

echo "→ Extracting on Vultr"
"${VULTR_SSH[@]}" "$VULTR_HOST" \
  "cd /opt/holaday-monorepo/apps/web-workbench && \
   rm -rf dist && tar xzf /tmp/holaday-spa-dist.tar.gz" \
  2>&1 | grep -v 'LIBARCHIVE.xattr' || true

echo "→ Vultr smoke check ($VULTR_SMOKE_URL must return '$SMOKE_MARKER')"
sleep 2
VULTR_OK=0
for attempt in 1 2; do
  VULTR_LOG=$(curl -s --max-time 15 -o /tmp/vultr-smoke.html -w '%{http_code}' "$VULTR_SMOKE_URL" 2>&1)
  if [[ "$VULTR_LOG" == "200" ]] && grep -q "$SMOKE_MARKER" /tmp/vultr-smoke.html; then
    VULTR_OK=1
    break
  fi
  echo "   attempt $attempt: http=$VULTR_LOG"
  sleep 3
done
if [[ "$VULTR_OK" == "1" ]]; then
  echo "✅ Vultr smoke check passed"
else
  echo "❌ Vultr smoke FAILED — rolling Vultr back"
  "${VULTR_SSH[@]}" "$VULTR_HOST" \
    "rm -rf $VULTR_SPA_PATH && mv $VULTR_BACKUP_PATH $VULTR_SPA_PATH"
  echo "🔄 Vultr rolled back. Aliyun deploy remains."
  exit 1
fi

VULTR_DEPLOYED_HASH=$("${VULTR_SSH[@]}" "$VULTR_HOST" \
  "grep -o 'index-[^\"]*\.js' $VULTR_SPA_PATH/index.html | head -1")
echo "✅ Vultr bundle:  $VULTR_DEPLOYED_HASH"
if [[ "$VULTR_DEPLOYED_HASH" != "$NEW_HASH" ]]; then
  echo "⚠️  Vultr hash mismatch — local $NEW_HASH vs Vultr $VULTR_DEPLOYED_HASH" >&2
  exit 1
fi
