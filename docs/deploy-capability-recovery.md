# 上线手册：capability-recovery（迁移 0059–0065）

照着从上往下做。每步都有"怎么验证"，验证不过就停下，不要往下走。
本文只写变量名和占位符，不写主机、密码、key。拓扑和凭据位置见 `docs/DEPLOY_RUNBOOK.md`、`DEPLOY_CHECKLIST.md`（RULE 1–5）。

| 占位符 | 含义 |
|---|---|
| `<ORCH_SSH>` | orchestrator 服务器的 SSH 目标（用你自己的密钥或现有方式登录） |
| `<DEPLOY_DIR>` | 服务器上的仓库目录（现有文档里是 `/opt/holaday-monorepo`） |
| `<RELEASE_REF>` | 要上线的 ref，例如 `origin/claude/capability-recovery` |
| `<BACKUP_DIR>` | 服务器上的备份目录 |
| `<OLD_SHA>` | 上线前的线上 HEAD（第 0 步记下） |

**铁律**：先迁移，后换代码，再重启（DEPLOY_CHECKLIST RULE 1）。新功能开关先全关上线，再按第 8 节逐个打开（RULE 2）。

---

## 0. 上线前检查（只读，5 分钟）

在服务器上执行：

```bash
cd <DEPLOY_DIR>
git status --porcelain --untracked-files=no      # 必须为空
git rev-parse HEAD                               # 记为 <OLD_SHA>，回滚要用
bash scripts/deploy-preflight.sh claude/capability-recovery   # 必须 exit 0
```

- `deploy-preflight.sh` 返回 1（线上 HEAD 不是发布分支的祖先）时**停下**。本分支基于 `codex/browser-release-candidate-20260925`（`2eaedd77`），线上如果跑的是别的线（比如 `musing-keller` 或浏览器首发切换的候选版本），直接覆盖会丢掉线上已有的提交，要先合并再发。
- 启动模式：如果线上进程带 `HOLADAY_POOL_BOOT` / `HOLADAY_POOL_CANDIDATE`（受控启动），或存在 `/var/lib/holaday/ordinary-maintenance`（维护模式），本手册的"pm2 重启"不适用，要走浏览器首发切换的维护流程（`docs/ops/browser-first-cutover-host.md`）。只看变量名、不看值：
  `pm2 env <进程id> | grep -o '^HOLADAY_POOL_[A-Z_]*' ; ls /var/lib/holaday/ordinary-maintenance 2>/dev/null`
- 准备数据库只读命令（后面几步都要用；凭据只从服务器 `.env` 读，不回显）：

```bash
cd <DEPLOY_DIR>/apps/orchestrator
set -a && . ./.env && set +a
read -r DB_H DB_P DB_U DB_N <<<"$(node -e 'const u=new URL(process.env.DATABASE_URL);process.stdout.write([u.hostname,u.port||3306,decodeURIComponent(u.username),u.pathname.slice(1)].join(" "))')"
export MYSQL_PWD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).password))')"
q() { mysql -h "$DB_H" -P "$DB_P" -u "$DB_U" "$DB_N" "$@"; }
```

- 三个只读查询：

```sql
SELECT VERSION();                                                        -- 8.0.29 以上时 ADD COLUMN 基本都是 INSTANT
SELECT COUNT(*) FROM llm_calls;                                          -- 0060 的 MODIFY COLUMN 会重建这张表，行数大要挑低峰
SELECT COUNT(*) FROM notification_channels WHERE platform='custom';      -- 10.3 起"自定义"webhook 停发，>0 要先通知用户
```

## 1. 备份数据库

接着第 0 步的 shell 执行：

```bash
mkdir -p <BACKUP_DIR>
F=<BACKUP_DIR>/holaday-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
mysqldump --single-transaction --routines --no-tablespaces \
  -h "$DB_H" -P "$DB_P" -u "$DB_U" "$DB_N" | gzip > "$F"
gzip -t "$F" && ls -lh "$F" && zcat "$F" | tail -1     # 最后一行应为 "-- Dump completed ..."
```

验证：文件非空、`gzip -t` 通过、末行是 `Dump completed`。记下文件名。
（`scripts/release-simple.sh` 第 1 步就是这条命令。）

## 2. 执行迁移 0059–0065（代码还没换）

### 2.1 先看哪些已经执行过

```sql
SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND (
   (TABLE_NAME='tasks'                AND COLUMN_NAME IN ('execution_id','execution_revision','core_record_version'))
OR (TABLE_NAME='llm_calls'            AND COLUMN_NAME IN ('cost_status','usage_status','region','provider_request_id'))
OR (TABLE_NAME='task_action_captures' AND COLUMN_NAME IN ('replay_json','outcome_json','executor_source'))
OR (TABLE_NAME='operation_paths'      AND COLUMN_NAME IN ('template_json','generalizer','canary_pass_streak'))
OR (TABLE_NAME='scheduled_tasks'      AND COLUMN_NAME IN ('notify_on_success','failure_notify_threshold','consecutive_failures','pending_task_id'))
OR (TABLE_NAME='planned_tasks'        AND COLUMN_NAME IN ('notify_on_success','failure_notify_threshold','consecutive_failures')))
 ORDER BY 1,2;                                                -- 全部执行后应为 20 行
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('model_catalog','model_catalog_events','task_model_selections',
                      'operation_path_replays','quota_refunds','model_catalog_settings');   -- 全部执行后应为 6 行
```

### 2.2 每个迁移做什么、怎么判断已执行

| 编号 | 内容 | 已执行的标志 | 说明 |
|---|---|---|---|
| 0059 | `tasks` 加 `execution_id` / `execution_revision` / `core_record_version` | 3 列都在 | 只加列，有默认值 |
| 0060 | `llm_calls` 的 token/cost 列改为可空；加 `cost_status` / `usage_status` / `region` / `provider_request_id` | 4 列都在，且 `cost_usd` 的 `IS_NULLABLE='YES'` | **唯一不是纯加列的**：`MODIFY COLUMN` 放宽为可空，会重建表 |
| 0061 | 模型目录：`model_catalog`（种子：千问默认可见，Claude/GPT 隐藏）、`model_catalog_events`、`task_model_selections` | 3 张表；`SELECT id,is_default FROM model_catalog` 只有 qwen 是 1 | `INSERT IGNORE`，重跑不覆盖后台改动 |
| 0062 | 自我进化：`task_action_captures` 加 3 列，`operation_paths` 加 3 列，新表 `operation_path_replays` | 6 列 + 1 表 | 依赖 `task_action_captures`、`operation_paths`、`tasks` 已存在 |
| 0063 | 平台失败退额度账本 `quota_refunds` | 表存在 | |
| 0064 | `model_catalog_settings`，种子行 `mcp_servers = []` | 表存在且有 `mcp_servers` 行 | |
| 0065 | `scheduled_tasks` 加 4 列、`planned_tasks` 加 3 列（通知设置、连续失败计数） | 7 列都在 | 每张表是一条 `ALTER`，要么全加要么全不加 |

### 2.3 执行（推荐：只执行缺的文件，按编号顺序）

SQL 直接从发布 ref 取，服务器工作树不动（这样第 3 步换代码之前，库已经是新结构）：

```bash
cd <DEPLOY_DIR> && git fetch --prune origin
for f in 0059_core_execution_identity 0060_llm_usage_accounting 0061_model_catalog \
         0062_playbook_self_evolution 0063_quota_refunds 0064_model_catalog_settings \
         0065_task_outcome_notifications; do
  echo "== $f"
  git show "<RELEASE_REF>:apps/orchestrator/drizzle/$f.sql" \
    | sed '/^--> statement-breakpoint$/d' \
    | q || { echo "!! $f 失败，停下"; break; }
done
```

- **只把 2.1 里还没执行的文件放进循环。** 已执行过的文件再跑会报 `1060 Duplicate column`（`mysql` 遇错即停），这不是故障，但要回 2.1 核对。
- **为什么要 `sed`**：drizzle 文件用 `--> statement-breakpoint` 分隔语句。MySQL 只把"`--` 后面跟空白"当注释，`-->` 不算注释，会粘到下一条语句上报 `1064` 语法错（batch 10.3 实测）。删掉这些行之后，每条语句本身都以 `;` 结尾（已逐个核对），可以直接喂给 `mysql`。
- 不要加 `--force`：它会把真实错误也吞掉。
- 0060 在大表上会锁写一小段时间，挑低峰。

**另一种方式（仓库现有 runner）**：`pnpm db:migrate:numbered`（`apps/orchestrator/scripts/apply-numbered-migrations.ts`）。它自己处理 breakpoint，"已存在"类错误（`ER_DUP_FIELDNAME`、`ER_TABLE_EXISTS_ERROR` 等）自动跳过。但要注意：
1. 它**每次都会重跑 0000–0065 全部迁移**（没有记录表），输出的 `statements=N` 不代表本次新增几条，以 2.1 的查询为准；
2. 文件里注明 0042 要求备份和迁移期间支付写入是停的；
3. 它和 `db:verify` 都**不读取 `apps/orchestrator/.env`**（只读仓库根的 `.env`、`.env.local` 和 `apps/orchestrator/.env.local`），没有先 `set -a && . ./.env && set +a` 就会连到开发默认地址；
4. 它要用新代码里的 drizzle 目录，所以只能在第 3 步检出新代码之后、重启之前跑。

### 2.4 验证

- 再跑一次 2.1：20 行列、6 张表。
- `SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='llm_calls' AND COLUMN_NAME='cost_usd';` → `YES`。
- 第 3 步检出新代码后再跑 `pnpm db:verify`（先 source `.env`），必须全部通过。
- 上线后 `pnpm self-check` 的"数据库迁移"一组 7 项都是 ✅（第 5 节）。

## 3. 生产环境变量（只写变量名）

改 `apps/orchestrator/.env`，沿用 RULE 2 的写法：`sed -i '/^NAME=/d' .env && echo 'NAME=<值>' >> .env`。重启后生效。
只检查"有没有设置"、不看值：

```bash
for k in DASHSCOPE_INTL_API_KEY DASHSCOPE_INTL_WORKSPACE_ID DASHSCOPE_CN_API_KEY DASHSCOPE_CN_WORKSPACE_ID \
         DASHSCOPE_API_KEY FIRECRAWL_API_KEY FAL_KEY OPENAI_API_KEY ANTHROPIC_API_KEY REDIS_URL; do
  grep -q "^$k=." .env && echo "$k: 已设置" || echo "$k: 未设置"; done
```

### 3.1 删除（或确认不是"关"）的旧开关
这些现在默认开启，env 只能用来**关**。旧 `.env` 里留着"关"的值，能力就会继续关着。详见 `docs/env-changes-capability-recovery.md`。

| 变量 | 处理 |
|---|---|
| `QWEN_CORE_ROLLOUT_MODE` | 删除（默认 `all`），或确认不是 `off` / `synthetic` / `internal` |
| `QWEN_CORE_ENABLED_LANES` | 删除（空 = 全部通道），或确认包含全部通道 |
| `QWEN_CORE_ALLOWLIST` | rollout 为 `all` 时不再起作用，可删除 |
| `QWEN_MESSAGES_ADAPTER_ENABLED`、`QWEN_RESPONSES_ADAPTER_ENABLED` | 删除，或确认不是 `false` |
| `EVIDENCE_LEDGER_ENABLED`、`EXECUTION_CONTRACT_ENABLED`、`EXECUTION_VERIFIER_ENABLED` | 删除，或确认不是 `false` |
| `MODEL_RUNTIME_POLICY` | 不再阻断启动，可以留着；模型由后台"模型管理"决定 |

### 3.2 新增或要确认存在的 key 和配置

| 变量 | 用途 | 必需？ |
|---|---|---|
| `DASHSCOPE_INTL_API_KEY`、`DASHSCOPE_INTL_WORKSPACE_ID` | 千问新加坡区；媒体通道在 `DASHSCOPE_API_KEY` 为空时也用它 | 国际区必需 |
| `DASHSCOPE_CN_API_KEY`、`DASHSCOPE_CN_WORKSPACE_ID` | 千问北京区 | 有中国区用户时必需 |
| `DASHSCOPE_API_KEY`、`DASHSCOPE_WORKSPACE_ID` | 旧别名，只用于 intl | 可留空 |
| `DASHSCOPE_{INTL,CN}_{ANTHROPIC,RESPONSES}_BASE_URL` | 接入地址 | 有默认值 |
| `FIRECRAWL_API_KEY`（`FIRECRAWL_BASE_URL`） | scrape 通道；联网搜索失败时降级 | 推荐 |
| `FAL_KEY`（`FAL_BASE_URL`） | Nano Banana 2、Veo 3.1、IP 换口型 | 用这些模型才需要 |
| `OPENAI_API_KEY`、`OPENAI_BASE_URL` | GPT 大脑（后台默认隐藏） | 可留空 |
| `ANTHROPIC_API_KEY` | Claude 大脑（后台默认隐藏） | 可留空 |
| `QWEN_IMAGE_MODEL`、`WAN_IMAGE_MODEL`、`FAL_NANO_BANANA_2_MODEL`、`FAL_NANO_BANANA_2_EDIT_MODEL`、`FAL_VEO_FAST_MODEL`、`FAL_VEO_LITE_MODEL`、`FAL_VEO_STANDARD_MODEL`、`QWEN_VISION_MODEL` | 媒体和视觉模型 ID | 都有默认值，一般不设 |
| `IMAGE_DEFAULT_MODEL` | 通用图片默认模型：`nano_banana_2`（默认，走 fal）/ `wan_image` / `qwen_image` | 没有 `FAL_KEY` 时建议设为 `wan_image` |
| `WANXIANG_I2V_MODEL`、`WANXIANG_T2V_MODEL` | 万相视频 | 确认 `.env` 没把 `WANXIANG_I2V_MODEL` 钉在旧的 `wan2.2-*` 值 |
| `BROWSER_EXECUTOR` | 浏览器执行器 `legacy` / `unified` | 见第 8 节，建议显式写 |
| `PLAYBOOK_EVOLUTION_ACTOR_EXTERNAL_ID`、`PLAYBOOK_EVOLUTION_MODEL_REGION` | 后台沉淀调千问时用的系统身份和区域 | 可留空：留空时只做确定性泛化，不调模型 |
| `REDIS_URL` | 已有；BullMQ（沉淀/canary）也用它 | 已必需 |

开关类变量（`ACTION_CAPTURE_ENABLED`、`MEMORY_EXTRACTION_ENABLED`、`PLAYBOOK_*` 等）上线时**一律不设或设为非 `true`**，按第 8 节再打开。

## 4. 发布 orchestrator 和 SPA（同一个窗口内一起发）

10.1、10.2 新增了 tRPC 路由，前后端要一起发。顺序：迁移（第 2 节）→ 服务器换代码并构建 → 重启 orchestrator → 发 SPA 两边 → 验证。

### 4.1 先 dry-run

```bash
DEPLOY_HOST=<ORCH_SSH> DEPLOY_DIR=<DEPLOY_DIR> RELEASE_REF=<RELEASE_REF> \
HEALTH_URL=http://127.0.0.1:4001/healthz \
  bash scripts/release-simple.sh            # 不加 --execute 只打印计划，不连服务器
```

**本地已执行过一次（2026-10-04，主机用的是占位名 `deploy@example.invalid`）**：脚本不加 `--execute` 时，`remote()` 只 `printf`，不调用 ssh/curl。实际打印出 6 个远程步骤，exit 0，没有任何连接。按打印出的计划核对，发现下面几处**直接 `--execute` 会出问题**：

| # | 问题 | 处理 |
|---|---|---|
| 1 | 第 3 步 `pnpm db:migrate:numbered && pnpm db:verify` 没有先 source `apps/orchestrator/.env`，而这两个脚本不读该文件，会连到开发默认库地址然后失败（第 2 步已经换了代码，但还没重启） | 用第 2 节手工迁移；或者先在脚本里给这一步补上 `set -a && . ./.env && set +a`（要改代码，另开任务） |
| 2 | `HEALTH_URL` 默认 `:3000`，线上端口是 4001（RULE 4） | 显式传 `HEALTH_URL=http://127.0.0.1:4001/healthz` |
| 3 | 用 `pm2 restart --update-env` 重启，会把 SSH 会话的环境带进进程；线上现有的重启入口是 `scripts/orchestrator-runtime.sh restart <DEPLOY_DIR>`（root PM2，进程降权到运行用户） | 先确认线上实际用哪种方式重启 |
| 4 | 在服务器上构建 web-workbench 会**立刻替换** Vultr 的 SPA（`deploy-spa.sh` 里 Vultr 的 SPA 目录就是 `<DEPLOY_DIR>/apps/web-workbench/dist`），而 Aliyun 一侧不会更新 | 发完要按 4.3 发 Aliyun |
| 5 | 冒烟失败时的自动回滚只重建 orchestrator，不重建 SPA | 按第 6 节手工回滚 SPA |
| 6 | 前置检查只看工作树干不干净，不跑 `deploy-preflight.sh` | 第 0 步手工跑 |

问题 1、3 解决之前，建议按 4.2 手工执行，release-simple 只当核对清单用。

### 4.2 手工执行（与 release-simple 同样的步骤）

```bash
# 在服务器上（第 0–2 节已完成）
cd <DEPLOY_DIR>
git checkout --detach <RELEASE_REF>
pnpm install --frozen-lockfile
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench build          # 这一步就更新了 Vultr 的 SPA，见 4.1 第 4 条
(cd apps/orchestrator && set -a && . ./.env && set +a && pnpm db:verify)   # 必须通过
# 重启：用线上现行的方式（见 4.1 第 3 条），例如
bash scripts/orchestrator-runtime.sh restart <DEPLOY_DIR>
for i in 1 2 3 4 5 6; do curl -fsS -m 10 http://127.0.0.1:4001/healthz && break; sleep 5; done
```

### 4.3 SPA 双发（Aliyun + Vultr）

在本机一个**干净的专用 worktree** 里（`deploy-current.sh` 会 `git reset --hard`）：

```bash
BRANCH=claude/capability-recovery ./scripts/deploy-current.sh spa
```

- 一定要设 `BRANCH`：默认值是 `claude/musing-keller-ae1d05`。
- 它会构建 web-workbench，再用 `deploy-spa.sh` 同时发 Aliyun 和 Vultr，带冒烟和自动回滚。凭据由 `scripts/load-deploy-env.sh` 读取。
- **这两个脚本没有 dry-run，会直接连服务器，本次没有执行。**
- **不要用 `deploy-current.sh orchestrator` 或 `both`**：它们调用 `deploy-orchestrator.sh` 时只传 1 个参数，而当前的 `deploy-orchestrator.sh` 是"仅维护发布"，要求 2 个参数和 3 个清单摘要，会直接报 `MAINTENANCE_TARGET_REQUIRED`。

### 4.4 验证

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 https://holaday.ai/api/healthz
curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 https://hd-app.orangebench.tech/api/healthz
```

两个都是 200；两个域名返回的 SPA 入口 bundle hash 相同（`deploy-spa.sh` 会打印）；服务器 `git rev-parse HEAD` 等于发布的 SHA。按惯例记录新的线上 HEAD。

## 5. 跑 `pnpm self-check`

```bash
cd <DEPLOY_DIR>/apps/orchestrator && set -a && . ./.env && set +a
pnpm self-check --region intl          # 有北京区 key 时再跑一次 --region cn
pnpm self-check --skip-models          # 只看迁移/基础设施/开关，不发模型请求
```

也可以在后台 `/admin/self-check` 点"开始自检"。模型通道每个不同的模型最多发一次 8 token 的请求；媒体只做鉴权探测，不会生成；key 不会出现在输出里。有 ❌ 时退出码为 1。

**判定通过**（退出码 0）：

| 组 | 必须 |
|---|---|
| 数据库迁移 | 0059–0065 共 7 项全部 ✅ |
| 基础设施 | MySQL、Redis、浏览器池（Chromium）都是 ✅ |
| 模型通道 | 默认大脑的 browser / generate / scrape / plan / suggestions / verifier / vision 都是 ✅ |
| 媒体 | 百炼鉴权 ✅ |
| 开关 | 只是展示当前值（都显示 ✅）。逐项核对：与第 3、8 节的计划一致，没有残留的"关"值 |

**可以接受的 ⚠️**：
- 没配 `FAL_KEY`（Nano Banana 2 / Veo 不可用，其他媒体不受影响）；配了 `FAL_KEY` 但 fal CDN 不可达时，只有不用 fal 模型才算可接受；
- 没配 `FIRECRAWL_API_KEY`（搜索失败时无法降级、抓取模式不可用）；
- 模型通道偶发的超时、429、5xx：隔几分钟重跑，第二次仍是 ⚠️ 就要查。

**不能接受**：任何 ❌。`MODEL_ROLLOUT_NOT_ALLOWED` / `MODEL_MIGRATION_IN_PROGRESS` 这类 ⚠️ 表示某个通道被旧开关关着，回第 3.1 节。
已知情况：qwen3.8-max 在账号验证完成前会是 ❌"免费额度已用完（403 FreeTierOnly）"，影响 browser / verifier / vision 三个通道。这种状态不算通过。
Chromium 显示 ❌ 时，先确认 self-check 是用和服务进程相同的用户、相同的浏览器目录跑的。

## 6. 回滚

**先关开关，再考虑回滚代码。** 第 8 节的开关都是关掉加重启就能恢复，比回滚代码快。千问的紧急总开关是 `QWEN_CORE_ROLLOUT_MODE=off`。

**代码回滚**（服务器）：

```bash
cd <DEPLOY_DIR>
git checkout --detach <OLD_SHA>
pnpm install --frozen-lockfile
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench build      # Vultr 的 SPA 跟着回退
# 用线上现行方式重启，然后检查 healthz
```

Aliyun 的 SPA：在本机干净的 worktree 里 `git checkout <OLD_SHA>`，执行 `pnpm --filter @holaday/web-workbench build`，再执行 `./scripts/deploy-spa.sh`（两边都会回到旧 bundle）。

**迁移不回退。** 旧代码不认识这些新表和新列，也不会去读：
- 0059、0062、0065 的新列都有默认值或可空，旧代码插入时不写也没问题；
- 0060 把列放宽为可空，旧代码照常写数字；
- 0061、0063、0064 的新表旧代码不访问。代价是：回滚期间退额度清扫器不跑，`quota_refunds` 里待退的记录保留，等重新上线后会继续处理；回滚期间定时任务的连续失败计数不会更新。

**确实需要删掉结构时**（只在代码已回滚、并且刚做过一次新备份之后）：

```sql
-- 0065
ALTER TABLE scheduled_tasks DROP COLUMN notify_on_success, DROP COLUMN failure_notify_threshold, DROP COLUMN consecutive_failures, DROP COLUMN pending_task_id;
ALTER TABLE planned_tasks  DROP COLUMN notify_on_success, DROP COLUMN failure_notify_threshold, DROP COLUMN consecutive_failures;
-- 0064 / 0063（会丢掉退款账本）/ 0061
DROP TABLE model_catalog_settings;
DROP TABLE quota_refunds;
DROP TABLE task_model_selections; DROP TABLE model_catalog_events; DROP TABLE model_catalog;
-- 0062（同文件头的回滚 SQL）
DROP TABLE operation_path_replays;
ALTER TABLE operation_paths DROP COLUMN canary_pass_streak, DROP COLUMN generalizer, DROP COLUMN template_json;
ALTER TABLE task_action_captures DROP COLUMN executor_source, DROP COLUMN outcome_json, DROP COLUMN replay_json;
```

0059、0060 不建议回退：0060 回退要先把 NULL 改成 0，等于伪造历史用量。
用第 1 步的备份整库恢复，会丢掉备份之后的所有写入，只作为最后手段。

## 7. 上线后真机冒烟（只列链接）

1. P0 smoke：`DEPLOY_CHECKLIST.md` RULE 3（`eval:smoke`，`EVAL_BASE_URL=http://127.0.0.1:4001`）。
2. 全面验收：`scripts/smoke-real-tasks.md`，包括文本、技能、股市、能量、规划、项目、浏览器 15 条、扩展、图片、视频和模型管理。
3. 回归基准：`docs/HOLADAY_PHASE0_BASELINE.md`（含 E19 / E20）。
4. 批次子报告里的真机项（在任务目录 `/private/tmp/holaday-tasks/`，不在仓库里）：
   - `batch-10-2-subreport.md`"需要 BOSS 处理的事"：退款标签、本机 Chrome 面板关闭按钮；
   - `batch-10-3-subreport.md`"需要 BOSS 处理的事"第 2 条：企业微信、飞书、钉钉机器人和失败阈值；
   - `batch-10-4-subreport.md` §6：扩展 8 步；
   - `batch-08-report.md` 更新 F：fal NB2、Wan t2v 在服务器上复测；
   - `batch-10-report.md` 10.1：self-check 结果和预期对照。
5. 扩展安装：`docs/CHROME_LOAD_GUIDE.md`。

## 8. 首日开关：顺序和观察

上线时全部关闭，先确认第 5、7 节通过，再按下面的顺序一次开一个。每开一个都要：改 `.env`、重启、跑 P0 smoke、观察至少 1–2 小时。
**关闭方法统一为**：把变量删掉或改成非 `true`，再重启。

| 顺序 | 开关 | 影响 | 观察指标 |
|---|---|---|---|
| 1 | `ACTION_CAPTURE_ENABLED=true` | 只多写 `task_action_captures`，不改变执行结果 | 新行在增长，`replay_json` 非空的比例；抽查输入值都是 `[REDACTED:sensitive]`；浏览器任务成功率和耗时不变；日志里没有捕获写库错误 |
| 2 | `PLAYBOOK_SEDIMENT_ENABLED=true` + `PLAYBOOK_CANARY_ENABLED=true` | 后台 BullMQ 任务（队列 `playbook-evolution`），canary 会起无头 Chromium；对用户不可见 | 后台"学习引擎"的进化看板：路径数、验证通过率；`canary_results` 新行；服务器 CPU 和内存；Redis 队列不积压。至少要有同站点、同能力 2 次以上成功任务才会出路径，第一天可能是 0 |
| 3 | `MEMORY_EXTRACTION_ENABLED=true` | 每个成功的浏览器任务多一次 generate 通道调用，写 `execution_memory`（只写站点操作和偏好），之后会被注入到同一用户的任务里 | 日志 `memory: extracted + stored` 和 `memory: extract call failed` 的比例；`llm_calls` 调用量和费用；抽查新记忆里没有手机号、邮箱、证件号这类信息 |
| 4（首日不开） | `PLAYBOOK_REUSE_ENABLED=true` | 命中已验证路径时直接确定性回放，**改变用户任务的执行路径** | 要等看板上有 verified 路径、canary 通过率连续几天稳定之后再开；开后看复用命中率、`operation_path_replays` 里 failed 的比例、浏览器任务成功率 |

第 2 步的注意事项：
- 受控启动模式（进程带 `HOLADAY_POOL_BOOT` / `HOLADAY_POOL_CANDIDATE`）下，打开 `PLAYBOOK_SEDIMENT_ENABLED`、`PLAYBOOK_CANARY_ENABLED`、`PLAYBOOK_EXPLORER_SCHEDULE_ENABLED`、`RETENTION_REAPER_ENABLED`、`USER_TASK_CRYSTALLIZE_ENABLED` 中的任何一个，启动时都会直接报 `CONTROLLED_BACKGROUND_UNPROVEN`，**服务起不来**。开之前先按第 0 步确认启动模式。
- 可调参数：`PLAYBOOK_CANARY_PASS_THRESHOLD`（默认 3）、`PLAYBOOK_SEDIMENT_MIN_SUPPORT`（默认 2）、`PLAYBOOK_{SEDIMENT,CANARY,EXPLORER}_INTERVAL_MS`、`PLAYBOOK_CANARY_BATCH_SIZE`。

**继续保持关闭**：

| 开关 | 原因 |
|---|---|
| `RETENTION_REAPER_ENABLED` | 证据清理器（`evidence/retention-reaper.ts`），需要单独评估；受控模式下还会导致启动失败 |
| `USER_TASK_CRYSTALLIZE_ENABLED` | 旧的结晶清扫，与本次无关 |
| `PLAYBOOK_EXPLORER_SCHEDULE_ENABLED`、`EXPLORER_ENABLED` | 站点清单 `EXPLORER_SCHEDULED_SITES` 还是空的；会产生 Firecrawl 费用 |
| `B4_SCREENSHOT_ANCHOR_ENABLED` | 和捕获一起开时会产生 `manual_hold` 截图，没有自动删除期限 |
| `BROWSER_EXECUTOR` | 评测结论出来之前**显式写 `legacy`**。批次 11.0 如果把代码默认值改成 `unified`（标注"待 3.8-max 复核"），不写这个变量就会跟着代码默认值切过去。要切到 `unified`，等 qwen3.8-max 复核通过并经 BOSS 拍板后再改 |
| `ASTROLOGY_ENABLED` | 由 codex 占星线决定，本次不动 |
| `OTA_USER_BROWSER_ENABLED` 及其 allowlist | 保持现有 canary，不扩大 |
| Claude / GPT 大脑 | 后台"模型管理"里保持隐藏；要打开，先配好对应的 key |
