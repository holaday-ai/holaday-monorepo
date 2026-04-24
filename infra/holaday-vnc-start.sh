#!/bin/bash
# Phase 12 VNC wrapper with per-process supervision.
#
# x11vnc 0.9.16 (last upstream 2019) crashes with SIGSEGV every few
# hours of idle. Phase 6-2b's baseline relied on pm2 restarting the
# whole wrapper script when x11vnc died — but the original wrapper
# used `exec websockify` which kept the wrapper alive as long as
# websockify was alive, so x11vnc death just left a refused-
# connection storm and pm2 never noticed.
#
# Fix: both processes get their own supervisor loop inside this
# script. If either dies we restart it; if the whole script dies
# pm2 restarts it.
set -u

cleanup() {
  # Graceful shutdown on TERM / INT: kill both children + exit.
  # EXIT trap fires regardless so pm2 sees us go.
  pkill -P $$ 2>/dev/null || true
}
trap cleanup EXIT TERM INT

# ---- x11vnc supervisor loop ----
(
  while true; do
    echo "[$(date -u +%FT%TZ)] x11vnc: starting"
    x11vnc \
      -display :98 \
      -forever \
      -nopw \
      -shared \
      -noxdamage \
      -listen 127.0.0.1 \
      -rfbport 5901
    echo "[$(date -u +%FT%TZ)] x11vnc: exited (code $?), restarting in 2s"
    sleep 2
  done
) &

# Give x11vnc a beat to bind 5901 before websockify tries to proxy.
sleep 2

# ---- websockify supervisor loop ----
while true; do
  echo "[$(date -u +%FT%TZ)] websockify: starting"
  websockify \
    --heartbeat 30 \
    --web /usr/share/novnc \
    127.0.0.1:6080 \
    127.0.0.1:5901
  echo "[$(date -u +%FT%TZ)] websockify: exited (code $?), restarting in 2s"
  sleep 2
done
