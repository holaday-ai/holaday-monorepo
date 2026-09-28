# 浏览器首次切换验收记录

## 当前结论：未完成，不能执行生产切换

2026-09-29后续核查（基于`21b0fac6`）：真实应用数据库账号缺全局PROCESS，事务/复制状态查询被拒绝，只见同账号4个Sleep连接；不证明未知写入者为零。原host现可调用严格权限覆盖的独立MySQL观察器，但它只覆盖数据库这一来源，原site的完整独立facts仍待组合，生产权限没有更改。新鲜browser1019/1019、Linux关联115/115及真实LinuxNode22/MySQL五项权限/跨账号/跨库事件/事务反例均通过、零跳过、退出0；详见checkpoint最新段。并未执行全切换、生产备份、ops/应用全套或部署。

本轮权限语义依据：[MySQL PROCESS及全局权限](https://dev.mysql.com/doc/refman/8.0/en/privileges-provided.html)、[事件可见性与EVENT权限](https://dev.mysql.com/doc/refman/8.0/en/events-privileges.html)、[复制总applier状态](https://dev.mysql.com/doc/refman/8.0/en/performance-schema-replication-applier-status-table.html)。实现不把局部EVENT授权的空集合或权限异常当全服务器空集合；全局EVENT也有管理能力，不能为读取而静默授予应用账号。两遍元数据采集不是事务隔离或持续禁止重连的证明。

本文件承接原实施计划Task6/6.R3，不是新计划。2026-09-29本轮实现基于`b9454ca1`，Task4原BASE仍为`844c2ced779fa360b62e2bfbdd87d4909d13b8a0`。已通过组件不能替代完整成功/故障演练，`--execute`仍明确拒绝。

| 验收范围 | 状态 | 本轮证据与限制 |
| --- | --- | --- |
| 三组原WS重启恢复 | passed | 真实MySQL迁移/合成记录、JWT和WebSocket；新增受控/旧版配对后9/9，退出0、零跳过 |
| 原队列持久化回归 | passed | 54/54，退出0、零跳过 |
| 受控候选不重派发旧执行步骤 | passed | 同一真实存储样本，旧模式派发一次、受控模式不派发，任务与步骤完整行不变；只覆盖WS恢复入口 |
| 固定协调器/现场编排/transition工具模块闭包 | passed | 28个固定模块离开检出目录可真实导入；Mac及Linux Node22均完成针对性核验，身份/缺模块等19项通过 |
| 保留的headed浏览器观察 | passed | 仅当时只读观察成功；不是已隔离、没有注入脚本或没有外部请求的证明 |
| 独立knownExternalWork/unknownWriters现场来源 | blocked | 原facts仍无完整默认现场实现；不以空白页、数据库空集或源码能力证明填零 |
| 6.R3全流程成功/故障/丢响应不重放 | not-run | 此处WS用例不是performFirstCutover全流程，也没有验证真实外部效果计数始终为1 |
| 实际生产停写备份→Mac隔离恢复 | not-run | 既有合成MySQL/age历史通过不改称生产恢复；本轮不重做密钥和已有组件 |
| 非PayPal支付恢复证据、整分支审查 | not-run | 历史商户查询不是恢复演练；PayPal继续全部延期 |
| PR / 合并 / 部署 / 上线 | not-run | 本轮没有执行；分别验收，不合并成“发布成功” |

## 应用恢复：环境与可复现边界

本轮最终串行回归：browser998/998；原ops120/59/16/847及Python12；全部退出0、零跳过。日志`/tmp/holaday-recovery-closure-browser-final.log`、`/tmp/holaday-recovery-closure-ops.log`。类型检查在1536MB堆OOM后、QA容器清理后，以2GB堆串行完成、退出0，`/tmp/holaday-recovery-typecheck-final.log`。不重跑/冒称此前8602项应用全套为本轮新证据。所有本轮测试进程均已退出。

源码快照：`/private/tmp/holaday-recovery-snapshot.152nsH`，由当前提交的apps/orchestrator、packages及工作区配置归档创建，排除全部`.env*`；复用现有依赖，无安装。执行前使用`env -i`，仅传合成DATABASE_URL/REDIS_URL/JWT、PATH、NODE_ENV、TZ、WS_PORT=39500和HTTP_PORT=39501。测试明确使用`vitest.integration.config.ts`，singleFork/非文件并行；应用运行于Mac Node，数据库运行于Linux容器，**不是Linux应用进程验收**。

专用资源标签`holaday.qa=recovery-0c24df2bc9ea998f`：新MySQL仅发布127.0.0.1:13316，新Redis仅发布127.0.0.1:16379，独立网络，无宿主绑定/生产凭据。数据库`holaday_0c24df2bc9ea998f_integration`只含本例合成数据；测试结束后核实标签并停止本例两个`--rm`容器、移除专用网络，合成库随一次性卷清除，不保留恢复用途。原holaday-mysql/holaday-redis保持健康且未操作。

在快照apps/orchestrator内执行的测试主体：

```sh
node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run \
  --config vitest.integration.config.ts \
  src/ws/restart-recovery.integration.test.ts \
  src/ws/restart-recovery-executing.integration.test.ts \
  src/ws/restart-recovery-transient.integration.test.ts --maxWorkers=1
node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run \
  src/agent/task-queue-persistence.test.ts --maxWorkers=1
```

不能直接在含真实dotenv的检出目录或默认3306/6379执行以上命令。首次未修改测试8/8日志`/tmp/holaday-recovery-ws-first.log`；最终9/9日志`/tmp/holaday-recovery-ws-final.log`；队列54/54日志`/tmp/holaday-recovery-queue.log`。

受控用例使用真实DrainController/状态文件、真实DB/JWT/WS，仅开放授权回调为显式合成成功，不冒充发布readiness。使用真实welcome及有序WS标记等待可观察输出，不把连接被拒绝/任意短暂sleep当成不重放。QA副本中唯一移除`state.work.controller`恢复保护后，strict=true收到实际click派发，1失败/3通过、退出1；恢复原保护后全部9项通过。日志`/tmp/holaday-recovery-strict-mutant-authorized.log`。原实现从未移除保护；变异仅发生在临时副本并已恢复。

第一次变异运行被沙箱阻止连接13316，hook失败及4项跳过，退出1；不计RED或验收。获准本地测试网络后才得到上述断言失败。类型检查1536MB首轮退出134（JS堆OOM），不算通过，最终结果见最新checkpoint。

## 工具安装范围核对

原22模块集合能导入检查入口，但未包含现场site/transition所需的6个现有模块。现将gateway-session、payments、recovery-session、registrations、site、transition绑定到原固定清单，继续要求完整集合、真实候选Git字节、文件权限和二次身份校验。不增加任意模块入口、默认facts、工具安装或生产执行权限；远端工具、native helper及运行时MySQL依赖仍各自核验，模块导入成功不代表它们已经安装可运行。

清单契约先出现15失败/4通过（`/tmp/holaday-coordinator-site-closure-red.log`），补齐正式清单后19/19。真实Linux Node22、已有QA镜像、无网络、只读scripts/ops、限1核512MB：19/19、零跳过、退出0（`/tmp/holaday-coordinator-site-closure-linux-verified.log`）。独立子进程导入真实28文件；身份校验用例的/proc/Git/UID依然是夹具，不能说完成真实受保护部署。

Linux前两轮导入探针分别错误触发CLI、使用不存在的argv[1]被原realpath保护拒绝（各18/19、退出1）；改为实际独立probe文件后通过，未放宽产品入口保护。完整浏览器回归首轮995/998、退出1：两个原发布夹具在env-i省略TMPDIR后继承/tmp的wheel组而拒绝，另一失败是上述已修探针；显式用户临时目录后的最终结果见checkpoint。

## 现场与恢复来源事实

UTC2026-09-28T16:18:20.951Z，沿既有阿里云跳板到Vultr，只读两次9223监听归属和本地`/json/list`。只返回数量/摘要：1个page、1个about:blank、其他目标0；监听前后稳定。没有导航、页面内容、cookie、profile、关闭页面、业务SQL或提供商调用。证明`/private/tmp/holaday-browser-source-observation.Q34mom/proof.json`，退出0；此时点证据不作为未来维护窗口凭据，也不说明空白页面没有执行脚本/外部副作用。

候选源码恢复入口核对：application-main受控启动跳过旧启动扫描/rehydration；WS executing在controller存在时禁止重新派发，本轮已用真实DB验证；队列只持久化状态，不会凭持久行重建原闭包。planned-runner仍有运行任务恢复入口，必须由实际生产者暂停/开启顺序及持久来源核对约束，不能仅凭启动扫描被跳过宣称所有恢复来源均已隔离。

下一步仍沿原4.R2/6.R3：完成独立现场facts及首次工具/单次入口接线，再做完整真实成功/故障闭环与恢复、非PayPal证据及整分支审查。不要重复13表、TCP、能力源码、密钥、商户或本文件已通过的恢复组件来替代缺失工作。
