#!/bin/bash
# Maintenance-only release. Legacy bootstrap is a separate reviewed operation.
# Never retry an uncertain remote cutover.
set -euo pipefail
set +x
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail() { echo "$1" >&2; exit 1; }
[[ $# -eq 2 ]] || fail MAINTENANCE_TARGET_REQUIRED
BRANCH="$1"
CANDIDATE="$2"
[[ "$BRANCH" =~ ^[a-zA-Z0-9][a-zA-Z0-9/_-]*$ && "$CANDIDATE" =~ ^[a-f0-9]{40}$ ]] ||
  fail MAINTENANCE_TARGET_REQUIRED
CONFIG_DIGEST="${HOLADAY_TARGET_CONFIG_SHA256:-}"
MIGRATION_DIGEST="${HOLADAY_MIGRATION_MANIFEST_SHA256:-}"
INVENTORY_DIGEST="${HOLADAY_HOST_INVENTORY_SHA256:-}"
[[ "$CONFIG_DIGEST" =~ ^[a-f0-9]{64}$ && "$MIGRATION_DIGEST" =~ ^[a-f0-9]{64}$ && "$INVENTORY_DIGEST" =~ ^[a-f0-9]{64}$ ]] ||
  fail MAINTENANCE_MANIFEST_REQUIRED
source "$SCRIPT_DIR/load-deploy-env.sh"
source "$SCRIPT_DIR/ssh-password-auth.sh"
[[ -n "${VULTR_PASSWORD:-}" ]] || fail MAINTENANCE_CREDENTIAL_REQUIRED
build_ssh_password_prefix "$VULTR_PASSWORD"
SSH_ARGS=(-o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 root@207.148.70.106)
if ! PROOF="$("${SSH_PASSWORD_PREFIX[@]}" ssh "${SSH_ARGS[@]}" "bash -s -- browser-maintenance-probe" < "$SCRIPT_DIR/browser-maintenance-probe.sh" 2>/dev/null)"; then
  fail LEGACY_DRAIN_UNSUPPORTED
fi
if ! OLD_IDENTITY="$(printf '%s' "$PROOF" | node --input-type=module -e '
let text = ""; for await (const chunk of process.stdin) { text += chunk; if (text.length > 16384) process.exit(1); }
try {
  const p = JSON.parse(text);
  if (p.protocol !== 1 || !/^[a-f0-9]{40}$/.test(p.identity?.candidate ?? "") ||
      !/^[a-f0-9]{32}$/.test(p.identity?.bootId ?? "") ||
      !["serving", "closed"].includes(p.mode) || typeof p.idle !== "boolean" ||
      typeof p.needsReconciliation !== "boolean") process.exit(1);
  console.log(p.identity.candidate + " " + p.identity.bootId);
} catch { process.exit(1); }
' 2>/dev/null)"; then
  fail LEGACY_DRAIN_UNSUPPORTED
fi
read -r OLD_SHA OLD_BOOT <<< "$OLD_IDENTITY"
# Arguments are validated to a shell-safe alphabet. Use the installed driver.
REMOTE_COMMAND="/opt/node22/bin/node '/opt/holaday-releases/$OLD_SHA/scripts/browser-maintenance-host.mjs' '$BRANCH' '$CANDIDATE' '$CONFIG_DIGEST' '$MIGRATION_DIGEST' '$INVENTORY_DIGEST' '$OLD_SHA' '$OLD_BOOT'"
if ! RESULT="$("${SSH_PASSWORD_PREFIX[@]}" ssh "${SSH_ARGS[@]}" "$REMOTE_COMMAND" 2>/dev/null)"; then
  fail MAINTENANCE_RELEASE_INCOMPLETE_INSPECT_PHASE
fi
if ! OPENED_BOOT="$(printf '%s' "$RESULT" | node --input-type=module -e '
let text = ""; for await (const chunk of process.stdin) { text += chunk; if (text.length > 16384) process.exit(1); }
try {
  const p = JSON.parse(text);
  if (p.ok !== true || p.phase !== "opened" || p.identity?.candidate !== process.argv[1] ||
      !/^[a-f0-9]{32}$/.test(p.identity?.bootId ?? "") || p.identity.bootId === process.argv[2]) process.exit(1);
  console.log(p.identity.bootId);
} catch { process.exit(1); }
' "$CANDIDATE" "$OLD_BOOT" 2>/dev/null)"; then
  fail MAINTENANCE_RELEASE_INCOMPLETE_INSPECT_PHASE
fi
printf 'MAINTENANCE_RELEASE_OPENED %s %s\n' "$CANDIDATE" "$OPENED_BOOT"
