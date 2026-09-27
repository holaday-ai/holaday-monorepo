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

### 双机只读通道（2026-09-27）

`readFirstCutoverHostPair()` 已使用真实 SSH 连接固定阿里云/Vultr目标，Vultr沿既有阿里云跳板进入。复用现有采集器，经stdin在远端Node内存执行，不安装远端文件；保持严格主机密钥校验、关闭agent/端口转发，不接受调用方替换目标地址或提供任意远端命令。凭据沿用既有SSH/askpass环境，不进入返回值或日志。

一次双机读取共享随机请求ID并分别绑定主机名、采集代码摘要和采集进程自身身份；两条读取全部结束才返回，任一失败或超过60秒有效期拒绝整组，不重试、不返回半份成功。Vultr另外在采集前后检查旧checkout的HEAD及已跟踪文件差异；这只证明旧源码来源，没有把Git HEAD当作内存中程序版本。原始结果含私密配置，仅交给受信调用方私密保存，不能直接打印到用户日志。

`classifyFirstCutoverHostPair({pair,reviews,inventoryDigest})` 将两台机器分别交给既有单机分类器，核对各自已审核的bootId和端口，不依赖数组顺序配对。它保留浏览器/其他应用的保留项，并把未审核、漂移、缺失的来源按主机汇总到`unknownLaunchers`。**不会生成review、自动批准来源或返回发布就绪结论**；当前生产完整review及生命周期I/O仍待组装。

实际只读验证：UTC `2026-09-27T07:39:43.984Z` 起采集成功，阿里云12进程/2注册/223来源，Vultr28进程/9注册/265来源；旧checkout `107857fe70503e30691073f267d87275596edb20`。原始结果保存在Mac私密目录，未提交源码仓库。此快照会过期，不能当后续停机许可或复用为实时readiness；这些数量也不表示488个来源已经审核。

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

### 已批准的唯一 Sandbox 延期项

用户2026-09-27批准旧PayPal测试单延期；它仍未被支付方核验，不是已关闭或已支付。现场 `readHostInventory` 必须从受保护批准清单带入以下字段，并将实际新PayPal开关配置纳入 `configurationDigests`，不得凭空填写 `false`：

```json
{
  "paypalCheckoutEnabled": false,
  "deferredSandboxPayment": {
    "recordDigest": "75467f5b0aec5367761433a57fbd45aa9a41347e638f385178c12f5af7740b95",
    "approvalRef": "paypal-sandbox-20260927"
  }
}
```

数据库适配将同一 `deferredSandboxPayment` 传入已有 `readCutoverDatabaseScope`。此函数只在完整分页/计数覆盖下将精确匹配行输出为 `deferredUnverified`；其他订单照常核验。不调用PayPal merchant解析器、OAuth或订单API，发现另一条PayPal记录即拒绝。`inventory.merchants` 与演练证据对应本次实际核验的商户，不为此延期项伪造PayPal商户或演练回执；原PayPal历史回调路径仍按两阶段入口隔离规则保护。指纹使用表名、外部ID、provider订单/capture ID、金额币种、状态、排序metadata键值和UTC创建/更新时间；报告只输出摘要，不含原订单号。实际该指纹已从私密历史归档生成，不能替换为任意测试单。

采集器和readiness双重固定此唯一记录，拒绝额外/重复/被改写的例外。`payments.scopeDigest/queriedScopeDigest` 仅对应须查询的订单；database source摘要另外绑定延期数组，provider-query摘要不冒充验证延期项。准备与开放前都重采，读前后变动即拒绝。没有延期时原V1报告语义不变。现场适配、备份恢复、首次shell仍需按上文接口完成；本段不是已安装生产配置。

新组合测试使用真实候选准备编排、临时文件 journal、证据采集器、备份协调器及首次状态文件；Git/构建、远端进程、业务/支付、数据库及文件属主是明确的合成边界。Linux Node 22 运行这些组合测试也不等于真实双主机切换。

尚未完成：实际受保护双机分类清单及上述生产接口组装、密文运输到指定 Mac 隔离库、生产停写后的真实备份恢复、历史任务/支付核清、持久入口与启动配置验收、首次 shell 入口、整项演练及独立审查。恢复私钥已于2026-09-27复制到用户指定的Yalei USB并实际解密验证，详见[保管记录](browser-backup-recovery.md)；介质未额外加密，待用户物理离线保管，不能替代生产恢复演练。不得据本页执行生产切换或宣称浏览器已上线。
