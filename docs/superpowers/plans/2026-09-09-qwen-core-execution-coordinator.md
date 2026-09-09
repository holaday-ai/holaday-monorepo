# 核心文本实际执行编排

> 执行方式：superpowers:executing-plans inline；主线程串行，最多复用一名只读审查者。

目标：把已授权的完整输入经一次事务接纳接入真实 runner、共享核验和原子保存，而不是继续增加拒绝门卫。原总规格及发布门禁不变。

## Task 1：共享真实执行编排器

- 新增 `agent/core-task-execution.ts` 及行为测试。调用者提供已授权、完整解析的文件块和服务端要求快照；不接受客户端执行身份或调度许可。
- 输入预算在 `prepareCoreAdmission` / DB 前；只调用一次 `admitCoreTask`。只有直接事务确认的唯一许可才创建 registry、调用 runner。对账确认提交不等于允许再次执行。
- 使用真实 `runGenerateTask` 和 `reviewGenerateOutcome(coreExecution)`；两者收到同一完整上下文；不拼接摘要替代材料，不向 raw userTurns 注入字段标签。
- 生成异常经固定失败 outcome / 实际核验后原子保存。等待方案保留当前完整 planText；正常澄清不冒充新方案。
- 使用同一个 P2 operation 经 P3 有界恢复；只有保存已确认才发 awaiting / terminal。保存未知、注册失败或过期句柄不声称完成；不重跑生成。
- ACK、流、进度、保存后事件均带真实 ID/revision；finally 仅释放本句柄。通知失败和可选 suggestions 回调失败不能改变主任务的保存结论。
- 测试只替换外部模型传输和仓储边界；实际 runner、review、registry、admission、settlement/recovery 保持真实。仓储 SQL 和真实 MySQL 分别依赖既有与后续专用门禁，不把内存替身当真实事务证据。
- 先 RED 再实现；验证接纳未知不调度、完整材料双通道、审批方案等待、生成失败、终态响应丢失、保存失败不广播、过期归属及 finally、通知异常。

## Task 2：真实 reply 分流与恢复（Task 1 后）

实现细化：在现有 coreRequirements 中加可选、严格的 resume 元数据（schemaVersion=1、固定 expertMode/skillId/legacyWorkflowId、intakeBindings）。binding 只保存 userTurns 索引与字段名，不复制原文、不保存模型推断值；纳入同一个64KiB要求预算。旧无此元数据的核心记录仍可读取，但不能猜测丢失的执行配置来续接。新编排器所有新接纳均写此元数据。非空 legacyWorkflowId 的旧模板迁移留到 Task3，不能静默丢弃前导规范。

裸值只在“当前持久化提问等于真实 typed intake 生成的问题、且恰有一个缺失字段”时绑定；历史原话不改。恢复时验证字段仍存在、引用不越界，再构造 newest-explicit-first 的解析专用视图。草案修改及独立批准不绑定。无法唯一映射时仍让真实 intake 询问，不猜多个字段。

- 从一次授权 row 解码 core 记录；保持 invalid 拒绝和 legacy 防竞态，不把新记录放回旧 scheduler。
- 恢复完整原始历史、固定 workflow/null、当前 referencePlan；本次独立明确批准才切换草案阶段。完整文件集合重新授权。
- 明确解决 typed 裸值澄清的可恢复辅助视图、contract 与 lineage 身份；不能用历史中的“确认”或附件批准执行，也不能把衍生字段伪装成用户原话。
- 将 Task 1 接到实际 reply；建议结果持久化和 WS schema 同步增加轮次保护。补真实 router 行为测试。

## Task 3：首次创建、客户端及组合门禁

### Task 3A：先接新建方案的完整纵向链路

本地实施检查点，不是发布范围缩减。先迁移 `executionMode=generate && mode=plan && legacyWorkflowId=null` 且不具备股票专用分支候选资格的路径；草案本身由主生成器产出且经核验/P2 保存，不再为该模式另生成一份未经同轮保存的首屏辅助方案。股票候选分支及其通用回退本轮保留旧路径、不得误施新入口的核验 flags；direct、非空旧模板 lineage 和旧计划记录仍待 Task 3B 迁移；不得因此放行部分发布。

审查补充：首次壳 INSERT 也属于不确定写入边界，15 秒内未直接确认或抛错时，返回 `admissionState=creationUnconfirmed`、保留 taskId，executionId=null/revision=0（尚未接纳，不伪造轮次）。正常返回供既有创建幂等 claim 保存/维持，不释放可能已写入的请求；迟到结果只吸收，不重调度模型。前端必须在后续 Task3 中识别此状态，保留输入并提示创建未确认，不能显示已开始或鼓励重发；既有24h去重窗口不延长，不在此增加自动重试或退款规则。

- [x] 在 `tasks.core-continuation.test.ts` 扩展真实 caller fixture，验证 create→revise→approve 三轮身份、完整原话/附件双通道、只扣一次及只在最后发 terminal；预算在扣减/插入前拒绝。先观察旧入口缺身份/新保存链的 RED。
- [x] 新建 `tasks-core-create.ts`，仅调用既有 insertTask 插入壳记录，再走 startCoreTaskExecution 一次接纳；ACK 携带真实 id/revision 和接纳状态，接纳未知不调度。调用者在原扣减位置前校验含 resume 的完整要求，不改变扣减算法。
- [x] 复用 reply 的 `publishCoreExecutionEvent` 公共事件投影，不把内部 settlement 发给客户端。新建入口只生成待批准方案、不运行后续建议；批准后的建议仍由 reply 同轮 CAS 处理，避免为两处简单 runtime 选择引入通用调度层。
- [x] 在 tasks.ts 新增精确的 plan-only 路由；旧 template_fill/browser/direct/legacy 代码不删除。更新受影响 create 测试的仓储边界和新格式断言，旧 legacy reply 独立兼容测试保持真实。
- [x] 串行运行上述新测试及 core/reply/预算/生成/核验回归、后端类型/构建、前端类型、精确 lint/diff，独立只读审查后保存本地检查点。没有真实 DB/模型/前端排序证据，明确保留后续门禁。

- 迁移首次 core generate（不改 template_fill / browser）；旧计划迁移和首次计划写入必须保持身份/CAS。
- 前端 ACK/WS/detail 同轮次排序、真实隔离 MySQL、V10/V11/V12 双通道及性能验证、独立审查。
- 全部三子项目完成前禁止 push/部分 PR/部署；自动试发仍暂停，不重用旧包。

## 资源与验证

### 持续推进：旧入口与续接、前端、发布前组合门禁

2026-09-10 用户要求连续做到部署前，不再按内部检查点停顿。串行执行及只读审查保留，检查点通过后直接做下一项。禁止部分发布，不自动执行本次终点之后的部署。

- [x] 旧规范固定解析：`supercar/expert-workflows.ts` 提供 `resolveFixedExpertWorkflow(id,intent,opts)`，仅已知旧ID可解析，不因后续出现别的领域词换工作流；原matcher先匹配再复用此函数。`agent/core-legacy-workflow.ts` 提供 `restoreCoreLegacyWorkflow(id,{initialRequest,userTurns,fileIds})`，从完整原話和真实附件集合重算缺项，提取唯一server规范快照，不加入用户原话。结构化粘贴指标可作文本来源，但“稍后上传”不作已上传。
- [x] 核心续接恢复固定legacy：`prepareCoreContinuation` 在明确旧ID且快照匹配时重算本轮缺项，保留原始历史/phase/文件，不静默落回旧调度；NULL旧ID仍不重新匹配。旧完整待批方案同样恢复已存ID；没有完整历史的旧记录明确拒绝并允许用户重新创建，不能把不能恢复的数据列为可自动迁移。
- [x] 首次generate选择legacy规则进入core，预算必须仍在扣额前。direct缺项只澄清；draft/revise只产出方案（不将确定性缺项问题冒充可批准方案），批准后才检查执行缺项。真实router测试覆盖创建→修改→批准→补数据→保存，观察两通道和版本、不增加扣减。
- [x] 浏览器边界按当前千问策略拒绝，不实现新转交：2026-09-10核对实际`ProductionModelRuntimeWiring.resolveUnmigrated('browser')`恒返回迁移中，`tasks.create`在扣额前已走相同不可用分支；后部supercar仍依赖Anthropic，不能因旧handoff代码存在就启用。原草案的自动父子转交超出本轮核心文本范围，撤回该实现步骤，旧引擎保持关闭。新core reply在非计划阶段且固定legacy路由需要browser时，在C1/文件/模型/子创建前抛受控PRECONDITION，保留父方案与用户输入，提示改用附件或粘贴数据。以后浏览器千问迁移单独设计“未调度子任务→同事务父子关联→dispatch”、取消保护和未知对账，不用假核验通过替代回执。
- [x] 接通前端执行轮次合并及creationUnconfirmed，测试ACK/WS/detail乱序、相同revision不同ID、终态后stream、保存未知与输入保留，不改布局。
- [x] 审查发现的来源修复：跨原始用户轮次汇总不同指标键；父用户要求保留在初始上下文，父模型结果另存可选`referenceContext`，纳入64KiB预算并完整传给两通道，明确为不可信参考，不能供legacy intake确认数据来源或批准。不能把模型示例当用户数据。
- [x] 本地组合门禁：串行组合回归、前后端类型/构建及独立审查通过；既有MySQL服务中仅新建随机隔离合成库测试，不启动Docker/新浏览器，不读取输出生产密钥。真实模型性能及V12明确留在新部署阶段，不用mock替代真实证据。

2026-09-10 最终本地证据：后端415文件6764测试、前端250文件2458测试、Node发布/安全/基准脚本79测试通过；实际MySQL8.4.8执行0059后9项事务用例通过且仅删除本次新建随机测试库。后端types/build、前端完整lint/types/build、shared-types、15小TS完整Biome及diff检查通过；不宣称全仓Biome。前端bundle体积警告仍在，真实千问15秒/768-token预算与质量尚未验证。

最终审查追加的3Important均有行为RED→GREEN：list/detail先接管新轮清掉旧运行态；无ACK传输失败保守阻止会话内重复写入；未知create ACK不覆盖先到结果。8新用例中7实际失败后修复，142相关测试和完整前端复跑通过。两条旧fixture改为明确应用拒绝，继续覆盖合法纠错及历史顺序；不把网络失败误当未写入。无身份的传输未知不靠文本相等或后续任意新问题解锁，当前会话保护不承诺跨刷新/跨进程恢复。独立只读复审无剩余Critical/Important/必修Minor，准入PR/合并/本地候选封存，不是生产验收。

新只读核对实际生产为PR231 `107857fe70503e30691073f267d87275596edb20`、唯一Orchestrator uid998、两站healthz 200/ok；代码目标基线PR236 `8774feaf772f596dbfff94f41cccc3b1c2521c4b` 与生产不同。发布说明见 `docs/runbooks/qwen-core-delivery-release.md`。用户要求停在生产迁移/切换/重启/灰度之前；不复用旧包、旧授权回执、旧actor pin。封存源码/产物不是新生产工具或租约已验证。

### Task 3B-2c：旧执行规范的同源快照与生成守卫

本步骤只补齐 coordinator/runner 可独立核验的旧规范承载能力；不移除 router 的 legacy 排除条件，不改旧浏览器转交状态，不宣称已完成旧入口迁移。沿用已批准的单线程执行，不增加依赖。

`execution/core-execution-registry.ts` 的 contract 选择也必须读取固定 legacy ID：旧专家工作流在 normal/auto 模式下仍是 full tier，不能仅在 expert 模式才进入语义核验。实际 coordinator 的三种模式双通道测试覆盖此约束。

**文件与接口：** `execution/task-verification-context.ts` 增加可选 `legacyWorkflow`，只含固定 id `douyin-livestream-review`、非空 `promptPreamble`、唯一缺项 `liveSession|dataSource` 数组和 `routeOverride: generate|browser`；缺项只能配 generate。`agent/core-task-requirements.ts` 负责完整保存、预算和 resume lineage 一致性；`agent/core-task-execution.ts` 在接纳前拒绝有旧 ID 却无规范的执行，并在首次 await 前冻结全文。`agent/generate-runner.ts` 使用该快照，不把规范拼入用户原话；`execution/llm-verifier.ts` 保留同一快照并明确规范与不可信材料边界。测试集中在 context、requirements、真实 coordinator 和 runner，外部模型/仓储仍为合成边界。

- [x] RED：实际旧 matcher 的七段报告全文经 `legacyWorkflow` 进入真实 coordinator，验证 generation.instructions 与 semantic.context 同源，原话不变，admit 期间源对象变化不污染快照。现有严格 schema 应拒绝新增字段，先观察失败。
- [x] RED：`runGenerateTask({ verificationContext: {...context, legacyWorkflow} })` 在缺场次/来源时返回固定 awaiting_user 且零适配器调用；browser 且非计划阶段返回 `CORE_LEGACY_BROWSER_HANDOFF_REQUIRED`，不生成假结果；draft/revise 仍仅出方案。旧 generate 规范排除 lightweight 和自动新鲜度工具，防止上传分析被误转为联网研究。
- [x] GREEN：严格解析及完整预算，`parseCoreRequirements` 保存深冻结副本，新增快照必须与 resume.legacyWorkflowId 相同；旧记录缺快照可读取但 coordinator 接纳前拒绝，不据此改变历史读取兼容性。生成系统段与核验 payload 使用同一完整规则；缺项问题为“请补充需要复盘的直播场次或时间范围。”及“请上传复盘数据，或说明数据所在的后台来源。”，不增加权限。
- [x] 验证重复缺项、未知字段、缺项/browser 冲突、长规则预算、ID 不一致、历史缺规则零接纳、无规则旧路径兼容、正反生成守卫。新测试 GREEN 后相关回归、后端类型/构建、前端类型、精确 lint/diff 和独立只读审查串行执行；仅本地检查点提交，QA 记录真实证据及余项。

本地验证（2026-09-09 23:46 JST）：基线022031c1。新增字段初轮严格schema RED后，runner/上下文投影的12项实际行为失败（规则丢失、缺项与browser误执行、联网工具和轻量回答绕过）修复为GREEN；另有normal/auto两项真实RED揭示旧专家ID未进入contract选择，registry修复后同样通过。新增25项测试，真实coordinator证明规范在admit等待前冻结、三种模式都传入两通道、缺项保存awaiting_user而browser守卫保存failed且零生成调用；不将其解释为已完成浏览器转交。

最终三批35文件 **773 tests**（388+308+77）通过，后端tsc --noEmit/build、前端完整typecheck退出0，10个TS完整Biome与diff检查通过。唯一复用只读reviewer未发现Critical/Important/必修Minor，允许本地检查点，不允许发布。所有模型/仓储仍为外部边界合成替身；七段报告真实质量、MySQL、千问、浏览器及生产未验证。旧入口和continuation的legacy排除条件没有移除；后续须完成固定旧lineage的server规范投影、缺项重算/裸值历史以及不确定浏览器handoff的安全接线，再做前端同轮排序、真实组合与性能/新发布包门禁。Node堆2GB、单worker、重任务与审查串行；未安装或启动Docker/新浏览器，不读密钥或生产私人数据，不改敏感业务或自动化，不推送/PR/合并/部署。

### Task 3B-2b：旧方案批准后首次确定性澄清

这是旧兼容的一段纵向接线，不放宽总体发布门禁。旧代码在批准后park时保存 `approvedPlanText`、`fallbackChain=['generate-resume']`、完整历史及原planText，但不保存planMode。仅同时具备这些显式服务端证据、最后一条原始回复是独立批准、固定typed工作流当前确定性intake问题与row.awaitingQuestion一致、无历史派生planIntakeContext时恢复approved_execution。不能仅凭缺planMode、模型正文或历史中任意一处“确认”恢复批准；证据不完整拒绝，不猜。无approvedPlanText的非目标仍保留旧路径。

- [x] 将现有 `core-task-continuation.ts` 的确定性裸值绑定/辅助视图提取为 `core-task-intake.ts`：`renderCoreIntake(requirements,workflow)` 与 `bindCoreIntakeReply(requirements,workflow,awaitingQuestion,message)`；保持唯一缺项、问题精确匹配、全文正则匹配、原文不变、仅turn/field索引，现有9条续接行为无变化。
- [x] `core-legacy-plan.ts` 接收可选awaitingQuestion并识别上述旧批准凭据；纯schema与预算校验不伪造core记录/许可。只读hold不写；当前裸值经同一绑定函数恢复到新metadata。snapshot仍由同一已授权row产生，追加awaitingQuestion并在C1做NULL/值CAS，避免只改问题时绑定到错误旧提问。
- [x] 先用真实prepareLegacyPlanContinuation测试观察原本null的RED；正例为content-topic、初始“小红书内容选题”、最后原话“确认”、匹配确定性品类问题、当前“美妆护肤”。断言原话保持、phase approved_execution、intake ready和新绑定索引。拒绝批准文不匹配/最后回复非批准/问题不匹配/缺明确来源/非空派生历史；长或歧义答案不能截断绑定。
- [x] 真实tasks.reply旧批准澄清→新ID与保存→下一次core恢复，观察双通道保留历史/文件与resume索引且不再缺失品类。新增SQL问题CAS与拒绝测试。串行回归、前后端types/build、精确lint、独立只读审查后本地提交。非空legacy提示规范、带不可恢复派生历史/多次旧澄清、无历史记录仍未完成，不改生产。

本地验证（2026-09-09 23:28 JST）：基线e3bb7d29；纯旧恢复正例先因返回null行为RED，新增问题快照先因严格接纳schema不支持字段RED，再实现并GREEN。旧批准凭据缺失/不一致、历史中批准后有修改、问题不匹配、不可恢复派生历史、长/歧义裸值、hold均有回归；真实reply证明两轮原话和绑定持久化、四次生成/核验传输且无重复扣额，两轮是澄清而非最终交付。

最终三批32文件 **707 tests**（373+298+36）通过；后端tsc --noEmit/build、前端完整typecheck退出0，10个改动/新增TS完整Biome及diff检查通过。测试非空断言lint问题改为fixture显式检查，未修改生产规则。独立只读审查无Critical/Important/必修Minor，仅准本地检查点。SQL只验证Drizzle传输条件，模型和仓储为合成边界，不是真实MySQL/千问或生产证据。不安装/启动Docker或新浏览器、不读凭据、不改敏感业务；Node堆2GB、单worker、重任务和审查串行，收尾内存空闲74%、磁盘145GiB。整体旧规范/浏览器转交、其余不可恢复历史、前端与真实组合门禁未完成，禁止部分推送/PR/部署。

### Task 3B-2a：完整旧方案的首次同轮接续

沿用已批准的兼容范围，先处理旧generate方案中显式 `planLegacyWorkflowId=null` 且 `planMode=awaiting_approval` 的typed/null工作流；非空legacy的提示规范与浏览器转交另做，不丢弃其规范强行迁入。缺失planMode（包括旧批准后再澄清）保持原路径，后续恢复其明确阶段与裸值绑定，不以字段缺省推断已批准。本步骤不等于3B-2全部完成，不改变发布门禁。

- [x] 新 `agent/core-legacy-plan.ts`：`prepareLegacyPlanContinuation({head,result,message,fileIds,roleId,origin})` 返回 `{requirements,hold,legacySnapshot}` 或非目标null。只接受null/0/0、awaiting_user、明确awaiting_approval、完整planInitialIntent/planReplyHistory/planFileIds、明确planWorkflowId/null、expertMode、selectedRole与row.roleId一致；拒绝不可恢复历史/非空衍生planIntakeContext。不从旧intent或摘要补原话，不新匹配技能。现存typed ID在新接纳时读取当前注册定义并固定快照，不宣称恢复历史版本定义。
- [x] 真实router用旧完整方案+长修改+附件+单独确认，先RED（未产生core接纳）；通过后应新ID/revision1、原话不trim/截断、附件重新授权、生成和核验都见相同内容且无再次扣额。hold不写；非本次独立批准保持revise。
- [x] `CoreAdmission`/`CoreExecutionInput`增加可选server-only `legacySnapshot:{resultJson,roleId,origin}`，仅旧awaiting/null/0/0可用；验证JSON对象、UTF8≤128KiB，冻结。`admit`额外WHERE结果JSON语义相等、roleId/origin一致；不把snapshot写入result/events或日志。Drizzle传输测试先因缺失snapshot接纳字段RED，再补字段和条件。新流程首次身份和原要求仍同一C1事务保存；读取后旧回复改变内容时CAS拒绝。
- [x] `tasks-core-reply.ts`将legacy完整方案送入已有文件授权、一次core调度及同轮事件流程，初始授权SELECT加roleId；缺失历史固定拒绝，旧非目标不改。回归core/reply/旧计划，前后端types/build/精确lint、只读审查通过，仅保存本地检查点。

本步接口不生成虚假旧executionId。新ID仅由prepareCoreAdmission在实际接纳准备时分配；纯要求验证可用内部预算校验上下文，不伪装成数据库记录。未完成legacy/direct旧无历史记录与客户端/真实组合门禁前禁止发布。

本地验证（2026-09-09 23:14 JST）：

- 完整旧方案真实reply迁入、必需核验开关关闭仍接纳、缺planMode被当作批准均有行为RED→GREEN；首次fixture缺旧仓储边界导致的transaction异常不算行为RED。缺审批标记的旧澄清记录保留原路径，不能把缺省当授权或丢失字段绑定。
- 补充旧附件失效、只读hold、旧方案→修改→批准完整附件双通道、快照拒绝后不回落不生成、容量/冻结与角色/来源SQL条件。接纳临时快照只在服务器内存中使用，不写入新result/events。SQL为真实Drizzle/mysql2传输边界测试，不是实际MySQL证据。
- 三批32文件，361+297+36=694 tests通过；末次类型修正后受影响的12文件23:11 JST复跑297过。后端tsc --noEmit和build、前端完整typecheck均exit0。9小TS完整Biome通过；tasks.ts的33条既有lint均位于HEAD原有行，无新增行诊断，不声称全仓lint。TS2345源于新旧结果结构合并后的unknown，改为独立typed legacy变量，无断言绕过。
- 最终只读独立复审关闭Important，无剩余Critical/Important/必修Minor，仅准本地检查点。真实runner/review保持，模型fetch与仓储为合成边界替身；不是真实千问/浏览器/生产验证。Node堆2GB、单worker、审查/测试/构建串行，末次内存空闲74%、磁盘145GiB；不安装、不启动Docker/浏览器、不读凭据或生产私人数据，不改敏感业务。
- 下一项仍为Task3B-2：非空legacy提示规范（包括douyin-livestream-review的缺数据守卫及browser handoff）、无planMode的旧已批准澄清/字段绑定。不得静默清空lineage或将旧派生planIntakeContext冒充用户原话。之后才是前端ACK/WS/detail排序、creationUnconfirmed、真实MySQL/千问性能及V10–V12/新发布包；禁止部分push/PR/部署。

### Task 3B-1：通用 direct 首次执行与同轮辅助通道

本检查点范围为3A原条件去掉mode=plan限制，仍排除legacy和股票专用候选。历史记录迁移在3B-2，不把本步称为全部3B完成。保留首屏辅助计划和后续建议；辅助计划只用于展示，不作为用户要求或授权，不混入不可变核验上下文，也不写回coreRequirements。

- [x] 在真实router测试加 `createDirect()`：要求直接模式生成/核验完整同源、带真实轮次、保存最终结果；同轮辅助计划先持久化再广播，取消/换轮后不生成正文，计划失败但权威状态仍有效时继续；后续建议只在已保存completed同轮写入。
- [x] `CoreTaskRepository.persistAdvisoryPlan(op: CoreAdmission, planText: string)` 用既有planText/planStatus列，限制32KiB和owner/status/executionId/revision/recordVersion；不改核心版本或result，避免与P2竞争版本。真实SQL边界先RED。
- [x] 编排器增加可选 `beforeGeneration(admission, isCurrent, deadline): Promise<'ready' | 'stale' | 'unconfirmed'>`，接纳许可之后、runGenerateTask之前执行；stale静默终止，未知或抛错报告unconfirmed/不生成，不移除其他轮句柄。回调结束后重查本句柄和同一期限。create的回调调用现有prepareCoreTaskPlan，计划先CAS保存，结束后查DB同轮executing再发布；辅助计划只展示、不作为授权或第二模型输入。此DB读取和可选计划回调共用coordinator创建的15秒单调期限；超时不因迟到结果继续。资格只使用本次rawIntent，实际规划保留完整要求。
- [x] 将reply现有建议回调提取为共享 `publishCoreSettledSuggestions`（tasks-core-suggestions.ts）；create/direct和reply复用，任务初始草案不调用。保留rawIntent本次输入资格、完整原话约束、completed保存后CAS。
- [x] `createCorePlanTask` 泛化为 `createCoreGenerateTask`，只允许draft/direct，不变更壳INSERT未知处理。server.task.plan增加可选ID/revision，与旧客户端兼容；新版前端消费排序仍是后续门禁。
- [x] 新测试RED→GREEN、受影响回归≤20文件/批、前后端类型/后端构建/精确lint、独立审查通过；准备本地检查点提交，不改生产/模型配置/扣减算法，不推送/部署。

Node heap 2048 MiB，Vitest 单 worker / 无文件并行；每批最多 20 文件。内存空闲低于 40% 或磁盘小于 10 GiB 不启重任务。测试、类型检查、构建、审查串行；不安装、不启动 Docker/新浏览器、不访问生产或密钥，不触碰支付/积分/账号注销/DivineAPI。

验证顺序：新行为 RED → GREEN → 相关核心回归 → 后端 tsc --noEmit → build → 精确 Biome / diff → 只读独立审查及必要复验。

## Task 1 验证记录（2026-09-09）

- 初始 11 个用例对空编排行为全部失败；实现后 9 过 / 2 失败。两处为测试前提：双通道用例须明确 expert/full tier；同 revision 不同 ID 在已有 C1 中保守为 unknown，不代表第二次允许调度。对照真实契约修正 fixture/期望后 11 过，未为测试改变 tier 或 C1 判定政策。
- 补充冻结材料、旧句柄/迟到流、数据库新轮次、容量/释放、partial completion、无核验 runtime 等证据后 18 过。
- 独立审查的 3 个 Important 均复现：async publish 产生未处理 rejection；长正文 P2 本地拒绝被误归为提交未知；保存响应晚到仍启动过期后续建议。分别修复为通知同步/异步隔离、预算失败固定结算且不留候选、回调启动前同句柄检查。
- 计划的 TEXT 与 question+plan 双预算已有中间核验保护，保留该行为，不增加容量、不缩写原文；相关长计划用例不是新增缺陷的 RED 证据。
- 新模块 23 个测试；相关两批实际 14+6 文件、376+139=515 个测试全过。后端 tsc --noEmit 和 build 均退出 0；新增两文件完整 Biome check 通过。仅外部模型传输和仓储边界替身，不是真实模型/数据库/生产证据。
- Task 2/3 **未完成**。当前 router 仍维持 C3d 过渡保护；不能发布、不能声称页面已经支持新轮续接。先完成同 row 的 core 恢复、裸值辅助解析/固定 lineage 及实际调用接线，避免伪造缺失历史。

## Task 2 验证记录（2026-09-09 17:08 JST）

- 新增实际 `tasks.reply` 的 core 分流及恢复模块；由同一 owner/origin 授权 row 读取历史、固定 typed/null 工作流、当前方案和续接配置。保存后的完整附件集合重新授权/解析，调用 Task 1 编排器；旧 legacy 路径及 invalid 拒绝保持。旧缺少 resume 或非空 legacyWorkflowId 不猜测续接，首次创建与旧模板迁移仍为 Task 3。
- resume 元数据只保存固定配置和 turn/field 索引，严格解析并深冻结，纳入原要求预算。裸值只在唯一缺失字段及当前真实 intake 问题匹配时绑定；辅助解析不改变 raw userTurns。加测发现部分匹配会丢掉长回复/保留意见，2 个真实 RED 后改为完整匹配；未扩大解析能力。
- 元数据保存、仓储建议 CAS、实际 router 入口均先观察行为 RED 再实现。配置竞态回归真实 RED：事务等待期间 caller 改 expertMode 会跳过语义核验；改读已冻结 admission 元数据后通过。无效 workflow/phase 和缺少 Messages adapter 开关的 fixture 曾导致前置失败，核对真实契约后修正，不作为行为 RED 证据。
- 独立审查发现建议资格误读最初请求而非本次回复，导致“谢谢”仍调用建议或后续实质需求被跳过。实际 router 开启 suggestions lane 的正反 2 条 RED，改为本次 rawIntent、完整历史 intent 后通过；真实建议约束过滤保留历史“不要发送”。建议写入和广播带本轮 ID/revision，SQL 写入还校验 completed/version/owner。
- 最终后端两批 14+10 文件、334+255=**589 tests**通过（17:04:32 / 17:05:02 JST；3.47 / 27.02 秒）。后端 `tsc --noEmit`、`tsc -p tsconfig.build.json` 和前端完整 `typecheck` 均退出 0。11 个修改/新增小 TS 文件完整 Biome 通过；shared ws lint 无诊断；旧 tasks.ts 的 33 条 lint 均定位到 HEAD 原有且未改行，无新增诊断，不声称全仓 lint 通过。
- 新真实 router 测试为 7 条，恢复模块为 9 条；模型只替换外部 fetch，实际 router/runtime/runner/review/registry/coordinator 保持真实，但新 router 仓储以边界替身隔离，仓储 SQL 另测。**这不是 MySQL 集成、真实千问性能或浏览器/生产证据。** 老大输入预算测试耗时仍存在，未声称性能门禁解决。
- 本轮不安装、不启 Docker/浏览器、不触碰生产、密钥、支付/额度/账号注销/DivineAPI。主线程重任务串行，Node 堆 2GB，Vitest 单 worker；复用单个只读 reviewer，不并行运行重任务。自动化保持 PAUSED，所有子项目与组合门禁完成前不推送/PR/合并/部署。
- 下一项：Task 3 首次 core generate 接纳与计划同轮写入、旧 typed/legacy lineage 恢复及客户端 ACK/WS/detail 排序；再完成真实隔离 MySQL、V10/V11/V12 和新冻结发布包。不能将当前核心回复路径视为完整新建到交付的可发布链路。

## Task 3A 验证记录（2026-09-09）

- 通用首次方案实际 create→revise→approve 接入同一编排链，3 个执行 ID/revision、完整原话和原附件均进入生成与语义两通道（实际6次外部传输替身请求），只扣一次、仅最终发 terminal。新建草案不再另调辅助规划；typed/null 工作流固定，旧专用股票候选及其回退、direct、legacy 仍未迁移，不声称全入口已完成。
- 行为 RED 包括旧创建缺身份/未走新保存链、必需核验关闭仍扣额接纳，以及股票候选被新 flags 误拦；修复前后均观察实际 router 结果。旧 plan-mode 测试更换为 core 仓储边界观察者，断言真实新 result 格式；原短合成方案不满足确定性核验，补足合成内容，未弱化核验。只有生成、缺语义适配器的测试正确断言 partial_success，不再误认 completed。测试 observer 的类型错误已修复，未伪造持久化必需字段。
- 独立审查两轮 Important 都有实际 RED：壳 INSERT 提交后抛错/悬挂、以及时间超过15秒但 timer 未执行仍调度。现使用单调 deadline + timer，派发前、写入后、await 后及 C1 前复检；未知返回 creationUnconfirmed/nullID/rev0，保留 taskId 和既有24h去重 claim，不重复扣额/插入/模型调用，迟到成功或错误不恢复调度。新 router 测试15条；独立审查最终无 Critical/Important/必修 Minor，仅准本地检查点，不准发布。
- 相关回归两批14+11文件，334+270=**604 tests**通过（第一批18:12 JST；受本轮末次修正影响的第二批18:42 JST复跑29.34秒）。后端 `tsc --noEmit`、`tsc -p tsconfig.build.json` 与前端完整 `typecheck` 末次复跑均退出0。3个小文件完整Biome通过；plan-mode测试lint无诊断；tasks.ts 33条lint均位于HEAD未改原行，无新行诊断，不声称全仓lint通过。
- 模型仅替换外部传输、仓储仍是方法边界替身；没有真实 MySQL/千问/浏览器/生产证据。大正文预算测试仍耗时约6.6/13.6秒，真实性能门禁未完成。Node堆2GB、Vitest单worker，重任务与审查串行；最后内存空闲63%，磁盘149GiB。没有安装/启动Docker或新浏览器，没有生产或密钥/敏感业务变更；自动化PAUSED，无推送/PR/合并/部署。
- 下一项 Task3B：完成 direct 首次接纳、旧 typed/legacy lineage 和旧计划记录完整迁移，明确保留专用分支边界；随后客户端 ACK/WS/detail 的同轮排序及 creationUnconfirmed 展示/输入保留、真实隔离MySQL、V10/V11/V12/实际千问质量性能与新冻结发布包。所有门禁通过前禁止部分发布，不能复用旧包或旧生产回执。

## Task 3B-1 验证记录（2026-09-09）

- 基线 b2c2279a，同一隔离分支。通用 direct 首次创建接入共享生成/核验/P2/P3，与 draft/revise/approved_execution 共用身份和冻结上下文；非空旧模板 lineage、股票专用候选及其 generic fallback 不在此检查点迁移。方案和建议独立同轮 CAS，初始 draft 不额外生成辅助方案。
- RED→GREEN：直接创建缺少接纳身份、辅助计划仓储方法缺失；计划保存后数据库换轮仍发旧帧；独立审查发现长父任务后的轻量原话错误触发计划，以及回调 promise 返回与正文派发之间跨15秒仍生成。分别补持久化/接纳、保存后权威读回、资格rawIntent与实际完整要求分离、coordinator共享deadline并await后复查。timer悬挂/迟到成功、单调时钟越限、取消、计划写入拒绝的回归也通过；未把这些原本已安全的分支冒充新增RED。
- 旧测试更新的是边界替身：必需flags按generate作用域启用，补真实semantic传输格式和模型元数据，仓储观察者直接记录真实op状态，降级通过runner的partial/provider_error驱动；没有伪造核验通过、把awaiting_user改称完成或降低生产门槛。辅助plan是展示信息，不作为用户授权或第二条生成输入。
- 最终三批 **31文件 / 665 tests**（337+292+36）通过，Vitest单worker无文件并行；router真实续接文件23条、coordinator25条、repository41条。后端tsc --noEmit、build及前端完整typecheck退出0；12个小文件Biome check、ws.ts lint、git diff --check通过。tasks.ts仍有33条既有lint诊断，逐条落在HEAD原有行，无新增行诊断；没有全仓lint或全仓测试声明。
- 独立只读复审关闭两项Important，无剩余Critical/Important/必修Minor，只同意本地检查点，不是release ready。没有安装、启动Docker/浏览器、访问生产或读取密钥/身份数据；不改支付/额度/账号注销/DivineAPI，未推送/PR/合并/部署。末次资源空闲61%、磁盘148GiB，Node堆2GB，审查与重任务串行。
- 外部模型传输和仓储方法仍为合成替身，SQL测试只验证Drizzle生成与条件，不是真实MySQL或真实千问证据。**下一项Task3B-2：旧typed/legacy lineage及旧plan记录完整恢复**，保持原话/附件/固定工作流及一次接纳；随后前端轮次排序、creationUnconfirmed与真实数据库/模型/性能/发布组合门禁。全部通过前禁止部分推送或部署。
