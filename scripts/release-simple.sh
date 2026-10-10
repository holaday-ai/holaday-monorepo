#!/usr/bin/env bash
# Simplified release for claude/capability-recovery (see docs/release-simple.md).
#
#   backup DB → deploy code → apply migrations (0059–0063) → smoke → roll back on failure
#
# Default is a dry run that only prints the plan. Nothing touches a server
# unless --execute is given. Credentials are never read or printed here: SSH
# uses the operator's own key/agent, and the server-side .env stays in place.
#
# Required env (no secrets):
#   DEPLOY_HOST      e.g. root@207.148.70.106
#   DEPLOY_DIR       e.g. /opt/holaday-monorepo
#   RELEASE_REF      git ref to deploy, e.g. origin/claude/capability-recovery
# Optional:
#   PM2_APP          default holaday-orchestrator
#   HEALTH_URL       default http://127.0.0.1:3000/healthz (checked on the host)
#   BACKUP_DIR       default /var/backups/holaday (on the host)
set -euo pipefail

EXECUTE=0
[[ "${1:-}" == "--execute" ]] && EXECUTE=1

: "${DEPLOY_HOST:?set DEPLOY_HOST}"
: "${DEPLOY_DIR:?set DEPLOY_DIR}"
: "${RELEASE_REF:?set RELEASE_REF}"
PM2_APP="${PM2_APP:-holaday-orchestrator}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/healthz}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/holaday}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

remote() {
  if [[ $EXECUTE -eq 1 ]]; then
    ssh -o BatchMode=yes "$DEPLOY_HOST" "set -euo pipefail; $1"
  else
    printf '[dry-run] ssh %s: %s\n' "$DEPLOY_HOST" "$1"
  fi
}

echo "== release-simple $STAMP → $RELEASE_REF on $DEPLOY_HOST:$DEPLOY_DIR (execute=$EXECUTE)"

# 0. Refuse to deploy over uncommitted server-side changes; remember the rollback point.
remote "cd '$DEPLOY_DIR' && test -z \"\$(git status --porcelain --untracked-files=no)\" && git rev-parse HEAD > '$DEPLOY_DIR/.release-previous-ref'"

# 1. Database backup (credentials come from the server's own .env, never echoed).
remote "mkdir -p '$BACKUP_DIR' && cd '$DEPLOY_DIR/apps/orchestrator' && set -a && . ./.env && set +a && \
  node -e 'const u=new URL(process.env.DATABASE_URL);process.stdout.write([u.hostname,u.port||3306,decodeURIComponent(u.username),u.pathname.slice(1)].join(\" \"))' \
  | { read -r h p user db; MYSQL_PWD=\"\$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).password))')\" \
      mysqldump --single-transaction --routines --no-tablespaces -h \"\$h\" -P \"\$p\" -u \"\$user\" \"\$db\" | gzip > '$BACKUP_DIR/holaday-$STAMP.sql.gz'; } && \
  test -s '$BACKUP_DIR/holaday-$STAMP.sql.gz'"

# 2. Deploy code (fetch + build). The previous build stays until restart.
remote "cd '$DEPLOY_DIR' && git fetch --prune origin && git checkout --detach '$RELEASE_REF' && \
  pnpm install --frozen-lockfile && pnpm --filter @holaday/orchestrator build && pnpm --filter @holaday/web-workbench build"

# 3. Migrations BEFORE restart (schema first, then code). All are additive.
remote "cd '$DEPLOY_DIR/apps/orchestrator' && pnpm db:migrate:numbered && pnpm db:verify"

# 4. Restart and smoke.
remote "pm2 restart '$PM2_APP' --update-env && sleep 5"
if ! remote "for i in 1 2 3 4 5 6; do curl -fsS -m 10 '$HEALTH_URL' >/dev/null && exit 0; sleep 5; done; exit 1"; then
  echo "!! smoke failed — rolling back code to the previous ref (schema changes are additive and stay)"
  remote "cd '$DEPLOY_DIR' && git checkout --detach \"\$(cat .release-previous-ref)\" && pnpm install --frozen-lockfile && \
    pnpm --filter @holaday/orchestrator build && pm2 restart '$PM2_APP' --update-env"
  echo "!! rolled back. Backup kept at $BACKUP_DIR/holaday-$STAMP.sql.gz (restore manually only if needed)."
  exit 1
fi

echo "== release ok: $RELEASE_REF (backup $BACKUP_DIR/holaday-$STAMP.sql.gz). Run scripts/smoke-real-tasks.md next."
