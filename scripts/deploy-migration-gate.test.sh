#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# No live database, SSH, PM2, or migration: actual release adapters with injected I/O.
node --test "$SCRIPT_DIR/browser-maintenance-manifest.test.mjs" \
  "$SCRIPT_DIR/browser-cutover-evidence.test.mjs" \
  "$SCRIPT_DIR/browser-first-cutover-backup.test.mjs" \
  "$SCRIPT_DIR/browser-first-cutover-age.test.mjs" \
  "$SCRIPT_DIR/browser-first-cutover-host.test.mjs" \
  "$SCRIPT_DIR/browser-first-cutover-transition.test.mjs" \
  "$SCRIPT_DIR/browser-maintenance-release-tail.test.mjs" \
  "$SCRIPT_DIR/browser-maintenance-journal.test.mjs" \
  "$SCRIPT_DIR/browser-maintenance-host.test.mjs" \
  "$SCRIPT_DIR/browser-maintenance-transition.test.mjs"
