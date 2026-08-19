# HOLA DAY 股票风险持续监控设计

## 1. 背景与目标

HOLA DAY 已经具备可信股票快照、规则驱动的风险雷达、规划任务和站内通知，但三者目前彼此分离：用户可以看到风险，却不能把某只股票的风险规则转换成持续执行的监控，也无法在风险变化后得到去重提醒和可追溯运行记录。

本轮目标是完成以下闭环：

1. 用户在风险雷达的股票分组中创建持续监控；
2. HOLA DAY 在 A 股收盘数据刷新后，使用最新可信快照重新执行相同的确定性风险规则；
3. 系统只把新增风险、风险升级、风险解除和数据不可判断作为变化结果；
4. 变化结果写入规划任务运行记录，并通过站内通知送达；
5. 用户可从风险雷达查看监控状态、下次检查和最近结果，并进入规划任务暂停、恢复、立即运行或查看历史。

本功能只提供事实监控和风险解释，不提供股票推荐、买卖建议、收益预测、自动交易或适当性判断。

## 2. 已确认方案

采用“专用风险监控 + 复用规划任务调度器”的方案。

- 复用 `planned_tasks` 的重复规则、下次运行、暂停/恢复、立即运行、日历和运行记录能力；不建立第二套定时调度器。
- 风险监控不能作为普通自由文本指令执行。规划任务命中专用监控记录后，由确定性执行器直接读取可信股票快照、调用风险雷达服务并比较状态。
- 生成模型不能决定风险是否成立、风险等级或变化类型。AI 解释如后续启用，只能基于已经确定的结构化变化结果改写说明。
- 首期只写入 HOLA DAY 站内通知。现有用户主动配置的 webhook 渠道不自动接收股票风险提醒，避免在未增加独立订阅控制前将金融提醒外发。

## 3. 用户体验

### 3.1 创建监控

风险雷达的每个股票分组右上角增加“持续监控”按钮。点击后打开确认 Sheet，展示：

- 股票名称和代码；
- 当前快照日期；
- 将持续检查的规则：质押、商誉、业绩预告、董监高变动和公告风险；
- 默认执行时间：每个自然日 16:30，时区 `Asia/Shanghai`；非交易日或没有新交易日快照时自动跳过；
- 提醒边界：仅在风险新增、升级、解除或无法判断时提醒；无变化不提醒；
- 合规提示：监控结果不构成投资建议。

确认后创建一条标题为“监控 {股票名称} 风险变化”的规划任务。相同用户、相同股票只能存在一条风险监控；重复创建返回已有监控，而不是产生重复计划。

### 3.2 监控状态

风险股票分组显示以下状态之一：

- `开始监控`：尚未创建；
- `监控中`：规划任务为 active，并显示下次检查时间；
- `已暂停`：规划任务为 paused，可直接恢复；
- `需要处理`：最近一次执行失败或连续无法建立可信快照；
- `已归档`：不在风险雷达主卡中展示为活动监控，可重新创建。

状态旁显示最近一次结果摘要，例如“08/19 新增 1 条警示”“08/19 无变化”“08/19 数据不可判断”。点击“查看记录”进入 `/planned?plan=<plannedTaskId>`，规划任务页自动打开对应详情和最近运行记录。

### 3.3 运行结果和通知

每次执行生成一种结构化结果：

- `changed`：存在新增、升级或解除；写运行记录并创建一条未读站内通知；
- `unavailable`：相关来源不可用，无法判断完整变化；写运行记录。相同数据日期、相同不可用来源指纹只通知一次；
- `unchanged`：风险状态无变化；只写运行记录，不创建通知；
- `skipped`：非新交易日、快照日期未前进或股票已不在用户关注列表；写简短运行记录，不创建通知；
- `failed`：执行器内部失败；规划任务记录失败，保留可重试信息，不覆盖上一次有效状态。

通知标题采用“{股票名称} 风险发生变化”或“{股票名称} 风险暂时无法判断”。消息只列出有界摘要、数据日期和“查看规划记录”入口，不包含推荐语或自由推断。

## 4. 数据模型

新增迁移 `0049_stock_risk_monitors.sql`。

### 4.1 `stock_risk_monitors`

专用表保存监控配置和最近一次有效比较状态：

- `id`：内部主键；
- `external_id`：公开监控 ID；
- `user_id`：所属用户，删除用户时级联；
- `planned_task_id`：对应规划任务，删除规划任务时级联；
- `symbol`、`name`、`market`：创建时经可信快照校验后的股票身份；
- `risk_keys_json`：固定的 `StockRiskCheckKey[]`，首期必须是五类完整检查集合；
- `last_evaluated_data_as_of`：最近完成比较的可信交易日；
- `last_signals_json`：最近有效风险状态，只保存 `key / severity / signalId / evidenceId / sourceDataAsOf`；
- `last_unavailable_checks_json`：最近无法判断的检查键；
- `last_notification_fingerprint`：最近已通知变化的稳定指纹；
- `created_at`、`updated_at`。

约束：

- `external_id` 唯一；
- `(user_id, symbol)` 唯一，保证创建幂等；
- `planned_task_id` 唯一，保证一条计划只对应一个风险监控。

不保存用户输入的自然语言，不保存资产、收入、风险承受能力或浏览行为。

### 4.2 `planned_task_runs.result_json`

给 `planned_task_runs` 增加可空 JSON 字段 `result_json`，专用风险监控写入：

```ts
interface StockRiskMonitorRunResultV1 {
  kind: 'stock-risk-monitor';
  version: 1;
  monitorId: string;
  symbol: string;
  name: string;
  dataAsOf: string | null;
  outcome: 'changed' | 'unavailable' | 'unchanged' | 'skipped' | 'failed';
  added: StockRiskChangeItem[];
  upgraded: StockRiskChangeItem[];
  resolved: StockRiskChangeItem[];
  unavailableChecks: StockRiskCheckKey[];
  summary: string;
}
```

结果数组均受风险键数量约束，`summary` 最大 500 字，不写原始上游响应。

### 4.3 `notifications.planned_task_id`

给 `notifications` 增加可空 `planned_task_id`，外键指向 `planned_tasks.id`，删除计划时 `SET NULL`。现有 `scheduled_task_id` 保持不变。通知列表据此生成 `/planned?plan=<externalId>` 跳转。

## 5. 服务边界

### 5.1 创建服务

新增 `createStockRiskMonitor(...)`：

1. 验证调用用户；
2. 使用 `snapshotId / dataAsOf / trustMode` 调用现有股票任务上下文校验；
3. 确认股票位于该用户当前可信快照的关注列表；
4. 在事务内创建 daily 规划任务、一个可读任务项和 `stock_risk_monitors` 记录；
5. 捕获唯一键冲突并返回既有监控；
6. 首次状态以创建时风险雷达结果为基线，不发送“新增风险”通知，避免把已展示事实误报成新变化。

默认首次运行时间由纯函数 `nextShanghaiPostmarketRun(now)` 计算：当天上海时间 16:30 之前取当天 16:30，否则取次日 16:30。计划每天触发，但执行器通过可信快照日期自动跳过周末、节假日和上游尚未更新的日期。

### 5.2 比较服务

新增纯函数 `compareStockRiskMonitorState(previous, current, checks)`：

- 以 `symbol + key` 作为规则身份；
- 之前没有、现在存在为 `added`；
- 现在的严重度高于之前为 `upgraded`；
- 之前存在、现在不存在，且该风险所依赖的来源本轮为 `checked`，才是 `resolved`；
- 来源为 `unavailable` 时绝不判定解除；
- 相同键、相同严重度、事实或证据编号变化但等级未变，不生成风险变化，只更新最近证据状态；
- 输出按高风险、警示、关注以及固定风险键顺序稳定排序。

通知指纹由 `monitorId + dataAsOf + added/upgraded/resolved + unavailableChecks` 的规范化 JSON 计算，保证重试和后台重复周期不产生重复通知。

### 5.3 专用执行器

`dispatchPlannedTaskRun` 在创建普通 task 之前调用可注入的专用执行器。执行器按 `plannedTaskId` 查找 `stock_risk_monitors`：

- 未找到时返回 `handled: false`，保持现有规划任务路径完全不变；
- 找到时返回 `handled: true`，直接完成本次 `planned_task_runs`，不创建自由文本 task；
- 手动“立即运行”和定时运行使用同一执行器；
- 使用最新持久化股票仪表盘建立当前可信上下文，不复用创建时旧快照；
- 只检查监控对应的单只股票，仍复用 `runStockRiskRadar` 的超时、来源规范化和确定性规则；
- 成功后在一个事务中写运行结果、更新监控状态和规划任务最近运行状态；通知在事务提交后调用，通知失败不回滚监控结果；
- 执行失败时不修改 `last_signals_json`、`last_evaluated_data_as_of` 或通知指纹。

## 6. API

在 `stocks` 路由增加：

### `riskMonitors`

输入当前风险雷达快照上下文，返回当前用户关注股票对应的监控状态：

```ts
interface StockRiskMonitorView {
  monitorId: string;
  plannedTaskId: string;
  symbol: string;
  status: 'active' | 'paused' | 'failed';
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastOutcome: StockRiskMonitorRunResultV1['outcome'] | null;
  lastSummary: string | null;
}
```

### `createRiskMonitor`

输入 `snapshotId / dataAsOf / trustMode / symbol`。名称、市场、基线风险和证据全部由服务端可信快照与风险雷达结果确定，客户端不能提交这些事实。

### 状态操作

暂停、恢复、立即运行和归档继续调用现有 `plannedTasks` 路由，使用其用户归属校验。风险雷达只传递服务端返回的 `plannedTaskId`。

## 7. 前端设计

`StockRiskRadar` 增加可注入监控 API，保持现有风险读取 API 不变。风险数据成功后并行读取监控状态，单独失败时只隐藏监控操作，不影响风险事实展示。

每个股票分组：

- 未监控：次级按钮“持续监控”；
- active：状态点 + “监控中”，显示下次检查；
- paused：显示“已暂停”和“恢复”；
- failed：显示“需要处理”和“查看记录”；
- 所有状态使用文字和图标，不只依赖颜色；
- icon-only 控件同时提供 `aria-label` 和原生 `title`；
- 390px 下按钮和状态换行，不产生横向滚动；
- Sheet 关闭后焦点返回触发按钮；
- 尊重 `prefers-reduced-motion`。

`PlannedTasksPage` 增加 `plan` 查询参数：页面加载后只打开当前用户列表中匹配的规划任务；参数无效或不属于用户时保持普通列表，不泄露任务是否存在。

通知铃铛识别 `plannedTaskId` 后跳转对应规划详情；没有该字段的旧通知行为保持不变。

## 8. 错误与降级

- 当前可信快照不可用：禁止创建监控，明确提示“当前数据无法建立可信监控”；
- 股票已移出关注列表：本轮记 `skipped`，不自动删除监控；用户可在规划任务中暂停或归档；
- 单个来源不可用：结果为 `unavailable`，不把缺失误判成安全或解除；
- 所有来源失败：记录无法判断并按指纹去重提醒；
- 通知写入失败：运行记录仍成功，写结构化错误日志，不重复执行风险检查；
- 重复调度或重试：沿用 `planned_task_runs` 发生时间唯一约束，并使用通知指纹二次去重；
- 旧 generic 规划任务、旧通知和旧运行记录无需回填，新增字段均可空且向后兼容。

日志只记录用户内部 ID、监控 ID、股票代码、数据日期、变化数量、不可用检查数量、耗时和错误码；不记录通知正文、原始上游数据或任何密钥。

## 9. 测试与验收

### 9.1 单元与服务测试

- 上海时区 16:30 前后、跨日和夏令时不适用边界；
- 相同用户股票创建幂等、跨用户隔离、股票不在可信关注列表时拒绝；
- 新增、升级、解除、无变化、来源不可用、部分不可用和稳定排序；
- 来源不可用时不得产生解除；
- 同一数据日/指纹不得重复通知；
- 无新快照、非交易日、移出关注列表和内部失败不覆盖有效基线；
- 专用执行器 handled/unhandled 边界，generic 规划任务不回归；
- 手动立即运行与定时运行走同一路径。

### 9.2 数据库与路由测试

- 迁移编号唯一、表和三项唯一约束存在；
- `planned_task_runs.result_json` 与 `notifications.planned_task_id` 可空、外键行为正确；
- API 所有权、快照篡改、股票代码篡改和服务端名称解析；
- pause/resume/runNow/archive 继续执行现有归属校验。

### 9.3 前端测试

- 创建确认 Sheet、重复创建反馈、active/paused/failed 状态；
- 下次运行和最近摘要；
- 监控 API 失败不遮挡风险雷达；
- `/planned?plan=` 自动打开、非法参数静默忽略；
- 通知跳转；
- 键盘、焦点恢复、原生 title、390px 布局和 reduced motion。

### 9.4 生产验收

1. 当前交易日可信快照下创建一条真实监控；
2. 立即运行产生 `unchanged` 或可解释变化，并在规划记录中显示数据日期；
3. 重复立即运行不产生重复通知；
4. 暂停后不再被调度，恢复后显示正确下一次执行时间；
5. 人为使用旧快照创建被拒绝；
6. 模拟一个来源不可用，结果显示无法判断且不误报解除；
7. 两个生产健康端点返回 200，Orchestrator 以非 root 用户运行，数据库迁移校验、Web/Orchestrator 全量测试、类型检查和生产构建通过；
8. `holaday.ai` 与 `hd-app.orangebench.tech` 加载同一新 bundle，生产控制台无错误。

## 10. 发布与回滚

按一个独立 PR 交付，部署目标为 `application`；不需要部署 AkShare，因为复用现有风险接口。

迁移为纯增量。回滚应用代码后新增表和可空字段保留，不影响旧版本。若专用执行器异常，关闭风险监控创建入口并暂停 `stock_risk_monitors` 对应规划任务；不得回退风险雷达、股票快照或现有规划任务可信保护。

## 11. 明确不在本轮

- 短信、邮件、企业微信、飞书、钉钉或自定义 webhook 股票提醒；
- 价格、涨跌幅、成交量等行情阈值预警；
- 自动推荐、交易、调仓、组合或风险承受能力判断；
- 用户自定义风险阈值和风险等级；
- 生成模型改变规则结果；
- 多股票合并成一条监控计划；
- 今日能量 C 阶段或其他产品模块改动。
