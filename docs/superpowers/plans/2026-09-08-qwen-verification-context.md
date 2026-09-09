# 千问完整核验上下文 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 核心文本生成和核验使用同一完整用户上下文及授权材料，超限明确降级，不再静默截断。

**Architecture:** 先建立纯数据、不可变、运行时校验的本轮上下文和UTF-8预算边界；再接入语义请求；最后接入首次生成和计划续接。taskId不代替executionId，生产接纳事务的revision推进属于下一子项目，未组合完成前不发布。

**Tech Stack:** TypeScript、Zod、Vitest、现有中立Qwen Responses/Messages适配器、tRPC。

**Spec:** `docs/superpowers/specs/2026-09-08-qwen-delivery-contract-design.md`，用户已在本轮回复“继续”确认。

## Global Constraints

- 用户上下文与规范序列化内容不超过64 KiB UTF-8；所有可核验材料正文合计不超过64 KiB UTF-8；最终候选正文不超过96 KiB UTF-8；完整语义请求序列化后不超过256 KiB UTF-8，包含JSON转义与协议结构。
- 语义15秒超时、零自动重试、768输出token上限；不改变既有semantic unavailable/warn政策，覆盖不完整不能冒充服务不可用。
- 不变更套餐/积分/额度扣减规则、支付奖励提现、账户注销、Partner Ledger、旧供应商凭据、DivineAPI。模型不跨区域回退。
- 主智能体串行，最多一名只读审查者；不安装依赖，不启动Docker或新浏览器进程；Node堆不超过2GB，Vitest单worker、无文件并行。
- memory_pressure空闲低于40%或磁盘可用少于10GiB，不启动重任务。既有未提交QA及主工作区草稿不提交。
- 全部三个子项目及组合验收完成前不发布，不重跑任何旧生产灰度包。

## 文件边界与接口

- 新建 `apps/orchestrator/src/execution/task-verification-context.ts`：严格schema、纯快照、正文/材料覆盖；不导入数据库、日志或提供者。
- 新建 `apps/orchestrator/src/execution/verification-input-budget.ts`：固定字节预算、固定失败码、纯检查函数。
- 修改 `llm-verifier.ts`：完整上下文与候选正文构成请求，覆盖失败独立于语义unavailable。
- 修改 `execution-pipeline.ts` / `generate-outcome-review.ts`：显式传递上下文，覆盖失败只能降级。
- 修改 `generate-runner.ts` / `trpc/routers/tasks.ts`：同一快照供两层消费，接纳前预算校验；不把解析辅助字段伪装成用户原文。

工作目录均为既有隔离worktree。以下测试命令在 `apps/orchestrator` 执行，检查资源后运行：

```bash
NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/execution/task-verification-context.test.ts src/execution/verification-input-budget.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism
```

## Task 1: 可独立检验的上下文与预算（完成）

证据：无实现导出时先出现模块加载失败（不计行为RED）；最小导出边界后23条行为反例失败，再实现至25通过；空材料追加反例1失败后修复，总计26通过。Orchestrator tsc --noEmit通过，四文件Biome/diff通过；独立审查无Critical/Important。分项预算不等于总请求预算，Task2/3仍必须执行实际序列化检查。

**Files:** 新建上述两个模块及同目录 `.test.ts`。

**Interfaces:**

```ts
type VerificationInputIssue =
  | 'VERIFICATION_CONTEXT_INVALID'
  | 'VERIFICATION_INPUT_LIMIT'
  | 'VERIFICATION_MATERIALS_INCOMPLETE';
type VerificationBudgetResult =
  | { ok: true }
  | { ok: false; code: 'VERIFICATION_INPUT_LIMIT' };
// 全部返回固定码，不携带原文、身份或异常详情。
checkVerificationAdmission(contextJson: string, materialTexts: readonly string[]): VerificationBudgetResult;
checkVerificationCandidate(answerText: string, serializedRequest: string): VerificationBudgetResult;
createTaskVerificationContext(input: unknown): TaskVerificationContext;
renderVerificationUserIntent(context: TaskVerificationContext): string;
assessVerificationMaterials(context: TaskVerificationContext):
  { complete: boolean; codes: readonly VerificationInputIssue[] };
```

`TaskVerificationContext` 为深只读字段：schemaVersion=1、executionId（非空）、executionRevision（正安全整数）、initialRequest、按顺序的userTurns、phase（direct/draft/revise/approved_execution）、workflow（null或id+sections快照）、referencePlan（string或null）、materials。section含id/title/required/sourceAnnotation/guidance可选；material为text（key、source=file/provider、text）或unavailable（key、source、reason=non_text/source_body_unavailable）。不接收base64/source.data等额外字段。

- [x] **RED：完整历史和快照隔离。** 创建测试fixture时只使用合成字符串：

```ts
const input = {
  schemaVersion: 1, executionId: 'exec_synthetic', executionRevision: 1,
  initialRequest: '原始要求'.repeat(180), userTurns: ['仅更改结论', '确认执行'],
  phase: 'approved_execution', workflow: null, referencePlan: '不可信参考',
  materials: [{ kind: 'text', key: 'file:0:0', source: 'file', text: '合成材料全文' }],
};
const context = createTaskVerificationContext(input);
input.userTurns[0] = '后续变化';
input.materials[0].text = '后续材料';
expect(context.userTurns[0]).toBe('仅更改结论');
expect(context.materials[0]).toMatchObject({ text: '合成材料全文' });
expect(renderVerificationUserIntent(context)).toContain('确认执行');
expect(Object.isFrozen(context.userTurns)).toBe(true);
```

- [x] **RED：预算与安全。** 测试64KiB上下文/材料、96KiB正文、256KiB请求的等于边界和多1字节；汉字/emoji UTF-8、多材料合计、JSON转义、unknown schema、非法revision、未知字段、图片不可核验、附件“批准”不能修改phase。运行前述命令，确认失败由于待实现边界，而非运行环境。
- [x] **GREEN：实现纯边界。** 使用已有Zod strict schema解析并深复制；解析失败仅抛固定 `VerificationContextError`；逐个投影已允许字段，冻结所有嵌套对象/数组，不冻结输入对象。上下文预算使用去除正文后的材料metadata及其他完整字段序列化，材料预算单独累加正文。JSON.escape实际开销最后由完整请求预算捕获。

```ts
export const VERIFICATION_INPUT_LIMITS = Object.freeze({
  contextBytes: 64 * 1024, materialsBytes: 64 * 1024,
  answerBytes: 96 * 1024, requestBytes: 256 * 1024,
});
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
// checkVerificationAdmission：任一项>上限时返回固定VERIFICATION_INPUT_LIMIT。
// checkVerificationCandidate：正文和完整序列化请求分别检查，绝不slice。
```

- [x] **验证与提交。** 同命令GREEN，再运行 `NODE_OPTIONS=--max-old-space-size=2048 pnpm exec tsc --noEmit`（串行）；精确四文件Biome及diff检查；独立审查。只提交这四文件和计划/规格状态，提交信息 `feat: add bounded immutable verification context`。

## Task 2: 语义请求不再截断且覆盖失败不放行（完成）

证据：完整正文/上下文、预算/材料不足、修复后候选、末端覆盖保持、失败级别单调性、非法上下文和真实 wire 模型字段均先行为 RED 再 GREEN。最终七文件139测试通过（21.61秒）；Orchestrator tsc --noEmit通过。五个精确文件Biome通过，三个既有大文件57条lint诊断全部位于基线已有且本次未改动的代码行（18/2/37），不宣称全仓lint通过。最终只读复审无Critical/Important；实际入口接线仍属Task3，非发布结论。

**Files:** 修改 `execution/llm-verifier.ts`、`llm-verifier.test.ts`、`execution-pipeline.ts`、`execution-pipeline.test.ts`、`answer-verifier.ts`；必要的精确Messages协议序列化边界位于 `llm/messages-adapter.ts` / `llm/qwen-messages-transport.ts`，不改变路由/凭据。

**Interfaces:** `LlmVerifierInputs.verificationContext?: TaskVerificationContext`；语义结果新增可选 `inputCoverage: { complete: boolean; codes: VerificationInputIssue[] }`，`VerificationResult`保留相同coverage字段。旧非核心调用可保持legacy输入，核心有context时必须用完整上下文，不走摘要fallback。末端`FinalizeAnswerForPersistenceInputs`接收同一`verificationContext`及安全`semanticMetadata`，重新检查最终正文和真实模型wire预算；缺失模型字段不得认证完整覆盖，不读取凭据、不重复调用模型。

- [x] **RED：实际请求尾部反例。** 在现有makeAdapter fixture中捕获真实Messages request：

```ts
const head = '相同正文'.repeat(600);
await verifyWithLlm({ ...fixture, adapter, verificationContext: context, answerText: head + '尾部甲' });
await verifyWithLlm({ ...fixture, adapter, verificationContext: context, answerText: head + '尾部乙' });
const first = JSON.stringify(create.mock.calls[0][0]);
const second = JSON.stringify(create.mock.calls[1][0]);
expect(first).not.toEqual(second);
expect(first).toContain('尾部甲');
expect(first).toContain(context.initialRequest);
expect(first).toContain('合成材料全文');
```

- [x] **RED：边界及降级。** 超限或coverage不足时provider未调用，结果具有固定inputCoverage原因；merge到确定性pass不得completed；确定性hard_fail保持failed；adapter缺失但输入超限仍归为覆盖失败；15s/0retry/768保持原测试；fixed semantic code不再变unknown。
- [x] **GREEN：构造请求一次后检验完整预算。** `buildUserPayload`有context时序列化完整快照+原candidate，无slice；将system与Messages wire envelope（含model/max_tokens等真实字段）一起计入预算。复用实际适配器请求转换函数而非估算常数，不读取key。预算检查在provider调用和其catch之前，避免失败被吞为unavailable。coverage issue merge使用固定deterministic check、failureLevel fixable；deterministic已有失败不能被覆盖。

```ts
if (!coverage.complete) {
  return { ...deterministic, passed: false,
    failureLevel: deterministic.failureLevel ?? 'fixable',
    inputCoverage: coverage,
    checks: [...deterministic.checks, {
      criterionId: 'verification.input_coverage', criterionType: coverage.codes[0],
      passed: false, checker: 'deterministic', severity: 'fixable',
      detail: '核验输入不完整，请缩小材料或拆分任务。',
    }],
  };
}
```

- [x] **验证。** 单worker运行上下文/预算/llm-verifier/pipeline/generate-outcome-review/messages-adapter/qwen-messages-transport七文件139测试，类型检查、精确lint/diff检查和审查，记录既有lint限制；本分项本地提交 `fix: verify complete bounded delivery payloads`，提交编号见本地进度。不在此阶段发布。

## Task 3: 生成与核验接入同一授权快照

### C2 本地检查点（2026-09-09，Task3/C 整体仍未完成）

- 已把真实 `runGenerateTask` 接入可选的服务端 `verificationContext`：完整时序、材料、phase、referencePlan 和固定 workflow 从严格不可变快照读取，拒绝另附 raw attachments；仅旧非核心入口沿用旧参数。文本材料不再有第二个未预算通道，不可读材料仅发送不可读描述，不透传图片 base64。core 有材料或固定规范时不走忽略材料的简单问答捷径。
- `reviewGenerateOutcome` 的 `coreExecution` 明确携带本轮 handle/registry；已完成候选的证据、真实确定性/语义核验均走独立 registry，不写同 taskId 的 legacy ledger；缺少 generation 或 taskId/handle 不符固定拒绝。实际 router 必须显式接入此参数，不能因它是兼容 optional 就省略。
- 确定性、修复后重核及末端检查使用快照中的章节，不再重新采用运行时技能库的章节；数值检查读取完整原始要求、最新明确字段赋值及完整材料，审计 ledger 的500字上限不变。最新明确赋值优先，订单/订单数统一；没有将这一有限字段解析宣称为任意自然语言修改理解。
- 已观测 URL-only 的缺正文事实独立于后续预算是否通过；主审查所有出口保留材料原因，末端复核不能凭缩短正文或恢复到原始 context 消除这一事实。材料与预算原因可同时保留。没有新增网页抓取、跨区回退或减弱确定性阈值。
- core 不在候选正文附加 legacy workflow-action UI footer，避免带编码数字的控件链接被当作专家事实而硬拒绝；后续 router 保持既有独立 suggestions 通道，不因此取消用户后续操作。
- 新增 `execution/core-generation-review.test.ts` 19例，真实 runner→review→deterministic/semantic→finalizer，仅替换外部模型传输；18例观察到行为RED后GREEN，1例解析专用字段不进入模型用户历史是直接GREEN回归。覆盖完整历史/材料、阶段伪批准、固定技能、越过审计长度的数值更正、材料矛盾、同task旧ledger、旧handle、缺完整性、URL-only、候选与context两种预算早退后的末端覆盖。
- 最终20+3文件共668测试通过（04:51:38 JST起，30.53s+1.45s）；tsc --noEmit、后端构建、4文件Biome/diff通过。3个旧文件22条lint诊断全部位于基线已有且本次未改变的行；不宣称全仓lint/格式通过。只读复审无剩余Critical/Important/必修Minor。两个既有大正文用例6.69/14.79秒，真实性能门禁仍待解决。
- **仍待完成：** 首次/计划/修改/批准的真实router接纳与finally接线、awaiting/failed同轮元信息及P2可持久化结果形状、所有权/事件/响应共同身份、前端排序、真实MySQL事务与V10–V12。此检查点没有实际数据库、模型或生产调用，没有PR/推送/部署，不勾选下方整链任务。

**Files:** 修改 `agent/generate-runner.ts`、`generate-runner.test.ts`、`execution/generate-outcome-review.ts`、对应测试、`trpc/routers/tasks.ts`、`tasks.plan-mode.test.ts`、`tasks.resume-verifier.test.ts`；新增 `trpc/routers/tasks.delivery-contract.test.ts`。

**Interfaces:** `RunGenerateOpts.verificationContext?`、`ReviewGenerateOutcomeInput.verificationContext?`、`VerifyInputs.verificationContext?` 均使用Task1同一类型；router在已验证附件之后、额度调用之前检查输入。context的服务器ID/revision由后续可靠接纳模块提供，不允许在每层重新随机生成。

- [ ] **RED：两通道真实链路。** 新集成文件沿用既有router fixture，只mock外部model传输和DB边界；不得mockrunGenerateTask/reviewGenerateOutcome/verifyWithLlm。设置生成和核验旗标，先计划、长历史修改、单独确认；捕获Responses和Messages两请求的原始要求/材料一致。

```ts
expect(generationRequest).toContain(originalRequest);
expect(semanticRequest).toContain(originalRequest);
for (const turn of userTurns) {
  expect(generationRequest).toContain(turn);
  expect(semanticRequest).toContain(turn);
}
expect(semanticRequest).toContain(finalCandidateTail);
expect(semanticRequest).toContain('approved_execution');
expect(chargeMock).not.toHaveBeenCalled(); // 超限接纳反例独立用例
```

- [ ] **GREEN：上下文接入。** router固定workflow（快照只存serializable reportSections，不能JSON序列化函数/regex）；附件逐文件逐块映射key，图片仅metadata标不完整，正文不入通用日志。typed intake保留独立解析视图；生成的用户文本由renderVerificationUserIntent提供，system仅使用服务端phase。referencePlan保持不可信。sourceUrls由提供者观测；URL-only材料标source_body_unavailable，不能凭URL推定全文已核验。
- [ ] **验证。** 运行新联合测试、plan-mode/resume-verifier/generate-runner/generate-outcome-review/pipeline/llm-verifier、类型检查、构建、精确lint/diff；核查恶意附件批准、越权文件、跨区域和旧提供者反例。连续大套件约20文件一批，不同时启动。
- [ ] **交接下一子项目。** 保存Task1–3真实RED/GREEN与局限，复用轻量审查者。完整性和执行所有权按下一计划接管同一context；接纳事务及前端时序是第三计划。此任务若仍缺后续revision提供者，只能记录未完成，不能以临时常量或fake ID替代验收。

## 总规格覆盖与后续顺序

本计划覆盖V1–V4及V10/V11的输入部分。V5/V6由“生成完整性与执行所有权”子项目覆盖；V7/V8/V9由“可靠接纳、保存、页面合并”覆盖；V10整链、V12新生产灰度在三个子项目全部完成后执行。后两个计划在前一子项目接口核实后分别细化，不以本节替代其实施和验证。

当前可先独立完成Task1/Task2；Task3生产接纳接线需要后续所有权/事务模块，保留为组合门禁，不伪造完成。
