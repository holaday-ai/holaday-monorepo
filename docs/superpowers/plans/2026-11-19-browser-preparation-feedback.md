# Browser Preparation Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, inline and serial. 沿用用户已指定的当前工作树、原 Goal 与执行方法，不派代理。

**Goal:** 已确认的页面加载产生明确回执及持续进度，创建结果未知持续可见；保留真正未知的执行保护。

**Architecture:** 继续原 Chrome 准备、TaskTabJournal、tRPC 与 BrowserLaunchJournal。新增协商的 loading 回执和共用客户端核对 helper，保持全局保护代码与已有权限边界。

**Tech Stack:** 现有 TypeScript、Zod、React、Vitest、Node22.23.3、真实 Chrome 项目脚手架，不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-19-browser-preparation-feedback-design.md`；原完整 release-readiness Spec 继续约束范围。

## Global Constraints

- 单路、无代理；测试heap1536MB、类型/构建2048MB，单fork、文件串行、并发1，UV/GOMAX2；日志存文件。
- 不上线、不合并PR361、不生产写入、不新增权限/资源/收费探测；已批准的完整验收及预算守卫不变。
- 不改全局未知判定、清空票据或关闭执行保护来过关；未知输入和旧原件不重放。
- 核对最多3次、间隔1000ms，只对可靠loading回执；创建任务在ready后一次发生。
- 不新增浏览器/客户端执行系统，不复制浏览器资料，不把准备状态当成SQL任务已创建。

## Review Focus

1. pending回执绑定错误准备编号、来源、连接、账号或浏览器会话时不得继续创建任务。
2. Chrome创建/导航/私有存储回执未知时不得冒认已创建且加载中的页面。
3. 页面加载期间账号切换、选择变化或组件销毁时，不向新上下文交付旧结果。
4. 旧服务端、旧插件、旧私有记录保持原约束；新UI能力字段不进入严格权威selection。
5. 真正未知错误仍阻止写入；创建前提示和创建后结果不能混淆，短暂toast消失后错误仍可见。

### Task 1: 固定排查证据

**Files:** `apps/orchestrator/src/ws/server-drain.test.ts`、`apps/orchestrator/src/execution/http-drain.test.ts`。
**Interfaces:** 真实WS/JWT与真实HTTP/tRPC，原ExecutionDrain；不调用模型/真实站点。

- [x] 增加并运行旧token拒绝→有效token的真实验证，确认unknown=0。
- [x] 增加并运行泛化准备错误→后续ready→写入被拒绝，确认原未知保留、业务写入未调用。
- [x] 两文件相关回归、严格类型/静态通过；WS33项、HTTP27项分别记录，诊断不等于完整站点通过。

### Task 2: 共享回执与客户端核对

**Files:** 新建 `packages/shared-types/src/browser-task-preparation.ts` 及对应测试；修改 `packages/shared-types/src/index.ts`、`ws.ts`、`browser-launch-journal.ts`。
**Interfaces:** 导出 `taskTabLoadingReceiptSchema`、`BrowserTaskPreparationReply`、`BrowserTaskPreparationPendingError`、`pollBrowserTaskPreparation({source,preparationId,prepare,current,onLoading?,wait?}): Promise<BrowserLaunchTarget>`。`BrowserLaunchTarget`增加可选UI能力 `preparationReadiness?: boolean`；`resolveBrowserLaunchTarget`从当前同一连接恢复此能力；权威selection不携带它。

`prepare(target, preparationId)`只接收固定的原来源快照和原编号，返回unknown供helper校验。loading原始字段为taskTabStatus=loading、taskTabCreated=true、preparationId、sourceTabId、sourceOrigin、tabId及可选launchBrowserSessionId；主机输出用preparationState=loading替换taskTabStatus并加入extensionClientId。unsupported只有preparationState=unsupported，不是页面句柄。ready输出由既有BrowserLaunchTarget字段构成，去掉UI能力。

- [ ] RED：最多3次、间隔1000、原编号不变；ready后返回句柄；未知拒绝不重试；错绑定/切账号不返回；超过上限抛明确pending错误。
- [ ] 最小实现Zod契约、固定核对上限和会话校验，输出剥离UI字段的ready target。
- [ ] shared-types相关回归/严格类型通过并提交。

### Task 3: 插件确认加载状态

**Files:** `apps/extension/src/background/selected-tab-read.ts`、`task-tab-journal.ts`、`extension-tools.ts` 及各自测试；`apps/extension/e2e/user-browser-v2.e2e.mjs`。
**Interfaces:** `prepareIndependentTaskTab`增加尾部可选 `reportReadiness`；新能力 `task_tab_readiness_v1`。`TaskTabJournal.prepare`增加可选readiness，loading内部值可用type guard识别；私有记录增加仅已确认导航才置真的 `navigationAcknowledged`。对外回执按Task2 schema序列化，绝不输出raw URL。

- [ ] RED：已知created页超时返回loading；旧请求保留旧错误；缺创建/导航/存储回执、错owner/origin拒绝；持久化重入仍只观察或继续原唯一导航。
- [ ] 最小实现ack与协商；保留未知创建记录、nonce、唯一marker及原八秒等待。
- [ ] 原插件/Journal/协议回归和真实Chrome慢页回归通过，提交。

### Task 4: 主机验证与客户端接线

**Files:** `apps/orchestrator/src/trpc/routers/local-chrome-selection.ts`及其测试；`apps/web-workbench/src/stores/task-store.ts`、`lib/browser-launch-journal.ts`；`apps/extension/src/sidepanel/task-launch.ts`、`durable-launch.ts`及各自测试。
**Interfaces:** 发现结果携带 `preparationReadiness`；准备input可选 `reportReadiness`。仅原握手支持能力且严格绑定的原始loading回执产生HTTP成功的 `preparationState: loading`。协商失效返回不创建页面的unsupported状态；不请求新契约时保留旧ready形状。两个客户端使用Task2 helper，并剥离UI能力字段后发送selection。

- [ ] RED：可靠loading的真实HTTP回归unknown保持0；旧泛化错误仍unknown、仍拒绝业务写入；所有错绑定、旧版本/旧客户端边界。
- [ ] RED：两个客户端loading只核对原编号，ready后create一次；helper拒绝时create零次；持久化恢复不改幂等编号。
- [ ] 实现协商、主机验证、两个客户端及后台恢复接线；原共享journal与客户端回归通过，提交。

### Task 5: 持续反馈与完整验收

**Files:** `apps/web-workbench/src/components/InputArea.tsx`及其测试；`stores/task-store.ts`及创建相关测试；必要的 `apps/extension/src/sidepanel/App.tsx`反馈；既有项目验收入口与报告。
**Interfaces:** 工作台提交中使用当前准备进度；加载超上限保留输入/原准备记录；真正创建未知的乐观行命名“任务创建待核实”。错误用持续role=alert显示，改变输入或成功提交后清理；未知创建不自动重发。

- [ ] RED：toast过期后错误仍显示、输入保留；准备阶段不假称已收到任务；未知行停止虚假创建文案；loading时有明确进度。
- [ ] 实现以上反馈，保留既有布局、输入/焦点及账号边界。
- [ ] 相关单元/严格类型/静态、必要组件构建及真实Chrome/HTTP结合验证；不把合成通过当真实站点验收。
- [ ] 刷新必要候选、正常推送草稿PR；私有更新准确交接，再按原完整Fresh100与其余Goal推进，不上线。
