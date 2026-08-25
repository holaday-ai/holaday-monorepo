#!/bin/bash
# SPA deploy with smoke check + auto-rollback.
#
# White-screen postmortem (1de57cc) made the smoke check
# non-negotiable: build, ship, then verify the live HTML responds
# with our marker string. Aliyun rolls back its atomic edge release;
# Vultr restores the SPA and landing-site backup pair.
#
# BOSS-feedback follow-up (2026-05-18) — script now pushes to BOTH
# Aliyun AND Vultr. The Aliyun-only flow let Vultr's SPA dist sit
# 15 days stale; holaday.ai (which hits Vultr nginx directly, no
# CF in front yet) silently served the old bundle until BOSS noticed
# a hash mismatch. Vultr now publishes the SPA and landing site together so
# exact legal routes cannot remain on an older release.
#
# Usage:   ./scripts/deploy-spa.sh
# Env:     ALIYUN_PASSWORD + VULTR_PASSWORD (both required)
# Exits:   0 on success, 1 on smoke failure (auto-rollback first)
#
# Caller is expected to have built `apps/web-workbench/dist`
# already. The script itself does NOT rebuild.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

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
ALIYUN_DOMAIN="hd-app.orangebench.tech"
ALIYUN_EDGE_DEPLOY="$ROOT_DIR/ops/aliyun-edge/deploy.sh"
ALIYUN_EDGE_ROOT="/opt/holaday-edge"
DIST_DIR="apps/web-workbench/dist"
LANDING_DIR="apps/holaday-landing"
# Probe the SPA entry, not the marketing root, so the response contains
# both the smoke marker and the deployed bundle hash.
SMOKE_URL="https://hd-app.orangebench.tech/app"
SMOKE_MARKER="HOLA DAY"
TARBALL="/tmp/holaday-web-release.tar.gz"
PORTABLE_TAR_SCRIPT="$ROOT_DIR/scripts/create-portable-tar.sh"
VULTR_WEB_SWITCH_SCRIPT="scripts/switch-vultr-web-release.sh"

# Vultr SPA mirror — holaday.ai serves this directly until Phase 28
# Cloudflare migration is done.
VULTR_HOST="root@207.148.70.106"
VULTR_SPA_PATH="/opt/holaday-monorepo/apps/web-workbench/dist"
VULTR_SPA_BACKUP_PATH="/opt/holaday-monorepo/apps/web-workbench/dist.bak"
VULTR_LANDING_PATH="/opt/holaday-landing"
VULTR_LANDING_BACKUP_PATH="/opt/holaday-landing.bak"
VULTR_WEB_STATE_PATH="/var/lib/holaday-deploy/vultr-web-release.state"
VULTR_STAGE_ROOT="/tmp/holaday-web-new"
VULTR_SMOKE_URL="https://holaday.ai/app"
VULTR_SMOKE_RESOLVE="holaday.ai:443:207.148.70.106"
VULTR_REMOTE_SMOKE_RESOLVE="holaday.ai:443:127.0.0.1"
VULTR_PRIVACY_URL="https://holaday.ai/privacy"
VULTR_TERMS_URL="https://holaday.ai/terms"

# Non-interactive password auth — pulled from env / local deploy env so
# passwords don't end up in shell history. Uses sshpass when installed,
# otherwise OpenSSH SSH_ASKPASS.
if [[ -z "${ALIYUN_PASSWORD:-}" ]]; then
  echo "❌ ALIYUN_PASSWORD unset — refusing SPA deploy" >&2
  exit 1
fi
build_ssh_password_prefix "$ALIYUN_PASSWORD"
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

sha256_file() {
  local path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    shasum -a 256 "$path" | awk '{print $1}'
  fi
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

vultr_legal_smoke_check() {
  local page url expected_sha response_path http_code actual_sha attempt

  for page in privacy terms; do
    if [[ "$page" == "privacy" ]]; then
      url="$VULTR_PRIVACY_URL"
      expected_sha="$VULTR_PRIVACY_SHA"
    else
      url="$VULTR_TERMS_URL"
      expected_sha="$VULTR_TERMS_SHA"
    fi
    response_path="/tmp/vultr-${page}-smoke.html"

    for attempt in 1 2; do
      http_code=$(curl -s --max-time 15 --resolve "$VULTR_SMOKE_RESOLVE" \
        -o "$response_path" -w '%{http_code}' "$url" 2>&1 || true)
      actual_sha=$(sha256_file "$response_path" 2>/dev/null || true)
      if [[ "$http_code" == "200" && "$actual_sha" == "$expected_sha" ]]; then
        echo "✅ Vultr $page origin smoke check passed"
        break
      fi
      echo "   $page attempt $attempt: http=$http_code, content_match=$([[ "$actual_sha" == "$expected_sha" ]] && echo 1 || echo 0)"
      if (( attempt == 2 )); then
        echo "❌ Vultr $page origin smoke FAILED" >&2
        return 1
      fi
      sleep 3
    done
  done
}

rollback_vultr_web() {
  run_with_retry "Vultr web rollback" "${VULTR_SSH[@]}" "$VULTR_HOST" \
    "VULTR_WEB_SPA_PATH='$VULTR_SPA_PATH' \
     VULTR_WEB_SPA_BACKUP_PATH='$VULTR_SPA_BACKUP_PATH' \
     VULTR_WEB_LANDING_PATH='$VULTR_LANDING_PATH' \
     VULTR_WEB_LANDING_BACKUP_PATH='$VULTR_LANDING_BACKUP_PATH' \
     VULTR_WEB_STATE_PATH='$VULTR_WEB_STATE_PATH' \
     bash '$VULTR_STAGE_ROOT/$VULTR_WEB_SWITCH_SCRIPT' rollback"
}

rollback_aliyun_edge() {
  local release_id="$1"

  run_with_retry "Aliyun edge rollback" "${ALIYUN_SSH[@]}" "$ALIYUN_HOST" \
    "bash '$ALIYUN_EDGE_ROOT/releases/$release_id/ops/aliyun-edge/rollback-remote.sh' '$ALIYUN_DOMAIN' '$release_id'"
}

assert_aliyun_release_active() {
  local expected_release_id="$1"
  local active_release_id

  active_release_id=$(run_with_retry "Aliyun active release" "${ALIYUN_SSH[@]}" "$ALIYUN_HOST" \
    "current_target=\$(readlink '$ALIYUN_EDGE_ROOT/current') && basename \"\$current_target\"")
  active_release_id=$(printf '%s\n' "$active_release_id" | tail -1 | tr -d '[:space:]')
  if [[ "$active_release_id" != "$expected_release_id" ]]; then
    echo "❌ Aliyun release $expected_release_id was superseded by ${active_release_id:-unknown}" >&2
    return 1
  fi
}

if [[ ! -d "$DIST_DIR" ]]; then
  echo "❌ $DIST_DIR not found. Run: pnpm --filter @holaday/web-workbench build" >&2
  exit 1
fi
if [[ ! -x "$PORTABLE_TAR_SCRIPT" ]]; then
  echo "❌ $PORTABLE_TAR_SCRIPT is not executable" >&2
  exit 1
fi
if [[ ! -x "$VULTR_WEB_SWITCH_SCRIPT" ]]; then
  echo "❌ $VULTR_WEB_SWITCH_SCRIPT is not executable" >&2
  exit 1
fi

NEW_HASH=$(grep -o 'index-[^"]*\.js' "$DIST_DIR/index.html" | head -1 || echo unknown)
VULTR_PRIVACY_SHA=$(sha256_file "$LANDING_DIR/privacy.html")
VULTR_TERMS_SHA=$(sha256_file "$LANDING_DIR/terms.html")
VULTR_WEB_MANIFEST=$(bash "$VULTR_WEB_SWITCH_SCRIPT" manifest "$DIST_DIR" "$LANDING_DIR")
echo "📦 Local bundle: $NEW_HASH"

ALIYUN_SSH=("${ALIYUN_AUTH_PREFIX[@]}" ssh "${SSH_OPTS[@]}")
ALIYUN_RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-$$"
ALIYUN_EDGE_RELEASE_SPA_PATH="$ALIYUN_EDGE_ROOT/releases/$ALIYUN_RELEASE_ID/apps/web-workbench/dist"

echo "→ Packing the SPA and landing site for the Vultr mirror"
rm -f "$TARBALL"
"$PORTABLE_TAR_SCRIPT" "$TARBALL" apps/web-workbench/dist apps/holaday-landing "$VULTR_WEB_SWITCH_SCRIPT"

echo "→ Publishing Aliyun through the atomic edge release"
HOLADAY_EDGE_RELEASE_ID="$ALIYUN_RELEASE_ID" SSHPASS="$ALIYUN_PASSWORD" "$ALIYUN_EDGE_DEPLOY"
assert_aliyun_release_active "$ALIYUN_RELEASE_ID"

DEPLOYED_HASH=$(run_with_retry "Aliyun bundle hash" "${ALIYUN_SSH[@]}" "$ALIYUN_HOST" \
  "grep -o 'index-[^\"]*\.js' $ALIYUN_EDGE_RELEASE_SPA_PATH/index.html | head -1")
echo "✅ Aliyun bundle: $DEPLOYED_HASH"
if [[ "$DEPLOYED_HASH" != "$NEW_HASH" ]]; then
  echo "❌ Hash mismatch — local $NEW_HASH vs Aliyun $DEPLOYED_HASH" >&2
  rollback_aliyun_edge "$ALIYUN_RELEASE_ID"
  exit 1
fi

echo "→ Smoke check ($SMOKE_URL must return '$SMOKE_MARKER' + $NEW_HASH)"
sleep 2
if ! smoke_check "Aliyun" "$SMOKE_URL" /tmp/smoke-resp.html; then
  echo "❌ Smoke check FAILED — rolling back edge release $ALIYUN_RELEASE_ID"
  echo "Last response head:"
  head -5 /tmp/smoke-resp.html 2>/dev/null | sed 's/^/   /'
  rollback_aliyun_edge "$ALIYUN_RELEASE_ID"
  echo "🔄 Aliyun edge rolled back to the previous release"
  exit 1
fi
assert_aliyun_release_active "$ALIYUN_RELEASE_ID"

# ───────────────────────── Vultr mirror ─────────────────────────
#
# The Vultr archive contains both web surfaces. Activation and rollback keep
# the SPA and exact-route landing pages on one release boundary.
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

echo "→ Staging Vultr web release"
run_with_retry_filtered "Vultr stage" "${VULTR_SSH[@]}" "$VULTR_HOST" \
  "rm -rf '$VULTR_STAGE_ROOT' && \
   mkdir -p '$VULTR_STAGE_ROOT' && \
   tar xzf '$TARBALL' -C '$VULTR_STAGE_ROOT'"

echo "→ Switching Vultr web release"
run_with_retry "Vultr web switch" "${VULTR_SSH[@]}" "$VULTR_HOST" \
  "VULTR_WEB_SPA_PATH='$VULTR_SPA_PATH' \
   VULTR_WEB_SPA_BACKUP_PATH='$VULTR_SPA_BACKUP_PATH' \
   VULTR_WEB_LANDING_PATH='$VULTR_LANDING_PATH' \
   VULTR_WEB_LANDING_BACKUP_PATH='$VULTR_LANDING_BACKUP_PATH' \
   VULTR_WEB_STATE_PATH='$VULTR_WEB_STATE_PATH' \
   bash '$VULTR_STAGE_ROOT/$VULTR_WEB_SWITCH_SCRIPT' activate \
     '$VULTR_STAGE_ROOT' '$NEW_HASH' '$VULTR_WEB_MANIFEST'"

echo "→ Vultr smoke check ($VULTR_SMOKE_URL via $VULTR_SMOKE_RESOLVE must return '$SMOKE_MARKER' + $NEW_HASH)"
sleep 2
if ! smoke_check "Vultr" "$VULTR_SMOKE_URL" /tmp/vultr-smoke.html --resolve "$VULTR_SMOKE_RESOLVE"; then
  echo "⚠️  Vultr local-origin smoke failed from deploy host; verifying from inside Vultr before rollback"
  if ! vultr_remote_smoke_check; then
    echo "❌ Vultr smoke FAILED — rolling both Vultr web surfaces back"
    rollback_vultr_web
    echo "🔄 Vultr SPA and landing site rolled back. Aliyun deploy remains."
    exit 1
  fi
fi

echo "→ Vultr legal-page smoke check (privacy and terms must match this release)"
if ! vultr_legal_smoke_check; then
  echo "❌ Vultr legal-page smoke FAILED — rolling both Vultr web surfaces back"
  rollback_vultr_web
  echo "🔄 Vultr SPA and landing site rolled back. Aliyun deploy remains."
  exit 1
fi

VULTR_DEPLOYED_HASH=$(run_with_retry "Vultr bundle hash" "${VULTR_SSH[@]}" "$VULTR_HOST" \
  "grep -o 'index-[^\"]*\.js' $VULTR_SPA_PATH/index.html | head -1")
echo "✅ Vultr bundle:  $VULTR_DEPLOYED_HASH"
if [[ "$VULTR_DEPLOYED_HASH" != "$NEW_HASH" ]]; then
  echo "❌ Vultr hash mismatch — local $NEW_HASH vs Vultr $VULTR_DEPLOYED_HASH" >&2
  rollback_vultr_web
  exit 1
fi
