# P2 专业工作流延迟优化设计

## 1. 背景与目标

抖音直播复盘、内容选题和电商日报三个专业工作流已经通过同版本 24/24 生产评测，但单任务耗时仍明显高于可接受的交互等待：抖音与电商代表样本约 95–124 秒，内容选题约 152–204 秒，连续追问会串行执行两次完整生成而进一步放大等待。

本轮目标是在不更换主生成模型、不弱化确定性质量门禁、不删除用户要求内容的前提下，去掉已经证实没有用户收益的固定延迟，并约束重复、冗长的生成结构。

## 2. 生产根因证据

2026-08-21 对 12 个合成生产样本进行只读阶段计时，得到以下结论：

1. 8/12 个样本在 OpenAI response layer 固定等待约 25 秒，最终以 `api_error` 回退到原文；另外 4 个因来源保护以 0 毫秒跳过。该层没有给样本带来可见输出收益。
2. 12/12 个样本的 Haiku 语义复核均落为 `llm.fallback` 非阻断通过，原因是返回结构不符合当前解析契约；每次额外消耗约 8–15 秒，实际质量决策仍只由确定性 verifier 完成。
3. 主生成是剩余最大耗时。抖音、电商输出约 3.3k–4.4k token；内容选题约 6.5k–8.5k token。内容工作流当前要求“5–7 个方向 × 每方向 3–5 个标题”，产生 15–35 个标题和大量重复解释。
4. 12 个样本均没有实际调用 `web_search`。因此本轮保留搜索能力，不把未证实的工具开销作为优化手段。

## 3. 已确认方案

采用“三层减法，不换模型”的方案：

1. **结构化报告原样保护**：带 `expertWorkflowId` 的报告不再调用 OpenAI 二次润色，直接保留通过确定性校验的 Markdown、来源标签、数字和 follow-up markers，并记录显式的零延迟跳过原因。
2. **类型化工作流只走确定性质量门禁**：当且仅当 registry 能解析出真实的 typed workflow contract，且确定性 verifier 已通过时，不再调用当前无有效判别能力的 Haiku verifier。普通 full-tier 任务继续保留原行为。
3. **工作流级输出预算**：在 `ExpertWorkflowContract` 上声明 `maxTokens` 与目标字符区间；runner 使用工作流预算替代全局 8192 token，并把字符预算写进 system prompt。内容选题按用户已提取的 `topic_count` 输出方向，每个方向只保留 2 个差异化标题，只展开 1 个 Top 选题大纲。

## 4. 契约设计

`ExpertWorkflowContract` 新增：

```ts
interface ExpertWorkflowGenerationBudget {
  maxTokens: number;
  targetChars: { min: number; max: number };
}

interface ExpertWorkflowContract {
  // existing fields...
  generationBudget: ExpertWorkflowGenerationBudget;
}
```

首期预算：

| 工作流 | `maxTokens` | 目标字符数 | 内容边界 |
| --- | ---: | ---: | --- |
| 抖音直播复盘 | 4096 | 1800–2800 | 只写 2–4 个关键问题、3–5 个优先动作和有界 checklist |
| 电商日报 | 4096 | 1800–2800 | 指标、异常、机会、动作去重，不复述同一数字 |
| 内容选题 | 5120 | 2600–3800 | `topic_count` 个方向、每方向 2 个标题、1 个 Top 大纲 |

字符区间是生成指令，不作为阻断式 verifier 规则；`maxTokens` 是 SDK 请求上限。这样可避免因轻微超长触发错误修复，同时对极端过量输出设置硬边界。

## 5. 质量与安全边界

- 主生成模型保持 `claude-sonnet-4-6`，不以更快的小模型换取质量。
- typed workflow 的 section presence、来源标注、数字一致性、必需字段、Markdown skeleton 与 follow-up marker 仍由现有确定性链路校验。
- 非 typed full-tier 任务仍可运行 Haiku verifier；本轮不做全局关闭。
- response layer 仍服务普通长回复；只对有 `expertWorkflowId` 的结构化报告跳过。
- 不删除 `web_search` 工具，不改变 freshness 任务、浏览器任务、轻量问答或普通生成任务行为。
- 不改变数据库、API 契约、鉴权、生产配置和用户数据保存边界。

## 6. 验收标准

### 功能与质量

1. 三个专业工作流的现有 intake、矛盾校验、必需 section、来源标注、follow-up footer 和 24 项评测判定保持通过。
2. 专业工作流的 response layer metadata 为零延迟结构保护，且 OpenAI client 未被调用。
3. 已注册 typed workflow 确定性通过后 Anthropic verifier client 未被调用；普通 full-tier 仍会调用。
4. runner 对三个工作流发送各自 `max_tokens`，普通生成仍为 8192。
5. 内容选题 prompt 使用实际 `topic_count`，不再固定生成 15–35 个标题。

### 性能

1. 专业工作流消除约 33–40 秒固定后处理等待。
2. 部署后以相同版本合成评测复测，代表性抖音、电商单任务目标不高于 70 秒，内容选题目标不高于 110 秒。
3. 若受上游模型波动影响未达到绝对值，至少要求同类样本中位数较本轮基线下降 30%，且质量分不下降。
4. 生产健康检查保持 200/`status: ok`，进程 restart count 不增加。

## 7. 非目标

- 不切换主生成模型，不做动态模型路由。
- 不并行执行同一用户连续追问，不改变任务顺序或幂等语义。
- 不重写整个 verifier，不扩大 OpenAI response layer 使用范围。
- 不修改股票、今日能量、规划任务或其他产品模块。
