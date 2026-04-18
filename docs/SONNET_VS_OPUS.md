# Commander 模型对照：Claude Opus 4.7 vs Sonnet 4.6 · 2026-04-30

> **Goal**：W1 收尾时 founder 问"Phase 0 commander 继续用 Opus 还是切 Sonnet 省钱"。本件是 W2 Day 3 的小规模对照实测（3 个金融意图 × 2 模型 × 1 次），给 Phase 1 定价时一个数据锚点。
>
> **Phase 0 决策保持不变**：继续默认 `claude-opus-4-7`。本件是数据，不是决策。

---

## 实验设置

- **执行路径**：真 orchestrator（`pnpm --filter @holaday/orchestrator dev`）+ 真 Anthropic API + `.env.local` 的 key。
- **模型切换**：新增 `COMMANDER_MODEL` 环境变量（`AnthropicPlanner` 读 `opts.model ?? process.env.COMMANDER_MODEL ?? 'claude-opus-4-7'`）。
- **观测**：`AnthropicPlanner` 在每次 `messages.create` 后日志一行 `{component:'commander', model, elapsedMs, planSize, usage:{...}}`；`tasks` 表的 `plan` JSON 字段是 plan 全量。
- **三条意图**（都用 `occupation: finance-research`，命中 `eastmoney-news-digest` + `xueqiu-portfolio-digest` 两个 skill catalogue 条目）：
  1. "今日新能源板块要闻摘要"
  2. "帮我整理今天半导体板块的股吧热帖前 3 条"
  3. "本周金融股的主要政策面变化"

每条意图每模型跑 1 次；Sonnet intent 3 第一次失败后额外跑了 1 次确认失败是否稳定。Phase 0 不过度抽样（成本 + 时间）。

## 表 1：延迟 / plan 规模 / tokens / 成本

| 意图 | 模型 | wall (tRPC) | 纯 LLM | plan size | in tok | out tok | 成本 |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 新能源要闻 | Opus 4.7 | 2.10s | 2.01s | 1 | 2049 | 97 | **$0.0127** |
| 1 新能源要闻 | Sonnet 4.6 | 10.84s | 10.66s | 8 | 1535 | 742 | $0.0157 |
| 2 半导体股吧 | Opus 4.7 | 12.41s | 12.32s | 7 | 2060 | 925 | **$0.0334** |
| 2 半导体股吧 | Sonnet 4.6 | 9.39s | 9.29s | 5 | 1546 | 664 | **$0.0146** |
| 3 金融政策 | Opus 4.7 | 15.60s | 15.53s | 3 | 2049 | 461 | $0.0218 |
| 3 金融政策 | Sonnet 4.6 | 17.94s + 16.94s | — | **FAILED × 2** | — | — | $0.00（请求被我方 zod reject，但 API 计费仍扣，估算每次 ≈ $0.013，双次 ≈ $0.026） |

观察：
- **Sonnet input tokens ≈ 1.5k**；**Opus ≈ 2.0k**。差 500 — Opus 提示缓存写入时会多一些序列化开销？需要跨多轮对照才能盖棺，单次先记在案。
- **output tokens Sonnet > Opus**（742/664 vs 97/925/461）——Sonnet 倾向输出更多 selector / hints；Opus 在 intent 1 特别短（1 步）。后面说。
- **单次成本**：意图 1 / 3 Sonnet 贵一点或持平（Opus 靠少 output 压成本）；意图 2 Sonnet 便宜 56%（Opus 产了 925 output tokens）。**不是 "Sonnet 一定便宜 3 倍"**——取决于 output 体量。

## 表 2：plan 质量观察

| 意图 | Opus 产的 kinds 序列 | Sonnet 产的 kinds 序列 | 观察 |
|---|---|---|---|
| 1 新能源要闻 | `[eval]` | `[goto, goto, goto, goto, extract, goto, extract, screenshot]` | **两边都怪**：Opus 懒到只给 1 步 eval（用 JS 跑完整抓取？），Sonnet 搞 4 次 goto 再分两次 extract。真执行层（W2 Day 4-5 Playwright）会告诉我们哪种更可跑。 |
| 2 半导体股吧 | `[eval, goto, wait, extract, eval, extract, eval]` | `[goto, goto, screenshot, extract, eval]` | **Opus 更"浏览器式"**（goto/wait/extract 中间交替 eval 做过滤），**Sonnet 更"扫一眼"式**（前置 goto 后直接 extract）。Sonnet 首帧 screenshot 是加分项（审计线索）。 |
| 3 金融政策 | `[goto, eval, extract]` | **schema 违规**：`steps` 字段返回字符串而不是数组，连跑 2 次都这样 | **Opus 稳**，Sonnet 在这条 intent 上触发 tool-use schema 退化。样本太小不能断言"Sonnet 30% 的 planning 请求会产无效 tool 输出"，但是 **1 次已经算是可观察到的偏差**。 |

注意 Phase 0 stub 执行下没法端到端验证 plan 正确性——只能看形状。真对错要等 W2 Day 4-5 Playwright-CRX 接入后回头跑。

## 表 3：Sonnet 的 INVALID_PLAN 可复现性

Intent 3（"本周金融股的主要政策面变化"）Sonnet 连跑 2 次都返回 `steps: <string>` 而非 `steps: [<step>]`。错误都被我们 `selectorStrategySchema` 之前留下的 zod 验证捕获在 `AnthropicPlanner.plan` 里抛 `PlannerError(INVALID_PLAN)`。两次连续 failure ≈ 35s wall 浪费 + 估算 $0.026 费用（API 计费按 response 走，PlannerError 发生在我方解析阶段，tokens 仍被 Anthropic 扣）。

Opus 4.7 在同一 prompt 下 0 / 6 次失败（加上 W1 rehearsal 的 6 次 = 总共 7 / 7 成功）。

## 成本投影（月）

Phase 0 dogfood 假设：10 家种子客户 × 30 次 / 客户 / 天 × 30 天 = 9,000 次 / 月。

| 模型 | 平均成本 / 次 | 失败率 | **月成本**（含失败请求的 API 计费） |
|---|---:|---:|---:|
| Opus 4.7 | $0.023 | ~0% | **$207** |
| Sonnet 4.6 | $0.015 | 未知（本实验 1/3 失败，样本过小） | 若按失败率 10% 估：每次成功均摊 ~$0.017 → **$153** |

Sonnet 名义省 ~25%。但：
- 失败请求会走 MAX_STEP_RETRIES=1 重试路径（整条 task 进 paused），用户体验代价高。
- 若失败率真稳定在 >5%，建议 **两段式**：Sonnet 先跑，失败才上 Opus。但这会让 commander 层复杂化，Phase 0 不值得。

## 结论 & 建议

1. **Phase 0 commander 保持 Opus 4.7**。可靠性压成本。
2. **Phase 1 考虑两个方向**（择一不绑死）：
   - **Haiku 4.5 用于"快道"意图**（简单、低风险、无 skill 路由）；剩余上 Opus。需要 commander 先做 intent 分类——本身又是一次 LLM 调用，成本可能打平。
   - **Sonnet 做"第一次生成 + 若失败 fallback Opus"**。代码量小（在 AnthropicPlanner 里加一层 retry-with-different-model），但依赖更细的质量观测（`llm_calls` 表必须先打通）。
3. **真端到端验证必须等 Playwright-CRX**（W2 Day 4-5）。当前只对比 plan 形状，不是执行正确率。Day 5 可以回头跑 3 条 intent 端到端看哪种 plan 真的拿到数据；那时再更新本件。
4. **`llm_calls` 表**（W1 backlog b2）现在必须做——本件的观测都在日志里，重启后丢了。Phase 1 定价前必须有一份 7 天级别的 per-call 数据。

## 参考

- 实验数据原始文件：`/tmp/bakeoff-{opus,sonnet}-{0,1,2}.json`（不进 repo）
- Orchestrator 日志：`/tmp/orch-{opus,sonnet}.log`（不进 repo）
- `AnthropicPlanner` 的 `COMMANDER_MODEL` env + 每次调用的 `commander plan` 日志都是 W2 Day 3 引入的观测 infra
- W1 rehearsal 用 Opus 跑了 6 次全通（`docs/W1_REHEARSAL.md`）
- Claude API pricing (2026-04-15 cached in skill)：Opus 4.7 $5/$25 per 1M；Sonnet 4.6 $3/$15 per 1M
