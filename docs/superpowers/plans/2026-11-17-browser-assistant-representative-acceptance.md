# Goal3：双端代表任务验收计划

> **For agentic workers:** 使用 superpowers:executing-plans。用户已确认四阶段队列、当前聊天、单路自主执行；本计划把已确认 Goal3 落为有限测试批次，不增加审批、并行代理、发布或全量检查。

**Goal:** 用少量实际浏览器任务比较 Chrome 与云端交付，并准确记录模型、文件、权限和完成证据。

**Architecture:** 复用 SelectedChromeClient/runner、统一云端 runner、真实加载的候选插件、FileService 和现有原生/完整 App 脚手架。Goal1/2 已冻结的鉴权、进程重启及 SQL 所有权证据作为基线，不重新实现；新增验收明确标出替身边界。

**Tech Stack:** TypeScript、Node22.23.3、Playwright/Chromium、现有 Qwen messages adapter、Vitest、受所有权保护的隔离 MySQL。

**Spec:** `2026-11-17-browser-assistant-goal-sequence.md` 的 Goal3；基线 `4b6ea02281b82d6b013da7b518db97507b759b32`。

## Global Constraints

- 单路、无代理；重型检查串行；测试堆1536MB，定向类型2048MB。日志落盘，中文短摘要。
- 不修改业务库、生产开关、服务、额度或凭据；不新购或充值。不合并、部署或启动正式全量。
- 少量必要模型调用使用既有国际千问配置，仅传合成/公开材料。凭据只供测试子进程使用，不输出、不进源码或证据文件。记录 token/耗时；有计费回执则记录实际费用，估算必须带价格出处及估算标签，无法确认则明确待核对。
- 先跑一批再集中修；安全、泄露、越权、未确认提交、异常扣费、假完成等红线停止相应用例。结果未知先核对原操作，不重放。
- KMS/真实站点主体适配器及真实账号仍是 Goal2 已列待验项，不用公开匿名页面证明真实账号恢复。

## Review Focus

1. 两端工具协议不同，但交付必须有实际页面或文件证据，不能只比较模型的完成措辞。
2. 页面变更或人工介入后，旧元素/旧执行权失效；核对实际状态后再继续。
3. 原始文件、分析文件、上传授权及网站接收必须分别核对，不将上传误写为业务提交。
4. 公开站点登录墙、验证码、站点不可达必须如实等待/失败；缺日期控件按既有规则诚实部分交付。
5. 用户取消、结果未知或旧模型响应迟到，不覆盖终态、不重复导出/提交。复用 Goal1/2 证据时注明对应版本及未变模块。

## Task 1：固定输入及有限批次

**Files:** 本计划；后续 `docs/reports/2026-11-17-browser-assistant-goal3-acceptance.md`；外部 `goal3-inventory.json`。

**Interfaces:** 消费 Goal1/2 manifests、源码/插件版本、配置变量名与非敏感开关；产生批次用例和证据边界。

- [x] 核对当前工作树及 Goal2 冻结版本。生产 Node22.23.3 已核实，不重复读旧日志。
- [x] 本地进程和配置无模型凭据；通过既有 SSH 只读核对远端配置，已有 CN/INTL DashScope 凭据和 endpoint 变量。被读取配置 `QWEN_CORE_ROLLOUT_MODE=off`，启用列表不含 browser；不是生产运行进程快照，不推断当前在线行为。
- [ ] 冻结配置来源摘要和候选源文件；不保存凭据值。候选插件只对测试 origin 授权，正式交付包不带 QA 权限。

## Task 2：公开站点双端真实模型批次

**Files:** 新增 `apps/orchestrator/src/agent/browser-tools/representative-public.integration.test.ts`；必要的测试专用装配放 `apps/orchestrator/src/testing/browser-representative-candidate.ts`。既有生产执行器只在复现缺陷后修改。

**Interfaces:** 云端消费 `runUnifiedSupercarTask` +真实 `PlaywrightExecutor`；Chrome 消费 `runSelectedChromeTask` + `LocalChromeTaskSessions.start` +实际插件 WS。模型消费 `createQwenMessagesAdapter({environment,region:'intl',purpose:'vision'})`，包装仅记录请求计数/usage/耗时。非生产鉴权/模型运输替身必须在 evidence 标注。

| 用例 | 两端任务 | 实际核对 |
| --- | --- | --- |
| P1 表格筛选与分析 | 在 `https://the-internet.herokuapp.com/tables` 的第一个表格筛出 Due 不少于 51 的人，列姓名/金额、人数和合计；不登录或提交 | 运行时独立读取第一张表的实际 DOM 形成预期；比较答案字段、截图、原 URL、无外部写入。不要用预设答案充数。 |
| P2 表单准备 | 在 `https://httpbin.org/forms/post` 填 Customer name=Session QA，不提交，截图；缺日期控件如实说明 | 实际 inputValue、0 POST、截图文件、实际日期控件数量和诚实部分交付。 |

- [ ] 先完成路由/拦截离线体检；Goal2 的路由74/拦截24在未变路径可作为先验，新增意图作定向确认。
- [ ] 每端两条，各最多10次模型迭代/120秒；按次顺序执行，保留第一轮结果，不为通过而盲目重复。
- [ ] 记录原始 outcome、实际 DOM/字段、工具动作、模型 usage、耗时、用户配合及停测原因。状态完成而交付不实立即按红线处理，不继续计通过。

## Task 3：文件闭环及页面变化核对

**Files:** 复用 `src/trpc/routers/tasks.chrome-full-app-http.test.ts`、`src/files/testing/chrome-{upload,download}-candidate.ts`、`src/agent/browser-tools/unified-supercar-runner.test.ts` 的定向用例；如存在未覆盖差异，新增 `src/agent/browser-tools/representative-files.integration.test.ts`。

**Interfaces:** 实际 FileService、BrowserTaskFiles、任务归属、生成文件回执与网站接收字节。使用现有协议并注明模型/DB/鉴权是否替身。

- [ ] 每端选一条下载→读取/统计→交付或上传接收的多步闭环；核对原文件与分析结果 SHA/行数/合计、网站实际接收及历史重新读取。只验合成站点，不向第三方上传。
- [ ] 汇总页面变化/人工介入/取消/恢复的双端证据对照；已有实际执行证据未受改动影响时引用冻结版本，差异或缺口才增加定向原生场景。
- [ ] 权限/匿名/同账号恢复与未知等待的行为边界对照 Goal1/2，不能将一端能力推断为另一端已测。

## Task 4：集中修复、冻结与阶段交付

**Files:** 相关缺陷源文件与回归；Goal3 报告、manifest、精简 TAKEOVER/run-state。

- [ ] 先完成上述有限批次，分开记录交付失败、外部依赖、未执行和缺陷；不启动大矩阵。
- [ ] 对实际缺陷先观察 RED，再最小修复为 GREEN；只做必要相关回归、类型/静态及真实网站复核。无缺陷不扩写产品能力。
- [ ] 作者在单路约束下做独立于实现步骤的自审，记录局限；整批独立评审留给 Goal4 PR。
- [ ] 提交并冻结实际结果和待验事项，再完成 Goal3。之后进入 Goal4：候选/迁移状态/回滚/PR；不自动发布。
