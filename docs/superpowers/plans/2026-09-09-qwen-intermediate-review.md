# 千问中间产物同轮核验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 真实 runner 的方案、澄清和失败结果能够携带诚实的同轮核验元信息进入 P2，不能用空 verification 或最终报告规则假装中间产物合格。

**Architecture:** 继续 C2 的真实 runner/review/pipeline 接口。核心 pipeline 根据服务端 runner 状态和不可变 phase 选择中间产物核验；最终交付保留原规则。中间产物保留通用安全、URL、产物声明和专家事实依据检查，语义仍消费完整同一上下文；失败结果不调用模型且不保留正文。P2 的状态、覆盖和失败保存门槛不放宽。

**Tech Stack:** TypeScript、现有 Vitest/Qwen adapter/执行 registry，不添加依赖。

**Spec:** `docs/superpowers/specs/2026-09-08-qwen-delivery-contract-design.md` 第3/5/6/7节；这是 Task3/TaskC 的接线前置，不代替真实 router、数据库、前端或生产门禁。

## Global Constraints

- 已有隔离 worktree/分支，主线程串行，最多复用一位只读审查者。Node堆≤2GB、Vitest单worker/无文件并行；free<40%或磁盘<10GiB不启动重任务。
- 不安装、不启动Docker/浏览器，不触碰主工作区、生产、身份/密钥、支付/奖励/提现/额度mutation、账户注销、Partner Ledger、DivineAPI。
- 64KiB上下文、64KiB材料、96KiB候选、256KiB语义请求；15秒/零重试/768 tokens不变。不截断、不新增持久化正文队列。
- 三子项目和组合门槛未全部通过，不推送部分PR、合并或部署。

## Task C3a：真实中间产物审查与 P2 组合

**Files:**
- Create `apps/orchestrator/src/execution/core-intermediate-verification.ts`：仅中间产物的确定性/语义核验。
- Modify `execution/execution-pipeline.ts`：同轮身份、flags和await后归属校验复用现有边界；失败/等待分流。
- Modify `execution/generate-outcome-review.ts`：核心中间产物不再略过核验；失败只保留固定状态，不把来源报告规则套到澄清。
- Modify `execution/answer-verifier.ts`：显式中间阶段只改变最终产物要求的适用性；短澄清不按完整报告20字下限，输入本身算术矛盾交给澄清语义而非阻止发问。最终交付路径不变。
- Modify `execution/llm-verifier.ts`：请求携带服务端deliveryStage；说明方案/澄清不是已完成交付，完整workflow仅是最终目标。材料/方案不授权阶段。
- Modify `agent/generate-runner.ts`：核心等待返回也保留真实提供者URLs，不因转为澄清丢失覆盖事实。
- Modify `agent/core-task-settlement.ts`：纯生成失败精确映射固定GENERATION_INCOMPLETE和既有“生成未完成”提示，不伪称发生过确定性质量失败；不改状态门槛或保存字段。
- Create `execution/core-intermediate-review.test.ts`：真实runner→review→pipeline→P2，只有外部模型传输替身。

**Interfaces:**

```ts
// CoreVerifyInputs 增加可选、仅服务端使用的runnerStatus。
runnerStatus?: 'completed' | 'awaiting_user' | 'failed';
// 确定性和语义输入增加服务端中间阶段，不改变TaskVerificationContext。
deliveryStage?: 'plan' | 'clarification';
// 新模块由pipeline在读取同轮state之后调用。
verifyCoreIntermediate({state, answerText, runnerStatus, semanticAdapter}): Promise<VerifyOutput>;
```

阶段规则：awaiting且context.phase为draft/revise时核验方案，否则核验澄清；调用者不能自选plan绕过最终交付。保持state.context/contract不变；派生中间contract仅替换完成品数量/章节/200字等要求，保留constraints、已观测依据和专家数字来源检查。中间阶段不要求尚未执行的目标网站来源，但出现的URL和“文件已生成”等声明仍须有依据。原材料数值矛盾允许询问，不能据此认证最终结果；完整用户/材料仍进入语义。det失败不调用语义、不自动改写问题；覆盖不足或质量拒绝不能以awaiting绕开P2门槛。failed不核验丢弃正文、不调用语义，记录固定GENERATION_INCOMPLETE、unavailable和实际输入覆盖。所有异步出口仍复查本轮handle/flags。

- [x] **RED：同轮保存可用且不假通过。**

```ts
const outcome = await runGenerateTask({ ...opts, verificationContext: state.context });
const reviewed = await reviewGenerateOutcome({ ...input, outcome, coreExecution });
expect(reviewed.verification).toMatchObject({ executionId: admission.executionId,
  executionRevision: 1, semanticStatus: 'pass', inputCoverage: { complete: true } });
const operation = prepareCoreSettlement({ admission, status: 'awaiting_user',
  result: { question: reviewed.outcome.summary, planText: reviewed.outcome.summary },
  generation: outcome.generation, verification: reviewed.verification! });
expect(operation.status).toBe('awaiting_user');
```

分别覆盖draft/revise完整上下文/材料/固定规范；简短真实澄清；有输入矛盾时只问核对问题；失效/交错handle和flags关闭；语义reject/unavailable；未观测URL、无文件却声称已生成、专家无依据数字；不可读/超限材料与候选；provider失败不泄露原始reason/正文且不调用语义；最终完成仍要求最终规范和确定性硬门槛。每个新反例先真实RED再GREEN，不把fixture错误计为RED。

- [x] **GREEN：最小实现。** 新中间核验模块和上述调用点，不更改最终交付规则，不扩展P2保存字段。core输出缺失semanticStatus明确记unavailable；失效handle固定hard_fail/空正文/本轮ID，不能返回旧正文。

审查细化：按实际P2保存形状，单一澄清≤65,535 UTF-8字节；方案同文写question和planText，合计≤96KiB即每份≤49,152字节。预算/材料覆盖在中间确定性与语义之前检查，失败不截断。明确的“请确认您提供的<指标值>是否准确？”只在整句提问、实际用户/材料中有同指标值且无夹带陈述时算有来源；不把referencePlan当事实、不放过新增值、错指标或混入数字断言。最终交付的数值/结构规则不变。

组合细化：最终确定性早退也在活跃归属边界补齐实际coverage和unavailable元信息，不改变失败等级；这使已有拒绝能由P2保存固定失败。纯生成中断的提示只在partial、非quality_rejected、semantic unavailable、覆盖完整、无来源/硬失败且全部失败check为固定generation.incomplete时使用既有“生成未完成”。没有把语义unavailable伪造为pass。
- [x] **验证。** 相关runner/review/pipeline/P2及既有router回归，每批≤20文件；随后tsc --noEmit、tsc -p tsconfig.build.json、精确lint/diff、独立只读审查。真实MySQL/真实模型/生产不计已过。
- [x] **本地检查点。** 精确暂存代码/测试/此计划，不提交QA；本地commit，PROGRESS记录证据和下一步。继续真实router接纳与结果读取兼容，C1/C2/C3a不重做。

最终本地证据（2026-09-09 05:54 JST）：20文件468测试（05:52:46启动，29.06秒）退出后，4文件228测试（05:53:36，1.73秒），合计24文件696。新增28例中23例有行为RED，5例为直接GREEN的兼容/防放宽回归；awaiting marker fixture最初拼写错误纠正后重新观察RED，不将错误fixture当产品反例。tsc --noEmit、tsc -p tsconfig.build.json通过，6文件完整Biome通过；answer-verifier/pipeline的18+2 lint均在78952df1已有未改行，未全量格式化旧文件。独立只读审查及P2提示分类复审无Critical/Important/必修Minor。旧大正文测试仍6.57/13.47秒，真实性能/真实模型门禁未解除；Qwen日志来自传输替身。真实router/前端/数据库仍未接入本分项，不能推送部分PR或部署。
