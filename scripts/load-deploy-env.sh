#!/bin/bash
# Load local deploy credentials without committing secrets.
#
# Supported locations, first match wins:
#   1. $HOLADAY_DEPLOY_ENV
#   2. .env.deploy.local in the repo root
#   3. ~/.config/holaday/deploy.env
#   4. ~/.holaday/deploy.env
#
# The files are regular shell env files, for example:
#   ALIYUN_PASSWORD='...'
#   VULTR_PASSWORD='...'
#   SKIP_AUTO_SMOKE=1

if [[ -n "${HOLADAY_DEPLOY_ENV:-}" ]]; then
  DEPLOY_ENV_CANDIDATES=("$HOLADAY_DEPLOY_ENV")
else
  DEPLOY_ENV_CANDIDATES=(
    ".env.deploy.local"
    "$HOME/.config/holaday/deploy.env"
    "$HOME/.holaday/deploy.env"
  )
fi

for DEPLOY_ENV_FILE in "${DEPLOY_ENV_CANDIDATES[@]}"; do
  if [[ -f "$DEPLOY_ENV_FILE" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$DEPLOY_ENV_FILE"
    set +a
    echo "→ Loaded deploy env: $DEPLOY_ENV_FILE" >&2
    break
  fi
done

unset DEPLOY_ENV_CANDIDATES DEPLOY_ENV_FILE
