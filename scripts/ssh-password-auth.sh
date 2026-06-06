#!/bin/bash
# Build a password-auth prefix for ssh/scp.
#
# Prefer sshpass when present. On clean macOS machines sshpass is often
# unavailable, so fall back to OpenSSH's SSH_ASKPASS flow. The askpass
# helper reads the password from the per-command SSHPASS env var and is
# removed automatically when the parent deploy script exits.

ensure_askpass_helper() {
  if [[ -n "${HOLADAY_ASKPASS_HELPER:-}" && -x "$HOLADAY_ASKPASS_HELPER" ]]; then
    return 0
  fi

  HOLADAY_ASKPASS_HELPER="$(mktemp -t holaday-askpass.XXXXXX)"
  cat >"$HOLADAY_ASKPASS_HELPER" <<'EOF'
#!/bin/sh
printf '%s\n' "$SSHPASS"
EOF
  chmod 700 "$HOLADAY_ASKPASS_HELPER"
  trap 'rm -f "${HOLADAY_ASKPASS_HELPER:-}"' EXIT
}

build_ssh_password_prefix() {
  local password="${1:-}"
  SSH_PASSWORD_PREFIX=()
  if [[ -z "$password" ]]; then
    return 0
  fi

  if command -v sshpass >/dev/null 2>&1; then
    SSH_PASSWORD_PREFIX=(env SSHPASS="$password" sshpass -e)
    return 0
  fi

  ensure_askpass_helper
  SSH_PASSWORD_PREFIX=(
    env
    SSHPASS="$password"
    SSH_ASKPASS="$HOLADAY_ASKPASS_HELPER"
    SSH_ASKPASS_REQUIRE=force
    DISPLAY="${DISPLAY:-localhost:0}"
  )
}
