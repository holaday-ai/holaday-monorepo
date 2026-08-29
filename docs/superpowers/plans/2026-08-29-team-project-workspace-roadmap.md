# Holaday Team Project Workspace Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的团队项目空间总体设计拆成五个可独立开发、验证、发布和回滚的阶段，并明确阶段之间不可跨越的上线门槛。

**Architecture:** 采用方案乙双核心：Orchestrator 内的协作核心管理组织、项目、任务和报告；独立收益结算核心管理收益积分、资金、归属和出款。两个核心只通过事务性 outbox/inbox 事件连接。阶段一和阶段二不创建真实资金负债，阶段三只跑内部影子账本，阶段四在合规与渠道前置全部书面通过后才开放真实资金。

**Tech Stack:** TypeScript、Node.js、tRPC、Drizzle ORM、MySQL、React 18、Vite、Vitest、pnpm、现有 Holaday 部署与生产验证脚本。

**Spec:** `docs/superpowers/specs/2026-08-29-team-project-workspace-design.md`

## Global Constraints

- 保留现有个人项目；不自动把个人项目转换为团队项目。
- 组织是服务端租户边界；任何客户端 `organizationId`、`projectId` 都必须重新鉴权。
- 不建设聊天、在线时长、键鼠、摄像头、私人消息或情绪监控。
- Holaday 只能整理证据和提出建议，不能自动作出人事处罚、劳动争议或奖金扣回决定。
- `Holaday 通用积分` 与 `Holaday 收益积分` 永不兑换、永不共用账本或余额字段。
- 阶段一、二不得写入现有 Partner Ledger、提现或 `cn-payment` 资金能力。
- 阶段三只允许内部白名单与沙箱/影子事件，不开放真实充值和提现承诺。
- 阶段四缺少任一书面合规、财税、渠道、隐私、对账前置时必须停止，不以产品命名规避监管。
- 每个阶段使用独立 migration、功能开关、PR、部署和生产验收；资金类迁移只能追加，不能删除历史流水。
- 每阶段先写失败测试，再写最小实现；每个可验证小任务单独提交。
- 不触碰已延期的 DivineAPI Translator/OpenAI Key 配置。

---

## Stage Plan Index

### Stage 1 — Organization and Team Project Foundation

**Detailed plan:** `docs/superpowers/plans/2026-08-29-team-project-workspace-phase1-foundation.md`

**Scope**

- 组织、组织成员、组织角色、直属上级、邀请、项目成员。
- 个人项目与团队项目并存的兼容模型。
- 项目空间外壳、个人/团队分区、成员入口与权限化操作。
- 全局关闭 + 用户白名单灰度，生产默认关闭。

**Exit gate**

- 跨组织、跨项目、已退出成员和伪造资源 ID 的读写全部被拒绝。
- 原 `projects.list/create/rename/delete` 个人项目测试与现有任务归组行为保持通过。
- 数据库迁移可重复执行，`db:verify` 能识别新增表列索引。
- 白名单外用户的 UI 和 API 均保持旧行为；关闭功能开关可立即停止新团队操作。
- 内部测试组织完成创建、邀请、加入、建团队项目、移除成员和旧个人项目回归。

### Stage 2 — Task Lifecycle, Acceptance and Arbitration

**Plan file to create after Stage 1 production gate:** `docs/superpowers/plans/2026-08-29-team-project-workspace-phase2-task-acceptance.md`

**Scope**

- 团队任务、负责人/协作者、指派、认领、里程碑、依赖和阻塞。
- 验收合约版本、提交、评审、最多两轮返工、申诉和无利益冲突仲裁。
- Holaday 证据包、AI 贡献记录和交付预检。
- 事务性任务事件，明确组织、操作者、合约版本和幂等键。

**Exit gate**

- 合法状态迁移、非法跳转、并发提交、重复评审和过期审批全部有确定性测试。
- `submitted_on_time` 与 `accepted` 分开记录和展示。
- 驳回缺少标准编号、证据、修改要求或新期限时服务端拒绝。
- 范围变更生成新合约版本，不覆盖领取时版本；执行人未确认时不能生效。
- Holaday 建议不会直接改变人事、处罚或奖励状态。

### Stage 3 — Earnings Ledger Shadow Mode

**Plan file to create only after Stage 2 production gate and finance-domain review:** `docs/superpowers/plans/2026-08-29-team-project-workspace-phase3-earnings-shadow-ledger.md`

**Scope**

- 独立收益账户、lot、双重记账流水、奖励预留、释放、归属和争议冻结。
- 协作核心 transactional outbox 与结算核心 inbox；端到端幂等。
- 项目奖励预算和员工收益页面仅显示“内部测试/不可提现”。
- 沙箱资金事件或内部白名单影子事件，不接真实外部充值。

**Exit gate**

- 每笔事件都满足借贷平衡与资金守恒，重复、乱序和重试不重复发奖。
- 通用积分和收益积分在表、服务、API、文案、图标和权限上完全隔离。
- 账本修正只追加反向流水；任何测试均不直接更新历史金额。
- 人工对账、故障注入、恢复和审计导出通过。
- 对外页面没有“可提现”“到账”等真实资金承诺。

### Stage 4 — Real Funding and Multi-channel Payout

**Plan file to create only when every compliance prerequisite has written evidence:** `docs/superpowers/plans/2026-08-29-team-project-workspace-phase4-funding-payout.md`

**Required written prerequisites**

- 针对 Holaday 具体合同与资金流的支付合规法律意见。
- 收益积分税务口径、代扣代缴、发票/凭证和企业账务方案。
- 奖励资金专户或被确认等效的资金隔离安排。
- 银行、微信、支付宝商户转账/代发权限和真实场景准入。
- KYC、收款信息、数据保留、跨境与隐私影响评估。
- 三方对账、渠道余额补充、失败补偿、退款和灾难回滚演练。

**Scope after prerequisites pass**

- 真实奖励资金充值、到账确认、等额收益积分发行。
- 结算日、税费、限额、冷静期、风控和双人审批。
- 银行、微信、支付宝渠道适配器和统一 payout 状态机。
- 奖励专户、出款通道和不可变账本三方对账。

**Exit gate**

- 生产小额白名单完成成功、失败、用户确认、超时、退款和回单全路径。
- 渠道受理不被标记为 `paid`；只有渠道终态或对账确认能完成付款。
- 余额不足、渠道不足或对账差异自动阻断新发行和新出款。
- 任意个人对个人转账、充值提现套利和通用积分兑换路径均不存在。

### Stage 5 — Reports and Organization Insights

**Plan file to create after Stage 2 events are stable and Stage 3 data boundaries are fixed:** `docs/superpowers/plans/2026-08-29-team-project-workspace-phase5-reports-insights.md`

**Scope**

- 任务、项目、个人成长和组织四层报告。
- 严重事件提醒、周报、里程碑复盘、终期总结。
- 员工完整个人视图、主管工作视图、事实更正和版本追踪。
- AI 投入产出、证据覆盖和不确定性说明。

**Exit gate**

- 报告可从任务事件、合约版本和证据绑定重建。
- 主管视图不含私人消息、情绪人格、健康家庭或无业务必要的在线指标。
- AI 建议不自动触发晋升、降职、处罚、解雇或奖励扣回。
- 人工抽样准确率、字段级权限和敏感数据导出测试通过。

---

## Cross-stage Delivery Rules

- [ ] 每阶段开始前，从 `origin/main` 创建独立 `codex/` worktree，先记录主工作区状态并保护无关未提交内容。
- [ ] 每阶段创建一份详细实施计划，列出精确文件、测试、命令、预期输出、迁移、灰度和回滚。
- [ ] 每个 PR 只跨一个阶段或一个可回滚垂直切片；不得把协作、账本和出款混成一个 PR。
- [ ] PR 合并前执行目标单测、包级全测、typecheck、build、`git diff --check` 和迁移契约测试。
- [ ] 生产部署前记录现有健康基线、功能开关、迁移版本和回滚目标。
- [ ] 部署后用白名单账户验证成功路径、权限拒绝路径和旧功能回归；不使用真实员工个人数据。
- [ ] 若生产验证失败，先关闭功能开关；数据库只做向前修复，不删除审计、任务或资金事实。
- [ ] 只有当前阶段上线条件全部满足，才编写和执行下一阶段详细计划。

