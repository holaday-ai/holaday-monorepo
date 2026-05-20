#!/usr/bin/env bash
# Codex Round 2 / staging bootstrap — runs ON VULTR.
#
# Provisions a fully isolated staging environment on the same Vultr
# box that hosts prod:
#   1. Creates `holaday_staging` MySQL database via root-socket auth
#      (root @ Vultr can hit MySQL via unix_socket — never reads
#      prod's MySQL password).
#   2. Creates `holaday_staging`@`127.0.0.1` MySQL user with a
#      freshly generated password (random 32 bytes, base64-encoded).
#   3. Grants ONLY `holaday_staging.*` to the new user — no prod-DB
#      access, even if .env.staging leaks.
#   4. Writes /opt/holaday-monorepo/apps/orchestrator/.env.staging
#      with staging overrides (DATABASE_URL, PORT=4011, WS_PORT=
#      4012, JWT_SECRET, STORAGE_PROVIDER=local, HOLADAY_FILES_DIR)
#      and inherits everything else (ANTHROPIC_API_KEY, OAuth,
#      etc.) verbatim from prod's .env so the runtime is functional.
#   5. Verifies the new user can actually connect.
#
# Idempotent: re-running rotates the staging user's password +
# regenerates JWT_SECRET. Existing rows in holaday_staging are
# untouched (CREATE DATABASE IF NOT EXISTS).
#
# Never prints credentials to stdout. Output is a single OK line
# with DB name + ports + env path.

set -euo pipefail

PROD_ENV="/opt/holaday-monorepo/apps/orchestrator/.env"
STAGING_ENV="/opt/holaday-monorepo/apps/orchestrator/.env.staging"
STAGING_DB_NAME="holaday_staging"
STAGING_DB_USER="holaday_staging"
STAGING_API_PORT="4011"
STAGING_WS_PORT="4012"
STAGING_FILES_DIR="/opt/holaday-spa-staging/files"
MYSQL_HOST="127.0.0.1"
MYSQL_PORT="3306"

if [[ ! -f "$PROD_ENV" ]]; then
  echo "FATAL: prod .env not found at $PROD_ENV" >&2
  exit 1
fi

# Probe for a root-mysql invocation that works. Ubuntu's default
# MariaDB/MySQL ships with unix_socket auth for root — `mysql` from
# a root shell connects with no creds. Some boxes require `sudo`.
# Quote the probe SQL minimally; --batch + -N keeps output tight.
MYSQL_ROOT=""
if mysql -BNe 'SELECT 1' >/dev/null 2>&1; then
  MYSQL_ROOT="mysql"
elif sudo -n mysql -BNe 'SELECT 1' >/dev/null 2>&1; then
  MYSQL_ROOT="sudo mysql"
else
  echo "FATAL: no root-socket MySQL access — neither 'mysql -e SELECT 1' nor 'sudo mysql -e SELECT 1' works" >&2
  echo "Hint: this box probably uses password auth for MySQL root. Operator must create the DB + user manually." >&2
  exit 2
fi

# Generate staging password + JWT secret. Both server-side; neither
# echoed to stdout.
STAGING_DB_PASS="$(openssl rand -base64 32 | tr -d '=+/' | head -c 40)"
STAGING_JWT_SECRET="$(openssl rand -hex 32)"

# Run the bootstrap SQL through the working root invocation. Heredoc
# is inline so $STAGING_DB_PASS never lands on the command line.
# DROP + CREATE rotates the user cleanly on re-run.
$MYSQL_ROOT --batch <<SQL
CREATE DATABASE IF NOT EXISTS $STAGING_DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
DROP USER IF EXISTS '$STAGING_DB_USER'@'127.0.0.1';
CREATE USER '$STAGING_DB_USER'@'127.0.0.1' IDENTIFIED BY '$STAGING_DB_PASS';
GRANT ALL PRIVILEGES ON $STAGING_DB_NAME.* TO '$STAGING_DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# Sanity-check the new user can actually log in to the new DB.
if ! mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$STAGING_DB_USER" --password="$STAGING_DB_PASS" --ssl-mode=DISABLED "$STAGING_DB_NAME" -BNe 'SELECT 1' >/dev/null 2>&1; then
  echo "FATAL: staging user could not connect to $STAGING_DB_NAME after bootstrap" >&2
  exit 3
fi

# Write the staging .env. INHERIT every line from prod .env EXCEPT
# the keys we're overriding (so dotenv parsers that don't do
# last-wins still see the staging value), then append the staging
# block at the bottom for parsers that do.
mkdir -p "$(dirname "$STAGING_ENV")"
{
  grep -vE '^(DATABASE_URL|PORT|WS_PORT|JWT_SECRET|STORAGE_PROVIDER|R2_BUCKET|HOLADAY_FILES_DIR|NODE_ENV|HOLADAY_ENV)=' "$PROD_ENV" || true
  echo ""
  echo "# === staging overrides ==="
  echo "NODE_ENV=production"
  echo "HOLADAY_ENV=staging"
  echo "PORT=$STAGING_API_PORT"
  echo "WS_PORT=$STAGING_WS_PORT"
  echo "DATABASE_URL=mysql://$STAGING_DB_USER:$STAGING_DB_PASS@$MYSQL_HOST:$MYSQL_PORT/$STAGING_DB_NAME"
  echo "JWT_SECRET=$STAGING_JWT_SECRET"
  echo "STORAGE_PROVIDER=local"
  echo "HOLADAY_FILES_DIR=$STAGING_FILES_DIR"
} > "$STAGING_ENV"
chmod 600 "$STAGING_ENV"
chown "$(stat -c '%U' "$PROD_ENV")":"$(stat -c '%G' "$PROD_ENV")" "$STAGING_ENV"

mkdir -p "$STAGING_FILES_DIR"

# Confirmation only — no credentials.
echo "OK staging db=$STAGING_DB_NAME user=$STAGING_DB_USER@127.0.0.1 ports=api:$STAGING_API_PORT,ws:$STAGING_WS_PORT env=$STAGING_ENV connect_test=ok"
