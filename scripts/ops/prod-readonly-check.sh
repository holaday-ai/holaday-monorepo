#!/usr/bin/env bash
# Batch 12 — read-only production facts for docs/deploy-capability-recovery.md
# (the 8 open questions). Run ON the server as the deploy user:
#
#   bash prod-readonly-check.sh [/opt/holaday-monorepo]
#
# Read-only: no file is modified, no service is restarted. .env files are never
# printed — only whether a key is set; DATABASE_URL is read inside node and
# used for SELECTs on information_schema / COUNT(*).
set -u
DIR="${1:-/opt/holaday-monorepo}"
section() { printf '\n== %s ==\n' "$1"; }

section "1. 部署形态"
ls -ld /opt/holaday-monorepo /opt/holaday-releases 2>&1 | sed 's/^/  /'
ls -1t /opt/holaday-releases 2>/dev/null | head -5 | sed 's/^/  release: /'
if [ -d "$DIR/.git" ]; then
  echo "  HEAD: $(git -C "$DIR" rev-parse --short HEAD) ($(git -C "$DIR" log -1 --format='%cs %s' | cut -c1-80))"
  echo "  branch: $(git -C "$DIR" rev-parse --abbrev-ref HEAD)"
  echo "  uncommitted files: $(git -C "$DIR" status --porcelain | wc -l)"
  git -C "$DIR" merge-base --is-ancestor HEAD origin/claude/capability-recovery 2>/dev/null \
    && echo "  HEAD is an ancestor of origin/claude/capability-recovery: yes" \
    || echo "  HEAD is an ancestor of origin/claude/capability-recovery: no / unknown (fetch not run)"
fi
ls -ld /var/lib/holaday/ordinary-maintenance 2>/dev/null | sed 's/^/  maintenance marker: /' || echo "  maintenance marker: none"

section "2. 进程与重启方式"
command -v pm2 >/dev/null && pm2 -v | sed 's/^/  pm2 /'
pm2 jlist 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    for (const p of JSON.parse(s || "[]")) {
      const env = p.pm2_env || {};
      console.log(`  ${p.name} status=${env.status} user=${env.username ?? "?"} script=${env.pm_exec_path} cwd=${env.pm_cwd} node=${env.node_version ?? "?"} restarts=${env.restart_time}`);
      console.log(`    env keys present: HOLADAY_POOL_BOOT=${"HOLADAY_POOL_BOOT" in env} HOLADAY_POOL_CANDIDATE=${"HOLADAY_POOL_CANDIDATE" in env} BROWSER_EXECUTOR=${"BROWSER_EXECUTOR" in env}`);
    }
  });'
ls -l "$DIR/scripts/orchestrator-runtime.sh" 2>&1 | sed 's/^/  /'
ps -eo user,pid,etime,args | grep -E "node .*(orchestrator|dist/index)" | grep -v grep | cut -c1-160 | sed 's/^/  /'
systemctl list-units --type=service --no-pager 2>/dev/null | grep -iE "holaday|pm2|nginx|mysql|redis" | sed 's/^/  /'

section "3. Node / pnpm"
for n in node /opt/node22/bin/node /usr/local/bin/node; do command -v "$n" >/dev/null 2>&1 && echo "  $n -> $("$n" -v)"; done
command -v pnpm >/dev/null && echo "  pnpm $(pnpm -v)" || echo "  pnpm: not on PATH"
cat "$DIR/.nvmrc" 2>/dev/null | sed 's/^/  .nvmrc: /'

section "4/5. MySQL 版本、llm_calls 行数、迁移 0059–0065"
ENVFILE="$DIR/apps/orchestrator/.env"
( cd "$DIR/apps/orchestrator" && node --env-file="$ENVFILE" -e '
  const mysql = require("mysql2/promise");
  (async () => {
    const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });
    const q = async (sql, p = []) => (await c.query(sql, p))[0];
    console.log("  mysql", (await q("SELECT VERSION() v"))[0].v);
    console.log("  llm_calls rows", (await q("SELECT COUNT(*) n FROM llm_calls"))[0].n);
    const size = await q("SELECT ROUND(SUM(data_length+index_length)/1024/1024) mb FROM information_schema.TABLES WHERE table_schema = DATABASE() AND table_name = ?", ["llm_calls"]);
    console.log("  llm_calls size MB", size[0].mb);
    const markers = [["0059","tasks","execution_id"],["0060","llm_calls","cost_status"],["0061","model_catalog",null],["0062","task_action_captures","replay_json"],["0063","quota_refunds",null],["0064","model_catalog_settings",null],["0065","scheduled_tasks","consecutive_failures"]];
    for (const [id, t, col] of markers) {
      const rows = await q(col ? "SELECT 1 FROM information_schema.COLUMNS WHERE table_schema=DATABASE() AND table_name=? AND column_name=?" : "SELECT 1 FROM information_schema.TABLES WHERE table_schema=DATABASE() AND table_name=?", col ? [t, col] : [t]);
      console.log(`  migration ${id}: ${rows.length ? "applied" : "missing"}`);
    }
    const pay = await q("SELECT COUNT(*) n FROM payments WHERE created_at > NOW() - INTERVAL 1 DAY").catch(() => [{ n: "?" }]);
    console.log("  payments in last 24h", pay[0].n);
    await c.end();
  })().catch((e) => console.log("  db check failed:", e.code || e.message));
' ) 2>&1 | grep -v -i "password"

section "env 文件（只报是否存在/是否含某键，不输出值）"
for f in "$DIR/.env" "$DIR/.env.local" "$DIR/apps/orchestrator/.env" "$DIR/apps/orchestrator/.env.local"; do
  if [ -f "$f" ]; then
    has() { grep -qE "^$1=" "$f" && echo yes || echo no; }
    echo "  $f: exists; DATABASE_URL=$(has DATABASE_URL) BROWSER_EXECUTOR=$(has BROWSER_EXECUTOR) FIRECRAWL_API_KEY=$(has FIRECRAWL_API_KEY) FAL_KEY=$(has FAL_KEY) DASHSCOPE_INTL_API_KEY=$(has DASHSCOPE_INTL_API_KEY) DASHSCOPE_CN_API_KEY=$(has DASHSCOPE_CN_API_KEY)"
    # BROWSER_EXECUTOR is an enum, not a secret: print its value (letters only).
    if grep -qE '^BROWSER_EXECUTOR=' "$f"; then
      echo "    BROWSER_EXECUTOR value: $(grep -E '^BROWSER_EXECUTOR=' "$f" | tail -1 | cut -d= -f2- | tr -cd 'a-z')"
    fi
  else echo "  $f: absent"; fi
done

section "7. 磁盘与备份目录"
df -h / /opt /var 2>/dev/null | sed 's/^/  /'
for d in /var/backups /opt/backups /root/backups; do [ -d "$d" ] && echo "  $d: $(du -sh "$d" 2>/dev/null | cut -f1), latest: $(ls -1t "$d" | head -1)"; done
du -sh /var/lib/mysql 2>/dev/null | sed 's/^/  mysql datadir: /'

section "8. Chromium（服务进程用户）"
for d in /root/.cache/ms-playwright /home/*/.cache/ms-playwright; do [ -d "$d" ] && echo "  $d: $(ls "$d" | tr '\n' ' ')"; done
