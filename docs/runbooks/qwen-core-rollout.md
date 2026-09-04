# Qwen-only 核心文本能力上线手册

## 目标与硬边界

本手册只发布核心文本子项目 A：任务建议、计划、文本生成、网页资料综合、视频编辑指令规划和语义核验。浏览器视觉、图片生成、视频生成及其他尚未迁移能力必须显示“正在迁移到千问”，不得回退到 Anthropic、OpenAI 或 Google。

- 生产 `MODEL_RUNTIME_POLICY` 必须为 `qwen_only`。
- 大陆账号只能调用大陆端点；国际账号只能调用新加坡国际端点；不得跨区回退。
- 日志、报告和终端输出只保留 provider、region、purpose、outcome 聚合数据，不输出密钥、用户输入或模型原文。
- 每次扩量前都必须满足：两个健康端点为 200/ok、旧 provider 请求为 0、跨区请求为 0、卡住任务为 0、核心探针失败为 0、短调用 p95 不高于 5 秒，以及核验器全部阈值通过。
- 回滚目标本身也必须执行 `qwen_only`。不满足时部署脚本在修改生产检出前终止。

## 阶段 0：本地门禁

串行执行：

```bash
pnpm --filter @holaday/orchestrator test:qwen-only-contract
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench test
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench build
pnpm test:ops
git diff --check
```

任一失败即停止，不创建发布版本。

## 阶段 1：国际合成协议探针

只从受控环境读取国际凭据，不在命令行传值：

```bash
pnpm --filter @holaday/orchestrator eval:qwen-intl:protocol
pnpm --filter @holaday/orchestrator eval:qwen-intl:runtime
```

两个报告均须为 completed，协议用例不可为 fail，运行时用例必须全部通过。报告不得含端点、凭据或模型输出。

## 阶段 2：大陆合成协议探针

仅在准备执行本阶段时配置大陆专用凭据和大陆端点。国际凭据不得作为大陆后备：

```bash
pnpm --filter @holaday/orchestrator eval:qwen-cn:protocol
pnpm --filter @holaday/orchestrator eval:qwen-cn:runtime
```

如大陆凭据尚未配置，结果必须是 `blocked/missing_credentials`；不得跳过后直接启用大陆账号。

## 阶段 3：精确合成账号 canary

生产环境设置：

```text
MODEL_RUNTIME_POLICY=qwen_only
QWEN_CORE_ROLLOUT_MODE=synthetic
QWEN_CORE_ENABLED_LANES=suggestions,plan,generate,scrape,video_edit_planner,verifier
QWEN_CORE_ALLOWLIST=<唯一合成测试账号标识>
```

只用该账号依次验证：短文本生成、计划、带来源的资料综合、核验拒绝、模型服务不可用。非白名单账号必须收到小范围验证提示，浏览器/图片/视频能力必须收到迁移提示。检查任务均进入 completed、failed 或 awaiting_user，不得长期停留 executing。

将只读聚合结果写入 JSON 文件后执行：

```bash
pnpm qwen-core:preflight -- --input /path/to/sanitized-qwen-preflight.json
```

输出必须为 `{"status":"pass","failures":[]}`，再继续下一阶段。

## 阶段 4：内部白名单

将 `QWEN_CORE_ROLLOUT_MODE` 改为 `internal`，`QWEN_CORE_ALLOWLIST` 仅包含已批准的内部账号。不得通过空值、通配符或前缀匹配扩量。至少跨越一个完整后台刷新周期后重新生成聚合报告并通过同一预检。

## 阶段 5：全量

只有前四阶段均有留存证据时，才把 `QWEN_CORE_ROLLOUT_MODE` 改为 `all`。保持相同 lane 列表。发布后再次验证：

```bash
curl -fsS https://holaday.ai/api/healthz
curl -fsS https://hd-app.orangebench.tech/api/healthz
```

随后重新运行国际和大陆运行时探针、精确合成账号核心任务以及聚合预检。任何门禁失败都不得继续扩量。

## 回滚

1. 先停止扩量，把 rollout mode 收回到上一个已验证阶段。
2. 仅选择仍含生产 `qwen_only` 强制校验的已验证提交作为 `ORCHESTRATOR_ROLLBACK_HEAD`。
3. 使用标准部署脚本执行回滚；脚本会在 reset 前检查回滚提交。
4. 回滚后重复两个健康检查、合成账号任务和聚合预检。

若不存在合格的 Qwen-only 回滚提交，停止发布并保留现状，不能回退到会重新调用旧模型的版本。
