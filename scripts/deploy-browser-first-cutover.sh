#!/bin/bash
# Explicit first-cutover entry; ordinary deployment remains separate.
set -euo pipefail
set +x
fail() { echo "$1" >&2; exit 1; }
[[ $# -ge 2 && $# -le 3 ]] || fail CUTOVER_COORDINATOR_USAGE
CANDIDATE="$1"
ATTEMPT="$2"
MODE="${3:---check}"
[[ "$CANDIDATE" =~ ^[a-f0-9]{40}$ && "$ATTEMPT" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$ ]] || fail CUTOVER_COORDINATOR_USAGE
[[ "$MODE" == --check || "$MODE" == --execute ]] || fail CUTOVER_COORDINATOR_USAGE
# Both modes use the fixed protected entry and its original execution gates.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-deploy-env.sh"
source "$SCRIPT_DIR/ssh-password-auth.sh"
[[ -n "${VULTR_PASSWORD:-}" ]] || fail CUTOVER_COORDINATOR_CREDENTIAL_REQUIRED
build_ssh_password_prefix "$VULTR_PASSWORD"
SSH_ARGS=(-o StrictHostKeyChecking=yes -o ForwardAgent=no -o ClearAllForwardings=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -T root@207.148.70.106)
REMOTE_COMMAND="cd / && env -i PATH=/opt/node22/bin:/usr/bin:/bin /opt/node22/bin/node '/var/lib/holaday-deploy/first-cutover/$CANDIDATE/browser-first-cutover-host.mjs' $MODE '$ATTEMPT'"
# One request. A failed/unknown response is never replayed.
if ! RESULT="$("${SSH_PASSWORD_PREFIX[@]}" ssh "${SSH_ARGS[@]}" "$REMOTE_COMMAND" 2>/dev/null)"; then
  [[ "$MODE" != --execute ]] || fail CUTOVER_COORDINATOR_EXECUTION_RESULT_UNKNOWN
  fail CUTOVER_COORDINATOR_CHECK_UNPROVEN
fi
if ! CHECKED="$(printf '%s' "$RESULT" | node --input-type=module -e '
let text="";
for await(const chunk of process.stdin){text+=chunk;if(text.length>16384)process.exit(1);}
try {
  const p=JSON.parse(text);
  if(process.argv[3]==="--execute") {
    if(p.kind!=="first-cutover-execution-result" || p.candidate!==process.argv[1] || p.attempt!==process.argv[2] || p.ok!==true || p.phase!=="reconciled")process.exit(1);
    console.log(JSON.stringify({kind:p.kind,candidate:p.candidate,attempt:p.attempt,ok:true,phase:p.phase}));
    process.exit(0);
  }
  if(p.kind!=="coordinator-source-inspection" || p.candidate!==process.argv[1] ||
     !/^[a-f0-9]{64}$/.test(p.toolDigest??"") || p.releaseReady!==false)process.exit(1);
  console.log(JSON.stringify({kind:p.kind,candidate:p.candidate,toolDigest:p.toolDigest,releaseReady:false}));
} catch {process.exit(1);}
' "$CANDIDATE" "$ATTEMPT" "$MODE" 2>/dev/null)"; then
  [[ "$MODE" != --execute ]] || fail CUTOVER_COORDINATOR_EXECUTION_RESULT_UNKNOWN
  fail CUTOVER_COORDINATOR_CHECK_UNPROVEN
fi
printf '%s\n' "$CHECKED"
