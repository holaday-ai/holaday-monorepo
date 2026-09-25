# 首次切换实施断点：PM2 停止策略已批准本地实施

日期：2026-09-26（Asia/Tokyo）。本地实施中，未部署。

更新：用户回复“允许”，已批准下述最小调整的本地实现和隔离测试。设计与计划同步修订；原“待确认”段落保留为断点历史。生产停机仍未授权。

## 本次继续进度（Task 3）

- 已实现首次/普通 journal 互斥、独立引导种子、身份核对与 PM2 定向停止边界、未托管进程 pidfd SIGTERM、两阶段 nginx 配置生成/校验/恢复、首次 closed 状态初始化。
- 新鲜本地验收：全部浏览器脚本 160/160；Task 3 其中 runtime 22、fence 8、journal 11（含原有测试）；Python 首次 helper 5、普通 helper 4 均通过；六个触碰的 MJS 文件 Biome 与 diff-check 通过。`pnpm test:ops` 全命令退出 0（Node 分组 120、46、16、53，附属 shell 检查通过）。
- 日志：`/tmp/holaday-first-cutover-task3-final.log`、`/tmp/holaday-first-cutover-task3-ops.log`。一次全量脚本运行出现 11 个既有 socket 测试 EPERM，批准本机临时 socket 权限后全部通过；未为此修改产品代码。
- 隔离 Linux 组件实测已通过，日志 `/tmp/holaday-first-cutover-task3-linux.log`：真实 Node 22.20.0 / PM2 6.0.14 下，开启自动重启且忽略普通停止信号的批准目标被定向停止，无关应用保持存活；未托管 UID998 进程通过真实 pidfd SIGTERM 退出；首次状态目录/文件的 UID998、0700/0600 通过；真实 nginx 两阶段 503、无效签名回调探针、no-store 和原配置恢复通过。完整记录与合成 QA 位于该计划 `.superpowers/sdd/.../qa/`，不是生产部署工具。
- QA 环境修正：容器需 SYS_PTRACE 才能读取另一 UID 的 `/proc` 身份，仍无宿主 PID、网络、生产凭据或端口映射；镜像 Python 位于 `/usr/local/bin`，仅在镜像补齐 `/usr/bin/python3` 路径。产品停止规则未改。容器已自动移除。
- 组件的主机观察、root 文件操作与 journal 回调尚需 Task 4 连接真实适配器；Task 6 整流程与独立审查仍未完成。下述较早“Task 3 尚未写实现”为历史断点，不代表此更新后的代码状态。

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
