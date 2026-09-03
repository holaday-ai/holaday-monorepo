# HOLA DAY 千问迁移能力矩阵

日期：2026-09-03
状态：国际区第二阶段离线验证中

## 核心结论

“改用千问”不是替换一个模型名称。HOLA DAY 当前模型调用至少包含普通文本、流式文本、强制自定义工具、浏览器视觉决策、Anthropic beta computer/web search、严格 JSON、图片理解、图片生成、视频生成和语音能力。必须逐类迁移、评测和灰度。

## 当前调用形态

| 场景 | 当前协议 | 千问目标 | 直接替换判断 | 发布前门禁 |
|---|---|---|---|---|
| 分类、摘要、报告、核验 | Anthropic Messages / OpenAI Responses | Qwen Flash / Plus | 需要统一 adapter，模型能力基础门禁已通过 | 结构化输出、中文约束、超时与错误映射 |
| Commander 任务规划 | Anthropic Messages + forced custom tool | Qwen Max + forced custom tool | 协议文档支持，必须真实验证工具块和 schema | `tool_use` 名称、参数 schema、拒绝危险步骤 |
| a11y 浏览器循环 | Anthropic Messages + custom tools | Qwen Max + custom tools | 可设计兼容 adapter，必须做多轮工具结果验证 | 连续 tool-use/tool-result、终止、恢复、延迟 |
| 视觉浏览器循环与 selector heal | 图片 + custom tool | Qwen3.8 Max | 文档支持图片与 function calling，组合能力需实测 | 截图理解、坐标/selector 精度、工具 schema |
| Supercar 主循环 | Anthropic beta Messages +内建 computer/web_search/code execution | Qwen + HOLA DAY 自有 custom tools | **不能直接换模型名**；千问兼容文档没有证明支持这些 Anthropic beta 内建工具 | 先把供应商内建工具隔离为自有协议，再逐项评测 |
| 普通流式生成、抓取总结 | Anthropic Messages streaming | Qwen Messages streaming | 文档支持，需验证 SSE/SDK 事件兼容 | 首 token、完整正文、取消、超时、token 统计 |
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

## 不能跳过的工程改造

- 建立 provider-neutral 的 Messages/Tools adapter，不让业务层依赖 Anthropic 特有类型。
- 把 Supercar 的供应商内建 computer/web search/code execution 与 HOLA DAY 自有浏览器动作分开；前者不能假设千问兼容。
- 每个用途有独立 feature flag、区域白名单、超时、错误率与 kill switch。
- 国际和中国大陆分别评测，绝不因模型名称相同而复用结论。
- 图片、视频和语音分别核算能力、成本与合规，不把“千问文本通过”写成“所有任务通过”。

## 当前发布判断

- 已满足：国际凭据与端点、区域路由、基础文本质量、代码、证据核验。
- 已满足：强制自定义工具调用与严格 JSON Schema 的国际真实协议门禁。
- 尚未验证：流式、多轮浏览器工具链、长上下文、视觉、多媒体生成、北京区域。
- 因此当前只允许继续离线评测，不允许生产切流或宣称已可替代全部现有模型。
