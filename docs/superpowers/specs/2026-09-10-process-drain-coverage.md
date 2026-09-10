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
