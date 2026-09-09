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

- 从一次授权 row 解码 core 记录；保持 invalid 拒绝和 legacy 防竞态，不把新记录放回旧 scheduler。
- 恢复完整原始历史、固定 workflow/null、当前 referencePlan；本次独立明确批准才切换草案阶段。完整文件集合重新授权。
- 明确解决 typed 裸值澄清的可恢复辅助视图、contract 与 lineage 身份；不能用历史中的“确认”或附件批准执行，也不能把衍生字段伪装成用户原话。
- 将 Task 1 接到实际 reply；建议结果持久化和 WS schema 同步增加轮次保护。补真实 router 行为测试。

## Task 3：首次创建、客户端及组合门禁

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
