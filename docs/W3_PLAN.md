# W3 Plan — HOLA DAY

> 承接 W2 Day-6 收官（真浏览器端到端 11/11 绿、100+ tests 全绿、popup Results 落地）。
> 详见 [`W2_FINAL_REPORT.md`](./W2_FINAL_REPORT.md)。

W3 的主题是**从公开页跑通到真业务场景跑通**。Baidu 是 warm-up，抖音/雪球是真钱。

---

## P0 · 真登录态端到端

### P0.1 · 抖音创作者中心（`creator.douyin.com`）

**目标**：在用户已登录的 `creator.douyin.com` 上完成一次真业务操作。候选意图按"读 → 写"难度递进：
- **读操作（先做）**："列出最近 7 天的视频评论数量和点赞数"
- **写操作（P0 的下一阶段）**："把近 24h 待回复的评论列表给我"（列出，不真回；真回复已在 `douyin-comment-manager` Skill 的批量 confirm 路径）

**需要做的**：
1. 跑之前会发现 Opus 给抖音产的 selector 跟真 DOM 不匹配 — 这是 **P1 self-heal 的主要触发场景**
2. 可能撞上抖音 bot 检测（风控页、滑块验证码）—— 撞上就记录诊断截图 + URL，self-heal 会把这些回传给 Claude，让它识别出是 captcha 并在 description 里标注（planner system prompt 里已有这条规则）
3. `allowedOrigins` 约束：`douyin-comment-manager` Skill 的 manifest 里已限 `*.douyin.com`；`PlaywrightCrxAdapter` 构造时要真正传这个 allowedOrigins（当前 orchestrator 没串 —— 是 technical-debt 第 8 条）
4. 真环境验证 `batch_confirm_required` 协议：批量预览 + Confirm/Skip/Cancel 在真评论流下交互顺畅

**验收**：抖音 Creator 后台上的一个真任务从 popup 输入 intent → plan 产出 ≤10 步 → 执行完成 ≤1min → Results 区域看到结果或 batch 预览。

### P0.2 · 雪球持仓摘要（`xueqiu.com`）

**目标**：用户已登录雪球，意图"今天我的持仓涨跌情况"→ extract 持仓列表 + 总浮盈 → popup 汇总展示。

**需要做的**：
1. `xueqiu-portfolio-digest` Skill 在 W2 Day 3 已写 SKILL.md；Day-6 未真跑。W3 先 popup Run，失败看 selector / self-heal，迭代 SKILL.md 的 hint
2. 雪球持仓需要进 "我的持仓" 页（URL 形如 `xueqiu.com/p/{user}`）—— 需要 Skill 给具体 entryUrl，或 plan 里用 `goto` 到推断 URL
3. 数字解析：涨跌百分比是带 `+` `-` 的字符串，`texts[]` 抓完后 popup 得能看出来——extract 只返字符串，**人读足够**，不做结构化解析

**验收**：同 P0.1 —— 真跑通一遍，Results 有数据。

### P0.3 · 已知前置债（做 P0.1/P0.2 前顺手清）

- **orchestrator 还没把 Skill 的 `allowedOrigins` 传给 PlaywrightCrxAdapter** —— 目前 adapter 构造传空数组等于不限 origin，虽然现在没撞坑但一撞就 goto 所有 URL。**这条必须在 P0 之前做**，不然是 Phase 1 SafetyFilter 的前置。

---

## P1 · Self-Heal 实战验证 + 任务历史

### P1.1 · Self-heal 真场景验证

**目标**：从 P0.1/P0.2 的真任务跑中自然触发 SELECTOR_NOT_FOUND，观察 `planner.healSelector` 是否能从截图重新推出有效 selector。

**度量**：
- heal 成功率：`task_steps` 表里，error_code=SELECTOR_NOT_FOUND 的步中，最终 status=completed（经过 1 次 heal 重试）的比例；预期 ≥ 40% 就够 Phase 0 dogfood，能救一半就是赚的
- heal 成本：每次 heal 约 1 次 Opus call，截图约 50-200KB 输入；`llm_calls` 里 `purpose='commander.heal'` 的行应能看到具体 token 数
- heal 次数失控：如果某 session heal 占总 Opus 调用 > 50%，说明 Day-6 的 planner system prompt 还是太乐观，要回炉

**可能要做的补丁**：
1. 如果 heal 效果好但 1 次不够：把 `MAX_STEP_RETRIES=1` 提到 2（+1 次 heal 机会）
2. 如果 heal 经常给出 identical 的 selector：prompt 里更凶地警告"**strategies tried 是黑名单不是白名单**"
3. heal 生成的新 selector 是否要回写 `task_steps.input` —— 当前是内存 mutate，重启丢失；W3 决定（成本：加一条 UPDATE，好处：审计真实）

### P1.2 · popup 任务历史

**目标**：popup 除了显示"当前 + 最近"的几个任务，还能翻到**过去 1-7 天**的任务，点进去看详情。

**需要做的**：
1. 新 tRPC 端点 `tasks.list({ since?, until?, limit, cursor })` —— 仿 `llmCalls.list` 的 DESC id cursor 分页；scope 当前用户
2. 新端点 `tasks.detail(taskId)` —— 返回 task 行 + 所有 step 行的 `output`，给 popup 渲染 Results 区域
3. popup：登录后除了当前 tasks 列表（从 SW 内存），加一个"历史"折叠区，lazy 查 `tasks.list`，点一条展开查 `tasks.detail`
4. 历史展示可复用 `ResultsSection` 组件

**边界**：Phase 0 不做 search / filter，只是时间倒序分页。

---

## P2 · UI 打磨 + 交接文档

### P2.1 · popup UI 打磨

目前 popup 能跑起来但粗糙。具体痛点（Day-6 dogfood 注意到的）：
- **状态 badge 颜色对色盲不友好**：paused 黄和 awaiting_user 黄分不清 → 加图标或文字补足
- **error 消息直接糊一大串 JSON**：比如 Anthropic 403 那坨 `{"error":{"type":"forbidden",...}}` 直接抛到 UI。包装层 friendly message + 展开看原文
- **长 task 列表没有折叠**：多跑几个任务后 popup 会很长 —— 每个 task 只默认展开最新一个，其余折叠
- **Smoke Test 按钮平时其实没用**：放太显眼占空间 —— 挪到 "Dev" 菜单或加个 `Ctrl+Shift` 激活

**不做**：复杂过渡动画、主题切换、i18n —— Phase 1 再说。

### P2.2 · `SESSION_HANDOFF.md`（新文件）

一份给新同事（或 Claude 下次 session）的"5 分钟上手"文档，放 `docs/SESSION_HANDOFF.md`：

- 项目是什么（2 段，链接到 STRATEGY + TECH_POC）
- 本机怎么跑起来（`./scripts/refresh.sh` + `pnpm --filter @holaday/orchestrator dev` + `chrome://extensions` reload）
- 关键文件导航（orchestrator / driver / extension / skills 各一段）
- 已知**必看**的坑（从 W2_FINAL_REPORT 的"已解决的典型难题"抽 3-5 条最容易踩的）
- debug 工作流（SW console / orchestrator 日志 / `task_steps` 表 / `llm_calls` 表 各查什么）
- 当前分支状态 + 如何看最新 EOD

---

## 时间预算

| 块 | 天数 | 说明 |
|---|---|---|
| P0.3 前置债（allowedOrigins 接线） | 0.5 d | 必须先做 |
| P0.1 抖音 E2E | 1-1.5 d | 可能撞 bot 检测 +0.5 d |
| P0.2 雪球 E2E | 0.5-1 d | 登录态简单，selector 才是难点 |
| P1.1 self-heal 度量 + 补丁 | 1 d | 和 P0 并行跑数据 |
| P1.2 任务历史 | 1 d | 后端 0.5 + 前端 0.5 |
| P2.1 popup 打磨 | 0.5 d | |
| P2.2 SESSION_HANDOFF | 0.5 d | |
| **合计** | **5-6 d** | 留 1 d buffer |

---

## 风险与决策点

- ⚠️ **抖音/雪球风控**：真撞上滑块，Phase 0 不做"自动过验证码"，直接 surface 给用户手过。self-heal 的 description 得能写出"需要用户完成验证码"—— planner prompt 需要一条新规则
- ⚠️ **Opus 成本**：self-heal 打开后每个失败步多 1 次调用。如果 dogfood 期每天 100 任务 × 20% SELECTOR_NOT_FOUND × $0.03/heal = $0.60/day，还能忍；到 $5/day 就要重审
- ⚠️ **Skill `allowedOrigins` 接线做不对会放开防护**：P0.3 落地前 adapter 仍可 goto 任意 URL。W3 做不完就标红在日报里
- ⚠️ **Chrome 112+ 非扩展 popup 打开的权限提示**：抖音如果重定向到登录页又跳回来，某些 Chrome 版本会提示"您的扩展请求权限"—— 真遇到再开工单

---

## 不做（明确排除）

- Anthropic computer-use browser 模式 —— 抽象层大改，Phase 1 再评估
- 独立 Web dashboard —— popup 承载 Phase 0 用户量足够
- PDF 导出 / 邮件推送 / 定时任务 —— 都是 Phase 1
- 多 Skill 组合工作流（Skill A 的输出喂给 Skill B） —— Phase 1
- 本地 LLM 备份 —— Anthropic 下线才考虑
