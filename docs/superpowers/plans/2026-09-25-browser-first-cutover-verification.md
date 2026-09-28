# 浏览器首次切换验收记录

## 当前结论：未完成，不能执行生产切换

2026-09-29续跑（基于`e994cfd0`）：原6.R3预定Linux入口现串联真实transition/site/journal及PM2/pidfd停止，新增非支付HTTP动作已发生但响应丢失的未知/已知配对。只覆盖停止与故障保留段，未覆盖完整恢复/新候选开放；详见下方“丢响应物理演练”。不重试被拒绝的数据库管理凭据查找，现场独立facts仍未具备。

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
| 6.R3全流程成功/故障/丢响应不重放 | partial | 已接真实transition/site停止及故障保留段，独立HTTP计数为1；恢复/候选/open尾段明确拒绝，完整成功与晚到故障仍未运行 |
| 实际生产停写备份→Mac隔离恢复 | not-run | 既有合成MySQL/age历史通过不改称生产恢复；本轮不重做密钥和已有组件 |
| 非PayPal支付恢复证据、整分支审查 | not-run | 历史商户查询不是恢复演练；PayPal继续全部延期 |
| PR / 合并 / 部署 / 上线 | not-run | 本轮没有执行；分别验收，不合并成“发布成功” |

## 丢响应物理演练：2026-09-29停止/故障段

入口是原计划中的`scripts/browser-first-cutover.integration.test.mjs`，不是新框架。真实LinuxNode22.20/PM2 6.0.14，缓存镜像`holaday-first-cutover-age:qa`，无网络/宿主端口/生产挂载/凭据，私有PID，1CPU/512MB；SYS_PTRACE仅限该容器内既有跨UID进程观察。只读挂载当前scripts和ops。每个案例新容器，结束自动删除该容器合成进程/数据，不触碰原MySQL/Redis。

| 本次验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 未知旧请求：真实动作后断响应→停止→恢复未配置而保留失败 | 1/1，退出0，零跳过；计数1、风险摘要保留、QA resurrect不恢复旧进程 | `/tmp/holaday-lost-effect-unknown-verified.log` |
| 已知未决动作：拒绝中断，不进入停止 | 1/1，退出0，零跳过；site拒绝码、旧健康端口仍200、计数1 | `/tmp/holaday-lost-effect-known-site-contract.log` |
| 临时副本移除已知动作保护 | 0/1，退出1，零跳过；实际错误进入backup_verified，阶段断言捕获 | `/tmp/holaday-lost-effect-mutant.log` |
| 原`--execution-site-interruption`物理模式 | 退出0；ss/真实受保护日志/PM2/pidfd停止与无关进程恢复断言通过 | `/tmp/holaday-lost-effect-original-physical-verified.log` |
| 原`pnpm test:ops` | 120/59/16/868及Python12，全部退出0、零跳过 | `/tmp/holaday-lost-effect-ops.log` |
| 两个触及MJS Biome、git diff --check | 退出0 | 本轮命令结果 |

不宣称本轮重跑完整browser1019、应用全套、类型检查或独立整分支审查；未改应用/生产模块。原ops的固定测试列表不包含新Linux入口。手工Mac广义`browser*.test.mjs`枚举必须排除`*.integration.test.mjs`，再单独运行下列真实Linux案例；入口在Mac/缺少场景变量时硬失败，没有用skip替代Linux验证。

在当前工作树执行，两例串行、每例新容器，任一失败立即退出：

```bash
cutover_workspace=/Users/yaleiqi/.codex/worktrees/browser-release-candidate/holaday-monorepo
for cutover_case in unknown known; do
  docker run --rm --network none --cpus=1 --memory=512m --cap-add SYS_PTRACE \
    -e "CUTOVER_QA_LOST_EFFECT_CASE=$cutover_case" \
    --mount "type=bind,src=$cutover_workspace/scripts,dst=/source,readonly" \
    --mount "type=bind,src=$cutover_workspace/ops,dst=/ops,readonly" \
    holaday-first-cutover-age:qa \
    /opt/node22/bin/node --test /source/browser-first-cutover.integration.test.mjs || exit "$?"
done
```

原模式用Node父进程`spawnSync`启动`/source/fixtures/browser-registration-removal-linux.mjs --execution-site-interruption`，把子退出码原样传回；不能直接让观察夹具成为容器PID1，因为原身份契约要求pid>1、ppid>=1。新入口天然由node:test派生子进程，满足此约束。

初始失败保留：`/tmp/holaday-lost-effect-linux-first.log`退出1、0/2，分别是夹具误读journal摘要为完整before对象，以及同容器第二案例残留PM2路径；已按实际摘要形态断言、每例改独立新容器，未改生产校验。`/tmp/holaday-lost-effect-original-physical.log`退出1来自上述PID1启动错误，父子结构复核通过。追加拒绝码断言时错误期待内部MAINTENANCE码，`/tmp/holaday-lost-effect-known-verified.log`退出1、0/1；核对真实site.run统一包装为CUTOVER_SITE_UNPROVEN后只修预期，最终site-contract日志通过。初次Biome的独立block、label、模板及导入排序4项失败已在测试代码修正。上述夹具/调用错误不是产品RED；只有临时模块缺失保护的变异属于有效反例。

**尚缺：** 这里的阶段名backup_verified是失败发生时的预写意图，不是恢复通过。真实failureObservation记录新候选not-started、关闭未确认；没有fake backup/migrate/start/verify/open成功。其他主机、入口、业务/SQL/恢复来源观察仍是明确的合成依赖。原6.R3完整成功、候选dirty、开放后已知动作关闭及不重放、真实停写备份/Mac恢复、非PayPal恢复证据和整分支审查均未完成。下一轮应复用此入口接剩余尾段，不重做计数器/停止组件。

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
