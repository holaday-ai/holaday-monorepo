# 首次生产切换：只读核查记录

核查时间：2026-09-25 22:50–22:54，Asia/Tokyo（远端结果为 13:50–13:54 UTC）。本地基线 `1ec8e1fc3287da4ff561a0205e7f63f618ca687b`，验收源码仍为 `b86af4e9e72f3b260ef39b3b5864e35853546231`。

本轮仅进行本地既有测试、SSH 只读元数据、只读数据库事务与健康 GET。未推送、部署、停止进程、修改生产配置、执行迁移、创建订单、取消任务或清理支付记录。本文是核查结果，不是新的实施计划或停机批准。

## 结论

现有支付实现可复用，不需要先重写支付系统。但当前候选不能直接执行生产切换：线上未接入维护协议，旧任务归属未核清，支付维护检查尚无生产可通过路径，且备份/目标配置尚未验收。

上一轮 Tasks 1–6 的“完成”限定为已批准的本地维护实现与隔离验收；不意味着下面的首次生产切换已经实现或获准。

## 实时生产快照

| 项目 | 本轮实际结果 | 不能据此推断的事项 |
| --- | --- | --- |
| 公开 `/healthz` | HTTP 200 | 不代表维护就绪或浏览器任务成功率 |
| Vultr checkout | `107857fe70503e30691073f267d87275596edb20`，跟踪文件 diff 为空 | 不认证全部已加载内存代码；未跟踪文件未审计 |
| 主进程 | PID 733273，UID 四项均 998，Node v22.20.0，cwd `/opt/holaday-monorepo/apps/orchestrator` | 不是新候选，不能应用新候选的排空证明 |
| 主监听 | 4001、4002 都归属 PID 733273 | 不证明所有外部执行已结束 |
| 注销 worker | PID 67648，同一应用目录，UID 998 | 不等于已停止；必须纳入切换 |
| 维护目录/状态/发布目录 | `/var/lib/holaday/ordinary-maintenance`、其中 state.json、`/opt/holaday-releases` 均不存在 | 当前普通发布必然需识别首次引导，不允许伪造旧实例 idle |
| 磁盘模型配置 | qwen_only；QWEN_CORE_ROLLOUT_MODE=off；enabled lanes 不含 browser | 本次只核对磁盘这些字段，未重新认证所有运行环境；只换代码不会自动开放千问浏览器通道 |
| 0059/0060 新字段 | 指定的 tasks 三列、llm_calls 四列查询均不存在 | 此次未重新完整扫描所有历史 schema |

数据库核查在专用连接执行 `START TRANSACTION READ ONLY`，仅 SELECT 聚合/结构元数据，最终 ROLLBACK 并关闭连接；查询设置 3 秒执行上限和 4 秒客户端超时。未输出任务正文、用户名、订单号、密钥、连接串。

## 任务与支付记录

| 范围 | 实际聚合 | 判断 |
| --- | --- | --- |
| tasks | completed 2094、failed 1273、partial_success 78、cancelled 19、running 1 | 状态计数不是原始执行终点证明 |
| running 的更新时间 | 距查询时 8,025,795 秒，约 93 天 | 高度陈旧，但没有因此将其取消、改为失败或声称无外部副作用 |
| scheduled_tasks | active 2，当时 due 0 | 仍存在未来自动派发，不能忽略 |
| planned_task_runs / batch_tasks | 均无记录 | 不代表其他队列/内存任务为空 |
| account_closure_requests | cancelled 1，没有其他状态记录 | worker 仍在运行，不能只看表来忽略进程 |
| payments | completed 2、pending 13 | pending 不等于已收款或正在支付 |
| pending 分布 | 支付宝 9，最新 50 天；微信 3，最新 51 天；PayPal 1，最新 151 天；最近 3 天新增 pending 均为 0 | 不能仅凭年龄证明支付方订单已关闭、无漏结算；未删除或重放 |

上述是瞬时快照，正式切换必须再读；不是长时观察或暂停调度的证明。

## 国内支付网关：复用证据与剩余边界

当前软链接目标为 `/opt/holaday-cn-payment/releases/604ddf17e84a-20260827133820`。两个关键源文件摘要与本地候选一致：

- `apps/cn-payment/src/index.ts`：`13141b9e677319cb8b586926048881b6392a8c07f384171a89611adc84fd04b5`
- `apps/cn-payment/src/sync-to-vultr.ts`：`52f7e161b87ca2ec9a9c3492737b7684d9bccc35ef2a52af60a88a2ce211a3c2`

4010 的实际监听者是 PID 1098048，父 PID 1098032 为 tsx 包装进程；当前目录另见 Node PID 1097924。不能把同目录 Node 数量直接算成重复监听服务。4010 健康接口返回 200，微信/支付宝 ready，bridge ready，微信回调使用 public_key。

另外，旧目录 `/opt/holaday-cn-payment/releases/083a6232aca7-20260804125641` 中 PID 965039（tsx，父 PID 1）及其子进程 PID 965055 仍在；后者监听 `*:4011`。本轮未核实 4011 的 nginx/外网路由、用途及支付凭据状态，不推断其已接生产流量，也不擅自停止。新旧实例的指定数据库环境变量均未出现，但这不是“没有任何写入渠道”的证明。

本地已核对的代码链：微信/支付宝已验签通知 → await Vultr confirm/confirmPartner → 只有桥接成功才回复成功；桥接失败抛错，微信返回非成功 HTTP，支付宝返回 fail。未发现该桥接实现内的持久回调队列；不能把日志或支付方重试当成本地可靠持久化。

PayPal 官方说明非 2xx 会触发有界重试（最多 25 次/3 天）；这支持保留非成功响应，不证明 Holaday 当前注册、签名配置或实际重投已经验收。[PayPal 官方说明](https://developer.paypal.com/api/rest/webhooks/rest/)

支付宝官方帮助说明完成业务处理后才能返回 success，否则按策略重发；该帮助页不能替代当前商户具体产品的重投验证。[支付宝官方帮助](https://help.alipay.com/support/help_detail.htm?help_id=397355)

微信官方文档访问本轮失败，因此不引用源码注释中的重试次数/时长作为官方证据；目前仅证明仓库的失败应答行为。

## 当前代码中明确未闭合的放行点

`apps/orchestrator/src/execution/ordinary-maintenance-readiness.ts` 的 `checkMaintenanceServices()` 无条件抛出 `MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN`。这是上一轮留下的明确阻塞，不是一个补填布尔配置即可通过的检查。host 在准备阶段以及候选验收时都会调用该链路；仅取得停机许可不会使它自动通过。

下一项应严格限定为首次切换与真实可核验的放行条件，不重新实现支付结算、不扩建原生池、不借机修改 UI。须先确定：

1. 陈旧 running 记录的执行/副作用归属与保留方式；不能用改状态制造空闲证明。
2. 旧版主进程、注销 worker、两个未来计划及 4011 旧网关的实际责任边界；停用对象逐一列明，不能统一清理所有进程。
3. 支付失败回调的重投/补核对安排，以及核验后如何走现有 readiness 的真实成功路径；拒绝“操作员填 true”式旁路。
4. 首次维护初始化和关闭启动流程、精确候选/配置摘要、全部 61 个编号 SQL 与 runner 摘要、备份及恢复证据。已有 runner 会重放旧 SQL，其中 0042 会更新支付完成时间；不能仅批准 0059/0060 却运行整套。
5. 千问浏览器开放范围需单独明确。现有 off 配置不能写成已开启生产浏览器执行。

备份存在性、可恢复性、生产目标配置摘要、本次是否处理 4011 都尚未验证或获准。本文不提供绕过现有部署拒绝的命令。

## 本轮本地验证

- `pnpm --filter @holaday/cn-payment test`：6 文件、45/45，退出 0；日志 `/tmp/holaday-predeploy-cn-payment-20260925.log`。
- `pnpm --filter @holaday/orchestrator exec vitest run src/http.payment.test.ts src/execution/ordinary-maintenance-readiness.test.ts`：2 文件、15/15，退出 0；日志 `/tmp/holaday-predeploy-payment-readiness-20260925.log`。
- 以上均使用现有 mock，不是支付方实际付款/重投测试；没有新增产品侧付费调用。之前 8518 项全量属于上一轮历史证据，本轮没有重跑全量。

连接过程：自动审批曾超时且命令未执行；隔离工作树默认未找到凭据，指定主仓库已有部署凭据后首次 SSH banner 超时；后续短连接证明 SSH 可达，再用既有凭据完成只读核查。未关闭主机指纹验证，未改网络/VPN、防火墙或服务器。密钥未输出。
