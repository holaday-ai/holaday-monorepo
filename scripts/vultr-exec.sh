#!/usr/bin/env bash
#
# Robust, non-interactive SSH to the Vultr prod box — safe for long-running /
# detached background polling.
#
# Why this exists: ad-hoc `sshpass -p '<password>' ssh ...` puts the password in
# argv. The prod root password contains shell-special chars (parens, *, [) and,
# in a detached/background shell, the inline `-p '...'` form got mangled and auth
# failed ("Permission denied (publickey,password)") — so a background poll died
# instantly instead of waiting for the task's terminal state.
#
# This wrapper instead uses `sshpass -e`, which reads the password from the
# $SSHPASS environment variable. Env is not subject to argv quoting/word-split
# and isn't visible in `ps`, so it's both more robust AND more secure. Keepalive
# options stop a long poll's connection from being dropped mid-wait.
#
# Usage:
#   SSHPASS="$VULTR_PASSWORD" scripts/vultr-exec.sh '<remote command>'
#   # background-safe (the original failure mode):
#   SSHPASS="$VULTR_PASSWORD" scripts/vultr-exec.sh 'node /tmp/poll.mjs' &
#
# Never commit the password; pass it via SSHPASS at call time only.
set -euo pipefail

: "${SSHPASS:?set SSHPASS to the Vultr root password (e.g. SSHPASS=\"\$VULTR_PASSWORD\")}"
if [ "$#" -lt 1 ]; then
  echo "usage: SSHPASS=<pw> $0 '<remote command>'" >&2
  exit 2
fi

HOST="${VULTR_HOST:-207.148.70.106}"

exec sshpass -e ssh \
  -o StrictHostKeyChecking=no \
  -o ConnectTimeout=30 \
  -o ServerAliveInterval=20 \
  -o ServerAliveCountMax=6 \
  -o BatchMode=no \
  "root@${HOST}" "$@"
