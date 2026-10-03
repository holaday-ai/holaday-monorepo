# 生产 env 变更清单（capability-recovery）

只列变量名，不写值。**部署前按本清单核对；本分支没有改动任何生产 env。**

## 一、需要删除（或确认不再设置为"关"）的 kill-switch
本分支起，下面这些默认就是开启的；env 只能用来**关**。生产 `.env` 里如果还留着旧的"关"值，会让对应能力继续处于关闭状态。

| 变量 | 新默认 | 处理建议 |
|---|---|---|
| `QWEN_CORE_ROLLOUT_MODE` | `all` | 删除；或确认不是 `off` / `synthetic` / `internal` |
| `QWEN_CORE_ENABLED_LANES` | 空 = 全部通道 | 删除；如需保留，必须包含全部通道 |
| `QWEN_CORE_ALLOWLIST` | 空 | rollout 为 `all` 时不再使用，可删除 |
| `QWEN_MESSAGES_ADAPTER_ENABLED` | `true` | 删除；或确认不是 `false` |
| `QWEN_RESPONSES_ADAPTER_ENABLED` | `true` | 删除；或确认不是 `false` |
| `EVIDENCE_LEDGER_ENABLED` | 开（只有 `false` 才关） | 删除；或确认不是 `false` |
| `EXECUTION_CONTRACT_ENABLED` | 开 | 同上 |
| `EXECUTION_VERIFIER_ENABLED` | 开 | 同上 |
| `MODEL_RUNTIME_POLICY` | 不再阻断启动 | 可保留 `qwen_only`，不再起作用；由后台"模型管理"决定 |
| `ASTROLOGY_ENABLED`（若存在） | 按占星线决定 | 本分支未改；如要上线占星，由 codex 线确认 |
| `QWEN_SUGGESTIONS_CANARY_ENABLED` / `QWEN_PLAN_CANARY_ENABLED` 及其 allowlist | 不变 | 仅旧 canary 路径使用，core 路径已不依赖 |

## 二、新增或需要确认存在的 key（只核对"是否设置"）
| 变量 | 用途 | 是否必需 |
|---|---|---|
| `DASHSCOPE_CN_API_KEY` / `DASHSCOPE_CN_WORKSPACE_ID` | 千问（北京） | 中国区必需 |
| `DASHSCOPE_INTL_API_KEY` / `DASHSCOPE_INTL_WORKSPACE_ID`（或 `DASHSCOPE_API_KEY`） | 千问（新加坡） | 国际区必需 |
| `QWEN_*_MODEL` | 各用途的千问模型名（目录未覆盖的用途使用） | 确认账号里可用 |
| `FIRECRAWL_API_KEY` | scrape 通道、可选的联网搜索 | 推荐 |
| `FAL_KEY` | fal（IP 换口型、Nano Banana、可选 Veo） | 视频和图片批次需要 |
| DashScope 图像和视频模型 ID（批次 05 报告列出的变量名） | Qwen Image / Wan 图像和视频 | 视频和图片批次需要 |
| `ANTHROPIC_API_KEY` | Claude 大脑（后台默认隐藏） | 可留空 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | GPT 大脑（后台默认隐藏） | 可留空 |
| `GEMINI_API_KEY` | 旧图像客户端（保留未删） | 可留空 |

## 三、数据库
迁移需在重启前执行：0061（model_catalog / model_catalog_events / task_model_selections）、0062（批次 06）、0063（quota_refunds）。`db:verify` 已把这些表列为必需。
