#!/usr/bin/env bash
# Codex Round 2 / staging bootstrap — runs ON VULTR.
#
# Reads /opt/holaday-monorepo/apps/orchestrator/.env, creates a
# fresh `holaday_staging` MySQL database + `holaday_staging`@
# `127.0.0.1` user with a freshly generated password, then writes
# /opt/holaday-monorepo/apps/orchestrator/.env.staging with the
# staging-only overrides (DATABASE_URL, PORT, WS_PORT, JWT_SECRET,
# STORAGE_PROVIDER=local). Every other env value (ANTHROPIC_API_KEY,
# OAuth secrets, etc.) is inherited verbatim from prod's .env so
# the runtime has what it needs without leaking creds back into the
# orchestrator transcript.
#
# Idempotent enough for a re-run: the SQL block uses CREATE
# DATABASE IF NOT EXISTS + DROP USER IF EXISTS so a second
# invocation rotates the staging user's password (handy if the
# .env.staging gets lost). Aborts on any error.

set -euo pipefail

PROD_ENV="/opt/holaday-monorepo/apps/orchestrator/.env"
STAGING_ENV="/opt/holaday-monorepo/apps/orchestrator/.env.staging"
STAGING_DB_NAME="holaday_staging"
STAGING_DB_USER="holaday_staging"
STAGING_API_PORT="4011"
STAGING_WS_PORT="4012"
STAGING_FILES_DIR="/opt/holaday-spa-staging/files"

if [[ ! -f "$PROD_ENV" ]]; then
  echo "FATAL: prod .env not found at $PROD_ENV" >&2
  exit 1
fi

# Parse prod's DATABASE_URL via Node so we get robust URL parsing
# (mysql:// can contain @, /, ? characters in the password).
read -r MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASS MYSQL_DB <<<"$(
  node --eval '
    const fs = require("fs");
    const env = fs.readFileSync(process.argv[1], "utf8");
    const line = env.split(/\r?\n/).find(l => l.startsWith("DATABASE_URL="));
    if (!line) { console.error("DATABASE_URL missing"); process.exit(1); }
    const raw = line.slice("DATABASE_URL=".length).replace(/^["\x27]|["\x27]$/g, "");
    const u = new URL(raw);
    process.stdout.write([
      u.hostname,
      u.port || "3306",
      decodeURIComponent(u.username),
      decodeURIComponent(u.password),
      u.pathname.replace(/^\//, ""),
    ].join(" "));
  ' "$PROD_ENV"
)"

if [[ -z "$MYSQL_USER" || -z "$MYSQL_PASS" ]]; then
  echo "FATAL: parsed empty MySQL credentials from $PROD_ENV" >&2
  exit 1
fi

# Generate a fresh staging password. 32 bytes base64 → ~43 chars.
STAGING_DB_PASS="$(openssl rand -base64 32 | tr -d '=+/' | head -c 40)"
STAGING_JWT_SECRET="$(openssl rand -hex 32)"

# Create the staging DB + user via the prod user's connection. The
# prod user must have CREATE DATABASE + CREATE USER + GRANT OPTION
# privileges. If it doesn't, the SQL block fails with an obvious
# permission error and the operator has to run the create as root
# manually (one-line fallback below).
mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" --password="$MYSQL_PASS" --batch --ssl-mode=DISABLED <<SQL
CREATE DATABASE IF NOT EXISTS $STAGING_DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
DROP USER IF EXISTS '$STAGING_DB_USER'@'127.0.0.1';
CREATE USER '$STAGING_DB_USER'@'127.0.0.1' IDENTIFIED BY '$STAGING_DB_PASS';
GRANT ALL PRIVILEGES ON $STAGING_DB_NAME.* TO '$STAGING_DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# Write the staging .env. INHERIT every line from prod's .env, then
# OVERRIDE the staging-specific lines at the bottom (later entries
# beat earlier ones in dotenv-style parsers; the orchestrator uses
# the same path so this is safe).
mkdir -p "$(dirname "$STAGING_ENV")"
{
  # Inherit (filter out the keys we're overriding so dotenv parsers
  # that DON'T do last-wins still see the staging value).
  grep -vE '^(DATABASE_URL|PORT|WS_PORT|JWT_SECRET|STORAGE_PROVIDER|R2_BUCKET|HOLADAY_FILES_DIR|NODE_ENV|HOLADAY_ENV)=' "$PROD_ENV" || true
  echo ""
  echo "# === Codex Round 2 staging overrides (do not commit) ==="
  echo "NODE_ENV=production"
  echo "HOLADAY_ENV=staging"
  echo "PORT=$STAGING_API_PORT"
  echo "WS_PORT=$STAGING_WS_PORT"
  echo "DATABASE_URL=mysql://$STAGING_DB_USER:$STAGING_DB_PASS@$MYSQL_HOST:$MYSQL_PORT/$STAGING_DB_NAME"
  echo "JWT_SECRET=$STAGING_JWT_SECRET"
  echo "STORAGE_PROVIDER=local"
  echo "HOLADAY_FILES_DIR=$STAGING_FILES_DIR"
  echo "# ANTHROPIC_API_KEY / OAuth secrets / R2 credentials inherited from prod .env above."
  echo "# R2 intentionally NOT used on staging — STORAGE_PROVIDER=local routes uploads to"
  echo "# $STAGING_FILES_DIR so we never touch holaday-files-prod bucket assets."
} > "$STAGING_ENV"
chmod 600 "$STAGING_ENV"
chown "$(stat -c '%U' "$PROD_ENV")":"$(stat -c '%G' "$PROD_ENV")" "$STAGING_ENV"

mkdir -p "$STAGING_FILES_DIR"

# Confirmation. Intentionally does NOT echo the password or the
# full DATABASE_URL — only the DB name + ports + .env path.
echo "OK staging db=$STAGING_DB_NAME user=$STAGING_DB_USER@127.0.0.1 ports=api:$STAGING_API_PORT,ws:$STAGING_WS_PORT env=$STAGING_ENV"
