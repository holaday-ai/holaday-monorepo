# HOLA DAY Qwen-only 模型运行架构设计

日期：2026-09-04

状态：待产品确认

范围：所有由大模型、视觉模型、图片模型、视频模型和语音模型驱动的 HOLA DAY 任务

## 1. 决策与目标

Anthropic（包括 Haiku、Sonnet、Opus）、OpenAI 和 Google Gemini 当前无法作为 HOLA DAY 的可运行模型供应商。现阶段所有模型任务统一迁移到阿里云 Model Studio 的千问与万相能力体系。

旧供应商代码保留为休眠实现，便于未来政策、账户和支付条件具备后重新评测；生产运行时不得选择这些实现，也不得在千问失败后自动回退到旧供应商。恢复旧供应商必须经过新的代码评审、能力评测和发布，不允许仅修改密钥或环境变量恢复。

本设计的目标是：

1. 保持 HOLA DAY 现有文本、研究、浏览器、代码、图片、视频和语音任务能力。
2. 按任务能力和风险选择不同千问模型，而不是让一个模型承担全部工作。
3. 中国大陆与国际用户严格使用各自的数据区域和凭据，不跨区域回退。
4. 模型故障不得绕过确定性安全、事实、证据、权限、支付和额度门禁。
5. 迁移完成前不宣称“所有任务已恢复”；每条任务链必须有独立证据。

## 2. 已确认的官方能力边界

阿里云 Model Studio 当前同时提供 Anthropic-compatible Messages、OpenAI-compatible Chat Completions、OpenAI-compatible Responses 和 DashScope 原生接口。Messages 接口支持 thinking 与 function calling；Responses 接口可提供 web search、web extractor 和 code interpreter。因此不能只改 SDK 的 base URL，必须按 HOLA DAY 实际使用的协议拆分适配器。

Qwen3.8 Max 支持文本、图片、视频输入、function calling、结构化输出和 web search；Qwen3.7 Plus、Qwen3.8 Flash 等模型也覆盖部分视觉、搜索和工具能力。图片生成与编辑可使用 Qwen-Image，品牌色、超高分辨率和多主体一致性可使用 Wan Image；视频使用 Wan；语音与声音克隆使用 Qwen Audio/TTS。

官方依据：

- [文本生成 API 与兼容协议](https://www.alibabacloud.com/help/en/model-studio/qwen-api-reference)
- [联网搜索与 Responses API](https://www.alibabacloud.com/help/en/model-studio/web-search)
- [Qwen3.8 Max 能力](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen3-8-max)
- [视觉理解与工具能力](https://www.alibabacloud.com/help/en/model-studio/vision-model)
- [图片生成与编辑](https://www.alibabacloud.com/help/en/model-studio/image-model)
- [视频生成与编辑](https://www.alibabacloud.com/help/en/model-studio/use-video-generation)
- [语音克隆与区域](https://www.alibabacloud.com/help/en/model-studio/voice-cloning-user-guide)
- [区域与访问域名](https://www.alibabacloud.com/help/en/model-studio/regions)

这些文档只证明供应商协议和模型能力存在，不证明 HOLA DAY 当前实现已经兼容。每项仍需真实合成验证。

## 3. 当前代码盘点

### 3.1 Anthropic 运行面

当前 Anthropic SDK 或 Anthropic 专有协议至少出现在以下链路：

- 启动与总路由：`src/index.ts`、`src/trpc/routers/tasks.ts`
- 普通生成与摘要：`agent/generate-runner.ts`、`agent/scrape-runner.ts`
- 规划与分类：`agent/planners/anthropic.ts`、`agent/intent-classifier.ts`
- 浏览器视觉循环：`agent/vision-loop/commander.ts`
- Supercar 主循环：`agent/supercar/agent-loop.ts`
- 浏览器接管：`agent/supercar/ota-user-browser-runner.ts`
- 语义核验：`execution/llm-verifier.ts`
- 图片主体、结果与视频质量核验：`agent/image/image-subject-verifier.ts`、`agent/visual-verifier.ts`、`agent/video/video-quality-verifier.ts`
- 长期记忆提取：`agent/supercar/memory-service.ts`
- 视频脚本等任务内专用调用：`trpc/routers/tasks.ts`

其中普通生成和抓取总结使用流式 Messages；Supercar 还依赖 Anthropic beta computer、web search 与 code execution，不能直接接到现有 provider-neutral Messages adapter。

### 3.2 OpenAI 运行面

- `response-layer/openai-verifier-fallback.ts`：第二意见核验器；当前生产开关为关闭。
- `video-editing/instruction-planner.ts` 与视频编辑路由：自然语言剪辑指令规划。

自动响应二次润色层已经下线，不再迁移。

### 3.3 Google 模型运行面

- `agent/image/gemini-image-client.ts` 与 `agent/image/model-router.ts`：图片生成和编辑。
- `agent/video/veo-client.ts`：视频生成。
- `agent/video/gemini-tts-client.ts`：语音合成。
- `agent/video/video-av-sync-verifier.ts`：音画核验。

Google OAuth 登录属于身份认证，不是 Gemini 模型调用，不在停用范围内，必须继续保留。

### 3.4 已有千问基础

代码已经具备：

- `ModelDataRegion = cn | intl` 的持久化区域所有权。
- 中国大陆与国际端点、凭据和 workspace 的严格路由。
- provider-neutral Messages adapter。
- `reasoning`、`standard`、`fast`、`coding`、`verify` 五类模型用途。
- 计划和下一步建议的独立 canary 及精确合成白名单。
- 国际区流式、工具回传、长上下文、超时归一和固定合成探针证据。

当前不足：

- 生产 Qwen 总开关、计划、建议、shadow 均为关闭。
- 生产未显式配置 verifier 模型值，依赖代码默认值。
- 用户和组织的 `model_data_region` 允许为空，尚无完整的一次性区域选择体验。
- Messages adapter 不覆盖 Responses 内建工具、流式生成、Supercar beta 工具和媒体 API。
- 多个业务接口仍直接暴露 Anthropic 类型。

## 4. 总体架构

### 4.1 生产供应商策略

新增统一的运行策略 `MODEL_RUNTIME_POLICY=qwen_only`。生产发布契约只接受 `qwen_only`；测试环境可显式使用 `legacy_fixture` 验证休眠代码，但不得访问真实旧供应商。

启动时建立 `ModelRuntimePolicy`，所有模型客户端必须通过它创建。业务层不得直接 `new Anthropic()`、`new OpenAI()` 或调用 Gemini 模型端点。旧代码移入明确的 dormant adapter 边界，并由静态发布测试确保没有生产调用路径。

即使旧供应商密钥仍存在于生产环境，也不能激活旧模型。后续在完成密钥清理计划前只报告“是否存在”，不得输出密钥值。

### 4.2 四类适配器

1. `MessagesGateway`
   - 普通非流式文本、结构化输出、图片输入和自定义 function calling。
   - 复用现有 provider-neutral Messages adapter，移除业务层 Anthropic 类型。

2. `ResponsesGateway`
   - 流式文本、联网搜索、网页提取和代码解释器。
   - 使用 Qwen OpenAI-compatible Responses API，但实现自有中立事件类型，业务层不得依赖 OpenAI SDK 类型。
   - 来源只接受搜索或提取工具返回的结构化 URL，不接受模型正文自报来源。

3. `BrowserAgentGateway`
   - 截图、a11y、坐标和 HOLA DAY 浏览器动作使用自定义工具协议。
   - 不复刻 Anthropic computer tool；Qwen 只提出动作，现有网络、权限、确认、验证码、支付和危险动作门禁继续由 HOLA DAY 执行。

4. `MediaGateway`
   - 图片：Qwen-Image 为默认，Wan Image 用于品牌色、高分辨率和主体一致性。
   - 视频：Wan 文生视频、图生视频、参考视频和视频编辑。
   - 语音：Qwen Audio/TTS 与 Qwen Voice Clone。
   - 报价、扣费、资源归属和用户确认仍由现有服务端逻辑决定，模型返回不能直接扣费。

### 4.3 能力路由

| 能力等级 | 默认模型 | 主要任务 | 允许的同区降级 |
|---|---|---|---|
| fast | `qwen3.8-flash` | 分类、短建议、低风险摘要 | 升级到 standard 或 reasoning |
| standard | `qwen3.7-plus` | 普通生成、报告、文档理解 | 只可升级到 reasoning |
| reasoning | `qwen3.8-max` | 复杂规划、专业研究、长任务 | 无 |
| coding | `qwen3-coder-plus` | 代码生成、修复和解释 | 默认无；通过专项基准后才可回退到 reasoning |
| verify_fast | `qwen3.8-flash` | 低风险语义核验 | 只可升级到 verify_strict |
| verify_strict | `qwen3.8-max` | 金融、事实、权限和高信任核验 | 无 |
| vision | `qwen3.8-max` | 浏览器视觉、图片和视频理解 | 无 |

“降级”只允许同一区域内向更强能力升级或使用经过同一验收集验证的等价快照。不得跨区域，不得从 Max 静默降为 Flash，不得从专用媒体模型降为文本模型。

模型 ID 均由环境配置，代码只声明用途和最低能力。任何模型 ID 变更都必须重新运行对应能力门禁。

## 5. 数据区域与用户体验

### 5.1 路由依据

- 个人任务：只使用用户持久化的 `users.model_data_region`。
- 团队任务：只使用组织持久化的 `organizations.model_data_region`。
- 不使用 IP、浏览器语言、手机号、时区或当前部署主机推断区域。
- 大陆区域使用北京端点和大陆凭据；国际区域使用新加坡端点和国际凭据。
- 某区域凭据缺失时返回固定的“该区域模型服务尚未配置”状态，不跨区、不调用旧供应商。

### 5.2 区域为空

现有区域字段允许为空，因此 Qwen-only 切换前必须补齐一次性区域选择：

- 用户第一次开始模型任务时选择“中国大陆”或“国际”。
- 选择前可浏览产品，但不能提交会发送内容给模型的任务。
- 团队空间由组织管理员选择，成员继承组织区域。
- 已产生模型数据后，区域切换不能作为普通设置即时完成；必须进入带数据迁移和删除确认的独立流程。
- 不批量猜测或静默回填现有账号。

## 6. 核验与安全单调性

确定性核验器始终先运行，继续负责数字、URL、来源、证据、结构、文件、权限和危险动作。Qwen 语义核验只处理相关性、完整性、结论是否得到材料支持等难以编码的质量问题。

合并规则必须满足：

1. 确定性 `fail` 不能被任何模型改为 `pass` 或 `warn`。
2. Qwen 只能维持或收紧结论：`pass → warn/reject`，不能反向升级。
3. 模型超时、结构错误或区域不可用时保留确定性结论，并把核验状态标为 `unavailable`，不得伪装成“模型已通过”。
4. 金融和高信任任务在严格核验不可用时显示警示；是否允许交付由该任务已有确定性门禁决定，不由模型故障改变。
5. OpenAI 第二意见运行开关永久关闭；待 Qwen 核验稳定后删除其生产接线，保留历史代码时也只能位于 dormant 边界。

核验输出只接受服务端 schema：`pass | warn | reject | unavailable`、固定问题代码、可修复性和不含用户原文的短说明。不得把模型原始响应写入日志、数据库或用户可见错误。

## 7. 搜索、工具和浏览器边界

### 7.1 联网研究

普通生成当前依赖 Anthropic web search。迁移后使用 `ResponsesGateway` 的 Qwen web search / web extractor，或 HOLA DAY 已有抓取工具。来源必须从工具事件提取并进入 EvidenceLedger；模型正文中的网址不能成为证据。

股票、新闻、天气等时效任务如果搜索工具不可用，必须明确标记数据不可用或需要稍后重试，不能用训练知识冒充最新内容。

### 7.2 Supercar

Supercar 不直接模拟 Anthropic beta 协议。迁移步骤为：

- 把 computer、web search、code execution 映射为 HOLA DAY 自有工具定义。
- 把工具调用和工具结果转换为中立消息块。
- 保留现有循环上限、额度、确认、接管、验证码、停止和恢复语义。
- 每次模型提出浏览器导航仍通过可信 URL 解析与网络策略。
- Qwen 无有效工具调用、重复动作或越过预算时失败关闭，不让模型以文本声称“已经执行”。

## 8. 休眠代码边界

以下内容可以保留但不能运行：

- Anthropic planner、commander 和旧 Messages 客户端。
- OpenAI verifier fallback 与视频剪辑 planner。
- Gemini 图片、Veo、Gemini TTS 和 Gemini 视频核验客户端。
- 对应模型 ID、兼容测试和历史数据映射。

以下内容不得被误停：

- Google OAuth 登录。
- Firecrawl、Apify、AkShare、DivineAPI 等非模型数据服务。
- 支付、订单、额度、提现、账户关闭和 Partner Ledger。
- 浏览器执行器、网络策略、确认门禁、EvidenceLedger 与确定性 verifier。

发布契约扫描生产入口，禁止在 dormant 目录外新增旧供应商 SDK 实例或模型 API 请求。新增的运行监控指标按 provider、region、purpose 和 outcome 聚合，不记录提示词、回复、附件、URL、用户 ID 或供应商原始错误。现有 `llm_calls` 计费归属表保持原有内部 user/task 外键，不在本项目修改其支付或额度语义；Qwen 写入只允许结构化 token、耗时、状态和经过白名单筛选的安全元数据，不得写入提示词、模型回复或供应商原始错误。

## 9. 工程拆分与顺序

本计划拆成四个独立子项目，每个子项目单独规格、实施计划、PR、暗发布和生产证据。不能把部分通过写成“全部迁移完成”。

### 子项目 A：核心文本与核验

优先级最高，完成后恢复大多数无浏览器、无媒体任务：

- 统一运行策略与区域选择。
- Messages 与 Responses 中立适配器。
- suggestions、plan、verifier、generate、scrape、template fill、A 股文本分析和视频剪辑指令规划。
- 流式输出、结构化输出、附件文本/图片输入、搜索来源和超时取消。
- OpenAI fallback 保持关闭；旧文本 provider 进入 dormant。

### 子项目 B：浏览器与工具循环

- Planner、VisionLoop、Supercar、a11y、视觉截图、接管和恢复。
- 自有 computer/search/extractor/code 工具协议。
- 持久化真实动作证据和安全策略。

### 子项目 C：图片、视频与语音

- Gemini Image → Qwen-Image / Wan Image。
- Veo → Wan Video。
- Gemini TTS → Qwen Audio/TTS。
- Gemini/Anthropic 媒体核验 → Qwen Vision。
- 保持报价、确认、扣费和版本回滚边界。

### 子项目 D：长期记忆

- 最后迁移 `memory-service.ts`。
- 在区域、明确同意、敏感字段排除、保留期、删除联动和审计完成前保持关闭。

## 10. 子项目 A 验收标准

### 10.1 固定合成金标准

建立人工确定预期结果的固定合成集，不依赖已经不可用的旧模型实时对照：

- 普通文本、翻译、摘要和长报告。
- 结构化 JSON 与 schema 拒绝。
- 工具调用和两轮工具回传。
- 流式首 token、完整响应、主动取消和超时。
- 最新信息必须检索与来源落账。
- 附件文本、表格、图片输入。
- 正确答案、遗漏、矛盾、伪造来源、提示注入和高信任错误。
- 中国大陆与国际区域相同语义的双区门禁。

核验器门槛：严重问题召回率不低于 95%，正确答案误拦率不高于 2%，任何确定性失败被升级为通过的次数为 0，结构化输出有效率不低于 99%。

### 10.2 运行门槛

- 所有旧模型网络请求计数为 0。
- 每个任务的 provider、region、purpose 与模型用途可审计，但无用户原文。
- 同区路由 100% 正确；跨区调用 0。
- 普通短调用 p95 不高于 5 秒；长报告与检索任务使用各自既有预算，不得因迁移扩大。
- Qwen 故障时任务进入可解释失败、等待或确定性降级，不停留在无限执行状态。
- 全量现有测试、类型检查、构建、发布契约和生产 P0 全部通过。

## 11. 发布策略

1. 子项目 A 先在隔离环境完成适配器、区域选择、lane 状态注册和静态旧供应商阻断；此时不改变生产流量。
2. 在国际与大陆端点分别运行固定合成探针；大陆探针前再向用户索取大陆专用 API 凭据，只报告存在性，不输出值。
3. 首次生产切换必须把子项目 A 与 `MODEL_RUNTIME_POLICY=qwen_only` 同批发布；从这一刻起，任何生产模型请求都不能进入旧供应商代码，旧供应商实际网络请求必须为 0。
4. 仅对唯一合成账号开放已迁移的子项目 A lane，验证真实任务生命周期、流式、来源、核验和持久化，再扩展到内部测试账号。
5. 尚未迁移的 B、C、D lane 统一返回可识别的 `unavailable_migration` 状态，并在界面说明“该能力正在迁移到千问”；不得尝试旧供应商、伪装成功或无限等待。当前这些旧供应商本就不可用，因此该状态用于把隐式失败变成可信的显式状态。
6. 子项目 B、C、D 各自重复隔离验证、合成 canary、内部 canary 和正式启用；每启用一条 lane，都继续验证旧供应商请求为 0。

任何阶段失败都只关闭对应 Qwen lane 或恢复到仍执行 `qwen_only` 的上一生产版本，不启用旧供应商，也不跨区域回退。若上一版本不具备 `qwen_only` 阻断，则不得作为回滚目标。

## 12. 非目标

- 不在本项目中删除旧供应商依赖包和历史数据库字段。
- 不修改 Google OAuth 登录。
- 不修改用户支付、订单、额度、提现、企业奖励、账户关闭或 Partner Ledger。
- 不触碰 DivineAPI Translator/OpenAI Key 配置。
- 不把 Qwen 文本门禁通过解释为浏览器或媒体任务已经迁移。
- 不在没有用户选择的情况下批量设置模型数据区域。

## 13. 完成定义

只有在四个子项目均通过各自生产证据后，才可以宣称“HOLA DAY 所有模型任务已迁移到千问家族”。在此之前，状态必须按能力分别标记为：未迁移、已实现待发布、合成 canary、内部 canary、已上线。

下一步仅为子项目 A 编写实施计划；子项目 B、C、D 不与 A 同批开发或发布。
