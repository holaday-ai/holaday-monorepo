# W2 Final Report — HOLA DAY

> **Phase**：0（Agent Loop 骨架 → 真 Chrome 端到端）
> **Branch**：`claude/chrome-extension-poc-biwr6`
> **周期**：W2 Day 1 – Day 6
> **结束状态**：真浏览器端到端 11/11 绿，3 轮 extract 共 184 条记录；Smoke Test 7/7 绿；测试 100 本地全绿

---

## 一句话总结

W2 把 W1 的 Agent Loop 骨架**跑上真 Chrome**：浏览器驱动独立成 `@holaday/browser-driver` 包 + `PlaywrightCrxAdapter`；SW 侧绕过 MV3 生命周期 + 动态 import 禁用 + `window` 缺失三连坑；planner 侧加硬 selector 规则 + SELECTOR_NOT_FOUND self-heal 回路；popup 接住 extract 数据与 screenshot 缩略图。真 Opus 规划现在可以把"帮我整理半导体要闻"这类任务跑 11/11 全绿。

---

## W2 Day-by-Day 核心产出

### Day 1 · 2026-04-28 · executing 重启 + 首个 Skill
- `9a4d45e` fix(ws): 重启后 re-dispatch executing 步（W1 backlog b1）
- `fc97f56` feat(skills): `douyin-compass-export`（ecommerce-ops 首个 Skill）
- `1aa217e` docs: Day 1 EOD

### Day 2 · 2026-04-29 · 批量 confirm 协议 + 第二 Skill
- `f94fb2f` shared-types: `server.batch_confirm_required` WS schema
- `e60447d` agent: TaskController 批量 confirm 分支
- `835c1bd` trpc: `tasks.confirm` 接 decision 枚举 + batch-approve repo path
- `333c2e4` extension: popup 批量预览卡（Confirm / Skip / Cancel）
- `7c6fc50` skills: `douyin-comment-manager`（首个写操作 Skill）
- `b4a1760` docs: Day 2 EOD

### Day 3 · 2026-04-30 · 第三 Skill + popup 防连点 + Sonnet 对照
- `eebf044` extension: popup 按钮 in-flight lock 防双击 412 风暴
- `af9be0e` skills: `xueqiu-portfolio-digest`（finance-research 首个）
- `7c229c4` docs: Sonnet 4.6 vs Opus 4.7 commander bake-off（**Opus 留任 Phase 0**，Sonnet 3/3 测有 1 条产出 malformed tool output）
- `fc6914f` docs: Day 3 EOD

### Day 4 · 2026-05-01 · 浏览器驱动包 + SW 接入 + runbook
- `5a35ab5` feat: `packages/browser-driver/`：driver interface / MockDriver / SelectorPlan / OriginGuard / 16 单测
- `26dbcba` extension: `PlaywrightCrxAdapter` 接入 SW（lazy import、chrome.debugger permission、MockDriver 回退）
- `2a7be08` docs: `W2_BROWSER_DRIVER_GUIDE.md` 真 Chrome 冒烟 runbook
- `5b00cc9` docs: Day 4 EOD

### Day 5 · 2026-05-02 · llm_calls 表落地 + tRPC 查询端点
- `393b580` orchestrator: `DrizzleLlmCallRecorder` + 成本估算器 + AnthropicPlanner 接入 + 11 单测
- `52ef5fa` orchestrator: boot 注入 recorder + `llmCalls.list` tRPC endpoint + 3 集成测试
- `4be46d1` docs: Day 5 EOD

### Day 6 · 2026-04-18（密集调试日） · 从冒烟不通到真端到端 11/11
**Anthropic 403 地理封锁排查**
- `d6c669e` orchestrator: planner 上游错误改成 BAD_GATEWAY，日志吐完整堆栈

**SW 生命周期三连坑**
- `3ae4166` extension: `chrome.alarms` 保活 + `chrome.storage.onChanged` token 监听 + `connect()` 幂等；绕开 MV3 SW 闲置 30s 被回收
- `9f057c1` extension: 砍掉 MockDriver 沉默回退，`VITE_BROWSER_DRIVER=auto/mock`
- `0f6e1a4` / `e21239c` / `2620c90`: **连环三修** —— Vite `modulePreload: false` → 最小 `window.dispatchEvent` shim → **静态 import crx 适配器**（MV3 SW 禁动态 `import()`，w3c/ServiceWorker#1356）

**Screenshot 连环坑**
- `ae1b49a` / `94d0b2b`（两修均被 playwright-crx 吞）→ `9393922` **弃用 `page.screenshot()`，改用原生 `chrome.tabs.captureVisibleTab`**

**诊断与 smoke 基建**
- `a0ed3ee` browser-driver: 富 SELECTOR_NOT_FOUND 诊断（每条 strategy 失败原因 + URL/title + 视口截图）
- `1cad688` orchestrator+extension: `tasks.smokeTest` + popup Smoke Test 按钮（硬编码百度 plan，绕过 Opus）
- `b7895ea` smoke-plans: 百度按钮 selector 6 条 fallback
- `afc661b` driver: 新增 `key` action kind（Enter 提交替代 click 按钮）
- `5ae1d65` scripts/refresh.sh：一键 pull + rebuild + kill orchestrator

**planner 收紧 + self-heal**
- `8cdd46f` planner: system prompt 硬 selector 优先级 + 最少 3 fallback + wait-before-extract + key-over-click；`Planner.healSelector(ctx)` + `AnthropicPlanner` 发截图给 Claude 生成替换 selector；WS server 拦 SELECTOR_NOT_FOUND，in-place 改 `plan[cursor].selector` 后走 controller 原有 retry

**结果展示 + 最后收尾**
- `c1bd7da` extension: popup Results 折叠区（extract 文本列表 + JPEG 缩略图）；SW 存 `step.output` + SW 侧再截一张 JPEG 缩略图
- `f13da7f` scripts/refresh.sh: `env -u HTTPS_PROXY` 绕开 HTTP/2 framing 错

---

## 关键技术决策清单

| # | 决策 | 背景 |
|---|---|---|
| 1 | **Opus 4.7 留 commander** | Sonnet 4.6 bake-off：3/3 测 1 次产 malformed tool output，延迟 1.3× 成本 3× 但质量差 |
| 2 | **MockDriver 从沉默回退改为显式 VITE_BROWSER_DRIVER** | Day-5 smoke `{stub:true}` 冒充成功的坑 |
| 3 | **静态 import `@holaday/browser-driver/crx`** | MV3 SW 禁动态 import（w3c/ServiceWorker#1356） |
| 4 | **`chrome.tabs.captureVisibleTab` 替代 `page.screenshot`** | playwright-crx 0.15 的 page.screenshot 在 SW 无限挂 |
| 5 | **`key` action kind 替代 click submit** | 搜索框 button 在 JS hydration 时会被短暂 detach |
| 6 | **self-heal：失败时 in-place mutate plan + 沿用已有 `MAX_STEP_RETRIES=1`** | 零状态机改动；每失败步最多 1 次额外 Opus 调用 |
| 7 | **`refresh.sh` 用 `env -u HTTPS_PROXY` 只剥 git 那一条命令** | 代理穿透：orchestrator 要代理调 Anthropic，但 git 过代理撞 GitHub HTTP/2 framing 错 |
| 8 | **screenshot blob 不走 WS 只留 SW 内存** | driver 吐 size metadata，SW 单独再截一张 JPEG 给 popup；3MB→50KB |

---

## 已解决的典型难题（踩坑沉淀）

1. **MV3 SW 30s 闲置即死** → `chrome.alarms` 最小周期 0.5min + 顶层 `ensureConnected()` + `storage.onChanged` 多唤醒路径 + `connect()` 幂等
2. **Anthropic 大陆 403 forbidden "Request not allowed"** → 运维侧解（`HTTPS_PROXY` / VPN / 或 `ANTHROPIC_API_KEY` 留空走 StubPlanner）+ 代码侧把上游错误分到 BAD_GATEWAY 让错误消息清晰透传
3. **`window is not defined` 真凶藏在 Vite `__vitePreload` 错误分发器** → 先试 `modulePreload:false`（没用），再 SW 顶层加 1 属性 shim `{ dispatchEvent: () => true }`，最后真凶 `TypeError: import() is disallowed on ServiceWorkerGlobalScope` 才现形，改成静态 import
4. **SELECTOR_NOT_FOUND 3×2000ms 整数倍** → Playwright `waitFor(attached)` 的 `perStrategyTimeoutMs` 默认 2s；富诊断 + self-heal 后 Claude 可看真 DOM 出新 selector
5. **popup 数据断链** → SW 曾经只保留 `step.status` 丢掉 `output`；改成 SW 保 `step.output`，popup 直读，零 orchestrator 改动

---

## 当前测试矩阵

| 套件 | 数量 | 状态 |
|---|---|---|
| 单测 · browser-driver | 17 | ✅ |
| 单测 · orchestrator | 62 | ✅ |
| 单测 · skill-sdk | 6 | ✅ |
| 集成 · orchestrator | 21 | ✅ |
| **合计** | **106** | **✅** |

```bash
pnpm --filter @holaday/browser-driver test
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/skill-sdk test
pnpm --filter @holaday/orchestrator test:integration

pnpm --filter @holaday/extension typecheck
pnpm --filter @holaday/extension build
pnpm lint
```

**真端到端**（founder Mac 手测）：
- Smoke Test（硬编码百度 plan）：7/7 green
- 真 Opus 规划"帮我整理半导体要闻"：11/11 green，3 extract × 184 items + 1 screenshot

---

## 已知限制与技术债

### 限制
1. **`captureVisibleTab` 只截可见 viewport** —— `payload.fullPage=true` 静默 no-op。fullPage 需要 scroll+stitch，Phase 1
2. **self-heal 结果不持久化** —— 只改 in-memory `state.plan[cursor].selector`，orchestrator 重启丢 heal 结果（rehydrate 用原 plan + 已消耗 retry → 首次重试直接 paused）
3. **self-heal 1 step 最多 1 次** —— 第二次失败仍走 `retries_exhausted`
4. **popup 单用户单扩展** —— 跨设备同步、多账户切换未做
5. **screenshot 缩略图 SW 内存** —— SW 被杀时丢失，popup 此时打开看不到
6. **`chrome.tabs.captureVisibleTab` 对非焦点窗口失效** —— 用户切焦点后截的是错的 tab
7. **Baidu 等公开搜索引擎**能走 smoke，**真登录态站点（抖音/雪球/千牛）Day-6 未验证**

### 技术债
1. **`lsof` 在无 `lsof` 的环境下 refresh.sh 哑掉**（macOS 自带，Linux minimal 镜像可能没有）
2. **3 条 lint warning 长期压着**（`.rehearsal/rehearse.mjs` 里两个未用变量 + llm-calls integration test 里未用 import）——不是今日引入，但没清
3. **MockDriver 的 shim（mock 模式下）永不被执行** —— 桩里有个 `throw new Error('called in mock build')` 做防御，可能是死代码
4. **perStrategyTimeoutMs 硬编码 2000** —— 非配置，慢网络下会误报 SELECTOR_NOT_FOUND
5. **orchestrator 没有暴露 `tasks.detail`** —— popup 只能靠 SW 的内存状态，刷新 / 重登录后历史任务拿不回
6. **3MB crx-adapter chunk** —— 静态 import 后都进 SW bundle 首个入口 3.1MB，~842KB gzip，冷启动会有加载延迟
7. **`task_steps.input` 不反映 heal 后的 selector** —— 审计留原始 plan，但调试时会对不上"实际用的是哪个 selector"

---

## 下周重点（详见 `docs/W3_PLAN.md`）

- **P0** 真登录态端到端：抖音 `creator.douyin.com` + 雪球 `xueqiu.com`
- **P0** self-heal 实战验证
- **P1** popup 任务历史
- **P2** UI 打磨 + SESSION_HANDOFF.md 更新
