# 普通模式维护发布：综合验收记录

## 范围与状态

2026-09-25；工作树 `/Users/yaleiqi/.codex/worktrees/browser-release-candidate/holaday-monorepo`，分支 `codex/browser-release-candidate-20260925`。Tasks 1–6 的本地实现、综合验证和一次独立审查已完成。最终验收源码提交为 `b86af4e9e72f3b260ef39b3b5864e35853546231`（Task 6），Task 5 为 `bedaa44d41b473f801b6001fa2adf90bc1ec82a9`。后续文档提交不改变该源码；停在生产切换边界，未部署。

这是维护发布链路的验收，不是浏览器任务成功率报告，也不等于生产已具备自动发布条件。没有修改 UI、安装扩展、连接线上 SSH、执行生产 SQL、重启服务、push 或合并。产品侧新增模型调用为 0，既有授权账本仍为历史记录 53/1000。

本维护实施相对 `5ec81b6a1997064524b30b3f9e1ba1552150390d` 的源码/测试/脚本差异共 101 个路径，逐文件字节数和 SHA-256 单列在 candidate-selection 的 maintenanceImplementation 中，原候选来源清单不覆盖。修改包括任务/HTTP/tRPC/WS 准入、原始异步生命周期、后台生产者/注销 worker 的停启边界，以及维护专用发布脚本。`src/payment`、`src/quota`、`src/db/schema`、`drizzle`、`apps/cn-payment`、前端、扩展及 shared packages 在这轮维护实施中无差异；HTTP 支付入口新增维护拒绝不等于修改支付结算规则。更早浏览器候选的 schema/费用变化仍以兼容性记录为准，不能用本轮无差异抹掉历史发布影响。

## 新鲜验证

### 最终修复后验收（以此表为准）

| 验证 | 结果 | 日志 |
| --- | --- | --- |
| 后端全量 | 504 文件，8518 通过，1 个既有跳过；前置 Node 73/73；退出 0 | /tmp/holaday-maintenance-postreview-full.log |
| 类型检查、生产构建 | 两项退出 0 | /tmp/holaday-maintenance-postreview-{types,build}.log |
| 真实子进程综合测试 | 7/7，退出 0 | /tmp/holaday-maintenance-postreview-composite.log |
| 维护控制/部署/身份 Node 测试 | 98/98，退出 0 | /tmp/holaday-maintenance-postreview-node.log |
| 完整运维回归 | pnpm test:ops 全链退出 0；各组计数不重复合并成产品用例数 | /tmp/holaday-maintenance-postreview-ops.log |
| 隔离真实 MySQL | 3 文件、11/11；容器身份及随机库清理核对通过 | /tmp/holaday-maintenance-postreview-mysql.log |
| 本地信号单元 / 隔离 Linux pidfd | 4/4 再跑通过；Linux 3/3（相关源码此后未变） | /tmp/holaday-maintenance-final-python.log、/tmp/holaday-maintenance-linux-kernel.log |
| 五个维护 shell 语法、git diff --check | 均退出 0 | 本轮命令记录 |

最终顺序运行的命令（综合 integration 不包含在默认全量里，已显式执行）：

```bash
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/execution/ordinary-maintenance.integration.test.ts
node --test scripts/browser-maintenance-*.test.mjs scripts/deploy-browser-maintenance.test.mjs
pnpm test:ops
git diff --check
```

MySQL 的显式 opt-in/13316 地址守卫和 Linux 容器边界见下方环境说明及计划 Task 6；不是直接运行全部 integration 或连接默认业务数据库。各项通过不取消文末生产条件。

### 实施过程证据（历史阶段，不重复计入最终结果）

| 验证 | 当前已取得的结果 | 日志 |
| --- | --- | --- |
| Task 5 后端全量 | 502 文件，8509 通过，1 个既有跳过 | /tmp/holaday-maintenance-task5-full-new.log |
| Task 5 发布/控制/进程 Node | 98/98 | /tmp/holaday-maintenance-task5-node-new.log |
| Task 5 完整 ops | 退出 0；保留其他服务测试，仅替换普通候选旧回退断言 | /tmp/holaday-maintenance-ops-new.log |
| Task 5 类型与构建 | 均退出 0 | /tmp/holaday-maintenance-task5-{types,build}-new.log |
| 综合子进程 | 7/7；真实 HTTP、WS、Unix socket、实际退出 | /tmp/holaday-maintenance-composite-green.log |
| 开启 retention / crystallization 的应用组合 | 13/13，含两个新场景 | /tmp/holaday-maintenance-periodic-composition-final.log |
| 真实 QA MySQL 执行记录、费用 | 10/10；随机库清理和连接局部临时表释放已核对 | /tmp/holaday-maintenance-mysql-final.log |
| 真实 MySQL readiness 元数据 | 1/1；大写列名问题 RED 后使用显式别名修复，兼容 schema 通过，不兼容费用列拒绝 | /tmp/holaday-maintenance-metadata-{red,green}.log |
| Python 信号身份单元 | 4/4 | /tmp/holaday-maintenance-task5-python-new.log |
| Linux 内核 pidfd | 3/3；实际子进程 SIGTERM、错误 start 拒绝、非 Node 命令拒绝 | /tmp/holaday-maintenance-linux-kernel.log |

审查前全量 502 文件、8511 通过、1 个既有跳过，类型/构建、综合 7 项、Node 98 项、ops、Python 均通过，见 /tmp/holaday-maintenance-final-*.log。这些属于审查修复前证据；最终结果以上方“最终修复后验收”表为准。

## 独立审查与集中修正

一个 Sol 高推理审查者只读检查指定维护差异和新综合测试；未执行生产或修改文件，已关闭。发现三项，已按源代码核实并集中修正：

1. **纯校验误锁全局接单**：公共 tRPC builder 自动识别无自定义回调的内建 Zod 结构，将原始解析错误绑定到当前 procedure owner。内建鉴权仍保留原有精确拒绝证明；任意自定义前置 middleware 会取消后续自动豁免，避免先写入后校验却被当成纯失败。transform/refinement/default 工厂等未审计自定义行为，以及业务 resolver 可能产生副作用后的拒绝，仍然保守拒绝。没有根据 BAD_REQUEST/UNAUTHORIZED 字符串整体放行。
2. **批量分离执行归属遗漏**：startBatchExecution 复用 runTaskBackground；请求返回后原 executeBatch Promise 仍被持有，执行失败即使被日志 catch 也保留 unknown。初次测试受不相关动态模块加载时间影响，已修正 fixture 后重新证实旧实现 active=0 的 RED，再恢复修复。
3. **屏幕流维护旁路**：普通模式给 screencast proxy 注入同一准入；异步鉴权属于原始工作，完成后重新核对维护状态；已连接通道的每次实际输入拥有原 Promise，关闭后新输入和排队 viewport 不再派发。native/未配置模式不启用新增普通模式入口。

修复定向证据：纯输入初始 2 RED → 17 GREEN（含原 task drain）；中间件顺序保护额外 1 RED 后修复；批量 2 RED；屏幕流 2 RED → 21 GREEN；三项合并一度 18 GREEN。以最后整体验证记录为最终结果，不以早期部分结果宣称全部完成。

第一轮修复后全量暴露一个接口兼容回归：原有 astrology 测试读取输入 schema 的同步 `parse`，新包装只保留 `parseAsync`。已将自动审计改为保留原 schema 的代理，仅包装 tRPC 使用的异步路径，没有删除或削弱原测试。原失败用例与维护输入、批量和流通道回归合计 17/17 通过（`/tmp/holaday-maintenance-schema-compat-green.log`）；随后重跑全量。

审查者未判定范围及裁定：真实发布主机 PM2/UID/内核行为仍须部署前证明；支付回调重试与独立写入者仍是明确阻塞；端到端浏览器成功率不在本维护验收内；未追踪的所有 router/adapter 不能宣称已经全面审计。父执行者额外完成 MySQL 元数据与容器 pidfd 验证，不冒称审查者独立复核过这些修复。未再启动第二轮代理审查。

## 十个验收场景

| 设计场景 | 证据与边界 |
| --- | --- |
| HTTP / 内部 caller 关闭并发 | http-drain、ordinary-maintenance-entry、tasks.drain；综合用例确认关闭后任务/支付入口返回 503，合成写入计数不增长；真实任务扣费前拦截由路由单元验证 |
| WS 新指令和原回执 | ordinary-maintenance-receipts + 综合用例；原 client/request 匹配回执完成，错 request/replay 不提前释放 |
| 请求结束后分离子工作 | 综合用例在 HTTP 202 后仍 active，原回执到达仍等待原始 child Promise；它结束后才 idle |
| 暂停、待确认、队列 | readiness 保留 paused/awaiting_user，只读查询；非空队列拒绝；真实 MySQL 执行记录测试验证兼容，不清空任务 |
| 断线、超时、清理失败 | 既有 HTTP/WS/drain 原 IO 测试 + 模拟 host failure；综合 dirty crash 保留 writer lock，rename 失败/身份替换不能产生干净证明 |
| 新进程关闭启动 | application-entry / application-main.wiring / start guard；新实例关闭且不运行恢复 sweep；有标记时缺配置不回退旧模式 |
| 迁移、启动、readiness 失败 | 实际 host adapter 注入底层命令失败；迁移不重试、不启动旧 checkout；阶段在动作前持久保存 |
| 新执行记录与 NULL 费用 | 13316 隔离 MySQL 10 项，额外实际 metadata 1 项；不改业务库 3306 |
| 旧版本无协议 | 复制的真实 shell 入口 + 假 SSH；旧版/失败/格式异常时只有 probe，没有上传、clone、停机或迁移 |
| 正常维护/恢复 | host/transition 测试同实例单次 open，丢 ACK 仅查同实例状态；worker 在 open 后恢复；真实综合测试证实实际监听器关闭 |

## 入口与生命周期覆盖

| 入口 | 准入/归属位置 | 原始工作终点 | 证据 |
| --- | --- | --- | --- |
| HTTP 普通路由、支付回调 | createHttpDrain + 显式 handler/middleware | response 生命周期及 handler 原 Promise，子工作单独归属 | http-drain.test、http.execution-drain-wiring、综合子进程 |
| tRPC / 内部 createCaller | 同一个 ExecutionAdmission + procedure 子生命周期 | resolver 原 Promise，纯输入/原始鉴权拒绝有精确豁免 | ordinary-maintenance-entry、tasks.drain |
| 分离任务执行 | task-background / owned-operation | 原执行与最终持久化 settle | task-background、task-queue-execution、cloud workflow |
| 批量任务分离执行 | startBatchExecution / runTaskBackground | 原 executeBatch Promise；日志 catch 不清除 unknown | batch-tasks.maintenance.test |
| 扩展 WS | 原连接、原任务和 requestId 绑定 | 原 tool_result 或原 transport 失败/清理 | ordinary-maintenance-receipts、server-drain、综合子进程 |
| 屏幕流鉴权、人工输入和 viewport | screencast proxy / owned input bridge / 同一 ExecutionAdmission | 原鉴权与连接准备 Promise；原输入动作 Promise；关闭后排队 viewport 不执行 | screencast-maintenance.test、既有 streaming 回归 |
| 定时、队列、heartbeat | periodic-work / producer registry / 原数据库 Promise | 清 timer 后继续等原工作；不能靠计数归零 | poller-stop、cleanup-drain、task-heartbeat、开启 flag 的 main 组合 |
| 独立注销 worker | 持久标记 pre/post page | 当前页实际结束、DB 关闭、原 PID 消失 | worker-maintenance、worker-entry、综合 worker page、host runtime |
| 本机维护控制 | 私有 Unix socket + SHA/bootId | close 是关闭屏障，wait 才是排空证明 | store/control/client、真实 Unix socket 综合用例 |
| 发布入口 | capability → 配置/全 SQL manifest → 独占阶段日志 | 旧实例/worker/监听器物理退出，再迁移和关闭启动 | entry/host/transition/journal/Linux tests |

## 测试环境与清理

- 数据库仅为已验证名称 `holaday-control-qa-20260914-mysql-1` 的 `127.0.0.1:13316`。凭据只在内存传递；不访问业务 MySQL 3306。执行记录测试创建独占随机库；费用测试用连接局部临时表；metadata 测试创建并删除自己的随机库。
- 子进程只有显式合成环境，cwd 为本例临时目录，不加载工作树的本地密钥。测试 teardown 只停止本例创建且仍存活的 ChildProcess，移除自己的临时目录。
- Linux 验证用新下载并缓存的 `python:3.12-slim`（镜像摘要 `sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9`），容器只读、无网络、无 host PID namespace，脚本只读挂载，/opt 为容器临时内存盘。容器已自动移除；镜像保留缓存。
- Linux 合成子进程为 Python：真实验证 pidfd/UID/start/cwd，测试专用子类只将精确 Python 命令映射为 main；生产解析器必须拒绝该 Python 子进程。**这不是完整真实 PM2 + Node22 主机演练。**

## 部署前仍需明确的条件

1. 首次旧版引导：历史生产版本没有维护协议时，当前入口必须拒绝。需要单独批准停机窗口、流量关闭、旧任务处理和首次私有状态/目录/用户配置；不伪造旧版 idle。
2. 支付回调、独立写入者：目前 servicesCheck 明确拒绝 `MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN`。创建支付订单的旧 preflight 不能证明停机期间回调重试；不得加布尔旗标当证据。
3. 精确生产候选、配置摘要、全部编号 SQL/runner 摘要、备份恢复安排都要在部署批准中列明。当前源码只允许维护保持，不允许新 schema 后自动启动旧版本。
4. 真实目标 Linux 主机上的 PM2/Node22/非 root 身份、进程自动重启设置和监听归属仍需部署前核实；Mac 容器测试不代替该证据。
5. 浏览器 QA 成功率、Chrome 登录态与 UI 产品验收仍是另一条证据线。不能从维护测试数量推断执行成功率。
