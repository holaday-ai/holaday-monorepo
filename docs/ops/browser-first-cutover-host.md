# 首次发布主流程接线

2026-09-27。本页描述代码接口，不是生产就绪或部署批准证明。

`scripts/browser-first-cutover-host.mjs` 的 `createFirstCutoverHostAdapter({ attempt }, io)` 已连接候选准备、同一实际 journal、证据采集、备份回执、迁移、首次状态、候选关闭启动、精确开放及后续核对。沿用 `performFirstCutover` 和共用的 `finishStoppedRelease`，不伪造旧 bootId，也不另建发布引擎。

## 调用契约

- 只接受 `attempt`，其余候选、摘要、分支和绝对窗口由已有受保护批准文件读取；不接受 CLI 手填字段覆盖批准。
- 构造无副作用；缺少任何现场适配接口时，获取锁和构建之前拒绝。`preflight` 只读批准，`stage` 复用实际准备函数持锁、构建并做 prepare readiness；只有通过后才进入入口修改。
- 调用方必须在 transition 返回后调用 `adapter.finish(result)`。失败只关闭文件句柄、保留锁与记录；`reconciled` 是意图，实际后续核对成功且仍在核对窗口内才释放锁。
- 同一副作用方法不能重复或并发执行；失败不重跑 SQL、不回启旧代码、不全局 PM2 save/delete/kill。启动状态查询可以轮询，启动命令和 open 只执行一次；open 丢 ACK 只查询同一身份。
- 保护性 close 不受维护窗口截止阻止。启动已读到合法候选身份但随后发现 dirty 时，也保留该身份用于关闭，而非等待 transition 收到 start 成功结果。

## 必须连接的现场接口

以下 `io` 是受信代码接口，不是可上传的 JSON 或人工 true 开关。当前没有默认生产适配或首次执行 CLI；构造函数默认仍会拒绝缺失的观察器。

| 接口组 | 责任 |
| --- | --- |
| `inspectLegacySource` | 按完整受保护清单读取旧源码、实际进程、启动来源并返回绑定旧版摘要的实时观察，不能只读 Git HEAD。 |
| `lifecycle.fenceOrders / settleLegacy / stopProducers / fenceAll / stopLegacy` | 复用已实现的两阶段隔离、真实业务核对、定向停止、注册与主/备用启动文件处理；两主机必须共享同一操作绑定并各自验证本机事实。 |
| `lifecycle.assertStopped(context, previous)` | 重采当前停止证明，包含 `inventoryDigest / phase:stopped / observedAtMs / survivors / listeners / unknownLaunchers`；不能原样回送上次回执。 |
| `lifecycle.verifyFence(context)` | 合并真实入口探针和工作核对：`inventoryDigest / stage:all-writers / observedAtMs / existingSockets / internalWriters / producersRunning / unsettledWork / externalWork`；后五项必须为零。停进程不能替代停写。 |
| `lifecycle.readBackupPlan(context)` | 从受保护配置返回且仅返回 `sourceIdentity / isolatedTarget`；导出前由已有备份协调器再读两端身份。 |
| `backup` | 真实数据库身份、加密设施、导出、hash、隔离恢复、全对象/数据比对、隔离库完整迁移、schema 与业务摘要、源库复核。主流程固定注入当前时钟、实际 journal ownership、停写检查以及 `journal.bindBackupReceipt`，不能由调用方换成假回执。 |
| `evidence / publishEvidence` | 复用真实采集器与受保护证据发布。候选工具在构建后运行 prepare，关闭启动后 verify，open 前再采一次。 |
| `lifecycle.restoreIngress / resumeWorker / reconcile` | 恢复绑定入口、恢复指定 worker 和批准的持久启动配置、窗口支付与任务/浏览器探针核对；不得使用全局 PM2 save 替代定向处理。 |
| `lifecycle.holdMaintenance(context, result)` | 按实际阶段保持或恢复维护隔离，记录不确定状态，不清锁、不自动数据库回滚。 |

`context` 含原批准、binding、候选目录、应用 GID 和同一个真实 journal 对象。它是当前进程内的控制接口，不是可跨网络直接反序列化的授权对象。跨主机传输和远端 journal/观察器仍须在生产组装中提供。

主进程启动、readiness/control 命令使用固定 argv 和候选工具，以 UID 998 运行；迁移仍走现有全部编号 SQL runner。首次状态由已有初始化函数创建并绑定真实 bootstrap seed，不能用它冒充新进程 bootId。初始化和启动之间仍复核停止、入口与配置/迁移摘要。

## 已验证与尚未验证

新组合测试使用真实候选准备编排、临时文件 journal、证据采集器、备份协调器及首次状态文件；Git/构建、远端进程、业务/支付、数据库及文件属主是明确的合成边界。Linux Node 22 运行这些组合测试也不等于真实双主机切换。

尚未完成：实际受保护双机分类清单及上述生产接口组装、密文运输到指定 Mac 隔离库、生产停写后的真实备份恢复、历史任务/支付核清、持久入口与启动配置验收、首次 shell 入口、整项演练及独立审查。恢复私钥离线副本仍待可写专用介质。不得据本页执行生产切换或宣称浏览器已上线。
