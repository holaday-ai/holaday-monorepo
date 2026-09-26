# 首次切换实施断点：Task 4 真实身份适配，启动来源与入口接线未完成

日期：2026-09-26（Asia/Tokyo）。本地实施中，未部署。

最新授权：2026-09-26 用户表示“我要出去一下 你自行安排任务 允许期间的所有操作 包含PR 部署 验证”。当前浏览器上线大项允许自主实施、PR、必要合并、部署与验证；下方历史“仅本地/未授权部署”限制已被本次授权取代。授权不等于验收通过；必须完成剩余真实接线、恢复演练与发布门槛，不得修改历史业务记录来伪造通过。

## 最新恢复点（优先于下方历史段落）

### 2026-09-26 自主推进批次

已完成受保护的 PM2 运行注册定向移除组件：`browser-first-cutover-registrations.mjs`。实际配置备份为 root 私密文件，按唯一 pm_id 执行 delete，动作前/后进入共享 journal；窗口、身份、在途工作、主备启动残留、备份损坏、无关注册变化、回生及结果不明均拒绝继续。支持实测 PM2 6.0.14、开启内存重启的 worker、已停止/PID0 的文件 cron，不把它们伪装成已禁用重启。普通停止路径拒绝使用该类 capture。

真实 Linux 最终演练通过：UID998 worker 退出、监听消失、cron 注册移除、无关 PID 不变、真实日志六条注册事件；测试 daemon 重启仅恢复保留应用。可复现 fixture 已纳入 `scripts/fixtures/browser-registration-removal-linux.mjs`，使用既有隔离镜像 `holaday-first-cutover-task3:qa`，源码挂载 `/source`；需私有 PID namespace、SYS_PTRACE 仅用于容器内跨 UID 观察，禁止生产挂载/网络。日志 `/tmp/holaday-registration-linux-final.log`。这是实际组件验证，不是双主机/DB/支付整流程验证。

演练先暴露了 PM2 `axm_monitor` 遥测字段持续变化导致的误拒绝。现仅排除该遥测字段，完整环境、启动路径、调度、重启策略和进程身份仍参与核验；原始私密备份仍保留全部配置。对应回归 RED→GREEN；空捕获清单误成功也已 RED→GREEN 修复。运行注册备份与主备启动文件备份是两个独立目录，均保留失败现场，不自动回滚或重试。

本轮最终结果：浏览器脚本 278/278；完整 test:ops 退出0（120/50/16/65及 shell）；orchestrator 506文件、8579通过/1既有跳过；cn-payment 7文件80通过且类型检查通过；现有普通/partner 支付幂等专项40通过。新增12条回调等待/失败应答行为锁定测试，不修改结算实现；首次 CN 测试遇 Vitest 缓存写权限 EPERM，已授权完整重跑通过。七个触碰的脚本/测试及新增Linux复现脚本 Biome 与 diff-check通过。Python首次7项/普通4项本批重跑通过（`/tmp/holaday-registration-python-{first,normal}.log`）。

生产只读预检未取得新数据：Vultr SSH 多次在 banner/认证阶段超时；即使仅执行 true 也未完成。终止了本次悬挂的本机 SSH 客户端，未向服务器业务进程发信号。Aliyun 的 true 探测两次自动审批超时，均未执行，不能说该主机不可达。公开 `https://holaday.ai/healthz` 返回200，仅证明该健康请求成功，不代表浏览器或切换就绪。未修改生产服务/配置/数据库。

**仍未完成：** Task4 的完整 host adapter、真实 nginx 拓扑接线、跨主机/DB/provider IO、普通入口新参数/证据顺序和 shell；Task5 新鲜加密备份/隔离恢复、完整迁移及外部支付证据；Task6 整流程与独立审查。历史审计仅保存 nginx 路由摘要，不含完整站点配置，不应猜测重写。下一步先恢复 SSH 只读通道并读取实际配置及在途工作，接续这些固定范围；不要再请求已授予的 PR/部署权限，也不要把网络恢复等同于代码已经就绪。

以下为此前恢复点历史，尚未实现运行注册删除的说法已被本段取代。

用户已回复“允许”，批准定向移除运行注册与主备启动条目的**本地实现和隔离测试**，不要再次请求同一授权；仍不授权线上操作。当前完成其中的主备文件处理与真实journal接线，运行注册的受保护生产删除入口尚未实现，不能把下面的测试PM2命令称为产品入口。

新增 `scripts/browser-first-cutover-startup.mjs`：仅 `/root/.pm2/dump.pm2` 和 `.bak`，两文件独立摘要和条目摘要匹配；备份在root私密 `maintenance/startup-<attempt>` 下，排他创建、同步写盘及写后重读核验。无关条目保留原始字节（包括JS无法精确表示的大整数）；缺失备用文件明确记录为缺失，不复制主文件补齐。恢复副本损坏、路径/权限/硬链接异常、源漂移、超期、初始时钟无效、旧attempt都拒绝；失败保留备份/部分状态，不自动恢复或重试。摘要重查后替换并不是操作系统级跨文件事务；仍依赖主机适配器排除并发配置写入，不能宣称抵抗恶意root。

`journal.recordStartupEvent` 只允许first-cutover的 `producers_stopped` intent阶段，严格绑定attempt/inventory和脱敏字段，顺序记录backup意图/结果、fallback及primary替换意图/结果；未完成的文件步骤阻止继续all_fenced。普通路径不能记录该事件。当前是每台主机/本次journal的一批主备文件，跨主机汇总、运行注册备份/定向删除、隔离/现场scope验证与主host组合仍待接线；不会仅凭本函数返回就认定停止完成。

新鲜验证：startup文件/journal组合测试及浏览器全套最终结果见 `/tmp/holaday-startup-browser-final.log`；完整test:ops退出0，`/tmp/holaday-startup-ops-final.log`。一次较早ops运行撞上新增journal测试的RED阶段而失败，已在实现后完整重跑通过，不隐去该历史。隔离Linux实际root备份/文件替换与真实共享journal六条事件通过；测试级定向delete后无关进程PID保持，测试daemon恢复只拉起保留应用。日志 `/tmp/holaday-startup-files-linux-final.log`。运行注册删除目前仅在QA脚本，没有生产删除适配器。未连接或修改生产、数据库、支付/额度、UI或扩展，未提交/push/merge/deploy。

历史上一轮：启动来源机制核验完成，当时等待停用策略决定（现已获准）。实际PM26.0.14隔离演练证明 stop 后cron会回生、delete运行注册不清主备保存记录、主/备用记录均可恢复目标；同时清理测试目标的主备记录后只恢复无关测试应用。真实Worker模块的可控异步采样测试证明stopped注册仍可触发内存reload、已移除注册不会。日志 `/tmp/holaday-task4-pm2-startup-characterization.log`，退出0；容器已自动移除，没有生产连接或变更。

建议：私密备份后，首次路径只定向移除批准旧对象的PM2运行注册及主备启动条目，每文件单独摘要/CAS/保留条目核验，记录先于副作用，无关应用与daemon不动；不执行全局save/delete/kill、不自动回启旧版。该策略比此前的仅stop扩大了操作类型，已向用户请求**仅本地实现和隔离测试**确认，尚未获得该新增授权，不落生产路径代码。完整提案与证据见host-readonly-audit第4节。不要重复调查已证明的stop/cron问题，收到同意后从定向注册/保存记录处理的TDD继续。此前254项等是上一轮回归，本轮未重跑或新增产品通过声明。

本轮按四项固定清单继续，完成首次路径的进程身份适配：管理器 `/usr/bin/node` 与应用 Node22 分离；网关 root Node/dash/同 release esbuild 完整树校验，未托管 root 网关仅允许固定支付 release 应用目录下的系统 Node，并保留 pidfd SIGTERM。main/worker UID998、普通升级 helper 和候选身份规则未改。管理器替换、跨 release、混用 UID 身份及孤儿子进程均拒绝。

显式停止超时支持真实 660000ms，首次停止相对窗口上限为900000ms；整批 PM2 超时总和加两次物理复核预算不足时，首个停止前拒绝，不缩短实际超时。完整 host 尚须与已批准绝对维护窗口取交集，不能从相对上限推出生产停机授权。worker 的 memory restart 和 files-cron 定时来源仍保持阻断，未填零、未绕过。

本轮新鲜验证：浏览器运维脚本254/254，Python首次7/7、普通4/4，完整 `pnpm test:ops` 退出0（`/tmp/holaday-task4-host-shape-ops.log`），两个触碰MJS的Biome和diff-check通过。Linux Node22.20.0/PM2 6.0.14 实测系统Node管理器定向停止、root网关pidfd TERM及4011释放、无关应用存活、UID998状态文件和两阶段nginx恢复；日志 `/tmp/holaday-task4-host-shape-linux-final.log`。x64 esbuild完整形态是单元fixture，不是arm64容器的真实esbuild运行证明；journal/工作计数仍合成，不是Task6整流程。测试均已结束，一次性容器已移除。

下一步仍在Task4：核实并实现 files-cron/memory restart/保存启动记录的定向停用与回生复核，不能仅凭 stopped/PID0 宣称已禁用。PM2本地源码显示 cron 是独立注册，异步内存采样后的reload也能启动停止进程；普通 stop 不足以证明所有启动来源关闭。接着做真实nginx入口适配及host/evidence/readiness接线。Task5/6和整分支审查未完成，不能部署。本轮只改本地四个首次runtime/signal实现与测试、记录和隔离QA；未连接或改变生产，未改数据库、支付结算/权益/额度、UI、模型路由或扩展，未提交/push/merge/deploy。

后续用户回复“继续”，已批准并完成两台主机的限定只读核查（09:48–09:51 JST）。见[真实主机核查与四项固定修正清单](2026-09-26-browser-host-readonly-audit.md)，不要再次询问相同只读权限。4010支付路由已明确；4011仍监听但未见 nginx 字面路由，不能直接判为可停用。PM2管理器/网关UID与exe、完整树、files-cron未来调度、worker超时/内存重启及 nginx 实际文件形态均与原合成假设存在差异。下一步基于该证据做首次路径专用适配，不能放宽普通升级/候选UID998，也不能全局停PM2。本次未修改生产状态或产品代码，未新增通过测试声明。

用户已批准生产者优先停止顺序，已实现和隔离验证，不要再次询问该顺序，也不要重做 Task 1–3。HEAD / Task 4 BASE 仍为 `844c2ced779fa360b62e2bfbdd87d4909d13b8a0`；Task 4 未提交、未标完成，Task 5/6 未开始。

- orders 隔离与工作核查 → 精确停止批准生产者 → all-writers 隔离与全局停止复核。生产者回执与最终 stopped 分开，不能复制/篡改后使用，也不重复向已停止进程发信号。真实 Linux Node22/PM2、pidfd、权限与 nginx 组件复测通过，日志 `/tmp/holaday-producer-order-linux.log`；主机事实/journal/root IO 仍部分合成，不是整流程证明。
- prepare 只要求核清批准对象，不再要求停机后才可能出现的零生产者状态；仅允许与 inventory 完全匹配的 main/worker，未知写入、外部工作、未解决记录仍拒绝。preopen 要求全局隔离和旧生产者为零。证据采集 36/36。
- 首次 transition 必须提供绝对维护窗口、补核对截止和负责人；实际副作用前重查时限/时钟倒退，构建或迁移不强杀、不重跑，保护性 close/hold 不因超时禁用。transition + 共用 tail 54/54。
- normal journal 可绑定 inventoryDigest；首次 journal 允许受保护批准清单预留 UUID，真实锁/新记录使用该值，历史记录永不覆盖，普通路径不能指定 attempt。journal 16/16。
- `browser-first-cutover-host.mjs` 目前只实现固定 root 保护清单读取，不是完整 host adapter。测试 12/12：Mac 实文件验证，只有 UID 模拟为 root。尚无可执行生产入口。
- 最后一次 journal 增补与格式修正后的浏览器运维脚本 243/243，日志 `/tmp/holaday-task4-final-browser.log`；`pnpm test:ops` 全命令退出 0，日志 `/tmp/holaday-task4-final-ops.log`，先前审批超时已不再阻塞。十个本轮 MJS 文件 Biome check 与 diff-check 通过；不宣称全仓 lint 通过。测试均已退出，无后台测试遗留。

此前资料不足与只读权限请求已被09:48–09:51核查取代；不再重复请求。现场快照仍不是部署时的批准清单，4011责任/旁路可达性及完整启动来源仍需绑定实际操作范围；读取不等于批准停止对象。

剩余 Task 4：完整 first host、真实多主机分类/DB/provider/root fencing IO、普通 host 的 acquire→采集发布→候选 readiness 新参数、显式 shell。Task 5/6、真实支付方演练和独立审查仍未完成，不能部署。Docker Desktop 为隔离测试在本机启动，一次性 QA 容器已自动移除，daemon 保持运行。两个 `scripts/__pycache__/` 缓存未纳入交付。未改线上进程、配置、数据库、支付/权益/额度、UI、模型路由或扩展；未 push/merge/deploy。

## 本次继续进度（Task 3）

- 已实现首次/普通 journal 互斥、独立引导种子、身份核对与 PM2 定向停止边界、未托管进程 pidfd SIGTERM、两阶段 nginx 配置生成/校验/恢复、首次 closed 状态初始化。
- 新鲜本地验收：全部浏览器脚本 160/160；Task 3 其中 runtime 22、fence 8、journal 11（含原有测试）；Python 首次 helper 5、普通 helper 4 均通过；六个触碰的 MJS 文件 Biome 与 diff-check 通过。`pnpm test:ops` 全命令退出 0（Node 分组 120、46、16、53，附属 shell 检查通过）。
- 日志：`/tmp/holaday-first-cutover-task3-final.log`、`/tmp/holaday-first-cutover-task3-ops.log`。一次全量脚本运行出现 11 个既有 socket 测试 EPERM，批准本机临时 socket 权限后全部通过；未为此修改产品代码。
- 隔离 Linux 组件实测已通过，日志 `/tmp/holaday-first-cutover-task3-linux.log`：真实 Node 22.20.0 / PM2 6.0.14 下，开启自动重启且忽略普通停止信号的批准目标被定向停止，无关应用保持存活；未托管 UID998 进程通过真实 pidfd SIGTERM 退出；首次状态目录/文件的 UID998、0700/0600 通过；真实 nginx 两阶段 503、无效签名回调探针、no-store 和原配置恢复通过。完整记录与合成 QA 位于该计划 `.superpowers/sdd/.../qa/`，不是生产部署工具。
- QA 环境修正：容器需 SYS_PTRACE 才能读取另一 UID 的 `/proc` 身份，仍无宿主 PID、网络、生产凭据或端口映射；镜像 Python 位于 `/usr/local/bin`，仅在镜像补齐 `/usr/bin/python3` 路径。产品停止规则未改。容器已自动移除。
- 组件的主机观察、root 文件操作与 journal 回调尚需 Task 4 连接真实适配器；Task 6 整流程与独立审查仍未完成。下述较早“Task 3 尚未写实现”为历史断点，不代表此更新后的代码状态。

## 历史断点：Task 4 当时停止顺序待确认（已被上方批准与实现取代）

Task 3 已完成并登记，HEAD `844c2ced779fa360b62e2bfbdd87d4909d13b8a0`。Task 4 的八个脚本/测试文件尚未提交：新增共用 release-tail、首次 transition 及测试；普通 host/transition 接入共用后半段与开放前后核查。首次 host、命令入口、真实证据接线、绝对截止时间仍未完成。

新鲜回归：新增流程 46 条 RED→GREEN，普通路径接线后四组 90 条通过；格式整理后全部浏览器脚本 210/210 通过，日志 `/tmp/holaday-first-cutover-task4-browser-final.log`。Task 4 的 `pnpm test:ops` 两次自动审批均超时，命令未执行，不能沿用 Task 3 结果称其通过。Biome 仅剩原 host/host-test 已存在的三项 useSingleVarDeclarator；diff-check 通过。

当前实现的顺序存在循环：`retireLegacyRuntime` 与实际命令边界在任何停止前都要求 `all-writers` 且 `producersRunning=0`，但首次流程自身需要停止旧版后台生产者，部分调度与主进程共存。尚无已批准、已验证的旧版独立暂停机制；不能把 fixture 的零计数当真实证据。这是本地接线发现的前置条件冲突，不是新的线上故障结论。

已向用户请求：是否允许在关闭新任务/订单入口、核清在途及外部工作后，先定向停止批准的生产者（必要时包含承载调度的主进程），再验证全局零写入。仅本地实现/隔离测试，不自动修改任务/订单、不把未知工作视为零、不操作生产。尚未收到此项确认，现有停止条件保持不变。

下一步从这里接：先取得上述顺序决定，再实现 Task 4 的真实 host/受保护清单、journal attempt 与证据绑定、候选 readiness 命令、shell 和截止时间；不要重做 Task 1–3。Task 5/6、支付方真实演练与全分支独立审查仍未完成，不能部署。当前没有运行测试或遗留容器；`scripts/__pycache__/` 为本轮 Python 测试生成的两个缓存文件，未纳入交付。

局部接口裁决：first adapter 增加必需的 `reconcile(identity)`，否则终态只有名称没有开放后核对；共用尾段的 closeAcknowledged 只接受同实例协议1且 closed 的回执，不以调用未抛错代替证明。对应代价：缺少真实核对/回执的适配器继续拒绝完成。

## 较早断点历史与证据（Task 2 时）

- 工作树：`/Users/yaleiqi/.codex/worktrees/browser-release-candidate/holaday-monorepo`。
- 分支：`codex/browser-release-candidate-20260925`；本次断点前代码 HEAD：`c37ddbd9bc5f96321dfb9f6a6bdbd72cda6a5943`。
- Task 1：候选/配置/迁移/操作记录绑定的 readiness 和受保护证据读取，提交 `96dc4929`。
- Task 2：国内支付及 PayPal 只读查询、主机/数据库证据采集与原子发布原语，提交 `c37ddbd9`。生产适配器接线仍属于 Task 3/4；完整外部支付演练证据仍属于 Task 5，不能把注入 IO 或签名测试样本当生产事实。
- 最新本地检查：证据采集测试 33 条、国内查询 23 条、PayPal 查询 18 条通过；浏览器脚本回归 125 条通过；国内支付全套 68 条通过；orchestrator 全套 8,579 条通过、1 条既有跳过。类型检查及脚本专项严格类型检查通过。
- 日志：`/tmp/holaday-first-cutover-task2-final.log`、`/tmp/holaday-first-cutover-task2-browser-regression.log`、`/tmp/holaday-first-cutover-task2-cn-final.log`、`/tmp/holaday-first-cutover-task2-orchestrator-full.log`。
- Task 3 已读任务说明，尚未写实现。Task 4–6、Linux 全流程演练和独立审查未完成。

## 发现的计划冲突

批准设计禁止自动 SIGKILL；Task 3 进一步规定通过 pidfd 固定进程身份后只发 SIGTERM。与此同时，它要求禁止旧 PM2 实例自动重启。

[PM2 官方说明](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/)规定标准停止先发 SIGINT，超时后发 SIGKILL。更改初始信号不等于禁止超时强杀。

检查上游实现的结论：

- [stopProcessId/restartProcessId](https://github.com/Unitech/pm2/blob/master/lib/God/ActionMethods.js)：停止会修改管理器状态并调用 killProcess；重启虽然合并配置，但随后实际停止/重启，不是对当前进程无副作用地禁用重启。
- [killProcess/processIsDead](https://github.com/Unitech/pm2/blob/master/lib/God/Methods.js)：使用数字 PID 发信号，并有超时 SIGKILL 路径。
- [RPC 接口](https://github.com/Unitech/pm2/blob/master/lib/Daemon.js)：所检查的接口未找到受支持的单应用、不中断进程的 autorestart 更新方法。stopWatch 只处理文件监视；全局停止标志/停止整个 daemon 不是本次允许的替代方案。

以上是官方文档和上游源码依据，**未在本次重新核实线上 PM2 版本或配置**。不能据此声称线上特定版本已实测，也不能把本地预设 `autorestart:false` 当作解决现有自动重启实例的证明。

## 待用户决定的最小调整

建议允许首次引导中增加独立的“PM2 定向停止”路径：只针对身份、管理器和进程树已核实的批准对象，接受 PM2 已明确核对的正常停止信号和超时强制结束行为。前提是入口已隔离、未解决工作为零；其他应用和整个 PM2 daemon 不动。未托管进程与普通发布原有 pidfd 停止路径不放宽。

风险：超时强制结束可能中断未识别的在途工作；PM2 自身数字 PID 停止不提供 pidfd 的相同保障。因此不能沿用“只 SIGTERM、绝不强杀”的承诺，也不能未经确认便实现为默认路径。实际版本、超时、树边界、其他重启来源或旧工作归属不清时仍拒绝切换。

这只是设计变更建议，尚未批准，不是生产停机授权。若用户不接受，则保留限制，重新选择首次停机方式，不能用隐藏补丁改 PM2 或模拟成功跳过。

## 下一条执行指令

用户决定后，先更新设计/计划中的对应停止约束，再从 Task 3 开始 RED→GREEN；不要重做 Task 1/2。沿用 `.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/progress.md` 中的接口裁决。全部本地验收与整分支审查完成后，另行提交部署清单。

未触碰：生产进程/配置/数据库、支付结算与权益规则、额度、UI、模型路由、浏览器扩展安装。未 push、merge 或部署。当前没有由本轮遗留的运行测试或容器。
