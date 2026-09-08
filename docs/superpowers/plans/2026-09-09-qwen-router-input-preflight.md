# 核心任务真实入口输入门槛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline; reuse at most one read-only reviewer.

**Goal:** 首次和续接核心文本入口在既有扣减/状态接纳/生成前拒绝已知超限或不可读材料，并让预算内文本不再被旧解析器截尾。

**Status:** 本地前置分项完成，未发布。真实身份/接纳/终态接线与结果兼容仍待完成。

**Architecture:** 这是 C3b 真实 router 接线的第一个独立可审查前置分项。复用已有上下文预算；文件解析增加仅核心文本调用的完整模式，其他路径保持旧行为。tasks.create 在确定执行路径后、既有扣减前解析和校验；tasks.reply 在已确认核心等待路径中检查新旧文件及全量要求，校验失败保持 awaiting_user。此分项不接纳新执行轮次、不改数据库保存形状，也不宣称整体链路已完成。

**Tech Stack:** 现有 TypeScript / Zod / Vitest / 文件解析器，无新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-08-qwen-delivery-contract-design.md` 第3/4/7/10/11节；后续真实 admission→runner→review→P2/P3、结果兼容及前端门禁仍由关联计划负责。

## Global Constraints

- 既有隔离 worktree 与分支，基线59807677；不修改主工作区草稿、QA不提交。
- 主智能体串行，最多复用一个只读审查者；不安装依赖，不启动Docker/额外浏览器；Node堆≤2048MB、Vitest单worker、每批约20文件。
- memory_pressure空闲<40%或磁盘<10GiB不启动新重任务；08:30 JST后安全检查点暂停自动化。
- 用户上下文64KiB、材料合计64KiB、候选96KiB、语义请求256KiB UTF-8；15秒/0重试/768输出tokens不变。此分项只落实生成前已知输入预算。
- 不改支付/奖励/提现/Partner Ledger/额度扣减算法/账号注销/模型配置及凭据；不新增正文保留，不记录文件名/身份/原文/原始错误；其他执行路径不切换完整模式。
- 所有子项目与真实数据库、双通道、性能及生产门禁通过前禁止部分推送PR、合并或部署。

## Task 1: 真实首次与续接输入门槛

**Files:** `files/parsers.ts`、新 `agent/core-task-input.ts`、`trpc/routers/tasks.ts`；测试 `files/parsers.core.test.ts`、`trpc/routers/tasks.plan-mode.test.ts`。

**Interfaces:**

```ts
parseFileForPrompt(buffer, filename, mimetype, options?: { completeText?: boolean }): Promise<ParsedFile>;
assertCoreTaskInput(input: CoreAcceptedRequirements & {
  blocks: readonly Anthropic.Beta.BetaContentBlockParam[];
}): void;
```

完整模式：不得50K字符截断；原文本非空、解析失败或超过64KiB抛固定错误，不把错误文案当附件正文；包装后的完整块合计仍由上下文预算判断。图片保留既有block，不新增视觉调用；预算投影只记不可核验描述，不把base64写入核验上下文。预检使用固定36字符ID和最大安全revision预留序列化开销，不生成执行权；真正ID仍由后续原子接纳生成。

- [x] **RED：首次材料超限/中文多字节/多附件合计、预算内50K后尾部。** 实际调用tasksRouter.createCaller().create，文件存储与外部执行副作用替身；必须在业务BAD_REQUEST拒绝时断言没有扣减、insert、runner。预算内55000 ASCII尾部必须进入runner附件。测试外部边界替身不冒充V10整链路。
- [x] **RED：续接缺文件/解析错误/超限及长历史。** 真实reply从旧计划与非计划核心等待记录进入；断言未CAS、未runner，仍awaiting_user。保留的文件重新授权读取；缺少任一ID不忽略。原始文本、历史、固定workflow快照及referencePlan共同计预算，不只检查新消息。旧非计划记录未保存的历史或文件不能凭空恢复；本项仅重新验证实际可恢复的引用。
- [x] **GREEN：解析完整模式和真实router调用。** 首次解析移至路径确定后且在扣减之前。续接仅core等待路径启用严格错误处理，浏览器路径保留原行为；解析与预算失败均返回固定BAD_REQUEST提示，保留输入/等待状态。

```ts
expect(error).toMatchObject({ code: 'BAD_REQUEST' });
expect(quota.tryConsume).not.toHaveBeenCalled();
expect(insert).not.toHaveBeenCalled();
expect(resume).not.toHaveBeenCalled();
expect(run).not.toHaveBeenCalled();
expect(state.status).toBe('awaiting_user');
```

- [x] **回归和独立审查。** 受影响router、解析器、上下文/预算测试；tsc --noEmit、tsc -p tsconfig.build.json，精确Biome/diff。旧文件已有lint单独和基线核对，不大量格式化。复用只读审查者，修复Important后复验。
- [x] **本地提交与交接。** 精确代码/测试/计划文件提交，不包含QA，不推送。台账记录RED/GREEN、命令退出码、资源、未完成真实入口/新旧结果兼容/数据库/前端门槛。提交号由台账补记，不代表整个分支达到发布标准。

## 完成证据与未完成边界

- 原router基线35条通过；初次新增后17条行为失败/37条通过，修复后54条通过。超长文件ID再1条RED；边界正文及包装开销两条为直接GREEN回归。
- 独立审查发现不支持的二进制/损坏UTF-8、空工作表标题误算内容、首次owner快照到实际core等待之间的竞态，追加5条行为RED后修复。进一步NUL和伪装JSON的docx两条RED后修复；0/false单元格为直接GREEN回归。实际核心续接始终重新授权并完整解析当前文件集合，不复用早期可能截断的块。
- 最终20文件415测试通过，2026-09-09 07:52:27 JST启动，11.85秒、退出码0。router53条与完整解析12条；外部执行/存储替身不能冒充V10真实整链路。Qwen日志是测试传输，不是实际模型调用。
- 最终tsc --noEmit、tsc -p tsconfig.build.json退出0；3文件完整Biome通过，router测试无lint诊断，tasks.ts的33条诊断全部按diff位置及59807677原行同文核对为基线已有，不宣称全仓lint通过。新增两处非空断言已移除；显式parkRow守卫解决TS18048，最终全部重跑。独立最终复审无Critical/Important/必修Minor。
- Node堆≤2GB、单worker、重任务串行；最终门禁前54%内存空闲、152GiB磁盘。未安装依赖/启动Docker或新浏览器，未读取凭据或私人数据、未修改敏感业务或生产。
- 仅入口输入前置完成；尚未把真实router接新执行身份/接纳许可/P2/P3，尚未实现coreRequirements与旧结果的兼容读取及前端轮次排序。真实MySQL、双通道实际router、真实模型性能与生产门禁仍待完成；不推送部分PR或部署。
