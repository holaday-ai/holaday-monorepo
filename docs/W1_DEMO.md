# HOLA DAY — Week 1 End-to-End Demo (runbook)

> **Goal**：在 2026-04-24 周五验收会上，用 ~5 分钟演示 Agent Loop 完整闭环：登录 → 创建金融资讯任务 → Opus 4.7 规划 → 分步派发 → 高危步骤 awaiting_user 弹窗 → 用户 Confirm → 继续执行 → 用户 Pause → Resume → 任务完成。
>
> **范围**：真 Anthropic API（commander）+ 真 MySQL/Redis + 真 Chrome 扩展 UI + **stub 步骤执行**（extension 自动 ack dispatch，W2 换成 Playwright-CRX）。

---

## 0. 前置

在 founder 的 dev 机上：

```bash
# 0.1 仓库 & deps
git fetch && git checkout claude/chrome-extension-poc-biwr6
pnpm install

# 0.2 .env.local 已经写入 ANTHROPIC_API_KEY / DATABASE_URL / ...
cat .env.local | head -3

# 0.3 起 MySQL + Redis + MinIO
docker compose up -d mysql redis minio

# 0.4 Apply migrations
pnpm --filter @holaday/orchestrator db:push

# 0.5 Register built-in skills (eastmoney + taobao)
pnpm --filter @holaday/orchestrator sync-skills
# 预期:
#   inserted=2 updated=0 total=2
#     eastmoney-news-digest@0.1.0  东方财富资讯聚合
#     taobao-qianniu-inbox@0.1.0  千牛客服汇总

# 0.6 (可选) smoke-check API key
pnpm --filter @holaday/orchestrator smoke-anthropic
# 预期: {"ok":true,"model":"claude-haiku-4-5-…","text":"ok", ...}
```

## 1. 起服务

```bash
pnpm dev
# → @holaday/orchestrator:dev HTTP 3001 / WS 3002
# → @holaday/extension:dev      vite watch -> apps/extension/dist/
```

## 2. 注册一个演示账号

```bash
curl -sS -X POST http://127.0.0.1:3001/trpc/auth.register \
  -H 'content-type: application/json' \
  -d '{"email":"demo@holaday.local","password":"hunter22hunter22","displayName":"Demo"}' \
  | jq '.result.data.user'
```

## 3. Chrome 加载扩展

1. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序
2. 选目录：`apps/extension/dist/`
3. 扩展列表里应出现 "HOLA DAY"
4. 点击工具栏图标打开 popup → 输入 `demo@holaday.local` / `hunter22hunter22` → Sign in
5. 看到 popup 顶部显示用户名 + "Run" 按钮 = 登录成功

SW 控制台（`chrome://extensions` → HOLA DAY → Service Worker Inspect）应该有：

```
[holaday] welcome { type: 'server.welcome', clientId: '...', heartbeatMs: 30000 }
```

## 4. 演示 A：正常任务 → awaiting_user → Confirm

在 popup 的 textarea 里输 intent：

```
帮我整理今天半导体板块的要闻，带 3 条股吧热帖
```

点 **Run**。

期望（~5 秒内）：

1. **Orchestrator 终端**：
   - 一条 tasks.create 请求 → Opus 4.7 planning
   - 若干 server.task.dispatch 发出
   - 某一步命中 high-risk → `server.user.confirm` 发送
2. **Popup**：
   - 出现一张 task 卡片，step 列表逐个从 `executing` → `completed` 刷
   - 到高危步，卡片状态变黄色 `awaiting_user`，下方出现橙色 confirm box + **Confirm / Reject** 按钮
3. **点 Confirm**：
   - tRPC `tasks.confirm` 200
   - 卡片状态回到 `executing`，剩余 step 依次完成
   - 最终状态变绿色 `completed`
4. **DB 核查**：

```bash
mariadb -uholaday -pholaday-dev holaday -e "
  SELECT external_id, status, pause_reason, created_at FROM tasks ORDER BY id DESC LIMIT 1;
  SELECT type, actor, created_at FROM task_events WHERE task_id = (SELECT MAX(id) FROM tasks) ORDER BY id;
"
```

`task_events` 应包含：`task.created` → 若干 `step.completed` → `step.awaiting_user` → `step.completed`（Confirm 后） → `task.completed`。

## 5. 演示 B：执行中 Pause → Resume

再点一次 **Run**（或刷新同一条 intent）。

在 step 列表开始刷的第一秒内，**尽快点 Pause**：

1. Popup：卡片状态变黄 `paused · user`，Resume 按钮激活
2. Orchestrator 终端：`server.task.control command=pause reason=user` 发出
3. SW 控制台：看到 `server.task.control` 帧
4. **点 Resume**：
   - `server.task.control command=resume` + `server.task.dispatch` 重发当前 step
   - step 列表继续前进
   - 终态 completed

## 6. 演示 C：重启恢复

- 在 awaiting_user 状态下不点 Confirm，直接：

```bash
# 杀 orchestrator
pkill -f "tsx.*src/index.ts"
```

- 等 2 秒 popup 右上角显示断开（SW 重连中）
- 重新起：

```bash
pnpm --filter @holaday/orchestrator dev
```

- 扩展自动重连，popup 卡片重新弹出**同一张** `awaiting_user` 卡片 + confirm box（这是 rehydrate + re-emit `server.user.confirm` 的效果）
- 这一刻向观众强调：**数据库才是 Agent Loop 的 source of truth；orchestrator 进程是无状态的**

Orchestrator 启动日志会有：

```
restart recovery: rehydrated in-flight tasks { userCount: 1, taskCount: 1 }
```

## 7. 把"它能做什么"讲清楚

演示结束说三句话：

1. **现在**：完整 Agent Loop（规划 → 派发 → 结果 → 确认 → 暂停/恢复 → 完成）+ 崩溃恢复 + 三触发暂停（user / retries_exhausted / quota_exceeded），全程 47+ 项测试覆盖。
2. **还不做**：真浏览器动作（W2 Playwright-CRX 接入后步骤才是真的 goto/click/extract）。今天的 stub 是"信号自洽"演示。
3. **下一周首发 skill**：`eastmoney-news-digest`（已入库）+ `douyin-compass-overview`（待设计）。淘宝从首发里撤下来，理由见 `docs/STRATEGY_PIVOT_2026-04-21.md`。

---

## 故障排查

| 现象 | 原因 / 处置 |
|---|---|
| Popup Run 点了没反应 | 未登录（没 token）；orchestrator 没起（3001 没响应）。看 SW console 报错 |
| 卡片一直 `executing` 不动 | SW 的 auto-ack 没回；看 SW console 有没有 `stub-exec ok` 日志 |
| `tasks.create` 500 `planner returned empty plan` | Anthropic 拒答了；把 intent 写得更具体再试 |
| Confirm 后 412 `cannot confirm from status=executing` | 点晚了，step 已自动走完。正常行为 |
| 重启后 popup 没弹 confirm | `rehydrateInFlight` 查询空：当前没有任何 in-flight task（已 completed/cancelled）。DB 核查 |
| `chrome://extensions` 加载失败 | `apps/extension/dist/` 没生成 → `pnpm --filter @holaday/extension build` 一次 |

## 验收勾选（对着讲的时候打勾）

- [ ] 登录成功，SW welcome 日志 OK
- [ ] Run 触发真 Opus 4.7 规划，返回 N 步 plan
- [ ] Popup 卡片实时显示 step 状态迁移
- [ ] 高危步触发 awaiting_user，橙色 confirm box 出现
- [ ] Confirm → 任务继续直至 completed
- [ ] 执行中 Pause → 黄色 paused·user，Resume → 继续
- [ ] Kill orchestrator → 重启 → Popup 自动收到重发的 confirm
- [ ] `task_events` 表里事件序列完整
