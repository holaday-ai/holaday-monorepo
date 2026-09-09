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
