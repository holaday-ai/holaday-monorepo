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

## 3D-3b-3c-3 本地增量：CDP就绪探测响应生命周期（2026-09-11）

waitForCdpReady从spawn末端提取到cdp-readiness模块，原调用导出保持。整轮poll、每次响应及JSON读取/重试等待都在已有scope下同步预留子owner。响应pin从fetch派发前持续至body读取和finally取消结束；取消是当前响应的已接纳收尾，不新建根或依赖新准入，因此后续unknown/blocked不会跳过这份已取得响应的清理。

两秒Abort覆盖响应体而非只覆盖headers，并受绝对总deadline约束；派发前、headers/JSON/cleanup后同时核对时钟和abort，整轮返回前再验总deadline，迟到成功不能认证ready，单次过期先物理清理再按剩余预算重试。fetch拒绝或JSON/取消结束均清timer。非2xx或未读取的body在重试/返回前明确cancel并等待。在任何child或URL构造前严格验证端口是number整数1..65535、timeout为有限正数，不强转对象/字符串；保证固定loopback /json/version首跳，redirect:error不跟随重定向。该只读探测的连接拒绝/HTTP/JSON错误按known重试；取消失败保留unknown且不再开始新请求。这个分类不适用于任意GET、模型调用或业务提交。

测试从spawn真实导出调用，使用真实ExecutionDrain/Response/ReadableStream及合成fetch，不访问网络。验证fetch/json/cancel在父ACK和Abort后继续活动，JSON仍有独立pin，取消保留原响应pin；blocked/unknown后仍清已有响应但不发新请求，原始取消失败独立阻断，timer无遗留。

该单元不是浏览器资源/OS或全进程排空证明；浏览器spawn/launch/disconnect/clean-context、pool hook/timer、route事件、OS后代和其他入口/boot/生产门禁仍未完成。生产与Qwen browser门禁未触碰，不能据此发布局部组件。

## 3D-3b-3c-4 本地增量：隔离context资源与绑定关闭（2026-09-11）

clean-context的newContext现在在返回lease后才派发，当前已准入scope同步预留execution子owner及私有pin；ready不释放资源owner，实际context.close结束才释放。创建派发scope在ready时seal，长期资源owner不能供后来SDK借用。dispose仅绑定该context，或等待同一未完成newContext后立即关闭；未知/blocked/父结束后仍清理已获得的资源，不新建根、按taskId恢复权限或暴露通用cleanup入口。

acquire与close的同步/getter/异步失败在资源owner释放前保留unknown。重复dispose共享实际回执，失败记录不清除、不自动重试；主动取消尚未交付的context若最终关闭成功则为成功收尾，ready仍拒绝。原始cookies经runBrowserOperation登记，检查绑定捕获的context/lease/generation；迟到结果不能认证当前context，更不能用旧dirty结果关闭替换资源。

connect/launchManaged首await前占位，拒绝并发半就绪返回；generation覆盖pending transport/newContext和初始化结果写回。初始化失败先dispose本轮lease。disconnect即使browser引用已空也等待已发起setup和context清理，并发调用共享失败/成功回执；managed setup与disconnect只交接一次原有browser关闭职责，不据此证明browser.close/OS完成。全局停止必须先请求dispose，再等待资源计数，不能倒序等待资源pin自动归零。

本增量测试运行真实executor/drain、合成SDK与受控Promise，不启动实际浏览器/网络/数据库、不读取真实cookie。managed launch/browser.close、外部CDP WebSocket及重连资源所有权、pool hook/timer/OS后代仍未完整登记；其他入口、统一boot/stop、全局对账、维护/平台/生产门禁均仍阻断发布，不能单独发布本单元。

## 3D-3b-3c-5 本地增量：受管Browser资源与原始关闭（2026-09-11）

launchManaged新建专用OwnedManagedBrowser，仅绑定由本executor启动的Browser。原始launch getter/调用前预留execution子句柄；ready后创建scope封闭，私有资源pin继续保持至Browser.close实际settle。真实getter/同步/异步失败保留unknown，getter后的取消/blocked/已有unknown为未派发已知拒绝。迟到的launch结果不可再创建context/发布，必须关闭自己已取得的Browser。

executor保留每轮managed lease，context清理与Browser清理各自有真实回执。setup catch只清本轮context再清本轮Browser，不等待全局disconnect；disconnect先等待setup/context全部结束（包括拒绝），随后等待Browser清理，原失败及unknown不清除。重复cleanup不重试SDK，失败禁止替换；已拥有资源的关闭不因之后关闸/unknown跳过。旧ownsBrowserProcess读标记由专用lease取代，external CDP connect/disconnect不新增Browser.close。

真实executor/drain与合成SDK验证失败、竞态、清理顺序、权限及无scope兼容。此增量证明的是受管Browser的SDK资源回执，不证明底层OS进程组/后代退出；外部CDP WebSocket与reconnect资源、pool hook/banner timer、未来route callback、其他动作/入口/统一boot/stop和全局恢复/维护/平台/生产门禁仍未覆盖，继续阻断整机制发布。停止编排仍须先请求资源关闭再等待idle。

## 3D-3b-3c-6 本地增量：外部CDP连接资源和重连（2026-09-11）

专用OwnedCdpConnection将原始connectOverCDP getter/调用至绑定Browser.close实际settle作为资源生命周期。ready后封闭获取scope，资源pin不因父ACK/超时提前释放；关闭失败保留unknown与共享失败回执，之后关闸/unknown不阻止已经拥有的连接清理。显式创建的context先清理，之后再关闭SDK连接；不调用默认context/page close。

本机Playwright/playwright-core 1.59.1只读源码确认CDP方式的Browser.close最终等待WebSocketTransport.closeAndWait及自有artifactsDir清理，与managed浏览器退出不同；官方 https://playwright.dev/docs/api/class-browser#browser-close 区分连接方式和启动方式。未对用户浏览器试验，发布前还需验证实际依赖及自有合成平台行为。

connect与reconnect复用initializeCdpConnection，setup锁覆盖获取、初始化、重连contexts检查和捕获lease清理；重连先等旧lease终态，失败不丢弃或重拨。lost cleanMode直接拒绝自动重连；只有新显式connect可重新选择模式，修复managed关闭后显式外部连接仍误用旧cleanMode。contexts验证重入/并发disconnect不能复活或关闭替换连接，无全局disconnect自等待。

合成SDK与真实executor/drain覆盖上述边界；没有真实连接/进程试验，不证明OS组/后代退出。旧无scope创建的资源不能反向成为新drain的全进程证明；全局boot接线与平台维护门禁仍需完成。pool ready hook/banner timer、future route callback、其余动作/Brave/batch/调度hook/其他入口/文件SDK、统一closed boot/stop、全局对账及生产门禁仍阻断发布。

## 3D-3b-3c-7a 本地增量：Cookie初始化的原始数据库与SDK（2026-09-11）

injectPendingCookies的用户/待处理行读取、解密或JSON失败/空行/空数组与成功后的五处删除，均在实际惰性DB链派发前以当前owner登记database子操作。原始thenable结束及严格删除ACK校验完成后才释放；owned模式删除affectedRows仅接受数值0/1，缺失/畸形/超范围回执保留unknown。无scope保持原结果兼容，不无条件创建root。

bulk与逐cookie addCookies经真实browser-operation登记；getter后用绑定原caller ALS的检查再验owner/封闭状态/unknown/blocked。明确未派发控制拒绝在raw wrapper外传播，不误记成SDK提交未知；真实getter/同步/异步SDK错误仍保留unknown。owned模式未知后不继续逐cookie重试或删除pending行，只有已派发操作收尾。正常关闸允许有效已准入子链继续；无scope原bulk失败逐条best-effort和清理行为不变。

不改Cookie白名单、schema、映射、upsert与crypto实现，测试仅使用合成值、真实service/ExecutionDrain和受控DB/SDK Promise。不证明HTTP或pool父生命周期已接线；3D-3b-3c-7b仍需保存/取消3秒timer、预留ready hook、收集getPage/banner内部timeout后原始SDK回执并协调release/stop。pool/index未改、Qwen browser/boot注入仍关闭。其余OS/入口/全局对账/维护/平台/生产门禁继续阻断发布。

## 3D-3b-3c-7b 本地增量：浏览器池后台协调和SDK实际收尾（2026-09-11）

browser-operation新增只读ALS settlement observer，真实raw result登记到所有祖先scope。scope结束/stop先seal拒绝新SDK，再等待已经派发的原始Promise；外层timeout或catch不提前结束等待。observer不创建root、不恢复owner、不提供pin释放或对账能力。嵌套scope不登记自己的返回Promise，封闭祖先不能通过新scope绕过。Cookie派发校验同步读取同一否决，使无drain scope的停止也不被legacy catch吞掉后继续删除。

PoolBackgroundWork只绑定BrowserInstance对象，在allocate返回前从有效父owner同步预留整体execution生命周期，延迟运行确保pool先登记回执；独立hook/banner观察scope结束后不能逃逸续发。3秒timer取消/唤醒与两条后台链allSettled纳入stop，原始SDK必须真正结束后tearDownInstance才disconnect。stop不取消已经派发的Promise或伪造资源释放；真实hook/SDK错误保留原有unknown，正常业务hook仍best-effort、不延迟allocate返回。

pool使用WeakMap按实例身份保存，retained adoption无需转移权限或漏掉回执。release及shutdown先检查当前后台上下文，拒绝自身及同池后台关闭重入，检查早于已有Promise快返；shutdown在等未完成allocation之前先同步停止已有后台派发。晚到allocation不再启动hook/banner。后台预留容量耗尽时清理已获得executor、只删本轮匹配registry/slot；已有release在途时等待原回执、不双释放。

这些测试仍是合成进程/代理/CDP与真实pool/executor/drain的组合，不证明OS进程组/后代退出；observer只覆盖已登记的SDK，现有cookie hook的DB由7a逐项登记且等待，不是任意DB/第三方callback的自动跟踪。future route事件、其他浏览器动作/Brave/batch/调度hook/所有入口与文件SDK、全局closed boot/stop/恢复对账、首次维护/平台/真实模型和生产发布门禁仍独立阻断。未开启Qwen browser或index全局注入，未发布局部组件。

审查补强：setup拥有独立派发scope，dispose/dirty/disconnect同步seal；已经派发的raw操作继续收尾，旧setup不能续发下一个SDK。无scope路径也在逐context/page循环与SDK getter之后检查generation；两类timeout setter之间亦检查。getter同步触发主动dispose但没有真正调用SDK时返回私有取消sentinel，在raw wrapper之外转为固定取消错误，避免把明确控制拒绝当成unknown；真正getter/SDK错误仍保留unknown。deferred setup在await后重验实时owner与unknown，不能趁调度间隙开启managed launch。未来route handler正文没有改动或纳入本单元证明。

## 3D-3b-3c-8 本地增量：未来请求回调与固定SDK事件边界（2026-09-11）

BrowserRequestGuard在获取Browser时捕获已有资源owner，未来固定route工作由该资源私有pin持有，不恢复已封闭setup scope、不新建root或暴露任意dispatch/finish能力。注册、policy检查和continue有独立normal集合；stop同步进入abort-only，等已派发normal收尾之后才能清context/Browser。实际Browser.close之后seal事件入口，等待已进入的完整SDK事件、abort及callback全部settle；一个context失败不提前结束其他context等待。真实错误保留unknown和同一失败回执，不重试continue/abort，不凭SDK关闭推定OS退出。

公开route callback的拒绝会被Playwright 1.59.1 EventEmitter再次抛出；成功noop又会使RouteHandler的handlingPromise等待不结束。因此使用明确固定版本的私有兼容层browser-route-events，仅替换绑定context/channel的唯一route listener。首个route注册前检查版本、对象身份、唯一入口、无既有pending事件和无listener生命周期hooks；原listener运行前同步登记完整事件。错误只进入本资源固定失败记录，包装器自身不reject，不使用全局unhandledRejection处理器。关闭后保留sealed wrapper且不再进入原SDK handler；不提前unroute/unrouteAll，不制造无handler放行窗口。安装失败、半替换、入口漂移和事件容量溢出拒绝并保留不确定性。

网络允许范围保持原策略；正常允许请求continue，阻止/检查失败请求abort。日志只保留固定blocked/policy_failed类型，不携带URL、原始错误或自由文本。四个executor测试文件在明确标注的合成SDK边界隔离事件适配；真实事件套件不mock适配，使用实际Connection/Browser/BrowserContext/Request/Route/RouteHandler/EventEmitter、真实CDP与managed资源lease/ExecutionDrain；Browser.close调用及driver响应仍为合成边界，不启动浏览器或网络。SDK接入核对实际playwright和core版本、真实Context/Browser实例、prototype原方法与固定listener签名，context.browser()必须等于绑定Browser且连接对象相同；后续事件和终态继续核对归属。只保证受信进程内固定SDK兼容，不宣称可抵御恶意同源码closure伪造。

当前验证和独立审查结果以对应计划及PROGRESS最新节点为准。这一边界不覆盖Playwright-client/driver内部RPC及safeRace隐藏原始提交，不证明driver进程、OS组/后代退出或其他事件/任意回调自动排空。其他动作/Brave/batch/调度hook/所有入口、统一closed boot/stop、全局恢复对账、首次PR231维护、平台/真实千问及新生产门禁继续阻断发布；Qwen browser unmigrated gate与boot注入保持关闭。后续优先界定driver内部原始RPC及终止权限，不能把本地SDK事件测试充当全进程安全证明。

## 3D-3b-3c-9a 本地增量：固定请求的内部channel回执（2026-09-11）

固定Playwright/core 1.59.1的Route._raceWithTargetClose在创建_channel.abort/continue的Promise后调用safeRace，目标关闭会先于driver响应结束公开调用。因此保留SDK原safeRace行为，在原context listener前安装此Route实例的观察器，所有已收到的channel Promise都纳入原事件槽和Browser资源pin；只有原listener与全部已派发回执settle才释放。成功回执允许完成，迟到错误/Connection.close拒绝保留unknown，不能把Connection回执表清空当远端完成。

同一Route公开abort/continue共享派发前单次标记，固定原receiver，首次调用失败也不能切换方法重试；重复或终态调用在channel前固定拒绝，不碰已结束owner。三个实例包装不恢复，初始、实际调用前及终态核对原方法、channel身份、真实Route/Request和有界context祖先链；未知方法、循环/外来归属、重复事件零新增派发且失败关闭。原listener失败即时报告，再等待已派发回执；失败报告幂等，不用成功noop吞SDK handling。事件1024容量直到原始回执settle才释放，不因safeRace返回提前腾空。

测试保留真实Connection/Browser/Context/Request/Route/RouteHandler/EventEmitter，并用实际Worker.close事件触发真实safeRace；CDP/managed、abort/continue、成功/失败/断连覆盖。driver协议响应、Browser.close仍合成，没有实际driver、网络、浏览器或OS进程试验。直接人为绕过公开方法调用私有SDK不在此固定回调契约保护内，本观察点不能事后阻止已经派发的任意Promise。

这只补齐3c-8的固定请求raw回执，不代表所有driver RPC/transport或OS组后代排空。其他SDK动作/事件、共享Connection与Browser.close实际传输/进程终止证明、OS kill/reaper、Brave/batch/调度hook/所有入口、统一closed boot/stop、恢复对账、维护/平台/真实千问及全部新发布门禁仍阻断发布。Qwen browser及boot注入保持关闭，不发布局部机制；下一步界定其余driver/transport与OS生命周期边界。

## 3D-3b-3c-9b 本地增量：绑定Browser关闭的真实client回执（2026-09-11）

公开SDK Browser.close吞TargetClosedError，可能将Connection清理pending回执造成的拒绝当成功。严格owned路径在取得Browser、创建请求guard及发布ready之前绑定固定SDK关闭能力，捕获channel/Connection/关闭通知与兼容形态；按获取时lifetime选择，不因cleanup已sealed/blocked而降级。guard及其初始化失败fallback共用同一缓存关闭回执；严格绑定失败不退回公开close，也不尝试关闭共享Connection。

首次close调用先缓存Promise，再deferred核对并发送原channel.close({})；保持原CDP/managed的Browser权限，未调用默认context/page或进程kill。必须先等待已派发RPC，ACK后还需原Browser关闭通知。Connection断开只能使结果未知，不能作为关闭成功；通知先到不提前结束ACK等待，ACK先到不提前宣称关闭。派发前/终态核对固定SDK自有data descriptor，拒绝accessor而不执行getter，避免末端getter或_closeReason setter重定向连接；真实newListener hook重入共享单次回执。监听器清理在固定错误处理内，removeListener hook运行后再次核对断连和形态。绑定异常归一UNSUPPORTED，执行异常归一RECEIPT_FAILED；保留unknown、不重发。无scope沿用旧公开SDK行为，其结果不是全进程证明；不宣称防御任意恶意同进程Proxy/原型篡改。

专门SDK测试使用真实Connection/Browser、真实CDP/managed lease/drain；组合测试还包含真实Context/Route及请求事件适配，验证close成功或失败后仍等待在途abort。只有guard初始化失败反例对构造处做条件故障注入。其他7份既有资源测试仍有明确标注的synthetic Browser.close，仅隔离新的固定SDK边界，不称这些测试证明真实关闭。driver响应/通知仍合成，未启动浏览器/网络/driver或OS进程。

该单元不证明server驱动内部所有工作、WebSocket/真实进程终止、OS组/后代或全平台排空。其余driver动作/事件、pool OS生命周期/失败清理、Brave/batch/调度hook/入口/文件SDK、统一closed boot/stop/全局恢复对账、首次维护与新发布工具/平台/千问/生产门禁仍阻断。下一步优先界定pool自有进程组的获取、绑定终止和退出证明；不能以信号成功、PID消失或新boot计数零冒充完整排空。

## 3D-3b-3c-9c 本地增量：自有ChildProcess的leader/stdio关闭回执

严格pool spawner在实际node spawn前同步reserve资源owner，获取ChildProcess后先挂spawn/error/exit/close监听再读取PID与流。ready来自成功spawn；单次terminate回执绑定原ChildProcess、捕获的PID及原生kill，只对本对象发TERM，三秒后仍未退出才发一次KILL。signal成功/false/ESRCH或killed都不能结束等待；exit停止升级，但必须继续等待close。无PID、无spawn且native error之后close属于已知启动失败；已取得进程的close仅结束leader/stdio观察，必须先留GROUP_EXIT_UNPROVEN再释放本物理pin，不认证进程组或逃逸后代结束。严格流仅消费，不输出原始子进程文本。

首spawn之前私有Set强引用启动record，固定原task/profile/slot及所有子句柄；成功后实例WeakMap仍指同record，retained adoption不改变物理资源身份。失败record独立于allocation Promise与实例Map保留，shutdown继续枚举。strict release/startup unwind先等后台和executor，再收集所有子进程终止回执；同步disconnect/diagnostic错误不能提前跳过清理。失败不得free slot、删profile或容许同key重新分配；adoption拒绝私有stopping/dead记录，原task profile不能因adoption而再次覆盖。无scope仍为历史best-effort组信号，不得到安全排空资格。

专门测试使用真实ChildProcess/EventEmitter、真实ExecutionDrain/pool/slot/temp目录；OS spawn/kill、CDP和proxy传输为明确合成边界。模拟darwin/linux分支不会启动相应OS/浏览器；不把模拟四进程关闭计数当Linux进程树验证。旧background测试仅隔离synthetic process receipt，仍只证明hook时序。

严格group退出尚无证明提供者，因而这些资源的正常leader关闭仍保留unknown并阻断发布。需要从本次spawn前建立可证明的隔离/身份、权限受限的终止和后代退出证据，不能事后凭负PID或扫描空结果推断。其余driver/浏览器入口/统一boot与恢复对账/首次维护/灰度适配/平台和真实千问门禁仍未完成。当前没有开启Qwen browser或boot注入，也没有生产变更。

补强：生命周期监听逐项保护，close观察优先，其他安装异常不跳过其等待；close监听本身不可安装时保持active+unknown而不是猜测完成。stdout/stderr在resume前安装error观察，不泄露原文、不结束child持有。每个实际spawner及后续CDP/setup派发前再检查pool关闭与已有child状态，避免logger重入或await track返回间隙续发；不以track内部较早检查替代真正派发门禁。

error监听本身注册失败时，本次ChildProcess及其stdio各自绑定固定receiver的局部emit兜底，仅截获error派发异常；不改共享原型/全局错误处理，不移除其他监听或吞掉非error事件异常。注册与resume独立保护，异常后仍保持close等待与unknown；关闭后的迟到error不触已结束owner。不宣称防御恶意同进程替换该包装器或任意原型篡改。
