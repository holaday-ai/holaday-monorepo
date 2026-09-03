# HOLA DAY Qwen International Synthetic Benchmark Plan

**Goal:** 使用生产进程中已有的新加坡 Key，对固定合成样本执行低成本、无个人数据、无生产接线的首轮千问能力门禁。

## Safety contract

- 只从目标进程 `/proc/<pid>/environ` 在内存中读取 Key，不复制、不打印、不写文件。
- 只允许新加坡公共或 workspace 专用 Anthropic-compatible endpoint。
- 输入全部为代码库内固定合成内容；不读取数据库、任务、附件、日志或用户数据。
- 输出只包含用例 id、通过状态、延迟、token 数、总通过率和结论；不输出模型原文或 HTTP body。
- 串行调用、单次无自动重试；不接入 Orchestrator、不开功能开关、不改变生产回答。

## Tasks

- [x] TDD 建立固定用例、确定性评分、安全报告和端点/凭据失败关闭。
- [x] 增加可通过 stdin 在服务器内执行的 Node CLI，不写远程文件。
- [x] 跑本地测试、类型/格式检查与安全扫描。
- [x] 先运行一条最小连通性用例，再串行运行完整首轮基准。
- [x] 根据文字规划、中文摘要、分类、代码、核验、工具选择六类结果给出迁移结论。

## 2026-09-03 safe result

- 首次连通性调用鉴权成功，但 `qwen3.8-max` 的默认思考耗尽 300 个输出 token，未留下正文；按官方 Anthropic-compatible 参数显式关闭思考后复测通过。
- 修正后烟测：1/1 通过，87 input tokens、56 output tokens，12,709 ms。
- 完整门禁：5/6 通过（83.33%），445 input tokens、215 output tokens；规划、分类、代码、证据核验和工具选择通过。
- 中文事实摘要返回正文但未完全满足确定性评分条件，记为 `criteria_not_met`；需要在更大离线样本中继续检验约束稳定性。
- 本轮共执行 8 次外部合成调用（包含首次失败烟测），累计 655 input tokens、571 output tokens；未发送用户、数据库、附件或日志数据。
- 结论：国际千问达到“进入扩大离线评测”的基础门禁，不等同于已证明可替换 Holaday 全部生产任务；生产调用链与开关保持不变。
