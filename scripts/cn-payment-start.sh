#!/usr/bin/env bash

set -Eeuo pipefail

ROOT=/opt/holaday-cn-payment
APP_DIR="$ROOT/src/apps/cn-payment"
ENV_FILE="$APP_DIR/.env"
ENV_EXPORTER="$ROOT/src/scripts/cn-payment-env-export.mjs"

cd "$APP_DIR"
unset HOLADAY_ENV_LOAD_COMPLETE
# The exporter emits only validated variable names and base64-decoded shell
# assignments. The dotenv file itself is never executed as shell code, and
# raw values never enter command arguments or logs.
source <(/usr/bin/node "$ENV_EXPORTER" "$ENV_FILE")
if [[ "${HOLADAY_ENV_LOAD_COMPLETE:-0}" != "1" ]]; then
  echo 'CN payment start failed: environment export incomplete' >&2
  exit 1
fi
unset HOLADAY_ENV_LOAD_COMPLETE

# Export before exec so the service's initial OS environment, and therefore
# the privacy-safe /proc rollout proof, matches the active release env file.
exec /usr/bin/npx tsx src/index.ts
