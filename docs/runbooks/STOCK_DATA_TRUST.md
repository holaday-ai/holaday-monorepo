# 股市数据可信度运行手册

## 目的与边界

本手册用于股市任务首页、AkShare 数据服务和由首页发起的股票任务。目标不是保证上游永不失败，而是保证：日期可解释、失败有界、旧数据不会伪装成当前数据、任务结论可追溯到用户点击时看到的快照。

以下服务端门禁属于发布不变量，不能被前端文案或布局开关绕过：

1. `current` 模式必须满足 `dataAsOf === latestExpectedTradingDate`。
2. `historical` 模式不得创建含“今天、当前、最新、实时”等当前时态的股票任务。
3. 超过七天安全窗口的快照必须进入 `unavailable`，并隐藏行情数值与图表。
4. 股票任务的 `sourceContext.snapshotId` 必须等于发起任务时页面快照的 `trust.snapshotId`。
5. 股票任务只能读取绑定快照内的证据，执行过程中不得回退到实时 AkShare 或通用搜索补数。

## 运行信号

### AkShare 健康端点

AkShare HTTP 服务只监听同机地址。生产机执行：

```bash
curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8848/healthz | jq .
```

必须返回 `status: "ok"`，并包含以下累计计数：

- `requests_total`
- `errors_total`
- `timeouts_total`
- `single_flight_timeouts_total`
- `fallbacks_total`
- `last_success_at`、`last_error_at`、`last_error_source`

响应不得包含上游错误原文、请求参数、token、cookie 或堆栈。连续取两次健康值，以计数增量而不是进程启动以来的绝对值判断异常。

### Orchestrator 结构化日志

正常生成或重新校验首页快照时，查询消息：

```text
stocks-dashboard: trust snapshot
```

每条日志必须包含：

- `snapshotId`
- `latestExpectedTradingDate`
- `dataAsOf`
- `trustMode`
- `snapshotAgeMs`
- `sourceStatuses[]`，其中仅有 `key`、`status` 和可选 `errorCode`

股票任务快照被拒绝时，查询消息：

```text
stocks-task: context rejected
```

日志只记录 `userId`、`snapshotId`、`rejectionCode`，不得记录任务正文或私有 `snapshotPayload`。重点拒绝码包括：

- `SNAPSHOT_NOT_OWNED`
- `SNAPSHOT_UNAVAILABLE`
- `SNAPSHOT_ID_MISMATCH`
- `DATA_AS_OF_MISMATCH`
- `TRUST_MODE_MISMATCH`
- `HISTORICAL_PRESENT_TENSE`
- `EVIDENCE_NOT_TRUSTED`
- `SYMBOL_NOT_IN_SNAPSHOT`

AkShare HTTP 客户端异常日志以 `path`、`group`、`errorCode` 和可选 HTTP `status` 为限。`CIRCUIT_OPEN` 表示对应路由组已熔断，不应再看到同组请求持续打向上游。

## 发布后探针

按顺序执行，任一 P0 门禁失败即停止扩大流量。

### 1. 服务与有界失败

```bash
pm2 describe akshare-mcp-http
curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8848/healthz | jq '{status,adapter_ready,requests_total,errors_total,timeouts_total,single_flight_timeouts_total}'
```

然后访问已登录的股市任务首页。首页应在首屏预算内返回，不得无限转圈；数据源失败时应显示明确的降级或不可用状态，而不是显示旧数据为“今日”。

### 2. 当前模式日期相等

在已登录浏览器的 `stocks.dashboardSnapshot` 响应中检查：

```text
trust.mode === "current"
trust.dataAsOf === trust.latestExpectedTradingDate
```

任何 `current` 且两日期不相等的响应都是 P0，立即回滚或切断新流量。

### 3. 历史模式不伪装当前

使用一个早于预期交易日但仍在七天窗口内的夹具或缓存快照：

- 页面必须展示明确的“截至 MM/DD”日期语义；
- 当前时态的快捷动作必须隐藏或禁用；
- 直接提交“今天哪只最强”必须返回 `BAD_REQUEST`；
- 日志必须出现 `rejectionCode=HISTORICAL_PRESENT_TENSE`，且不含任务正文。

### 4. 七天安全窗口

使用生成时间超过七天的快照夹具：

- `trust.mode` 必须为 `unavailable`；
- 自选股价格、涨跌幅、指数、板块和图表不得继续展示；
- 页面只允许刷新，不允许从该快照发起股票分析任务。

自动化回归由 `stock-trust.test.ts`、`stocks.test.ts` 和 `StockTasksPage.test.ts` 覆盖。生产只做只读或夹具验证，不手工修改真实用户快照。

### 5. 任务来源闭环

从首页创建一条股票任务后，记录页面响应中的 `trust.snapshotId`，再用只读 SQL 检查：

```sql
SELECT
  external_id,
  JSON_UNQUOTE(JSON_EXTRACT(source_context, '$.snapshotId')) AS task_snapshot_id,
  JSON_UNQUOTE(JSON_EXTRACT(source_context, '$.dataAsOf')) AS data_as_of,
  JSON_UNQUOTE(JSON_EXTRACT(source_context, '$.trustMode')) AS trust_mode
FROM tasks
WHERE external_id = '<task-external-id>';
```

必须满足 `task_snapshot_id` 等于发起页的 `trust.snapshotId`。任务详情接口只能返回公开的 `snapshotId`、`dataAsOf`、`trustMode`、`evidenceIds`，不得返回 `snapshotPayload`。

## 告警条件

以下任一条件触发 P0 告警：

- 任意 `current` 快照的 `dataAsOf` 与 `latestExpectedTradingDate` 不相等；
- 七天以上快照仍输出可见行情数值；
- 股票任务的快照 ID 与发起页快照 ID 不相等；
- `SNAPSHOT_NOT_OWNED`、`EVIDENCE_NOT_TRUSTED` 在五分钟内连续出现，需按安全事件排查；
- 日志或 API 响应出现上游错误原文、token、cookie 或 `snapshotPayload`。

以下条件触发服务降级告警：

- `timeouts_total` 五分钟增量达到 5；
- `single_flight_timeouts_total` 五分钟增量大于 0；
- 任一路由组出现 `CIRCUIT_OPEN`；
- `sourceStatuses` 中 `quotes=failed` 连续三个快照，或首页连续进入 `unavailable`；
- 健康端点三秒内无响应，或 PM2 进程重启次数持续增加。

告警记录至少保存：开始时间、服务版本、`snapshotId`、预期日期、数据日期、信任模式、源状态、健康计数前后值和处理动作。不要复制原始用户任务正文。

## 降级演练

仅在维护窗口、确认可恢复命令后执行。演练目标是验证停止 AkShare 后系统有界降级，而不是验证上游恢复速度。

1. 记录健康计数和一份当前快照的日期、模式、ID。
2. 执行 `pm2 stop akshare-mcp-http`。
3. 打开股市任务首页并刷新。已有安全窗口内快照可以标为正在刷新或历史数据；无可用快照时应在约 5.5 秒首屏预算内返回部分/不可用 UI，整体不得超过 15 秒或无限等待。
4. 尝试从历史快照提交当前时态任务，确认服务端拒绝。
5. 执行 `pm2 start akshare-mcp-http`，再运行 `scripts/smoke-akshare-mcp.sh`。
6. 确认 `/healthz` 恢复、生成新快照、日期门禁通过，并记录演练前后计数。

若恢复探针失败，不要反复重启。保留当前降级 UI，检查 PM2 日志、环境中的 `AKSHARE_HTTP_URL` 和上游连通性。

## 回滚

### 原则

- 回滚前端布局或新文案时，服务端信任门禁必须继续启用。
- 不得回滚 `stock-trust.ts` 的日期模式判断、`stock-task-context.ts` 的快照所有权/证据校验，或任务 `source_context` 的持久化。
- `0047_tasks_source_context.sql` 是 additive 迁移。应用回滚时保留该列，不执行 `DROP COLUMN`。
- 即使临时关闭新版页面文案，也必须保留：`current` 日期相等、历史当前时态拒绝、七天不可用、任务绑定快照四项门禁。

### 顺序

1. 停止扩大流量并保存上述运行证据。
2. 若仅 UI 回归，回滚 web-workbench 到上一稳定版本，Orchestrator 信任门禁不动。
3. 若 Orchestrator 回归，回滚应用代码到兼容 `source_context` 的上一稳定版本，但保留数据库列与 AkShare 有界超时。
4. 若 AkShare 服务回归，使用部署脚本的已知稳定提交恢复 `akshare-mcp-http`，验证 `/healthz` 和 smoke 后再恢复流量。
5. 回滚后重新执行“发布后探针”的五项检查。仅 health 200 不代表股市功能可信。

## 事故收口

关闭事故前必须回答：错误数据是否曾以 `current` 展示、是否创建过错误快照绑定的任务、影响哪些 `snapshotId`、用户是否看见原始错误信息、修复后五项门禁是否重新通过。无法确认时按“可能受影响”处理，不以页面能打开作为收口依据。
