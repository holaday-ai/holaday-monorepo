# HOLA DAY 部署 Runbook（任何 session 通用）

> 最后更新 2026-06-11（Phase 1 sprint 开工时）。本文档**不含任何密码**——凭据见下文「凭据」节。
> 新 session 若在 `/Users/yaleiqi/holaday-monorepo` 项目下，memory 里的 `HANDOFF_2026-06-10.md` 有更完整的背景；本文是可独立执行的最小操作集。

## 0. ⚠️ 部署前必查（共享工作区规则）

本 clone 被多个 Claude session 共享。**deploy 脚本第一步是 `git reset --hard origin/<branch>`，会清掉所有未提交的 tracked 改动。**

```bash
cd /Users/yaleiqi/holaday-monorepo && git status --short
```

- 有 ` M`（未提交修改）→ **先确认是不是别的 session 的在飞工作**（例：2026-06-11 Phase1 #5 图片任务曾以未提交状态躺在树里）。不是你的 → 不要 reset、不要部署，等对方 commit 或协调。
- untracked 的 `.claude/ qa-artifacts/ skills/{a-share-analyst,content-creator,marketing-expert}/` 是约定目录，**永远不要动、不要 git add**。
- 提交永远 `git add <具体文件路径>`，绝不 `git add -A`/`git add .`。
- browse skill 会偷偷给 `.gitignore` 加 `.gstack/`：提交前 `git checkout -- .gitignore`。
- `git commit -m` 里**不要用反引号**（shell 会执行）；长 message 用 `git commit -F <file>`。

## 1. 拓扑与当前态

| 项 | 值 |
|---|---|
| 活跃分支 | `claude/musing-keller-ae1d05` |
| 线上 orchestrator | Vultr `207.148.70.106`（pm2 `holaday-orchestrator`，进程 id 6）。2026-06-11 时点：HEAD `57863da`，restart 608 |
| SPA | 双边：Aliyun `47.99.169.186`（hd-app.orangebench.tech）+ Vultr（holaday.ai 直连源站）。2026-06-11 bundle `index-CUiNEIfi.js` |
| 入口 | holaday.ai → CF Worker 做 CN 302 → hd-app.orangebench.tech；`--resolve` 可直打源站 |
| env | Vultr `/opt/holaday-monorepo/apps/orchestrator/.env`（pm2 restart 时重读） |

## 2. 凭据（不在本文档）

全部在仓库根 `/Users/yaleiqi/holaday-monorepo/.env.deploy.local`（chmod 600，git-ignored）：
`VULTR_PASSWORD` / `ALIYUN_PASSWORD` / `SKIP_AUTO_SMOKE`。**不手填密码**，统一 `set -a && source .env.deploy.local && set +a`。
Prod 测试号（QA 登录用）：`yaleiqi716@gmail.com`，密码见 memory `HANDOFF_2026-06-10.md`（userId `usr_EeYpvsvLtyDzN4VLQi7BT`，plan=basic）。

## 3. 部署命令

```bash
cd /Users/yaleiqi/holaday-monorepo && \
git fetch origin '+refs/heads/claude/musing-keller-ae1d05:refs/remotes/origin/claude/musing-keller-ae1d05' && \
git reset --hard origin/claude/musing-keller-ae1d05 && \
set -a && source .env.deploy.local && set +a && \
./scripts/deploy-current.sh orchestrator   # spa | orchestrator | both
```

- orchestrator 部署 = Vultr 端 fetch + pnpm build + pm2 restart（自带本机 healthz 检查 + 重试；瞬时 sshd/TLS 抖动正常，脚本会 retry）。
- **SPA 必须双边**（脚本已自动镜像 Aliyun + Vultr，确认两边输出同一个新 bundle hash）。只发 Aliyun 会让 holaday.ai 停在旧版。
- **规矩**：orchestrator 改动 push 后默认交 BOSS 审查 + 由 BOSS 指令部署（除非明确授权自部）；SPA 在活跃分支可自部。**migration / Aliyun 配置 / 破坏性操作必须先问。**

## 4. 部署后独立复核

```bash
# healthz（注意 grep 字符类含连字符时把 - 放最后）
curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 --resolve holaday.ai:443:207.148.70.106 https://holaday.ai/api/healthz
curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 --resolve hd-app.orangebench.tech:443:47.99.169.186 https://hd-app.orangebench.tech/api/healthz
# 线上 HEAD + canary env 没被部署搞乱
sshpass -p "$VULTR_PASSWORD" ssh -o StrictHostKeyChecking=no root@207.148.70.106 \
  "cd /opt/holaday-monorepo && git rev-parse --short HEAD && grep -E 'OTA_USER_BROWSER' apps/orchestrator/.env"
```

期望：两个 200；HEAD 与你部署的一致；canary 三件套不变：
`OTA_USER_BROWSER_ENABLED=true` / `ALLOWED_USER_IDS=usr_EeYpvsvLtyDzN4VLQi7BT` / `ALLOWED_DOMAINS=ctrip.com`。

## 5. 提交前 gate（全绿才允许 push）

| 端 | 命令 |
|---|---|
| orchestrator | `npx tsc --noEmit` ＆ `npx vitest run` ＆ `npm run build` ＆ `git diff --check`（无独立 eslint）。2026-06-11 基线 **2240/2240** |
| SPA (web-workbench) | `pnpm typecheck` ＆ `pnpm test` ＆ `pnpm build` ＆ `npx eslint <touched .tsx>`（react-hooks/rules-of-hooks=error 必过）。基线 **636/636** |

**Migration 铁律**（DEPLOY_CHECKLIST.md RULE 1）：先在线上库 apply migration，再部署/重启代码——drizzle 生成的 SQL 含 schema 全部列，顺序反了会 "Unknown column" 500 把线上打挂。

## 6. 回滚 / 止血

- **orchestrator 回滚**：Vultr 上 `git reset --hard <旧HEAD>` + `pm2 restart holaday-orchestrator`（或本地 checkout 旧 HEAD 走一遍部署脚本）。
- **SPA 回滚**：checkout 旧 HEAD 重发 `deploy-current.sh spa`。
- **OTA canary kill switch**（无需回滚代码）：Vultr `.env` 把 `OTA_USER_BROWSER_ENABLED` 设非 `true`，或清空两个 allowlist 其一 → 全量退回 server Brave，`pm2 restart` 生效。
- **#5 图片 lane 止血**（Phase 1 新增）：清空 `GEMINI_API_KEY` → image intent 自动回落 generate lane，restart 生效。

## 7. 线上日志

```bash
sshpass -p "$VULTR_PASSWORD" ssh -o StrictHostKeyChecking=no root@207.148.70.106 \
  "pm2 logs holaday-orchestrator --lines 4000 --nostream | grep <taskId>"
```
SSH 偶尔被安全分类器拦——需要 BOSS 明确放行后重试。常用过滤：`executionMode|finalStatus|rollout|navigate completed|auth wall|extraction validated|recovered`。

## 8. 禁区（恒定）

不动 CF Worker（已部署，**永不重部**）、R2、GEO、staging、nginx；不接千问、不新增 model/provider、不改 env（除非 BOSS 明确要求）；OTA canary 不扩站点/不扩用户；qunar/fliggy/ly/meituan 不开 user-browser（须走 phase-summary §6 准入）。

## 9. QA harness 速记（gstack headless browse）

二进制 `~/.claude/skills/gstack/browse/dist/browse`。登录 hd-app `/login` 用 JS native-setter 填邮箱密码（**别点 Google 登录**）→ `/app` 提交任务（textarea native-setter + `[aria-label=发送]`）。首次提交常 stale-WS 不跳转：reload 后按 prompt 文本在列表找最新任务取 id。跑久了 stale-WS：`browse restart` + 重登。证据存 `qa-artifacts/holaday-<专项>-<ts>/`。OTA user-browser QA 需 BOSS 本机 Chrome 扩展在线且登录携程。

## 10. 汇报模板

```
HEAD: <hash>
问题: <一句>
用户影响: <一句>
改动文件: <列表>
验证: 测试 N/N ✅｜tsc ✅｜build ✅｜diff-check clean ✅
是否需要部署: SPA-only / orchestrator / both / 否
```
