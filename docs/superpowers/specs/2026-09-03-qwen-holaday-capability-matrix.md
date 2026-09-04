# HOLA DAY 千问迁移能力矩阵

日期：2026-09-03
状态：provider-neutral adapter 与首个低风险调用点已暗发布；千问生产流量仍为零

## 核心结论

“改用千问”不是替换一个模型名称。HOLA DAY 当前模型调用至少包含普通文本、流式文本、强制自定义工具、浏览器视觉决策、Anthropic beta computer/web search、严格 JSON、图片理解、图片生成、视频生成和语音能力。必须逐类迁移、评测和灰度。

截至 2026-09-04，统一 Messages 适配器和任务完成后“下一步建议”调用点已经部署，但三项千问开关均为关闭、精确合成白名单数量为 0。代码可到达不等于生产已切流：当前真实用户仍沿用原供应商，千问只具备后续固定合成 canary 的受控入口。

2026-09-04 又在目标主机上以固定合成输入直接串联已部署的 `createQwenMessagesAdapter` 与 `generateSuggestions`，完成首个真实调用点探针：国际区 `qwen3.8-flash` 1/1 通过，1,376ms 返回 3 条互不重复且长度合规的建议，停止原因为 `end_turn`，用量字段完整（输入 302 / 输出 20 token）。探针只在一次性进程内构造启用态 adapter，没有修改进程、配置或数据库；探针前后生产总开关、shadow、建议 canary 均为 false，合成白名单数量为 0，真实用户流量仍为零。

## 当前调用形态

| 场景 | 当前协议 | 千问目标 | 直接替换判断 | 发布前门禁 |
|---|---|---|---|---|
| 分类、摘要、报告、核验 | Anthropic Messages / OpenAI Responses | Qwen Flash / Plus | 统一 Messages adapter 已部署；任务后续建议已接入但默认关闭 | 结构化输出、中文约束、真实超时与逐调用点灰度 |
| Commander 任务规划 | Anthropic Messages + forced custom tool | Qwen Max + forced custom tool | 协议文档支持，必须真实验证工具块和 schema | `tool_use` 名称、参数 schema、拒绝危险步骤 |
| a11y 浏览器循环 | Anthropic Messages + custom tools | Qwen Max + custom tools | 两轮合成工具回传已通过；真实浏览器循环仍需 adapter 和场景门禁 | 连续 tool-use/tool-result、终止、恢复、延迟 |
| 视觉浏览器循环与 selector heal | 图片 + custom tool | Qwen3.8 Max | 文档支持图片与 function calling，组合能力需实测 | 截图理解、坐标/selector 精度、工具 schema |
| Supercar 主循环 | Anthropic beta Messages +内建 computer/web_search/code execution | Qwen + HOLA DAY 自有 custom tools | **不能直接换模型名**；千问兼容文档没有证明支持这些 Anthropic beta 内建工具 | 先把供应商内建工具隔离为自有协议，再逐项评测 |
| 普通流式生成、抓取总结 | Anthropic Messages streaming | Qwen Messages streaming | SSE 事件链、首 token、完整正文、客户端主动取消和 token 统计已通过固定合成运行门禁；真实国际端点的 adapter 客户端超时归一已通过，真实任务链仍待验证 | 接入 adapter 后仍需在真实任务链验证背压、恢复和用户取消语义 |
| 图片结果核验 | Anthropic/Gemini 视觉理解 | Qwen3.8 Max/VL | 可作为候选，需合成图片集对照 | 成功/部分/失败四分类准确率 |
| 图片生成 | Gemini Image | Qwen-Image / 万相 | 独立媒体迁移，不属于文字模型替换 | 中文提示、主体一致性、编辑、成本、审核 |
| 视频生成与核验 | Veo、万相、第三方媒体模型 | 万相与必要的国际供应商 | 按能力拆分，不由 Qwen 文本模型统一承接 | 画质、时长、音画同步、人物一致性、成本 |
| 语音与声音克隆 | Qwen TTS/VC 等 | 保留千问语音链路 | 已是千问生态，仍需区域化凭据审计 | 同意、声音权利、区域与删除策略 |

## 第二阶段固定合成门禁

1. 强制自定义工具：模型必须返回指定 `tool_use`，参数严格符合最小计划 schema。
2. 严格结构化输出：使用 Model Studio `output_config.format=json_schema`，不得靠文本清洗凑格式。
3. 流式事件：验证 text delta、usage、完成事件与主动取消。
4. 多轮工具循环：把合成 `tool_result` 回传，验证模型继续或正确终止。
5. 长上下文：仅使用重复生成的合成材料，验证远距离事实提取与证据编号。
6. 多模态：仅使用代码库生成的合成图片，不上传用户截图或附件。

## 国际区真实运行时证据

2026-09-03 使用现有国际区凭据在目标主机内存中执行最终门禁，全部输入均由脚本确定性生成；未读取数据库、任务、附件、日志或用户自由文本，报告未包含响应正文、工具 ID 或合成记录。

| 门禁 | 模型 | 结果 | 首 token / 取消触发 | 完整响应 / 客户端取消耗时 | 输入 / 输出 token | 请求数 |
|---|---|---:|---:|---:|---:|---:|
| SSE 基础事件链 | qwen3.8-flash | 通过 | 586 ms | 598 ms | 13 / 2 | 1 |
| 首 token 后客户端主动取消 | qwen3.8-flash | 通过 | 580 ms | 583 ms | 未知 / 未知 | 1 |
| 两轮 `tool_use/tool_result` | qwen3.8-max | 通过 | — | 1,802 ms | 427 / 46 | 2 |
| 2,048 行合成长上下文提取 | qwen3.7-plus | 通过 | — | 2,856 ms | 49,209 / 40 | 1 |
| 合计 | — | 4 / 4 | — | — | 已知 49,649 / 88；取消行未知 | 5 |

主动取消的“通过”只证明客户端在首个文本增量之后、任何已观察到的终止事件之前同时触发 `AbortSignal` 与流 reader cancellation；它不声称供应商已停止计费。取消后的 token 结算无法从被中断的 SSE 得到，因此报告使用 `null` 并明确标记聚合 token 用量不完整。若首 token 与 `message_delta` / `message_stop` 同块到达，或标准 SSE 终止事件的 JSON 跨传输块截断，门禁会失败关闭，不能把已经完成的流误报为主动取消。

兼容差异：国际千问在返回有效 `tool_use` 内容块时，实测 `stop_reason` 为 `end_turn`。因此未来 provider adapter 必须以结构化工具块作为继续信号，并把 `tool_use` 与 `end_turn` 两种终止值规范化；不能只按 Anthropic 原生终止值分支。

## 真实国际端点客户端超时证据

2026-09-04 使用已部署 adapter 对国际区 `qwen3.8-flash` 执行三次固定合成超时探针，`timeoutMs=1`、`maxRetries=0`，无工具、无 mutation；只记录错误分类与聚合时延，不读取或保留响应正文、请求 ID、凭据或用户数据。

首轮 3/3 被误归类为 `PROVIDER_ERROR`。诊断确认固定版本 SDK 的真实 `APIConnectionTimeoutError` 实例虽然 `constructor.name=APIConnectionTimeoutError`，但继承的 `error.name=Error`；adapter 原有单元测试用手工覆写 `error.name`，未覆盖真实对象形态。PR #210 改用真实 SDK 错误对象做回归测试并按实际错误类型归一。部署后复验 3/3 返回 `REQUEST_TIMEOUT`，单次耗时范围 2–76ms、平均 27ms。该结论只证明“客户端在真实国际端点请求上触发超时后，adapter 能稳定归一错误”；不声称供应商服务端主动返回 408/504，也不证明中断后的计费结算。

## 不能跳过的工程改造

- provider-neutral Messages/Tools adapter 已建立；继续迁移时不得让新业务层重新依赖 Anthropic 特有类型。
- 每个调用点必须声明模型能力：短建议对已验证的 Qwen 3 max/plus/flash 系列下发 `thinking: disabled`，对 coder 与未知覆盖省略该参数，避免可选结果被推理预算吞掉或因不支持参数失败。
- 把 Supercar 的供应商内建 computer/web search/code execution 与 HOLA DAY 自有浏览器动作分开；前者不能假设千问兼容。
- 每个用途有独立 feature flag、区域白名单、超时、错误率与 kill switch。
- 国际和中国大陆分别评测，绝不因模型名称相同而复用结论。
- 图片、视频和语音分别核算能力、成本与合规，不把“千问文本通过”写成“所有任务通过”。

## 下一批调用点盘点（只定候选，不授权接入）

| 顺位 | 调用点 | 当前作用 | 风险判断 | 接入前必须补齐 |
|---|---|---|---|---|
| 已退出 | 自动响应润色层 | 曾把主模型长答案再交给第二个模型改写；用户已决定下线，不迁移到千问 | **已消除运行时风险**：旧校验只会拒绝新增 URL、数字及缺失的标记类型，不能阻止删掉原有 URL/数字或改写非数字事实，不能称为完整事实校验 | 删除实际润色实现；所有任务 lane 永久透传主模型答案，旧开关与密钥不能重新启用；历史数据库字段只为兼容旧记录保留 |
| 2（已暗发布） | `agent/supercar/plan-service.ts` | 在执行前生成用户可见步骤与预计耗时 | **受控中风险**：计划只影响用户预期，不驱动工具；模型原文不直接展示，必须通过结构与危险动作后验闸 | 已建立 2-6 步 JSON schema、工具标签/耗时范围、危险最终动作拒绝、确定性 UI 渲染、独立 plan canary、精确合成白名单和持久化区域硬门；生产合成国际区探针已通过，真实用户开关仍关闭；失败只回退为无计划，不跨区或跨 provider 回退 |
| 3 | `agent/url-resolver.ts` | 把口语站点名解析成 URL 并注入后续执行 | **高**：模型输出会改变导航目标；“官方网站”属于事实与安全边界，且当前会记录 token/URL | 必须改为检索证据优先、域名与重定向校验、可疑域名拒绝和日志隐私收口；不能把模型单答当权威 URL |
| 4 | `execution/llm-verifier.ts` 与 `response-layer/openai-verifier-fallback.ts` | 影响答案通过、修复或澄清判定 | **高**：属于质量与安全裁决面；基础 verifier 遇基础设施故障会非阻断通过，fallback 又可能将通过降级 | 先冻结“不因迁移放宽结论”的单调性契约，建立双模型离线对照、严重问题召回率和误拦率门槛；不得直接做在线用户灰度 |
| 5 | `agent/supercar/memory-service.ts` | 从完成任务提取长期记忆并写入数据库 | **最高隐私风险**：包含偏好、历史和可能的身份信息，并产生持久化 mutation | 在大陆/国际分区、明确同意、敏感字段排除、保留期、删除联动与审计完成前不迁移，也不做生产 shadow |
| 后续 | A 股解读、模板填充、视频脚本/质检、视觉与主循环 | 专业内容、文件或多模态生成与执行 | **高或专用**：涉及金融信任、报价、文件写入、视觉判断或工具循环 | 分场景独立规格和验收集；不能复用“普通文本已通过”的结论 |

产品决策：不迁移自动响应润色层。主模型直接产出结果，结构与可读性由主提示词、确定性前端模板和已有终态验证负责；若未来某个场景确需改稿，应作为用户主动触发、范围明确的独立能力重新设计，不能恢复成所有任务的自动二次调用。`plan-service.ts` 的独立合成 canary 已实现、发布并通过国际区固定合成探针，但生产开关默认关闭且白名单为空，不构成生产用户切流；再下一候选 `url-resolver.ts` 仍只有风险盘点，没有接入授权。

## 当前发布判断

- 已满足：国际凭据与端点、区域路由、基础文本质量、代码、证据核验。
- 已满足：强制自定义工具调用与严格 JSON Schema 的国际真实协议门禁。
- 已满足：SSE 事件链、首 token、客户端主动取消、两轮合成工具回传、2,048 行合成长上下文提取。
- 已满足：provider-neutral Messages adapter、停止原因兼容、错误脱敏，以及首个无工具、无 mutation、失败可吸收的“下一步建议”调用点暗发布。
- 已满足：首个调用点通过目标主机固定合成端到端探针；结果只记录计数、时延、停止原因和 token 聚合，不保留模型正文。
- 已满足：真实国际端点的客户端超时经已部署 adapter 3/3 稳定归一为 `REQUEST_TIMEOUT`；服务端主动 408/504 仍只属于静态兼容分支，不混写为已实测。
- 已决定：自动响应润色层直接下线而非迁移；主任务答案不再经过第二个模型改写。
- 已部署验证：任务计划改走 provider-neutral adapter；Qwen 需要总开关、独立 plan canary、精确合成白名单和持久化数据区域同时满足，模型原文还必须通过结构化 schema 与危险动作后验闸；国际区固定合成探针生成 3 步合规计划，危险动作计数 0。
- 生产现状：总开关、shadow、建议 canary、plan canary 均为 false，建议与 plan 合成白名单均为 0；没有生产用户千问流量，也没有跨区域回退。
- 尚未验证：真实浏览器工具循环及恢复、真实任务流背压/恢复/用户取消语义、视觉、多媒体生成、北京区域。
- 因此当前只允许继续固定合成评测与明确隔离的 synthetic canary；不允许生产用户切流、扩大白名单或宣称已可替代全部现有模型。
