# 首次发布主流程接线

2026-09-27。本页描述代码接口，不是生产就绪或部署批准证明。

`scripts/browser-first-cutover-host.mjs` 的 `createFirstCutoverHostAdapter({ attempt }, io)` 已连接候选准备、同一实际 journal、证据采集、备份回执、迁移、首次状态、候选关闭启动、精确开放及后续核对。沿用 `performFirstCutover` 和共用的 `finishStoppedRelease`，不伪造旧 bootId，也不另建发布引擎。

## 调用契约

- 只接受 `attempt`，其余候选、摘要、分支和绝对窗口由已有受保护批准文件读取；不接受 CLI 手填字段覆盖批准。
- 构造无副作用；缺少任何现场适配接口时，获取锁和构建之前拒绝。`preflight` 只读批准，`stage` 复用实际准备函数持锁、构建并做 prepare readiness；只有通过后才进入入口修改。
- 调用方必须在 transition 返回后调用 `adapter.finish(result)`。失败只关闭文件句柄、保留锁与记录；`reconciled` 是意图，实际后续核对成功且仍在核对窗口内才释放锁。
- 同一副作用方法不能重复或并发执行；失败不重跑 SQL、不回启旧代码、不全局 PM2 save/delete/kill。启动状态查询可以轮询，启动命令和 open 只执行一次；open 丢 ACK 只查询同一身份。
- 保护性 close 不受维护窗口截止阻止。启动已读到合法候选身份但随后发现 dirty 时，也保留该身份用于关闭，而非等待 transition 收到 start 成功结果。

### 双主机操作记录

同一真实 journal 的启动文件及 PM2 注册子事件可带固定 `host: 'aliyun' | 'vultr'`。每台主机分别校验备份、意图、执行回执及所在阶段；相同 `/root/.pm2/dump.pm2` 路径、相同 PM2 数字 ID 不再被误判为另一台主机的重复操作。已有不带host的单机接口保留，但同一attempt不允许混用两种模式，也不接受任意主机名。

持久文件仍保留完整顺序事件，不能在第二台主机执行前覆盖第一台记录。已开始的任一主机批次未完成时，不能推进主阶段；重复执行、缺失回执和错误payload仍拒绝。现场适配器必须把host绑定到实际执行通道，并证明全部批准对象已处理，不能把一个host字符串或“当前所有批次完成”当成双机执行完毕证明。本变更不提供远程RPC或自动批准清单。

## 必须连接的现场接口

### 旧版身份与完整数据库比较（2026-09-27）

`readReviewedFirstCutoverLegacySource({reviews,inventoryDigest})` 将实际双机读取、原分类器和准备阶段的 `inspectLegacySource` 返回协议接在一起。只有两台主机都匹配受保护审核清单且没有unknown，才返回实算的旧版摘要；摘要绑定来源提交、采集代码、进程/启动时间、管理器、监听、保留对象及来源指纹，不从批准文件照抄摘要。时间刷新、采集进程更换、列表排序不改变旧版身份；真实进程或来源变化会改变绑定。**仍需现场适配从受保护配置提供reviews**，本函数不批准来源，也不是首次执行CLI。

`browser-first-cutover-mysql.mjs` 提供实际 MySQL 只读一致性快照及恢复比较。使用专用、无损类型配置的连接，前后核验server_uuid/database；覆盖表、视图、触发器、事件、存储过程及函数，检查完整列定义和全部原始行（重复行保留、顺序无关、二进制按字节）。返回摘要和对象清单，不返回业务值。源库/恢复库只规范化被引用的schema限定名及冗余utf8mb4声明，不改写SQL业务字面量；触发器对象重建时间不当作业务时间。

迁移后使用源快照的原始列投影比较所有历史业务列，允许新增列/表，不允许原列消失或旧值变化。非InnoDB、超过单表100万行、非法标识符、不安全整数/Date/未保持原文的JSON对象、读取失败及元数据漂移均拒绝，不截断采样。连接须启用 `dateStrings/supportBigNumbers/bigNumberStrings/jsonStrings`，禁止decimalNumbers；使用结束后回滚专用只读事务。调用方仍须证明停写/目标隔离，本模块不凭快照宣称停写。

上述比较器已接入真实age+mysqldump/mysql+原journal+全61SQL的合成集成测试，代替仅QA内的业务字段摘要；它不代表生产备份已执行。双机副作用适配、Mac运输、首次shell与整流程演练仍未完成。

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
