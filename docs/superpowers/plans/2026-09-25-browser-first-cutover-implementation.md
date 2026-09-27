# 浏览器首次停机切换与支付放行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划推荐 Native：同一执行者串行完成，整项结束做一次独立审查。

**Goal:** 补齐旧版首次停机引导和可核验的支付 readiness，在隔离环境完成整项演练，交付可供批准的生产切换清单。

**Architecture:** 首次引导单独识别旧进程和写入入口，不伪造维护协议；物理停止后复用现有候选迁移、关闭启动和精确开放流程。支付只增加只读核查及已有失败/重投语义的验证，不改结算与权益规则。生产缺证据时报告阻塞，不以测试替代事实。

**Tech Stack:** 现有 Node.js 22 生产运行时、pnpm、ESM 运维脚本、TypeScript/Vitest、Node test、Python pidfd、MySQL、现有 PM2/nginx 部署环境；不新增产品依赖。

**Spec:** [用户已批准设计](../specs/2026-09-25-browser-first-cutover-design.md)。执行者必须完整阅读本文与设计，不能只读其中一个任务。

**2026-09-26 批准修订：** 首次 PM2 托管对象采用独立的定向停止适配器，接受已核对的管理器信号和超时强杀。须先隔离入口、核清未结工作，核对管理器/应用/完整进程树/版本/超时及重启来源，按唯一 pm_id 定向停止；不停止 daemon、不使用全局名称操作。未托管对象仍由 pidfd 固定身份后只发 SIGTERM，无数字 PID 回退。普通维护停止不变。此修订仅授权本地实施和隔离测试。

## Global Constraints

2026-09-27 最新范围覆盖：用户明确要求 PayPal 全部延期（登录失败），随后回复“可以”批准唯一旧Sandbox测试单作为“未核验、上线后处理”，不再阻塞本次发布。不得继续浏览、登录或调用PayPal API；下方“历史查询保持”指保留产品实现，不是当前执行授权。仅允许部署本地数据库只读比对该记录是否仍匹配已批准指纹，不恢复支付方查询。具体指纹和保护条件见设计最新修订；不得改订单或把unknown伪装已核验。单条内部explorer任务取消已执行并读回验证，不外推为其他业务数据清理许可。

2026-09-26 已确认的PayPal收口：本次候选默认关闭新PayPal支付，`PAYPAL_CHECKOUT_ENABLED=false`（缺失也关闭）。服务端options隐藏SDK配置，新套餐和加量包create入口在DB/provider副作用之前拒绝；复用现有前端隐藏逻辑。历史capture/回调/查询保持，不修改结算或权益规则。PayPal新支付开通和体验验收延后；历史订单/环境身份/恢复风险仍保留，不能过滤旧记录或让证据采集器伪报通过。上线配置核对须确认新开关关闭，不能用`PAYPAL_ENABLED=false`替代。本修订不等于Task4–6完成。

2026-09-26 最新执行授权：用户离开期间允许自主安排当前大项的实施、PR、必要合并、部署与验证。下方原“仅本地/需另批部署”措辞为历史授权边界，已由本次授权取代；验收、真实证据和业务数据保护条件不变。仍不能把未完成实现或不可达主机判作放行，也不扩大到历史任务/订单自动清理。

- 后续用户已批准生产者优先顺序：`orders_fenced → legacy_settled → producers_stopped → all_fenced → stopped`。新增窄范围 `stopProducers`，仅在入口隔离、在途及外部工作已核清后停止批准的生产者。生产者停止回执与全局 stopped 分离；全局停止只跳过经本次实测退出的生产者，不重复发送停止信号、不凭 JSON 宣称成功。普通发布规则不变；仅本地实现/隔离测试。

- “普通升级仍走现有排空协议。首次引导必须显式选择，绝不在普通升级检查失败后自动降级进入。”
- “不包含：支付账本重构、持久回调队列、新浏览器池、UI 优化、模型路由扩张、额度修改、自动清理历史任务/订单。”
- “报告有效期最多 60 秒，过期、时钟倒退、目标变化均拒绝。”
- “目录属应用 UID、0700，状态文件 0600”；当前候选应用 UID=998，不能将应用以 root 启动。
- “不新增‘仅支付开放’运行模式”；已有 open 会恢复内部生产者，不允许先 open 再完成开放前检查。
- 不修改支付结算、权益与额度规则，不清任务/订单，不自动重放 SQL，不覆盖 dirty 状态或残留锁，不自动回启旧代码。
- 现有全部 61 个编号 SQL 与 runner 必须入摘要；0042 对支付完成时间的影响需单独核对，不能只验证新增列。
- 本计划执行授权不等于生产变更授权；生产 SSH 写入、停服务、SQL、付款、退款、扩展安装、push/merge/deploy 不在本地实施步骤中。
- 既有源码验收 `b86af4e9` 是历史结果；本计划重新修改后必须重新验收。不得复用旧测试数量宣称新分支通过。

## Review Focus

1. 检查期间订单集合改变、缺页或查询超时：拒绝不完整的核对结果，不能把新付款漏出窗口清单。归属 Task 2、5。
2. 旧进程由 PM2/systemd/cron 重新拉起或 PID 被复用：不能误杀新进程，也不能在旧实例回生时迁移。归属 Task 3、4。
3. 报告读到一半被替换、时钟倒退或切错商户环境：拒绝旧事实，即使文件是 root 所有。归属 Task 1、2。
4. open 实际成功但 ACK 丢失，或外部入口恢复失败：核对同一实例，关闭接单并保留阶段，不恢复旧数据库。归属 Task 4、6。
5. 恢复备份可读但遗漏历史表/触发器/事件，或旧 SQL 改写时间：不能以新列存在代替完整恢复验证。归属 Task 5、6。

## 执行基线、依赖与结束点

- 工作树：`/Users/yaleiqi/.codex/worktrees/browser-release-candidate/holaday-monorepo`。
- 分支：`codex/browser-release-candidate-20260925`；本计划前 HEAD `0fdc0a0a`。
- 开始前核对 `git status --short`、HEAD 和现有依赖；不覆盖他人变更，不另建重复工作树，不安装额外生产依赖。
- 如 PATH 缺 Node，使用已有 `/Users/yaleiqi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`。本机是 Mac，Linux 专项必须在隔离 Linux 环境执行，Mac 跳过不是通过。
- 顺序：Task 1 → 2 → 3 → 4 → 5 → 6。任务是内部验收单元，不要求用户逐小项回复。
- 结束点：本地实现、隔离验收、独立审查、候选清单更新。外部证据不足则明确列出；只有部署决策清单获得另行批准，才进入生产切换。

## 文件职责图

| 职责 | 创建/修改位置 | 不做什么 |
| --- | --- | --- |
| 证据读取与判定 | 新增 `apps/orchestrator/src/execution/ordinary-maintenance-services.ts`；修改 readiness 及其 CLI | 不持有商户/SSH 凭据，不信任手填 true |
| 主机/支付只读采集 | 新增 `scripts/browser-cutover-evidence.mjs`、`apps/cn-payment/scripts/payment-cutover-query.ts`、`apps/orchestrator/scripts/paypal-cutover-query.ts` | 不扣款、不补结算、不改订单 |
| 旧版停止与互斥记录 | 新增 `scripts/browser-first-cutover-runtime.mjs`、`scripts/browser-first-cutover-signal.py`；扩展现有 journal | 不放宽普通 runtime/signal 的旧路径拒绝 |
| 首次切换编排 | 新增 `scripts/browser-first-cutover-host.mjs`、`scripts/browser-first-cutover-transition.mjs`、`scripts/browser-maintenance-release-tail.mjs`、`scripts/deploy-browser-first-cutover.sh`；有限修改现有 host/transition | 不自动从普通发布回退，不复制整套发布引擎 |
| 入口隔离与恢复验证 | 新增 `scripts/browser-first-cutover-fence.mjs`、`scripts/browser-first-cutover-backup.mjs` | 不接受任意 shell 命令，不修改无关站点/数据库 |
| 综合证据 | 各模块同名测试，新增 `scripts/browser-first-cutover.integration.test.mjs` 与 `scripts/browser-first-cutover.qa.Dockerfile`；新增隔离 MySQL 测试和验收文档 | 不把合成支付回调当支付方真实重投 |

新文件只有在对应任务实现时创建；本轮只保存计划。以下接口均为拟实现接口，不代表已经存在。

## Task 1：让 readiness 能消费真实、有时效的证据

**Files**

- Create: `apps/orchestrator/src/execution/ordinary-maintenance-services.ts`
- Test: `apps/orchestrator/src/execution/ordinary-maintenance-services.test.ts`
- Modify/Test: `apps/orchestrator/src/execution/ordinary-maintenance-readiness.ts`、同名 `.test.ts`
- Modify/Test: `apps/orchestrator/src/application-entry.ts`、同名 `.test.ts`（真实 open 的进程内 readiness 调用，不能只修 CLI）
- Modify: `apps/orchestrator/scripts/browser-maintenance-readiness.ts`
- Test: `apps/orchestrator/scripts/browser-maintenance-readiness.test.ts`

**Interfaces**

```ts
type CutoverStage = 'prepare' | 'preopen';
type CutoverBinding = {
  attempt: string; candidate: string; configDigest: string;
  migrationDigest: string; inventoryDigest: string;
};
type ServicesContext = CutoverBinding & {
  stage: CutoverStage; nowMs: number;
  identity?: { candidate: string; bootId: string };
};
type EvidenceSource = {
  kind: 'host' | 'database' | 'provider-query' | 'provider-rehearsal';
  digest: string; observedAtMs: number; targetDigest: string;
};
type CutoverEvidence = CutoverBinding & {
  schemaVersion: 1; stage: CutoverStage; observedAtMs: number;
  maintenanceEndsAtMs: number; reconcileByMs: number; operatorRef: string;
  identity?: { candidate: string; bootId: string };
  sources: EvidenceSource[];
  host: { inventoryDigest: string; unknownWriters: number;
    unsettledWork: number; phase: 'prepared' | 'fenced-stopped' };
  payments: { scopeDigest: string; queriedScopeDigest: string;
    unresolved: number; validUnpaid: number; followupDigest: string;
    recovery: 'retry-proven' | 'query-and-existing-settlement-proven';
    recoveryUntilMs: number; rehearsalDigest: string };
};
// 无默认批准 context，无环境 success flag。
export function validateServicesEvidence(value: unknown, context: ServicesContext): void;
export function readServicesEvidence(context: ServicesContext): Promise<CutoverEvidence>;
export function readActiveServicesContext(
  identity: { candidate: string; bootId: string }, nowMs: number,
): Promise<ServicesContext>;
```

物理路径固定为 `/var/lib/holaday-deploy/evidence/<attempt>.json`，attempt 严格 UUID；父目录 root 所有、应用组只读可遍历（0750），文件 root:应用组 0640，单链接、规范路径、不追随链接、最多 256 KiB。JSON 拒绝额外字段与非有限/负计数。report 只是摘要，原始证据由 Task 2 独立生成并绑定摘要。

同目录 `active.json` 是 root 原子发布的当前 attempt/binding/preopen 身份索引，使用相同读取保护，且与报告及现行互斥操作记录绑定。`readActiveServicesContext` 在每次 verifyReady 时读取，不在启动时缓存；新进程关闭启动时不要求尚未生成的 preopen 证据。索引身份与原进程 identity 不同、索引/报告读取期间变更或来源记录无法核实时拒绝。索引不是人工批准开关；应用不读取 root 私密 journal，由采集器从实际持有的操作记录生成最小只读绑定摘要。

- [ ] **1. 写 RED 用例。** 从合法测试对象派生错误，不在生产代码提供 fixture 或默认成功分支。最小非法输入断言：

```ts
import { expect, it } from 'vitest';
import { validateServicesEvidence } from './ordinary-maintenance-services.js';
it('rejects operator boolean and absent evidence', () => {
  const context = { attempt: '11111111-1111-4111-8111-111111111111',
    candidate: 'a'.repeat(40), configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64), inventoryDigest: 'd'.repeat(64),
    stage: 'prepare' as const, nowMs: 100_000 };
  expect(() => validateServicesEvidence({ verified: true }, context))
    .toThrow('MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN');
});
```

- [ ] **2. 跑 RED。** `pnpm --filter @holaday/orchestrator exec vitest run src/execution/ordinary-maintenance-services.test.ts`。先证实缺失模块；随后补合法对象用例，分别破坏 observedAt（61 秒/未来）、目标摘要、商户 targetDigest、阶段、bootId、订单集合摘要、源类型、unresolved 与窗口，确保每一条能独立 RED。
- [ ] **3. 最小实现校验与安全读取。** 校验顺序固定：严格结构 → binding → 时间 → source 完整性 → host → payment → preopen 身份。付款核对源必须与数据库集合摘要一致；prepare 不要求新 bootId，preopen 要求同一新候选及 fenced-stopped。用 O_NOFOLLOW/O_NONBLOCK、fstat 前后及路径 inode 对比防换文件，校验 UTF-8 与长度；不直接 `JSON.parse(readFile(path))` 后放行。

```ts
const age = context.nowMs - report.observedAtMs;
if (!Number.isFinite(age) || age < 0 || age > 60_000)
  throw new Error('MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN');
if (report.payments.scopeDigest !== report.payments.queriedScopeDigest ||
    report.payments.unresolved !== 0 || report.host.unknownWriters !== 0 ||
    report.host.unsettledWork !== 0)
  throw new Error('MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN');
```

- [ ] **4. 接入 CLI 和既有 readiness。** 新 CLI 严格接受 `services <attempt> <candidate> <configDigest> <migrationDigest> <inventoryDigest>` 与 `verify <同上> <bootId>`；旧参数缺少证据时继续拒绝。`checkMaintenanceServices(context)` 调用安全读取与校验；`verifyProductionMaintenanceReadiness(identity, expectedIdentity, context)` 保留 schema→records→services 顺序。prepare 不读取不存在的新状态；verify 必须读实际 state。所有 CLI 导入仍无 DB/网络副作用，数据库连接 finally 关闭。

`application-entry.ts` 的原 `verifyReady(identity)` 同步接入：调用 `readActiveServicesContext(identity, Date.now())` 后传入第三参数。追加真实 open 拒绝缺索引/旧 boot、通过新证据的测试；既有缺参数测试保留为运行时拒绝用例，不因为 TypeScript 新参数而删掉缺证据测试。
- [ ] **5. 跑 GREEN 与回归。** 上述新测试、`ordinary-maintenance-readiness.test.ts`、新 CLI 测试；增加读取中换 inode、坏权限、目录可写、hardlink、oversized、旧 report 复用测试。`pnpm --filter @holaday/orchestrator typecheck` 和 build 均须通过。
- [ ] **6. 本地提交。** 仅暂存本任务文件：`feat(browser): validate release-bound maintenance service evidence`。

## Task 2：只读采集支付与主机事实，不改结算

**Files**

- Create/Test: `scripts/browser-cutover-evidence.mjs`、`scripts/browser-cutover-evidence.test.mjs`
- Create/Test: `apps/cn-payment/scripts/payment-cutover-query.ts`、同名 `.test.ts`
- Create/Test: `apps/orchestrator/scripts/paypal-cutover-query.ts`、同名 `.test.ts`
- Read/reuse: `apps/cn-payment/src/alipay.ts`、`wechat-pay.ts`、`sync-to-vultr.ts`；`apps/orchestrator/src/payment` 现有只读认证配置，不改结算函数。

**Interfaces**

```ts
type PaymentObservation = {
  provider: 'alipay' | 'wechat' | 'paypal'; orderRef: string;
  merchantDigest: string; environment: 'sandbox' | 'production';
  observedAtMs: number; rawDigest: string;
  state: 'settled' | 'closed' | 'unpaid-valid' | 'paid-unsettled' | 'unknown';
};
// 输入私密订单号和既有只读认证参数；输出脱敏摘要，原文留私密证据。
queryPaymentOrder(input: unknown): Promise<PaymentObservation>;
// MJS：io 是固定命名的事实读取接口，不接受报告或命令字符串当作结果。
collectCutoverEvidence({binding, stage, identity, window}, io): Promise<CutoverEvidence>;
// io: readHostInventory(), readDatabaseScope(), queryOrders(scope),
//     readRehearsalArtifacts(), readFenceState(), now(), publishPrivate(report).
```

- [ ] **1. 建立 RED：陈旧不等于关闭。** 查询适配器注入 spy transport，unknown/超时返回 unknown 或抛稳定错误；绝不返回 closed。校验金额、币种、商户、订单映射及已入账状态，不只看 provider 的大类状态。

```ts
it('does not capture an order to inspect it', async () => {
  const sent: Array<{ method: string; path: string }> = [];
  const transport = async (request: { method: string; path: string }) => {
    sent.push(request); throw new Error('TEST_NETWORK_UNAVAILABLE');
  };
  await expect(queryPaymentOrder({provider: 'paypal', orderId: 'TESTORDER',
    environment: 'sandbox', transport})).rejects.toThrow();
  expect(sent.some(r => r.path.endsWith('/capture'))).toBe(false);
});
```

- [ ] **2. 运行 RED。** `pnpm --filter @holaday/cn-payment exec vitest run scripts/payment-cutover-query.test.ts`；`pnpm --filter @holaday/orchestrator exec vitest run scripts/paypal-cutover-query.test.ts`；`node --test scripts/browser-cutover-evidence.test.mjs`。
- [ ] **3. 实现窄范围查询。** 使用现有 SDK 的签名/验签能力，只允许订单查询语义；PayPal 仅 OAuth 获取 token 和 GET 订单，不调用 capture。微信只允许商户订单查询；支付宝仅 `alipay.trade.query`，不得把 POST 一律等同写业务，也不得允许任意 SDK method。实现前对照实际 SDK 类型及当前商户产品官方说明，不匹配则报 `MAINTENANCE_PAYMENT_QUERY_UNSUPPORTED`，不猜响应字段或改生产配置。

只读接口依据：[PayPal Show order details](https://developer.paypal.com/api/rest/integration/orders-api/api-use-cases/advanced/)、[微信官方 SDK 查询接口](https://github.com/wechatpay-apiv3/wechatpay-go/blob/main/docs/payments/app/README.md)。支付宝国内产品与网关需在实施时核对官方 `alipay.trade.query` 文档；不能拿 Antom 国际网关说明替换现有国内配置。

- [ ] **4. 实现事实采集与集合封口。** 只读事务分页读取 pending、窗口涉及订单和未结工作；最多 100 页×100 条，超出拒绝不截断。查询前后重读集合及相关字段摘要，变化则拒绝本次报告并重新完整采集；没有后台无限重试。逐条核对 provider 结果，未查到/签名失败/部分成功均保留 unknown。

```js
const before = await io.readDatabaseScope();
const observations = await io.queryOrders(before);
const after = await io.readDatabaseScope();
if (before.digest !== after.digest || observations.length !== before.orders.length)
  throw new Error('MAINTENANCE_PAYMENT_SCOPE_CHANGED');
```

主机清单从实际 `/proc`、PM2、启动来源、监听和有效代理配置采集，覆盖 4001/4002、4010/4011 与独立 worker。指定 env 变量不存在不等于无写入能力；未经核清的进程/路由计入 unknownWriters。完整私密快照本地保存，脱敏摘要才进入报告；不输出密码、订单号、用户名或任务正文。每个动态 source 自身的时间也必须满足 60 秒上限，不能把旧观测装进一个刚生成的报告；支付演练历史 source 以配置绑定单独校验。
- [ ] **5. 生产报告只能来自实采。** report root 0600 临时写入、fsync、调整组读权限、原子发布并 fsync 父目录；与当前 journal attempt、配置和清单绑定。历史重投证据按代码/配置/商户环境关联，动态证据重新采集，不能只更新 observedAt。JSON fixture 只允许在测试依赖注入使用，不提供生产 `--assume-verified` 或直接上传成功报告入口。
- [ ] **6. GREEN 与本地提交。** 覆盖分页缺失、重复订单、多商户、货币不匹配、4011 未核清、回调查询期间改变集合、证据缺失、输出脱敏及 source 漂移；跑上述三组测试。提交 `feat(browser): collect read-only payment and writer evidence`。

## Task 3：首次旧版停止、隔离与状态引导

**Files**

- Create/Test: `scripts/browser-first-cutover-runtime.mjs`、同名 `.test.mjs`
- Create/Test: `scripts/browser-first-cutover-signal.py`、`scripts/browser-first-cutover-signal.test.py`
- Create/Test: `scripts/browser-first-cutover-fence.mjs`、同名 `.test.mjs`
- Modify/Test: `scripts/browser-maintenance-journal.mjs`、同名 `.test.mjs`
- Read, 不放宽: `scripts/browser-maintenance-runtime.mjs`、`browser-maintenance-signal.py`、应用 `ordinary-maintenance-store.ts`

**Interfaces**

```js
// target 包含 host、pid、start、四项 UID、exe、cwd、argvDigest、managerIdentity。
captureLegacyRuntime({inventory, approvedTargets}, io); // 返回匹配的完整进程树，否则抛错
retireLegacyRuntime({captured, deadlineMs}, io); // 精确停止，实际退出后返回
initializeFirstMaintenanceState({candidate, attempt, stoppedEvidence}, io);
applyCutoverFence({inventoryDigest, stage}, io); // stage: orders | all-writers
verifyCutoverFence({inventoryDigest, stage}, io);
restoreCutoverIngress({inventoryDigest, identity}, io);
// journal 扩展 discriminated union；旧调用保持不变。
acquireReleaseJournal(directory, metadata, io);
// metadata: 旧版 {oldIdentity,...} 或 {kind:'first-cutover',legacyDigest,...}
// 两种均占用同一 directory/release.lock；不能生成假的 oldIdentity。
```

- [ ] **1. 写 RED：首次/普通发布互斥，PID 变化不能停。** 使用真实临时 journal 与 fake signal spy；同一路径第二次 acquire 抛 `MAINTENANCE_RELEASE_LOCKED`。首次 metadata 不含 oldIdentity；对普通 metadata 缺 oldIdentity 仍抛错。

```js
test('first-cutover never relaxes normal runtime proof', async () => {
  await assert.rejects(retireMaintenanceRuntime({
    identity: {candidate:'a'.repeat(40),bootId:'b'.repeat(32)},
    main: {pid:100,start:'123',uid:998,command:'main',autorestart:false,
      cwd:'/opt/holaday-monorepo/apps/orchestrator'},
    effects: {}, deadlineMs:1000,
  }), /MAINTENANCE_STOP_INPUT/);
});
```

- [ ] **2. 跑 RED。** `node --test scripts/browser-first-cutover-runtime.test.mjs scripts/browser-first-cutover-fence.test.mjs scripts/browser-maintenance-journal.test.mjs`；`python3 scripts/browser-first-cutover-signal.test.py`。
- [ ] **3. 实现精确进程适配。** 首次 helper 仅接受批准清单、固定旧根路径及已观测 exec/argv/UID/start；未托管对象 pidfd 打开后重新核对完整身份，只 SIGTERM，无数字 PID kill 回退。PM2 对象按上述 2026-09-26 修订实施独立定向停止；逐一核对名称、唯一 pm_id、配置、管理器和进程树身份后操作，验证 stopped 与无回生。未知启动器拒绝，不接受任意命令模板、不自动停整个 PM2 daemon。4011 属独立网关适配的批准对象，不借用 main/worker 身份伪装。
- [ ] **4. 实现两阶段入口隔离。** 只对实采并批准的 nginx server/location 与服务目标生成临时配置；orders 阶段拒绝新任务/订单但允许既有回调；all-writers 阶段业务路由统一非成功，仅保留健康检查。修改前校验原摘要、备份原文件，`nginx -t` 通过才 reload；配置恢复也须匹配本次生成摘要，发现其他修改不覆盖。无效签名测试请求用于验证维护拒绝，不向生产发送有效支付通知。WS 旧连接、内部直连和生产者必须单独停止/隔离并证明，不将 HTTP 503 视为全局屏障。

此模块在本地 fixture nginx 配置和隔离容器实现验证；真实站点路径/启动来源必须由采集结果固定进部署清单，不能在计划中猜测。未识别入口使 verify 返回拒绝，不能形成“默认全覆盖”。
- [ ] **5. 实现首次初始化。** 仅在互斥锁持有、旧进程无存活/无回生、写入已隔离、未结工作为零且状态目录不存在时创建；原子创建 0700 目录和 0600 canonical state，应用 UID=998。用独立随机 32hex 引导种子并记入 journal，mode=closed、needsReconciliation=false；种子不是旧进程证明。半写入/已存在目录/锁/dirty 均拒绝覆盖。后续应用产生不同 bootId。
- [ ] **6. GREEN 和本地提交。** 覆盖 PID 重用、uid/exe/argv/cwd 改变、停止超时、PM2 回生、孤儿子进程、端口仍被占、未知 systemd/cron、未结 running、状态半写入、原配置漂移。原普通 signal/runtime 测试必须全部保留通过。提交 `feat(browser): add explicit legacy cutover isolation and stop`。

## Task 4：接上现有发布后半段，完成可执行但不自动部署的流程

2026-09-26 已批准补充：首次路径先私密备份，再定向移除批准旧注册及主/备用PM2启动条目，禁止全局save/delete/kill，不影响无关服务。文件部分由 `removeSavedStartupEntries({binding,files,maintenanceEndsAtMs},io)` 实现；files固定为dump.pm2及dump.pm2.bak，各自有文件摘要和批准条目的原始对象字节摘要，缺失文件显式为null，不从另一份复制。主机适配器必须提供受保护批准清单、实际共享journal、已隔离/工作核清/并发配置写入排除；本函数不自行证明这些现场条件。journal在producers_stopped意图阶段记录独立startup子事件；现场注册备份、唯一id删除和回生验证仍须接入完整host，不得以文件处理成功代替进程退出。

**Files**

- Create/Test: `scripts/browser-maintenance-release-tail.mjs`、同名 `.test.mjs`
- Create/Test: `scripts/browser-first-cutover-startup.mjs`、同名 `.test.mjs`；Modify/Test: `scripts/browser-maintenance-journal.mjs`、同名测试（首次startup子事件）
- Modify/Test: `scripts/browser-maintenance-transition.mjs`、`browser-maintenance-host.mjs` 及同名测试
- Create/Test: `scripts/browser-first-cutover-transition.mjs`、`browser-first-cutover-host.mjs` 及同名测试
- Create/Test: `scripts/deploy-browser-first-cutover.sh`、`scripts/deploy-browser-first-cutover.test.mjs`
- Modify/Test: `scripts/deploy-orchestrator.sh`、`scripts/deploy-browser-maintenance.test.mjs`（仅正常路径传入本次证据参数，保留 legacy 拒绝）

**Interfaces**

```js
finishStoppedRelease({candidate, previousBootId, adapter});
// 共用 adapter: persist, migrate, start, verify, open, status, close,
// beforeOpen, afterOpen, resumeWorker；正常发布显式提供适当检查，不能默认为成功。
performFirstCutover({candidate, adapter, window, clock});
// window: maintenanceEndsAtMs, reconcileByMs, operatorRef；clock 默认 Date.now。
// 首次前半 adapter: preflight, stage, fenceOrders, settleLegacy,
// stopProducers, fenceAll, stopLegacy, backupAndRestoreCheck, initializeState, persist,
// 其余复用 finishStoppedRelease；holdMaintenance({phase,identity,errorCode})
// 保留现有隔离并尝试关闭已启动的精确实例，返回 {closeAcknowledged:boolean}。
createFirstCutoverHostAdapter(options, io);
// options: branch,candidate,configDigest,migrationDigest,inventoryDigest,attempt,
//          maintenanceEndsAtMs,reconcileByMs；所有值来自受保护批准清单。
```

- [ ] **1. RED：记录先于副作用，开放失败不回旧版。** 在新 transition 测试内定义全方法 spy adapter（每个方法 push 自身名称；start 返回固定 candidate/newBoot；status 返回协议1 serving）。让 migrate 抛错，断言事件数组含 `phase:migration_started` 且随后无 start/open；禁止出现 rollback/restartOld。另测 open 抛错但 status 为同实例 serving 时只调用一次 open。

```js
const mark = async (phase, action) => {
  await adapter.persist(phase, {candidate});
  return action();
};
// 实现必须先 persist 后 action；persist 失败保持维护，不能执行 action。
await mark('migration_started', () => adapter.migrate(candidate));
```

- [ ] **2. 跑 RED。** `node --test scripts/browser-first-cutover-transition.test.mjs scripts/browser-first-cutover-host.test.mjs scripts/browser-maintenance-release-tail.test.mjs`。
- [ ] **3. 抽取已有后半流程并保持普通路径语义。** 只抽 migrate→关闭 start→verify→beforeOpen→open/status→afterOpen→worker，不更改普通 capability/receipt/stop 校验。same-instance open 仍要求 serving、needsReconciliation=true、idle=false；丢 ACK 只查询，不盲重试。beforeOpen 重采证据，afterOpen 才恢复入口；失败 close 当前实例并记录不确定性。

两条路径都先完成无副作用的身份/配置检查，再取得同一主机互斥、建立真实 attempt，之后采集并发布绑定报告、调用 prepare readiness。普通路径生成 UUID；首次路径允许受保护批准清单预留 UUID，锁和新记录必须使用该值，记录以排他创建保证不重用或覆盖历史 attempt。CLI 自报 UUID 不构成批准，不接管或清除旧锁。此修正解决“执行前须批准同一 attempt，但持锁后才生成未知 attempt”的接口冲突。调整当前 host 中“readiness 在 acquire journal 之前”的顺序；任一步失败保留可核对阶段，不盗用他人锁或把上次报告改成当前报告。
- [ ] **4. 组装首次 host。** 阶段固定 `prepared → orders_fenced → legacy_settled → producers_stopped → all_fenced → stopped → backup_verified → migration_started → candidate_started → verified → opened → reconciled`。stage/build 在停机计时前完成；旧 checkout 只用作已核实来源，目标 detached SHA/分支可达性、配置与全迁移摘要必须一致；准备命令使用候选工具，不去调用旧源码不存在的 readiness。Task 3 初始化只在迁移后、candidate start 前执行。
- [ ] **5. 提供显式首次 shell 入口。** 无参数只打印用法并退出非零；默认模式仅检查/准备，不停机。真正执行需要受保护部署清单、与其匹配的 attempt 和明确 `--execute`。使用既有 SSH 凭据加载、主机指纹校验和 `execFile`/固定 argv，远端报错不重试。准备包仅装本次批准的工具与候选摘要，不替换运行中旧 checkout。原 `deploy-orchestrator.sh` 仍对 legacy 返回拒绝，不调用首次脚本。
- [ ] **6. 截止时间与恢复逻辑。** 每个新增不可逆阶段前核对绝对截止；构建/迁移执行中不因客户端超时强杀并重跑。超期保持维护，记录哪个动作可能已执行，输出核对责任；不得自动 `open`、清锁、恢复旧 DB。启动/开放后失败仍走现有准入关闭与真实工作归属，不制造 clean。
- [ ] **7. GREEN、回归与本地提交。** 新四组测试、全部 `scripts/browser-maintenance-*.test.mjs`、正常发布 shell 假 SSH 回归、`bash -n scripts/deploy-browser-first-cutover.sh scripts/deploy-orchestrator.sh`。提交 `feat(browser): compose first cutover with existing release lifecycle`。

## Task 5：支付回调与备份迁移的实际验收支撑

**Files**

- Modify/Test only: `apps/cn-payment/src/index.test.ts`、`sync-to-vultr.test.ts`、`apps/orchestrator/src/http.payment.test.ts`、`apps/orchestrator/src/partner/payment-confirm-service.test.ts`
- Create/Test: `scripts/browser-first-cutover-backup.mjs`、同名 `.test.mjs`
- Create: `apps/orchestrator/src/execution/ordinary-first-cutover.mysql.integration.test.ts`
- Create: `docs/superpowers/plans/2026-09-25-browser-first-cutover-payment-evidence.md`（记录结果，不预填通过）

**Interfaces**

```js
backupAndRestoreCheck({binding, sourceIdentity, isolatedTarget}, io);
// io: assertWritersStopped, exportDatabase, hashArtifact, restoreIsolated,
//     compareInventoryAndData, runApprovedMigrations, verifySchema, sealReceipt
// 返回 {attempt, backupDigest, databaseIdentityDigest, migrationDigest,
//       restoredAtMs, comparisonDigest}；没有 restored:true 旁路。
```

- [ ] **1. 补支付行为锁定测试。** 沿用 index.test 的路由捕获与 makeResponse helper，给普通和 partner confirm 分别注入 pending Promise / reject；在 Promise 完成前不得发送 success，失败只能返回非成功。同事件重投、不同顺序和重复调用的权益次数断言落在 orchestrator 普通及 partner 现有幂等路径测试，不能只断言网关发了两次 HTTP。既有实现正确时新增测试可直接 GREEN，不人为破坏代码制造 RED。

```ts
it('waits for the original settlement before acknowledging a success', async () => {
  let resolve!: (value: {ok:true}) => void;
  const settlement = new Promise<{ok:true}>(r => { resolve = r; });
  syncConfirmSpy.mockReturnValueOnce(settlement);
  wechatNotifySpy.mockResolvedValueOnce({outTradeNo:'pay_cutover',
    transactionId:'wx_cutover',amountCents:4900,tradeState:'SUCCESS',
    attach:JSON.stringify({kind:'subscription',userId:'usr_cn_test',
      planId:'pro',cycle:'monthly',isFirstMonth:true})});
  const handler = routes.get('POST /payment/wechat/notify');
  if (!handler) throw new Error('wechat notify route missing');
  const {response,state} = makeResponse();
  const pending = handler({headers:{},body:'{"signed":"payload"}'}, response);
  await vi.waitFor(() => expect(syncConfirmSpy).toHaveBeenCalled());
  expect(state.body).toBeUndefined();
  resolve({ok:true});
  await pending;
  expect(state.body).toEqual({code:'SUCCESS'});
});
```

执行 `pnpm --filter @holaday/cn-payment test` 与 `pnpm --filter @holaday/orchestrator exec vitest run src/http.payment.test.ts src/partner/payment-confirm-service.test.ts`；如发现结算规则本身缺陷，保存失败证据、停止相关放行并单独报告，不能超出“不改结算”范围暗修。
- [ ] **2. 写备份 RED 与最小实现。** 缺表/视图/触发器/事件、坏校验和、错误 DB 身份、支付时间未批准变化、迁移半程失败必须拒绝。源仍允许写时不导出最终备份。使用 argv 调用 mysqldump/mysql，凭据通过私密配置/管道，不进入命令行或日志；备份只落主机受保护目录并使用已批准加密设施，缺加密或隔离恢复目标时拒绝。恢复端显式隔离身份校验，绝不向 source 导入。

```js
await io.assertWritersStopped();
const artifact = await io.exportDatabase();
const backupDigest = await io.hashArtifact(artifact);
await io.restoreIsolated(artifact, isolatedTarget);
await io.compareInventoryAndData({sourceIdentity, isolatedTarget});
await io.runApprovedMigrations(isolatedTarget, binding.migrationDigest);
await io.verifySchema(isolatedTarget);
```

- [ ] **3. 真实 MySQL 隔离测试。** 沿用 CORE_MYSQL_INTEGRATION=1 和 `mysql://127.0.0.1:13316/` 管理连接守卫，随机唯一 `holaday_first_cutover_<hex>_integration` 库。构建旧结构合成数据：完成/失败/暂停任务、未知费用 NULL、历史 pending/completed、明确 completed_at。生成备份并恢复到另一个本例随机库，在恢复库执行批准全部 SQL，比较所有表结构、行数、关键金额/状态/时间和对象清单。导出/恢复/runner 子进程使用已清理环境和明确随机库 URL；runner 会主动读 dotenv，因此须在本例不含 `.env*` 的源码快照运行，不能仅靠清环境变量保证隔离。测试 finally 仅清理本例创建且验证过身份的库。
- [ ] **4. 跑 GREEN。** `node --test scripts/browser-first-cutover-backup.test.mjs`；显式开启隔离 MySQL 后执行 `pnpm --filter @holaday/orchestrator exec vitest run src/execution/ordinary-first-cutover.mysql.integration.test.ts`。未开启时的 skip 不计入验收。原 SQL 不改；0042 行为与批准预期不一致就保留阻塞。
- [ ] **5. 单列支付方外部证据。** 文档每条记录 provider/商户环境摘要、代码/配置摘要、原始事件摘要、维护拒绝应答、实际重投时间、恢复结算和重复事件结果。本计划默认只准备测试与核查工具；真实 sandbox 账号/事件须在已明确授权的环境执行，不能临时改生产回调地址。微信等若无适用 sandbox，不伪造实测；列明需另批的商户测试方式及费用。PayPal 模拟器不能替代当前 postback 验签链的真实 sandbox 事件。
- [ ] **6. 本地提交。** `test(browser): verify payment retry boundaries and cutover restore`。不得把外部阻塞写成通过，也不因此跳过可完成的其他本地测试。

## Task 6：整项演练、审查与部署前交付

**Files**

- Create: `scripts/browser-first-cutover.integration.test.mjs`、`scripts/browser-first-cutover.qa.Dockerfile`
- Modify: `docs/superpowers/plans/2026-09-25-browser-candidate-selection.json`（追加本项，不覆盖原来源）
- Create: `docs/superpowers/plans/2026-09-25-browser-first-cutover-verification.md`
- Create: `docs/superpowers/plans/2026-09-25-browser-first-cutover-deployment-checklist.md`

**Interfaces**

综合测试调用 `performFirstCutover` 与实际 host adapter；只将外部支付和公网连接替换成本例服务，不替换进程停止、状态文件、HTTP/WS 连接、journal 和数据库恢复为固定成功。验收结果按 `passed | failed | blocked | not-run` 输出，保留每项命令、退出码、日志与源码 SHA。

- [ ] **1. RED：真实旧版到新版。** 隔离 Linux 容器启动 Node22+PM2 合成旧主程序/worker，cwd 采用旧路径、UID998，合成 HTTP/WS 与支付网关只有测试凭据。注入各阶段失败，断言任务写入计数、pidfd 退出、端口、持久阶段与 open 次数。必须包含实际 Node argv/exe；不能复用仅 Python 进程映射为 main 的历史测试冒充完整演练。
- [ ] **2. 建立隔离 harness。** 容器无 host PID、无 Docker socket、无生产目录/凭据挂载；源码只读挂载，构建与数据库使用本例临时卷/内网。镜像版本和摘要记录到验收文档；构建可取依赖，运行只用测试网络。先检查 Docker 可用；不可用时完成其他任务并标记 Linux 验收 blocked，不在 Mac 上模拟通过。
- [ ] **3. 跑完整故障矩阵。** unknown 旧任务、4011 不明、调度回生、普通/首次并发、陈旧报告、时钟倒退、订单集合变化、备份坏/不完整、SQL 中断、dirty 启动、open ACK 丢失、入口恢复失败、worker 恢复失败、截止到达。成功路径要求真实新 bootId，直到 open 才恢复外部入口；恢复后的延迟回调不重复权益。状态种子不得被普通 runtime 当旧回执。
- [ ] **4. 运行整项回归（串行，保存独立日志）。**

```bash
node --test scripts/browser-maintenance-*.test.mjs scripts/browser-first-cutover-*.test.mjs scripts/browser-cutover-evidence.test.mjs scripts/deploy-browser-maintenance.test.mjs scripts/deploy-browser-first-cutover.test.mjs
python3 scripts/browser-maintenance-signal.test.py
python3 scripts/browser-first-cutover-signal.test.py
pnpm --filter @holaday/cn-payment test
pnpm --filter @holaday/cn-payment typecheck
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/execution/ordinary-maintenance.integration.test.ts
pnpm test:ops
bash -n scripts/deploy-browser-first-cutover.sh scripts/deploy-orchestrator.sh
git diff --check
```

另外在本例 Linux 容器内执行 `node --test scripts/browser-first-cutover.integration.test.mjs`，并显式运行 Task 5 的 opt-in MySQL 测试，记录实际环境及失败/跳过；命令前确认隔离守卫。全量 lint 如仍有既有噪声，报告原问题并验证触及文件，不能声称全仓 lint 已过。
- [ ] **5. 一次独立整项审查。** 只读审查批准设计、实际 diff、所有新接口、证据可信边界和真实测试；重点检查首次停止是否放宽普通安全条件、支付检查是否变成凭空自证、入口/恢复时序是否循环依赖。按问题集中修正并重跑受影响及整项关键回归，不因旁支建议扩建。若独立审查工具不可用，明确缺少独立审查，不将自检冒称审查通过。
- [ ] **6. 更新候选与交付清单。** candidate-selection 追加本项基线、源码提交、逐文件 SHA256/字节数及迁移摘要；保留原 included/excluded/postSelectionFixes/maintenanceImplementation。生成部署清单：精确候选、配置、旧进程和入口、停机起止、责任人、备份恢复、遗留任务处置依据、支付核对与外部阻塞、模型开放范围、失败核对步骤。未取得的生产参数以 `blocked: 原因/所需证据` 表示，不用猜测值填满。
- [ ] **7. 本地提交和停止。** `docs(browser): record first cutover verification and deployment gates`。确认工作树仅有预期内容，报告敏感未改项：支付结算/权益/额度、SQL、UI、扩展、浏览器模型路由。停在生产变更前；push、PR、merge、部署各按本项已给范围办理，不能把本计划确认当成生产许可。

## 设计覆盖与最终检查

| 设计要求 | 对应任务 |
| --- | --- |
| 原维护机制保留、首次显式入口、互斥 | 3、4、6 |
| 旧 running / 未来计划 / worker / 4011 不误清理 | 2、3、6 |
| 历史支付、窗口新付款、验签和重投语义 | 2、5、6 |
| 证据来源、时效、权限、两阶段 readiness | 1、2、4 |
| 物理停止、首次 seed、真实新 bootId | 3、4、6 |
| 备份恢复、全部 SQL、0042、不重跑 | 4、5、6 |
| open ACK、超时、失败维护、无旧版回滚 | 4、6 |
| 生产审批、模型开放边界、成功率不混淆 | 6 与部署清单 |

计划编写自检：6 个任务覆盖设计固定验收；共享接口名称统一；每项有 RED/GREEN 与本地提交点；外部实测与本地 fixture 明确区分。计划中的接口/测试片段是实施约束与起点，不是已实现、已通过或已获部署批准的证据。
