# HOLA DAY — Session Handoff

> 一份给**下一个 Claude Code session**（或新同事）的 5 分钟上手文档。
> 读完就能接手开发，不需要再爬其他文档。

---

## 1. 产品是什么

HOLA DAY 是用户的 **meta-agent**：Chrome 扩展 + 云端 orchestrator，替用户操作**任何网站**和**任何 AI 工具**。详见 [`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md)。

核心不变量（**所有代码决策以此为准**）：
- 零学习成本：用户只说要什么，不说怎么做
- Agent 控制 Agent：目标站有 AI 就直接用它
- **后台独立运行**：点 Run 后用户可以切窗口 / 最小化 / 锁屏，任务不间断
- 全能操作：填表、提交、下载、配置、管理，不只是读

## 2. 一张架构图

```
┌────────────────────┐          ┌─────────────────────┐
│  Chrome Extension  │   WS     │     Orchestrator    │
│  (MV3 SW + popup)  │◄────────►│  (Express + tRPC)   │
└────────────────────┘          └────────┬────────────┘
        │                                 │
        │ CDP (chrome.debugger)           ├─► MySQL (tasks / steps / llm_calls)
        ▼                                 ├─► Redis
   PlaywrightCrxAdapter                   └─► Anthropic API (Opus 4.7)
   驱动 creator.douyin.com /
   xueqiu.com / etc.
```

- **popup** (`apps/extension/src/popup/`) — React 登录 + 输入 intent + 历史任务 + Results
- **SW** (`apps/extension/src/background/`) — 跑 PlaywrightCrxAdapter，单向 WS 接 orchestrator 的 dispatch
- **browser-driver** (`packages/browser-driver/`) — driver interface + CRX 适配器 + Mock
- **orchestrator** (`apps/orchestrator/`) — 创建任务、Opus 规划、WS 广播、self-heal、持久化
- **skill-sdk** (`packages/skill-sdk/`) — 加载 `skills/*/SKILL.md` manifest

## 3. 关键文件导航

| 想干什么 | 去哪 |
|---|---|
| 改 driver 动作的行为 | `packages/browser-driver/src/crx-adapter.ts` — doGoto/doClick/doType/doKey/doExtract/doWait/doEval/doScreenshot |
| 改状态机 | `apps/orchestrator/src/agent/task-controller.ts` — 纯函数 `start / onStepResult / userConfirm / pause / resume / cancel` |
| 改 Opus 的 prompt 或 tool schema | `apps/orchestrator/src/agent/planners/anthropic.ts` — `SYSTEM_PROMPT` / `PLAN_TOOL` / `HEAL_TOOL` |
| 改 WS 协议 | `packages/shared-types/src/ws.ts` — zod schema |
| 改 tRPC 端点 | `apps/orchestrator/src/trpc/routers/` — `tasks.ts` / `auth.ts` / `llm-calls.ts` |
| 改 popup 渲染 | `apps/extension/src/popup/App.tsx` |
| 改 SW 逻辑 | `apps/extension/src/background/index.ts` |
| 加新 Skill | `skills/<new-slug>/SKILL.md` → `pnpm --filter @holaday/orchestrator sync-skills` 写进 DB |
| 加新 driver 动作 | shared-types/ws.ts enum + driver.ts ActionKind + crx-adapter 的 doX + task-controller.ts PlannedStep.kind |
| DB schema | `apps/orchestrator/src/db/schema/*.ts` — drizzle |
| Migration | `apps/orchestrator/drizzle/` + `applyMigrations()` in `src/test/db-helper.ts` |

## 4. 开发工作流（强制）

**读 [`DEV_WORKFLOW.md`](./DEV_WORKFLOW.md) 全文**。要点：

1. 改代码
2. `scripts/test-all.sh`
3. 全绿才 commit（commit message 必须带 `Verified` 块，粘贴 test-all.sh 的 summary）
4. push

**创始人不跑任何命令**。Claude Code 全包。

## 5. 常用命令

```bash
# 一键起服务（git pull + install + build + 起 orchestrator 后台）
./scripts/start.sh

# 全量自测（typecheck × 4 + unit × 3 + integration + lint + build + e2e-smoke）
./scripts/test-all.sh

# 同步 Skill manifest 到 DB（改了 skills/**/SKILL.md 之后必跑）
pnpm --filter @holaday/orchestrator sync-skills

# 单独跑某个测试套件
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/orchestrator test:integration
pnpm --filter @holaday/browser-driver test
pnpm --filter @holaday/skill-sdk test

# 看 orchestrator 日志
tail -f /tmp/holaday-orchestrator.log

# 停 orchestrator
kill $(cat /tmp/holaday-orchestrator.pid)
```

## 6. 当前进度（W3 中）

- ✅ Phase 0 Agent Loop 骨架 + 真 Chrome 跑通（W1 + W2）
- ✅ P0.3 Skill `allowedOrigins` 全栈接入（orchestrator → WS → SW → driver）
- ✅ CDP screenshot + `'skipped'` status soft-fail（后台独立运行契约的关键一环）
- ✅ P1.2 popup 历史任务（tasks.list / tasks.detail）
- ✅ P2.1 popup UI 打磨（色盲友好 badge、friendly 中文提示、长列表折叠、Smoke Test 藏进 ⚙ 调试菜单）
- 🟡 P0.1 抖音 creator E2E — Skill + prompt 已接，live 层等真 Chrome 验证
- 🔄 P1.1 self-heal 度量 — 代码落地中（这份文档写的时候可能正在做）
- ❌ P0.2 雪球 portfolio E2E
- ❌ SafetyFilter（W3 后半 / Phase 1）

最新整周总结看 [`W2_FINAL_REPORT.md`](./W2_FINAL_REPORT.md)；W3 计划看 [`W3_PLAN.md`](./W3_PLAN.md)。

## 7. 已知问题 / 技术债

**必读**（最容易踩的坑）：
1. **MV3 SW 禁动态 `import()`** — crx-adapter 必须**静态** import；`VITE_BROWSER_DRIVER=mock` 走 alias 到 shim 避免打进 3MB 包。见 `2620c90`
2. **MV3 SW 30s 闲置就死** — `chrome.alarms` 30s 保活 + `ensureConnected` 在每个 SW 唤醒钩子里跑。见 `3ae4166`
3. **`chrome.tabs.captureVisibleTab` 抢焦点** — 不能用。用 `page.screenshot()` 走 CDP。`60e3aca` 把全栈换回 CDP + 'skipped' soft-fail
4. **Anthropic 大陆 403** — `HTTPS_PROXY` 必须设，orchestrator 调 Anthropic 需走代理；**git 操作必须剥掉 proxy**（HTTP/2 framing 错），`refresh.sh` / `start.sh` 用 `env -u HTTPS_PROXY` 只对 git 这一条命令剥
5. **playwright-crx 的 strict mode** — locator 中多个元素 `.click()` 会抛。doClick 已加 `.first()` fallback，其他动作还没。见 `500f225`
6. **rehydratedByUser 首次 drain 后 SW 死再活 → 不重派** — orchestrator 不重启就丢派发。Phase 1 解
7. **tasks.list/detail 用 MariaDB** — `output` JSON 列可能返回字符串。`normalizeOutput()` / `normalizeJson()` 都处理

**完整残留清单**：见 `W2_FINAL_REPORT.md` 的「已知限制与技术债」。

## 8. Debug Workflow

### "我跑任务失败了"

1. 看 popup 里 task 卡的 step 列表：哪一步 failed？
2. 看 `task_steps` 表那一步的 `error_code` + `error_message` + `screenshot_key`（SELECTOR_NOT_FOUND 时有现场诊断 + 截图）
3. 看 orchestrator 日志 `tail -f /tmp/holaday-orchestrator.log` 里该 taskId 相关行
4. SW console — `chrome://extensions` → HOLA DAY 卡片上"Service worker" → DevTools
5. 看 `llm_calls` 表有没有 `commander.heal` 记录：self-heal 触发了吗？成功没？

### "测试挂了"

1. `cat /tmp/tmp.XXXX`（test-all.sh 失败时 summary 里有具体路径）
2. 单跑那个套件：`pnpm --filter @holaday/orchestrator test -- <pattern>`
3. 看完整堆栈：`DATABASE_URL=... REDIS_URL=... JWT_SECRET=... pnpm --filter @holaday/orchestrator test:integration`

### "orchestrator 起不来"

1. `lsof -ti tcp:3001` — 有没有旧进程占端口？
2. `cat /tmp/holaday-orchestrator.log` — 启动报错？
3. MariaDB + Redis 在跑吗？`nc -z 127.0.0.1 3306` / `nc -z 127.0.0.1 6379`
4. DB 迁移跑过吗？integration 测试会自动 migrate，其他路径可能没

### "popup 连不上 orchestrator"

1. SW 有没有登录的 token？`chrome.storage.local.get('holaday.access_token')`
2. WS 能连吗？ws://127.0.0.1:3002 在 browser 里直连能握手吗
3. 有没有 proxy 挡了 `127.0.0.1`？HTTPS_PROXY 不应该代理本地

## 9. 开发规范

- **TypeScript strict** — 所有 workspace 都 strict
- **Biome** — `pnpm lint` / `pnpm lint:fix`，无 ESLint
- **vitest** — 单测同目录 `*.test.ts`；集成测试 `*.integration.test.ts`（需 MariaDB+Redis）
- **drizzle-orm** — 查询都走 drizzle，MariaDB 方言
- **注释原则** — 只写"为什么"，不写"做什么"；代码自己能说清楚的不写注释
- **commit message** — `<type>(<scope>): <小结>`；结尾必须 `Verified (scripts/test-all.sh):` + summary 块
- **不 `--no-verify` 绕过 hook** — 项目没装 pre-commit hook 但原则在

## 10. 走不通时

问创始人（Yale）。他只说需求、看最终效果。不要让他跑命令、排 bug、手测。

把问题描述成：
- 我想做 X
- 我试了 A / B / C 都挂在 Y
- 我理解的取舍是 Z
- 你想怎么决策？

不要问 "这个该怎么做？"——那是 Claude Code 该想的。

---

**写这份文档的最后 commit**：查 `git log -1 docs/SESSION_HANDOFF.md`
**上一份整周总结**：`docs/W2_FINAL_REPORT.md`
**下一步计划**：`docs/W3_PLAN.md`
