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

# Optional local credentials. The file is ignored by git when using
# .env.deploy.local, so deploys no longer need passwords pasted in chat.
DEPLOY_ENV_LOADER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/load-deploy-env.sh"
if [[ -f "$DEPLOY_ENV_LOADER" ]]; then
  # shellcheck source=scripts/load-deploy-env.sh
  source "$DEPLOY_ENV_LOADER"
fi
unset DEPLOY_ENV_LOADER

# shellcheck source=scripts/ssh-password-auth.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ssh-password-auth.sh"

ALIYUN_HOST="root@47.99.169.186"
SPA_PATH="/opt/holaday-spa/dist"
BACKUP_PATH="/opt/holaday-spa/dist.bak"
DIST_DIR="apps/web-workbench/dist"
# Probe the SPA entry, not the marketing root, so the response contains
# both the smoke marker and the deployed bundle hash.
SMOKE_URL="https://hd-app.orangebench.tech/app"
SMOKE_MARKER="HOLA DAY"
TARBALL="/tmp/holaday-spa-dist.tar.gz"

# Vultr SPA mirror — holaday.ai serves this directly until Phase 28
# Cloudflare migration is done.
VULTR_HOST="root@207.148.70.106"
VULTR_SPA_PATH="/opt/holaday-monorepo/apps/web-workbench/dist"
VULTR_BACKUP_PATH="/opt/holaday-monorepo/apps/web-workbench/dist.bak"
VULTR_SMOKE_URL="https://holaday.ai/app"
VULTR_SMOKE_RESOLVE="holaday.ai:443:207.148.70.106"
VULTR_REMOTE_SMOKE_RESOLVE="holaday.ai:443:127.0.0.1"

# Non-interactive password auth — pulled from env / local deploy env so
# passwords don't end up in shell history. Uses sshpass when installed,
# otherwise OpenSSH SSH_ASKPASS.
build_ssh_password_prefix "${ALIYUN_PASSWORD:-}"
ALIYUN_AUTH_PREFIX=("${SSH_PASSWORD_PREFIX[@]}")
SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o NumberOfPasswordPrompts=1
  -o ConnectTimeout=15
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=3
  -o TCPKeepAlive=yes
)
REMOTE_RETRIES="${DEPLOY_REMOTE_RETRIES:-3}"
REMOTE_RETRY_SLEEP="${DEPLOY_REMOTE_RETRY_SLEEP:-5}"

if ! [[ "$REMOTE_RETRIES" =~ ^[1-9][0-9]*$ ]]; then
  echo "❌ DEPLOY_REMOTE_RETRIES must be a positive integer" >&2
  exit 1
fi
if ! [[ "$REMOTE_RETRY_SLEEP" =~ ^[0-9]+$ ]]; then
  echo "❌ DEPLOY_REMOTE_RETRY_SLEEP must be a non-negative integer" >&2
  exit 1
fi

run_with_retry() {
  local label="$1"
  shift
  local attempt rc

  for ((attempt = 1; attempt <= REMOTE_RETRIES; attempt++)); do
    set +e
    "$@"
    rc=$?
    set -e
    if ((rc == 0)); then
      return 0
    fi
    if ((attempt == REMOTE_RETRIES)); then
      echo "❌ $label failed after $attempt attempt(s) (exit $rc)" >&2
      return "$rc"
    fi
    echo "⚠️  $label failed (exit $rc); retrying in ${REMOTE_RETRY_SLEEP}s ($attempt/$REMOTE_RETRIES)" >&2
    sleep "$REMOTE_RETRY_SLEEP"
  done
}

run_with_retry_filtered() {
  local label="$1"
  shift
  local attempt rc tmp

  for ((attempt = 1; attempt <= REMOTE_RETRIES; attempt++)); do
    tmp=$(mktemp)
    set +e
    "$@" >"$tmp" 2>&1
    rc=$?
    set -e
    if ((rc == 0)); then
      grep -v -E 'LIBARCHIVE\.xattr|time stamp .* is .* in the future' "$tmp" || true
      rm -f "$tmp"
      return 0
    fi
    grep -v -E 'LIBARCHIVE\.xattr|time stamp .* is .* in the future' "$tmp" || true
    rm -f "$tmp"
    if ((attempt == REMOTE_RETRIES)); then
      echo "❌ $label failed after $attempt attempt(s) (exit $rc)" >&2
      return "$rc"
    fi
    echo "⚠️  $label failed (exit $rc); retrying in ${REMOTE_RETRY_SLEEP}s ($attempt/$REMOTE_RETRIES)" >&2
    sleep "$REMOTE_RETRY_SLEEP"
  done
}

count_matches() {
  local needle="$1"
  local path="$2"
  local count

  count=$(grep -F -c -- "$needle" "$path" 2>/dev/null || true)
  printf '%s\n' "${count:-0}" | head -1
}

smoke_check() {
  local label="$1"
  local url="$2"
  local response_path="$3"
  shift 3
  local http_code marker_count bundle_count attempt

  for attempt in 1 2; do
    http_code=$(curl -s --max-time 15 "$@" -o "$response_path" -w '%{http_code}' "$url" 2>&1 || true)
    marker_count=$(count_matches "$SMOKE_MARKER" "$response_path")
    bundle_count=$(count_matches "$NEW_HASH" "$response_path")
    if [[ "$http_code" == "200" ]] && ((marker_count > 0)) && ((bundle_count > 0)); then
      echo "✅ $label smoke check passed"
      return 0
    fi
    echo "   attempt $attempt: http=$http_code, marker=$marker_count, bundle=$bundle_count"
    sleep 3
  done

  echo "❌ $label smoke FAILED" >&2
  return 1
}

vultr_remote_smoke_check() {
  local result

  if result=$(run_with_retry "Vultr remote smoke" "${VULTR_SSH[@]}" "$VULTR_HOST" \
    "response=/tmp/vultr-smoke-remote.html; \
     http_code=\$(curl -s --max-time 15 --resolve '$VULTR_REMOTE_SMOKE_RESOLVE' -o \"\$response\" -w '%{http_code}' '$VULTR_SMOKE_URL' 2>&1 || true); \
     marker_count=\$(grep -F -c -- '$SMOKE_MARKER' \"\$response\" 2>/dev/null || true); \
     bundle_count=\$(grep -F -c -- '$NEW_HASH' \"\$response\" 2>/dev/null || true); \
     marker_count=\$(printf '%s\n' \"\${marker_count:-0}\" | head -1); \
     bundle_count=\$(printf '%s\n' \"\${bundle_count:-0}\" | head -1); \
     printf 'http=%s, marker=%s, bundle=%s\n' \"\$http_code\" \"\$marker_count\" \"\$bundle_count\"; \
     [ \"\$http_code\" = \"200\" ] && [ \"\$marker_count\" -gt 0 ] && [ \"\$bundle_count\" -gt 0 ]"); then
    echo "✅ Vultr remote smoke check passed"
    echo "   remote: $result"
    return 0
  fi

  echo "❌ Vultr remote smoke FAILED" >&2
  if [[ -n "${result:-}" ]]; then
    echo "   remote: $result" >&2
  fi
  return 1
}

if [[ ! -d "$DIST_DIR" ]]; then
  echo "❌ $DIST_DIR not found. Run: pnpm --filter @holaday/web-workbench build" >&2
  exit 1
fi

NEW_HASH=$(grep -o 'index-[^"]*\.js' "$DIST_DIR/index.html" | head -1 || echo unknown)
echo "📦 Local bundle: $NEW_HASH"

ALIYUN_SSH=("${ALIYUN_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}")
ALIYUN_SCP=("${ALIYUN_AUTH_PREFIX[@]}" scp "${SSH_OPTS[@]}")

echo "→ Backing up current dist on Aliyun"
run_with_retry "Aliyun backup" "${ALIYUN_SSH[@]}" "$ALIYUN_HOST" \
  "rm -rf $BACKUP_PATH && cp -r $SPA_PATH $BACKUP_PATH"

echo "→ Packing + uploading $DIST_DIR"
rm -f "$TARBALL"
COPYFILE_DISABLE=1 tar czf "$TARBALL" -C apps/web-workbench dist
run_with_retry "Aliyun upload" "${ALIYUN_SCP[@]}" "$TARBALL" "$ALIYUN_HOST:/tmp/" >/dev/null

echo "→ Extracting on Aliyun"
run_with_retry_filtered "Aliyun extract" "${ALIYUN_SSH[@]}" "$ALIYUN_HOST" \
  "cd /opt/holaday-spa && tar xzf /tmp/holaday-spa-dist.tar.gz"

echo "→ Smoke check ($SMOKE_URL must return '$SMOKE_MARKER' + $NEW_HASH)"
sleep 2
if ! smoke_check "Aliyun" "$SMOKE_URL" /tmp/smoke-resp.html; then
  echo "❌ Smoke check FAILED — rolling back"
  echo "Last response head:"
  head -5 /tmp/smoke-resp.html 2>/dev/null | sed 's/^/   /'
  run_with_retry "Aliyun rollback" "${ALIYUN_SSH[@]}" "$ALIYUN_HOST" \
    "rm -rf $SPA_PATH && mv $BACKUP_PATH $SPA_PATH"
  echo "🔄 Rolled back to previous version"
  exit 1
fi

DEPLOYED_HASH=$(run_with_retry "Aliyun bundle hash" "${ALIYUN_SSH[@]}" "$ALIYUN_HOST" \
  "grep -o 'index-[^\"]*\.js' $SPA_PATH/index.html | head -1")
echo "✅ Aliyun bundle: $DEPLOYED_HASH"
if [[ "$DEPLOYED_HASH" != "$NEW_HASH" ]]; then
  echo "❌ Hash mismatch — local $NEW_HASH vs Aliyun $DEPLOYED_HASH" >&2
  exit 1
fi

# ───────────────────────── Vultr mirror ─────────────────────────
#
# Same tarball, different extract path. Smoke probes a deep route
# (/app — under the SPA fallback) since `/` lands on the marketing
# landing page.
echo
echo "→ Mirroring to Vultr (holaday.ai)"
if [[ -z "${VULTR_PASSWORD:-}" ]]; then
  echo "❌ VULTR_PASSWORD unset — refusing partial SPA deploy" >&2
  echo "    Set VULTR_PASSWORD so holaday.ai and Aliyun serve the same bundle." >&2
  exit 1
fi

build_ssh_password_prefix "$VULTR_PASSWORD"
VULTR_AUTH_PREFIX=("${SSH_PASSWORD_PREFIX[@]}")
VULTR_SSH=("${VULTR_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}")
VULTR_SCP=("${VULTR_AUTH_PREFIX[@]}" scp "${SSH_OPTS[@]}")

echo "→ Uploading tarball to Vultr"
run_with_retry "Vultr upload" "${VULTR_SCP[@]}" "$TARBALL" "$VULTR_HOST:/tmp/" >/dev/null

echo "→ Staging Vultr dist"
run_with_retry_filtered "Vultr stage" "${VULTR_SSH[@]}" "$VULTR_HOST" \
  "rm -rf /tmp/holaday-spa-new && \
   mkdir -p /tmp/holaday-spa-new && \
   tar xzf /tmp/holaday-spa-dist.tar.gz -C /tmp/holaday-spa-new"

echo "→ Switching Vultr dist"
run_with_retry "Vultr switch" "${VULTR_SSH[@]}" "$VULTR_HOST" \
  "set -e; \
   cd /opt/holaday-monorepo/apps/web-workbench; \
   if [ ! -d /tmp/holaday-spa-new/dist ]; then \
     grep -q '$NEW_HASH' dist/index.html 2>/dev/null && exit 0; \
     echo 'staged dist missing' >&2; \
     exit 1; \
   fi; \
   rm -rf dist.prev; \
   if [ -d dist ]; then mv dist dist.prev; fi; \
   mv /tmp/holaday-spa-new/dist dist; \
   rm -rf $VULTR_BACKUP_PATH; \
   if [ -d dist.prev ]; then mv dist.prev $VULTR_BACKUP_PATH; fi"

echo "→ Vultr smoke check ($VULTR_SMOKE_URL via $VULTR_SMOKE_RESOLVE must return '$SMOKE_MARKER' + $NEW_HASH)"
sleep 2
if ! smoke_check "Vultr" "$VULTR_SMOKE_URL" /tmp/vultr-smoke.html --resolve "$VULTR_SMOKE_RESOLVE"; then
  echo "⚠️  Vultr local-origin smoke failed from deploy host; verifying from inside Vultr before rollback"
  if ! vultr_remote_smoke_check; then
    echo "❌ Vultr smoke FAILED — rolling Vultr back"
    run_with_retry "Vultr rollback" "${VULTR_SSH[@]}" "$VULTR_HOST" \
      "rm -rf $VULTR_SPA_PATH && mv $VULTR_BACKUP_PATH $VULTR_SPA_PATH"
    echo "🔄 Vultr rolled back. Aliyun deploy remains."
    exit 1
  fi
fi

VULTR_DEPLOYED_HASH=$(run_with_retry "Vultr bundle hash" "${VULTR_SSH[@]}" "$VULTR_HOST" \
  "grep -o 'index-[^\"]*\.js' $VULTR_SPA_PATH/index.html | head -1")
echo "✅ Vultr bundle:  $VULTR_DEPLOYED_HASH"
if [[ "$VULTR_DEPLOYED_HASH" != "$NEW_HASH" ]]; then
  echo "❌ Vultr hash mismatch — local $NEW_HASH vs Vultr $VULTR_DEPLOYED_HASH" >&2
  exit 1
fi
