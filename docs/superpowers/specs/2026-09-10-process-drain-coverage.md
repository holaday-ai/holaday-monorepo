# Orchestrator 安全排空覆盖清单

静态核对基线：`2a4e253e6a395f462489601d4e20e6a94ed546cf`，2026-09-10。以下路径相对 `apps/orchestrator/src`。这是实施覆盖清单，不是运行时排空证据或发布许可。未检查生产、环境变量值或任何用户数据。

## 结论与覆盖口径

目前只有显式注入控制器时的 tasks.create/reply 入口及核心文本子链有局部所有权证明。`index.ts` 没有构造/注入控制器，`http.ts` 的依赖传递也未接入，实际进程不能报告全局已排空。

静态解析 `trpc/router.ts` 的相对导入、router 对象、别名、展开和本地工厂返回值，得到 **239 个挂载路径：150 mutation、89 query**；未解析项0。直接扫描定义只有149 mutation/87 query：差异来自 tasks 的两个兼容别名和顶层health，不能把定义数量当挂载数量。此计数只描述当前源码路由树，不执行模块、不证明运行时可达性、权限、功能开关或 query 无副作用。

所有行仅允许以下状态：**局部已接**、**未接**、**外围受限待核**。最后一种不能从计数中排除。标为禁止业务领域的行仅登记暴露面，不修改其规则；若完整维护方案需要新的影响范围，先报告真实决策问题，不偷偷排除这些请求。

## 一、HTTP / tRPC 入口

| 入口 | 接纳与原始工作 | 当前状态与所缺证据 |
| --- | --- | --- |
| `http.ts:93–95` 日志/body/auth中间件 | 位于所有路由前；认证可读DB，上传解析有资源生命周期 | 未接；路由内登记不能覆盖此前await；连接断开不代表handler/上传/底层IO结束 |
| `http.ts:97` healthz、`trpc/router.ts` health | 纯健康响应 | 不能证明其他入口安全；应保留维护期健康可读，但不以health响应放行 |
| `http.ts:106` source-cover | 外部抓取及响应流 | 未接；需覆盖fetch原始Promise、响应体清理，客户端取消不能解除原始占用 |
| `http.ts:202/237` OAuth、`:1542` sms-login | 会话认证与可能的DB/外部副作用 | 外围受限待核；不改认证/注销业务，不能简单豁免所有GET |
| `http.ts:632` stream-token | 认证与令牌签发 | 未接；只报告聚合，不输出token |
| `http.ts:655/764/853/906` 文件上传、直传申请/确认、下载 | multer、对象存储、DB、流关闭 | 未接；需要原始上传/存储确认/下载流和迟到回执证明 |
| `http.ts:959/1089` cookies sync、浏览历史 | DB与缓存/浏览器状态 | 未接；不得在审计中输出原始cookies/浏览记录 |
| `http.ts:386/1158/1220/1233` 支付相关 | 回调、内部确认及健康 | 外围受限待核；支付/Partner Ledger业务不改，外部维护阻断或隔离必须有实际证明 |
| `http.ts:1618` tasks webhook | handler被void派发；API-key验证、claim、任务create、finalize位于自己的调用链 | 未接；handler返回HTTP/内部create ACK均不能释放父链；buildContextForUser没有控制器/lifetime |
| `http.ts:1622` tRPC适配器 | context构造后调用路由，存在内部createCaller来源 | 未接；不能仅在Express连接finish/close上释放；需覆盖嵌套调用而不是重复接纳根 |
| `index.ts:704` HTTP upgrade | screencast/VNC各自的认证、CDP、socket、重验证、清理 | 未接；不等于普通HTTP请求，关闭HTTP listener不会完成upgrade子工作 |

### tRPC 挂载树清点（mutation/query）

| 命名空间 | mutation | query | 状态 |
| --- | ---: | ---: | --- |
| health | 0 | 1 | 纯健康，不作为放行依据 |
| tasks | 20 | 5 | 仅create/reply局部已接，其他入口未接 |
| teamTasks | 22 | 5 | 未接 |
| projects | 5 | 3 | 未接 |
| scheduledTasks | 5 | 1 | 未接 |
| batchTasks | 2 | 2 | 未接 |
| plannedTasks | 8 | 4 | 未接 |
| files | 2 | 2 | 未接 |
| stocks | 5 | 8 | 未接，包含preference与risk-monitor展开 |
| watchlists | 5 | 2 | 未接 |
| videoOnboarding | 4 | 1 | 未接 |
| videoEditing | 11 | 2 | 未接，静态解析本地工厂，不执行工厂 |
| astrology | 0 | 8 | 未接，不能假设query不调用外部服务 |
| energy | 1 | 2 | 未接 |
| memory | 2 | 1 | 未接 |
| feedback | 1 | 0 | 未接 |
| roles | 1 | 1 | 未接 |
| skills | 1 | 1 | 未接 |
| apiKeys | 2 | 1 | 未接 |
| connections | 0 | 1 | 未接 |
| usage | 0 | 1 | 未接 |
| llmCalls | 0 | 1 | 未接 |
| notifications | 2 | 2 | 未接 |
| notificationChannels | 4 | 1 | 未接 |
| organizations | 8 | 2 | 未接 |
| auth | 15 | 3 | 外围受限待核，业务不改 |
| accountClosure | 4 | 3 | 禁止业务领域，仅登记 |
| payment | 4 | 5 | 禁止业务领域，仅登记 |
| quota | 0 | 1 | 禁止规则修改，仅登记 |
| partner | 6 | 4 | 禁止业务领域，仅登记 |
| admin（含finance/partner/learning） | 10 | 15 | 混合范围；禁止领域不改，未证明隔离不能忽略 |

tasks 的另外18个mutation路径：smokeTest、pause、resume、confirm、confirmVideo、abort、wakeBrowser、ensureBrowserSession、checkpointBrowserSession、resetBrowser、browserNav、delete、clearUnsuccessful、clearFailed、rename、star、moveToProject、modeBPing。clearFailed/clearUnsuccessful为同一procedure的两个挂载路径；failedCount/unsuccessfulCount也为别名。取消或删除任务不能作为维护清场手段。

## 二、请求派生、可选工作与原始 IO

| 路径/锚点 | 已有机制 | 仍需补齐 |
| --- | --- | --- |
| `trpc/task-drain.ts` → tasks.create/reply | 显式controller下注入有效root；tRPC错误数据保守未知 | HTTP/auth和内部caller传播；不自动证明所有mutation或所有子任务 |
| `agent/core-task-execution.ts`、`core-task-recovery.ts` | ACK与completion分离，admission/settlement原始DB、派生建议占用；期限未知不自动清 | 业务事务证据与未知能力安全关联，禁止全局reset |
| `trpc/routers/tasks-core-create.ts` | shell INSERT原始DB与15秒等待分离 | core之前/之外的create分支及内层IO |
| `tasks-core-advisory-plan.ts`、`tasks-core-suggestions.ts` | logical/raw owner分离，DB、模型、外层期限、异常ACK留未知 | 本机制仅属于局部核心链；不是通用数据库代理 |
| `llm/model-operation.ts`、Qwen messages/responses | 每次派发绑定当前scope；fetch/JSON/read/cancel及迟到清理保留占用 | 无scope兼容调用仍无跟踪；不能因供应商配置存在就假设所有lane启用或关闭 |
| `tasks.ts:2156/2831/2995/3086/3212/3500/4020/4731`及后续分支 | legacy/image/video/generate/scrape等void链、runFn、保存、日志、广播 | 未接；必须在ACK前预留子owner，不能用结束请求留下的ALS上下文派发 |
| `planned/planned-runner.ts:240` startRunDispatch | queuePlannedRun先写run，再void dispatchPlannedRun | 未接；poll tick完成不等于这个dispatch或其通用/批量/专项子任务结束 |
| `trpc/routers/stocks.ts:1706`及startDashboardRefresh | query触发后台完整刷新、持久化snapshot，可能先回缓存 | 未接；这是query有后续写入的实际反例，freshness标签不变 |
| `files/file-service.ts:1216` loadMany；`files/parsers.ts:114` PDF | loadMany顺序await DB/storage；PDF await getText，finally await destroy | 局部父链会等待显式await，但SDK内层取消/清理/失败仍需原始边界证据，不能只看没有Promise.race |
| `agent/task-heartbeat.ts:19` | 定时更新executing.updatedAt，stop仅清interval | 未接；停止时原始写可能未完成，onError不能吞掉提交未知 |
| `agent/generate-runner.ts:471` | 进度超时timer只触发Abort | 其Qwen传输在有scope时已接；timer停止/Abort不证明底层完成 |

## 三、WebSocket 与浏览器子工作

`ws/server.ts:119` 创建listener；connection handler被void派发，认证首个await前未接纳。`:769` async message回调无统一owner，`:863` step.result再次void派发。`:155` close清两类timer并等待wss.close，但未汇集这些handler原始Promise。

| 分支 | 工作/当前边界 | 待证明 |
| --- | --- | --- |
| client.hello、session revalidation | 认证DB、rehydration，后者周期void | 关闸后的新认证与已有连接重验证分别处理；关闭socket不释放未完成DB |
| client.step.result → runStepResult | self-heal、控制器effects、DB保存、可能再派发步骤 | 必须继承原执行而非凭消息ID创造owner；重复/迟到消息不能新派发 |
| client.vision.user_input | CDP输入/点击/滚动；pool或singleton | 属外部行为，需真正原始执行结束证明，不能按UI响应证明完成 |
| tool_result、vision observation/acted | 已有pending resolver | 结果应归属已接纳的调用；维护关闸不能把必要回执也全部拒绝 |
| sendExtensionToolCall `:584` | timeout删除pending并resolve调用结果；扩展端动作可能继续 | 提交未知与远端完成分离；timeout/socket.close不是远端动作完成 |
| pong、task.ack、screenshot、login_states | 内存/确认/遥测分支 | 可划定纯内存例外，但要明确分类与测试，不能以所有WS都是只读豁免 |
| streaming/screencast-proxy、cdp-streamer、VNC | session revalidation、touch timer、CDP watchdog、socket事件与输入 | 独立upgrade链未接；浏览器shutdown/子进程回收需平台级真实验证 |

## 四、boot、定时器、队列与停止

静态源码发现18处setInterval调用（含未启用的新control-server）；这不是18个实际运行timer，条件启用、每连接/每任务实例和其他timeout/microtask需分别核对。

| 路径 | 开始/实际工作 | 停止现状 | 状态 |
| --- | --- | --- | --- |
| index main前半段 | CDP连接/managed浏览器、orphan reap、pool GC、资源adapter | 可在HTTP监听前产生IO/子进程 | 未接，禁止启动副作用来做本地核验 |
| index:349 →后续boot | HTTP已listen后才启动cleanup、恢复scheduled/planned和boot sweep | startup失败可能process.exit；不是原子closed启动 | 未接，开放顺序必须后续统一改造 |
| scheduled-runner:start | 立即tick；周期先recover再tick；DB claim/dispatch/advance/notify | stop清interval并把running置false，旧tick仍可能活跃 | 本轮优先修停止屏障；其业务未知和子派发仍未接 |
| planned-runner:start | 立即/周期recover、override/reminder、tick、sync | stop清interval并把running置false，旧tick仍可能活跃 | 同上；不改recover/claim/任务分配规则 |
| queue/task-queue | enqueue微任务、5s tick；onStart/runFn/onTimeout | stop只停止未来tick，保留queue；原始callback未汇集 | 未接；待派发queue必须占用，不能只数inFlight；不准丢队列清场 |
| energy/analytics-cleanup | 立即、小时、1s backlog续跑；多轮DB删除 | stop有generation，未等待当前删除 | 未接；不得触碰或输出分析原始个人数据 |
| api-keys/webhook-idempotency-service | 立即及小时cleanup DB | stop只清timer | 未接；错误catch返回0不能证明远端没删 |
| a-share/prewarm-scheduler | 每分钟检查时段；并行HTTP warm及symbol-table刷新 | index未保存返回停止函数；clearInterval不等待warm | 未接；allSettled/请求timeout不等于物理结束 |
| index:811 runtime reaper | 60s void sweep写任务状态 | interval unref但shutdown未清/等待 | 未接；不能用reaper改终态充当排空证据 |
| index:862 retention reaper | 条件24h清对象与DB | 未汇集当前sweep | 未接；未实际启用状态不得猜测 |
| index:891 crystallize | 条件6h写draft operation_paths | 未汇集当前sweep | 未接 |
| browser-pool:startGc | 周期GC/释放、浏览器子进程 | stopGc仅timer；shutdown另有kill/清理 | 未接；必须与OS后代回收证明关联 |
| auth/websocket-session-revalidation | socket存续期认证周期 | 清timer不代表当前认证结束 | 未接，不能当作任务无关即可忽略 |
| execution/drain-control-server | 新本机协议轮询/租约状态 | 单元已测，boot未接 | 局部已接；它自身不证明应用全覆盖 |
| index:934 shutdown | energy.stop → ws.close → http.close → executor disconnect → queue.stop → pool.shutdown → exit | 未先停止全部生产者，也未等待所有后台链；DB pool无统一收口证明 | 未接；不能直接增一行controller.close就放行 |

## 五、下一实施单元与不可跳过的发布门禁

先完成**两个轮询器的可等待停止屏障**：清timer同步生效，保留原始tick Promise；停止期间不因重启清running而重叠派发，旧generation不能再起新tick。只改变生命周期，不改schedule/planned的claim、recover、notify、额度或账号规则。原始tick可能继续完成其既定操作，stop不是取消。这个屏障仅证明poll tick结束，不证明其void子任务、原始IO提交结果或整个进程安全。

随后依次补：这些producer的真实root/子链与未知跟踪；内部createCaller传播；queue/legacy派发；HTTP/auth/WS及其他query/mutation；后台刷新/附件/SDK清理；统一closed boot和停止顺序；业务对账。每个未接入口必须继续阻断发布，而不是用默认false开关或局部snapshot0豁免。

首次PR231维护、旧boot对账、准确parked记录、新候选与独立备份、真实Linux/PM2/千问、有效新生产窗口仍是独立门禁。源代码静态清单无法替代实际部署拓扑、进程清单、条件开关、反向代理和独立worker证明；禁止领域及独立worker未核实前保持阻断。本轮不访问生产也不修改那些领域。

## 3D-2a 本地增量：scheduled 调用边界（2026-09-10）

以上表格保留2a4e253e静态基线。后续83077cfb先补两个poller的stop Promise/generation；本单元再为scheduled增加可选controller接纳、scheduler子链和每个DB/hook原始调用包装。真实Drizzle事务外层持有commit/rollback，内部select/update另有子owner；hook第二参数仅传进程内lifetime，可在ACK前reserve后续子工作，不能由任务ID或已释放父句柄重建。

内部DB/hook抛错以及无法确认的UPDATE/dispatch回执保留未知；有scope的单行ACK仅0/1可信，不可信回执不派发任务/提醒。未知存在时暂停新的poll pass，周期recovery新增未知后不继续该pass的tick，不以恢复扫描重放未确认工作。既有无scope业务提取/调用契约保留。

状态仅为**局部已接**：index尚未注入控制器，也未把hook lifetime传给其手工Context；真实notify的allSettled吞错、briefing/通用任务内部catch及ACK后子任务，尚不能由外层Promise证明收口。planned、队列、其他入口、boot及业务对账仍未接，不是scheduled全链或全进程发布证明。本地测试的mysql2/业务hook是合成外部边界，未验证实际MySQL、通知供应商、千问或生产。

## 3D-2b-1 本地增量：planned queue → dispatch 交接（2026-09-10）

在可选controller上下文下，queue/dispatch接纳绑定真实server-only owner；queue事务提交后或scheduled已有pending分支均同步预留dispatch子owner再返回starting。原始DB、事务commit/rollback、所有调用到的计划持久化以及账号门禁读取均有database子链。保留业务SQL和原有owner gate，不新增账号规则。内部special/tasks/batch caller以自己的子owner传Context；非法、跨控制器、缺失或已结束权限在IO前拒绝，不从runId恢复权限。

不可信单行UPDATE回执拒绝继续派发；INSERT运行要求正安全整数ID和单行ACK，事项INSERT要求准确行数。原始IO错误和被业务catch吞掉的派发错误留未知；special结构异常不能回落generic，失败或缺持久化证明的special回执保留未知（既有明确inactive-owner停止契约仍保留）。已有未知阻止新的queue/dispatch，但原有数据库收尾仍可完成。无controller且无继承scope的旧路径保持兼容。

边界仍是**局部已接**：planned poller、reminder、sync及index boot尚未注入/接纳；特殊执行器内部和batch executor的detached工作仍须各自预留owner。这里仅证明这些caller的Context/调用Promise和本runner的原始数据库，不证明其所有内部副作用。合成mysql2测试执行真实Drizzle事务；实际tasks/batch router只到合成用户查询失败边界，不调用模型、不证明真实用户任务完成。未做真实MySQL、Linux/PM2、千问或生产验证；不得把本单元合并部署。

下一单元：planned poller root、hook lifetime、所有poller原始IO、sync/stop和未知屏障；之后继续queue/真实caller内部链及剩余入口，发布阻断不解除。

## 3D-2b-2 本地增量：planned poller 原始生命周期（2026-09-10）

可选controller在真实pass首个recover SQL前持久接纳并建立scheduler子链。recover/normalize/reminder/tick/sync新增25个原始查询、写入及事务包装；单项/批量sync和commit/rollback均随原始Promise结束。stop的既有pending/generation不变，仍等待末端sync，而不是只等待queue ACK。无scope保留回调receiver和单参数契约；有scope的queue/notify在自己的execution子链中接收第二参数lifetime。

受控模式下，恢复扫描在控制器存在任何活动或未知时暂不接纳，包括已返回queue ACK但仍有detached子操作的情况；这是一项保守的接纳节流，可能延后轮询，不取消或改写业务任务清场。阶段/候选循环之间存在未知时不再开始后续派发；hook调用前再次检查未知。真实原始错误在业务catch前留未知，不可信UPDATE回执阻断，确定0行与合法多行recover兼容。受控直接plannedTick必须在同一drain有效scope中，不能借导出函数跳过准入。

审查补强：queue尚未真正调用前的准入拒绝不进入旧业务失败UPDATE，保留已有claim和未知供对账；只有实际调用queue后抛错才保留原失败处理。控制器活动检查是pass起点快照，不是跨所有入口的排他锁；未接入口、其他producer后续接纳及真实hook内部边界仍必须在整体接线中验证，不能宣称全局互斥恢复已实现。

该增量仅证明可选注入的poller链；index的boot recovery仍无controller，真实hook手工Context还未传lifetime，special/batch内部detached及scheduled对应真实hooks也仍未接。全局活动屏障仅涵盖已经登记的操作，不能证明未接入口无工作，也不作为全进程排空证明。真实MySQL、通知/千问、Linux/PM2和生产没有验证，发布阻断不解除。下一步继续task-queue/批量与真实hook内部的ACK后链，然后统一boot及剩余入口。

## 3D-3a 本地增量：任务队列待派发与回调生命周期（2026-09-10）

可选controller下，enqueue在返回ACK前同步预留排队owner，父请求结束后仍计活动。内部释放能力只存在私有WeakMap，不放入回调可见的receiver或snapshot。输入/时间/容量读取在预留前完成，准备异常不入队、不泄漏owner。无controller且无scope保留原FIFO、容量、超时阈值、回调receiver和零参数时序。

onStart/runFn/onTimeout各自在排队owner下建立执行子链，传入实时server-only lifetime，实际原始Promise结束前保持pin。同步失败立即留未知，异步拒绝在业务catch前留未知；未知或blocked时不移除待派发条目、不触发后续callback。实际派发前再次检查持久状态/owner。普通关闸后已预留链仍可收口，普通finish与signalSlotFreed不能释放原始工作。

stop同步停止timer和未来接纳，等待当前回调屏障；屏障在诊断日志/回调之前登记，日志异常不能破坏该屏障。尚未派发的队列原样保留且仍占用，不能把stop返回视为全局idle；回调在ACK前预留的子工作也独立持续占用。停止不取消业务任务、不提前触发超时清场。

状态仍为**局部已接**：index创建queue尚未传controller，tasks.ts两处enqueue尚未传lifetime，也未以callback子lifetime重新构造Context。真实onTimeout内部吞错、markQueuedTaskExecuting/Failed的DB及回执、浏览器runFn内部detached和清理仍需跟踪。现有rejected统一写QUEUE_REJECTED业务失败；后续接线必须区分容量拒绝与安全准入拒绝，不能把未真正派发的安全拒绝误写为业务失败。此次测试使用真实queue/controller/状态文件和合成回调，不含实际浏览器/模型/DB/生产；全进程发布阻断不解除。

## 3D-3b-1 本地增量：队列状态实际数据库边界（2026-09-10）

TaskRepository.markQueuedTaskExecuting/Failed在已有server-only scope中为select、事务外层、UPDATE、事件INSERT同步建立database子owner。事务外层持有真实Drizzle发出的BEGIN/COMMIT/ROLLBACK直至其Promise结束；查询/写原始错误在调用方catch前留unknown。后续新DB调用先检查当前scope/unknown；已经进入的事务通过原有Drizzle回滚收尾，不能因未知而丢掉回滚Promise。

有scope时单行UPDATE只接受0/1，0保持确定CAS拒绝且无事件；事件INSERT要求准确1行。不可信回执抛错并保留未知，不视为0行或成功，不继续提交。无scope继续原有回执处理；仅局部helper校验，不改共享extractMysqlAffectedRows、SQL状态条件、事件内容或禁止领域代码。

这是两个实际repository方法的局部接线，而非新增未被调用的模拟仓储。测试以真实Drizzle/ExecutionDrain调用两个方法，仅mysql2传输使用合成回执，覆盖延迟提交/回滚和晚失败；未连接真实MySQL。实际任务enqueue/lifetime/安全拒绝分类、回调内部浏览器与detached、boot注入仍未接，不得据此部署或声称全局排空。

## 3D-3b-2 本地增量：实际入队安全分类与回调 Context（2026-09-11）

queue在容量检查前验证scope/控制器/unknown/有效owner；无继承root还刷新持久状态和租约。真正reserve之前再校验，不用临时预留再释放来伪造容量拒绝。明确容量拒绝为capacity，维护/未知/失效/封闭/控制器缺失为unavailable；拒绝分类缺失也不可视为容量证明。

tasks.ts两处真实enqueue改用server-only enqueueTaskExecution，传当前lifetime。onStart/onTimeout/runFn以队列各自实际回调owner生成Context；跨控制器、缺失、旧父owner或非当前ALS回调不能进入业务。两处dispatch函数改接收该Context，非队列路径显式传原ctx并继续列为未跟踪。安全拒绝在旧QUEUE_REJECTED失败写入之前抛SERVICE_UNAVAILABLE，仅明确容量拒绝保留原有失败处理。SQL/状态/额度规则不变。

审查补强：helper仅是已有request的caller adapter，受控入口要求parent与当前ALS一致，再允许调用queue。不得通过无parent调用把工作送入legacy/异controller队列并提前ACK；根接纳仍由middleware/controller负责，不能由helper隐式补造权限。

测试边界：真实TaskQueue/DrainController/状态文件验证父ACK后回调和挂起工作；缺失/外来回调能力使用合成queue协议反例。当前完整router的browser入口仍被Qwen unmigrated gate挡住，未移除/绕过该产品门禁。为检验真实caller，从TypeScript AST定位并编译执行tasks.ts原有两处入队块和原完整dispatch函数，外部持久化/分配使用合成边界。这是实际源代码区段的可执行接线验证，不是完整router或真实浏览器/模型/生产验证，也不是仅grep源码。完整后端类型检查覆盖调用签名。

仍未覆盖direct-open/Brave内部原始浏览器、catch吞错与detached、所有其他producer、统一closed boot/stop、全局互斥恢复与生产维护工具。index仍未注入controller。该单元不能解除全进程发布阻断；下一步从较小direct-open原始IO/清理链开始，再逐段接Brave。

## 3D-3b-3a 本地增量：Playwright页面SDK与超时后清理（2026-09-11）

PlaywrightExecutor的getPage/resetPageForTask/reopenActivePage页面创建/关闭、页面存活探测、既有脚本初始化/异步evaluate、setViewportSize、navigate的goto/title/策略检查，以及screenshot/原生metadata调用在实际派发点使用runBrowserOperation。实时读取scope，同步取得私有pin的execution子owner，原始Promise结束后才释放；guard或unknown阻止后续原始调用。同步抛出当场留unknown，异步失败在外层best-effort catch前登记。

旧标签close的1500ms等待上限、探测超时和脚本/替换标签的detached行为保留；它们结束用户等待或外层函数不再释放原始child。close/evaluate使用其原对象receiver。页面恢复相关SDK也受未知屏障约束：失败结果不确定时不继续新的SDK恢复动作；已派发的原始Promise照常收尾，不能借此重试/取消业务任务或伪造idle。无scope维持旧best-effort行为。

审查补强：可选SDK方法的读取、类型判断和带receiver的调用均放入owned action。getter同步抛错也先留unknown，再进入原有catch；首个旧页close getter失败后不派发第二个close。两个detached close对整个包装Promise捕获，避免getter错误逃到未处理的IIFE rejection。

测试直接运行真实PlaywrightExecutor与ExecutionDrain，constructor只注入合成CDP/page传输，时间上限使用fake timers推进而不是实际启动浏览器。native sharp.metadata一项在原生异步边界替换回执以观察挂起；旧executor回归另外运行真实sharp。页面操作计数不证明浏览器整个OS进程、网页子资源/网络事件或所有动作已结束。

仍未覆盖BrowserPool分配/保留timer/子进程终止/文件清理，CDP connect/reconnect/网络路由回调和其他动作；persistVisionOutcome原始SQL及direct-open catch处的失败回执仍后续。上述页面方法可能经过未接的重连辅助链，不因此获得完整覆盖资格。保持Qwen browser未迁移门禁，index不启用，单元不可独立发布。下一步优先实际结果保存与pool/连接生命周期，之后Brave/batch及其余入口。

## 3D-3b-3b 本地增量：Vision结果真实事务与不确定回执（2026-09-11）

persistVisionOutcome复用同一仓储已有runQueueDatabase/runQueueWrite原始边界包装（名称沿用最初队列接线，并非仅队列可用的权限来源），逐一登记select、transaction、UPDATE与事件INSERT。真实Drizzle事务Promise包含BEGIN/COMMIT/ROLLBACK；后者在已进入事务的收尾路径继续等待，不能因错误被caller捕获就虚假idle。失败或不可信写入ACK保留unknown，阻止之后新的保存调用。

受控scope下UPDATE只接受0/1，0仍为明确状态CAS拒绝且不记录事件；事件INSERT必须1行。正常五类outcome的允许源状态、结果字段/事件内容和旧无scope回执行为保持不变。父ACK前启动的原始read仍持有，但父结束后不能以旧权限再开启transaction；调用者完整异步保存链仍必须在自己的owner内await或预留。

测试以真实TaskRepository、Drizzle、ExecutionDrain及合成mysql2传输核对六个协议阶段、迟到失败、回执、unknown/sealed/expired和旧业务行为。额外从TypeScript AST编译真实未改的完整dispatchDirectOpen函数，配真实repo/runDirectOpen和合成页面接口，验证事务commit之前不广播、原始错误后catch不再补发失败写。此为caller区段集成验证，未绕过完整router的Qwen browser门禁，不是实际HTTP/浏览器/模型/数据库或生产E2E。

仍不具备全链发布资格：BrowserPool生命周期/OS后代/保留timer/连接/路由回调、其余任务分支与后台producer、其他入口、统一boot/停止、全局恢复与业务对账、首次维护与生产平台门禁尚未完成。未修改tasks.ts、业务SQL/状态规则、禁止领域或配置；下一单元继续pool和连接生命周期，不能以本次结果保存成功替代那些证明。

## 3D-3b-3c-1 本地增量：BrowserPool分配与释放停止屏障（2026-09-11）

allocate在执行spawn/同步logger/ready hook之前登记Promise，维持旧同步派发时序；停止不再越过尚未注册实例的分配。release在执行任何释放回调前登记Promise，重复调用仍返回false，但必须等原释放结果；异常记录不删除，防止后续shutdown把draining视为已经成功释放。

shutdown永久关闭新分配、续租/touch、adopt及GC重启，清未来retention timer；并发调用共享一次停止流程。先等已开始allocation收尾，再快照实际实例并释放，所有release收尾后才传播首个错误，成功后才关闭proxy。一处释放失败不提前结束对其他释放的等待；已失败释放不自动重试或假报完成。正常业务容量、租期长度、实例归属及原teardown内部best-effort规则未改。

本单元只证明**协调层Promise等待**。spawn的killAll和tearDownInstance仍只是信号+宽限，不能证明OS组/后代退出；后者内部catch尚未接unknown。ready hook/三秒banner timer、GC自身日志异常、CDP/egress原始网络与route callback仍未完整持有，index启动关闭顺序也未接。长寿命保留资源与任务活动的归属要在下一单元单独设计，不能把shutdown返回直接接到全进程idle或生产放行。

独立审查反例补充：同一taskId在原release挂起/失败或旧实例非ready时拒绝替换，adoptRetained也拒绝转移到仍有release记录或pending allocation的目标key，避免旧释放删除/遮蔽新实例或迟到分配覆盖转入实例；shutdown独立收集releasePromises，不依赖instances是否还保留key。实例从Map删除后的尾部失败仍阻止成功关闭，不能以缺失key抹去异常回执。

测试使用真实pool/slot/spawn编排/executor连接与独立临时profile目录；外部spawner返回合成进程，CDP/readiness和proxy启动关闭为合成传输，部分disconnect边界用挂起Promise。没有启动浏览器/子进程、访问网络或读取真实profile，不证明实际Linux/PM2/进程终止/生产就绪。

## 3D-3b-3c-2 本地增量：CDP连接与初始化原始操作（2026-09-11）

PlaywrightExecutor.connect/reconnectIfStale实际connectOverCDP、cleanContext的newContext、route安装、context addInitScript和banner evaluate复用runBrowserOperation，每次调用从实时scope建立原始SDK子owner。getter和receiver调用在owned action内；同步/异步错误在既有catch之前保留unknown，不因返回ok:false/false或best-effort而丢失记录。banner两秒仅结束外层等待，未完成evaluate仍活动，迟到失败仍未知。

没有新增根、持久缓存owner或按taskId恢复权限。普通关闸允许已接纳子链继续；unknown/sealed/失效父scope在后续SDK派发前拒绝。无scope兼容原有连接与重连契约。route安装Promise的登记不代表异步route handler已覆盖；handler正文不变，不把未来网络事件归属于已经结束的安装owner。

测试使用真实executor/drain、constructor注入合成SDK；验证六阶段挂起/错误/getter、父ACK后raw仍活动、私有pin、失效scope与旧无scope路径。没有启动浏览器、连接CDP或读任何真实页面/cookies。

仍未覆盖launchManaged、disconnect/disposeCleanContext、assertCleanContext、readiness fetch/body/timer、pool ready hook/banner timer、route handler原始操作及资源存续期、OS组/后代终止。SDK Promise结束也不证明长寿命浏览器资源已清理；统一boot、所有入口和平台/生产门禁保持未完成。本单元不能解除发布阻断，下一步继续这些原始清理及资源/后台链。
