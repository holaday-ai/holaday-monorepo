#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node --test "$SCRIPT_DIR/deploy-browser-maintenance.test.mjs" "$SCRIPT_DIR/browser-maintenance-host.test.mjs" "$SCRIPT_DIR/browser-maintenance-transition.test.mjs"
