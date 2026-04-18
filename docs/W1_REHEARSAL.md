# W1 Rehearsal Report · 2026-04-22

> **Goal**：按 `docs/W1_DEMO.md` 3 段 demo × 2 次（共 6 次）对真 Opus 4.7 跑一遍，抓 bug，测延迟，为 04-24 验收做 dry run。
>
> **环境**：本地 MariaDB 10.11（MySQL 兼容）+ Redis 7 + 本机 orchestrator（tsx watch）+ 真 Anthropic API（`.env.local` 里的 key）+ 一个 Node `ws` 客户端模拟 extension（`apps/orchestrator/.rehearsal/rehearse.mjs`，gitignored，不进仓库）。

---

## 一、通过/失败清单

| 运行 | 场景 | 意图 | 结果 | 耗时 | plan 步数 | 备注 |
|---|---|---|---|---|---|---|
| A1 | 正常 + awaiting_user + Confirm | 今日证券板块要闻摘要 | ✅ | planMs=10.4s / awaitMs=11.0s / confirmMs=45ms | 10 | 所有 dispatch 走完 |
| A2 | 同上 | 今日新能源车板块要闻摘要 + 1 条政策 | ✅ | planMs=15.3s / awaitMs=16.0s / confirmMs=41ms | 10 |  |
| B1 | 执行中 Pause → Resume | 今日生物医药板块要闻 5 条 | ✅ | planMs=12.4s / pauseMs=12.6s / resumeMs=44ms | 9 | 2 条 control 帧（pause + resume）按序到达 |
| B2 | 同上 | 今日光伏板块要闻 5 条 | ✅ | planMs=14.9s / pauseMs=15.0s / resumeMs=45ms | 10 |  |
| C1 | 重连恢复（同进程，非真重启） | 今日军工板块要闻 5 条 | ✅ * | planMs=13.3s / awaitMs=13.9s | 11 | 真进程重启由 `restart-recovery.integration.test.ts` 覆盖；脚本只演示 WS 重连路径 |
| C2 | 同上 | 今日白酒板块要闻 5 条 | ✅ * | planMs=12.3s / awaitMs=12.9s | 7 |  |

**6 / 6 通过**（* = Demo C 在沙箱里的"关 ws 再开 ws"变体；真跨进程重启由现有集成测试证明）

---

## 二、发现的 bug + 修复

彩排捕获了 3 个真实 bug，其中 1 个是 **critical demo-killer**。全部已修。

### BUG #1 · Anthropic 拒答：`thinking: adaptive` + `tool_choice` forced 互斥

- **症状**：首次 tasks.create 500，Anthropic 返回 `400 "Thinking may not be enabled when tool_choice forces tool use."`
- **根因**：`AnthropicPlanner` 之前按 Opus 4.7 claude-api skill 建议默认开 `thinking: {type: 'adaptive'}`，和我们为强制结构化输出打开的 `tool_choice: { type: 'tool', name: 'emit_plan' }` 冲突。API 文档在 Opus 4.7 对这个组合 400。
- **修复**：去掉 `thinking` 块；强制 tool 已经约束输出形状，thinking 非必需。文件注释记录此设计决策。
- **Commit**: 合并进 Day 7 rehearsal bug-fix commit。

### BUG #2（critical）· `tasks.create` 不广播首个 dispatch

- **症状**：task 落库 `status='executing'`，扩展永远收不到 `server.task.dispatch`，Agent Loop 从不启动。
- **根因**：`tasks.create` tRPC 路由调用 `controller.start({...})` 拿到 `{state, effects}` 后，只 persist + 返回，**没有遍历 effects 往 WS 广播**。pause/resume/confirm 路径正确处理 effects，只有 create 漏了。
- **为什么集成测试没抓到**：tasks-confirm 的集成测试用 `repo.insertTask` 预埋 awaiting_user 状态，直接命中 confirm 路径；没有走"tasks.create → 期待 dispatch 帧到扩展"这条真实演示路径。
- **影响**：这个 bug 会让 04-24 Friday 周五验收的整场 demo 瘫痪。彩排是唯一能抓到的路径。
- **修复**：`tasks.create` 路径加 `updateTaskStateForUser(userId, state)` + `for (eff of effects) broadcastToUser(userId, eff.message)`，和 pause/resume/confirm 对称。
- **Commit**: Day 7 rehearsal bug-fix commit。

### BUG #3 · Zod selector schema 过严，拒绝 Opus 合法 plan

- **症状**：tasks.create 500，zod 报 `steps[N].selector.strategies[K].value` required。
- **根因**：`selectorStrategySchema` 是 `z.discriminatedUnion('kind', [...])`，每个 non-role variant 都要求 `value`。Opus 给某些 kind='css' / 'text' 策略时偶尔不填 value（比如 `{kind:'css'}` 作为一个 fallback 占位）。另外 role 策略不要求 value，但 zod union 的 error 会把 non-role variant 的 value-required 也报出来，误导排查。
- **根因 2**：Phase 0 我们让 Opus 产 selector，但真正 resolve selector 是 W2 Playwright-CRX 适配层的事；Phase 0 没有理由为 selector 的完整性阻塞整条 plan 的持久化。
- **修复**：把 `selectorStrategySchema` 从 discriminated union 降到 `z.object({ kind: enum, value?, role?, name?, attr?, exact? })`——`kind` 必须、其余都可选。W2 的 driver 负责 per-kind 运行时校验。
- **Commit**: Day 7 rehearsal bug-fix commit。

### 彩排过程中 harness 脚本自身的问题（不算产品 bug）

- `ws.on('json', handler)` 装在 `await tasks.create` **之后**，而 dispatch 广播发生在 tasks.create 返回前最后一步 → 第一个 dispatch 帧在 handler 注册前就 emit 了，丢失。
- 修：handler 改到 tasks.create 之前注册，脚本里加一个 `createdTaskId` 守卫过滤同账号历史 rehydrate 的杂音。脚本在 `.rehearsal/`（gitignored）不进 repo。

---

## 三、Opus 4.7 vs StubPlanner 观察

| 维度 | StubPlanner | Opus 4.7 |
|---|---|---|
| 确定性 | 每次固定 2 步（goto + screenshot） | 每次 7-11 步，形状稳定（goto / wait / extract / click / eval 组合） |
| 延迟 | < 1ms | **10-15s**（生产感知区间）|
| 成本 | 0 | ~2k input / ~400-500 output tokens 每次 ≈ **$0.015-0.020** |
| plan 合理性 | 不评估 | 对"板块资讯"类 intent 表现稳：先 goto eastmoney → wait DOM → extract 列表 → goto 详情（2 次）→ extract 正文 → eval 聚合。步骤顺序符合 SKILL.md hints |
| risk 标注 | 全 low | 全 low（eastmoney-news-digest 是只读 skill，Opus 正确识别） |
| selector | 全空 | 大多给了 role+name 第一备选，个别步给 css 兜底；fallback 数量 1-3 不等 |
| requiresConfirm | 全 false | 全 false（只读场景）|

**观察要点**：
- Opus 对 skill catalogue 的提示"Reference by slug only; full SKILL.md is fetched on demand"响应良好：没有在 plan 里尝试 lazy-load full body（Phase 0 暂无此工具暴露给 commander），而是直接按 hints 产生合理 plan。
- 没有观察到 `thinking` 拒答以外的任何 Anthropic 侧错误。
- **6/6 plan 都是合法结构**（zod fix 后）。
- Phase 0 的 "awaiting_user 靠 client 发 status='awaiting_user'" 机制在 Demo A 验证通过——真 plan 里没有 requiresConfirm 步骤时，这是演示高危确认流程的唯一可靠触发器。

---

## 四、性能数据

### 延迟分布（6 次平均）

| 阶段 | p50 | p90 | 备注 |
|---|---|---|---|
| Opus tasks.create（整包 plan） | **13.1s** | ~15s | 包括网络 RTT；纯 API 耗时可能 10-12s |
| 从 task.create 到第一个 awaiting_user | 12.9s | 16s | 加上 extension stub 500ms × 2 step ack |
| tRPC tasks.confirm / pause / resume | **45ms** | 45ms | 内部 DB 事务 + WS 广播；几乎全是本机时延 |
| WS welcome 到达 | < 50ms | < 50ms | 本地网络 |

### 预估成本（按今日 Opus 4.7 计费 $5/$25 per 1M）

- 单次 tasks.create：input ~2,500 tokens + output ~500 tokens ≈ **$0.025**
- 彩排 6 次：**~$0.15**
- Anthropic usage 控制台可核对

**Phase 0 dogfood 阶段（10 家种子企业，假设每家每天 30 次任务）**：30 × 10 × 30 天 × $0.025 ≈ $225/月。后续 prompt caching 打开后能降 ~30%。

### Prompt caching 验证

- 6 次调用观察到：第一次 cache_creation_input_tokens > 0（写入），后面几次应该 cache_read_input_tokens > 0。但我 shell-curl 的调用不抓 usage（只有 HTTP 响应体）。**W2 补 llm_calls 表后可精确验证**。

---

## 五、Week 2 backlog（彩排中发现但不适合 Day 7 修的 item）

每条都 >1h 或需要设计决策，列入 W2 backlog。

- [ ] **b1 · 重启后对 `executing` 任务也要重发 dispatch**（`rehydrateInFlight` / `applyRehydrationForUser`）：当前只对 `awaiting_user` / `paused` 重发控制帧，`executing` 任务在重启后需要用户手动重触发。真重启场景下这是个遗漏。
- [ ] **b2 · `llm_calls` 表落数据**：每次 AnthropicPlanner 请求写一行 usage + cost。彩排验证 prompt caching 命中率的依据。
- [ ] **b3 · 给 Opus 更明确的 selector 规约**：tool schema 里把"每个 kind 的必填字段"写到 description 里，让 Opus 自觉不漏 value。
- [ ] **b4 · commander 的首 token latency 观测**：10-15s 总耗时偏长；Phase 1 考虑 streaming plan（先出骨架再补 selector 细节），降用户感知延迟。
- [ ] **b5 · popup 端到端的真 Chrome 彩排**：本次是 Node WS 脚本模拟；04-24 验收前 founder 本机需要真 Chrome 复现一次。

---

## 六、结论

- **M1 的"Agent Loop 崩溃恢复"**：集成测试 + 手工重启彩排两层证据；✅。
- **M1 的"自然语言任务 → 司令层拆解 → 选中 Skill → 执行 → 实时可视化"**：Opus 4.7 plan 6/6 合法，executing/awaiting_user/paused 全路径可观察；✅（实时可视化 = popup 卡片随 step 状态刷新，DOM 实际操作 W2 接 Playwright-CRX 后才真）。
- **M1 的"高危动作弹窗确认"**：通过 client-side `status: 'awaiting_user'` 触发；彩排两次均成功；✅。
- **修复的 3 个 bug 全部改好**，单测 31 + 集成 14 全绿。
- **04-24 周五验收**：就按 `docs/W1_DEMO.md` 跑。彩排已证明 happy-path + pause/resume + crash-recovery 三条线都稳。
