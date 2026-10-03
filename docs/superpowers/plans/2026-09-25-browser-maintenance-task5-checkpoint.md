# 维护发布检查点：Task 5 本地接线完成，转综合演练

最新更新（2026-09-25）：以下旧检查点保留作历史，不代表当前未完成项。
真实维护发布入口、只读 capability probe、独立候选构建、精确配置/完整迁移清单绑定、独占阶段日志、Linux 身份核验停机、新实例关闭启动、同实例开放与 worker 后置启动已接线。

本轮新鲜验证：维护 Node 98/98、Python 4/4，完整 test:ops 退出 0（含保留的其他服务隔离测试）；typecheck/build 退出 0；五个 shell 语法和 diff 检查通过。日志为 /tmp/holaday-maintenance-task5-{node,python,types,build}-new.log 和 /tmp/holaday-maintenance-ops-new.log。综合子进程演练、真实隔离 MySQL 和统一审查尚待 Task 6；后端全量回归正在运行，未计作通过。

生产限制未变：旧实例无协议时在任何上传或停机前拒绝；支付回调/独立写入边界仍由 MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN 阻断，未加绕过开关。Mac 上 Linux pidfd 仅单元验证，未获得真实 Linux 内核执行证据。没有线上操作、push、合并或付费模型调用。

---

2026-09-25；候选分支 `codex/browser-release-candidate-20260925`。
最后提交 `60c4b39b16f4a753f54fcd92797241c059e0893e`。Task 5 修改未提交；Tasks 1–4 的完成记录不变。

## 已实现、已验证

- 开放前同实例 SHA/boot 校验，依次检查 schema、记录、服务；身份不符不运行查询。
- 只读执行身份、暂停记录、NULL 费用检查；不改任务状态、恢复任务或把未知费用改零。
- 支付回调重试及独立服务写入边界尚无证明，servicesCheck 明确拒绝开放；预检成功环境变量不构成证明。
- 客户端可显示资源准备的 closed+dirty，发布策略仍拒绝凭此停机。
- 控制命令绑定原实例；开放超时不重发，只读同实例状态。
- 发布阶段状态机、原进程退出等待、PM2/端口归属判断、完整 SQL 摘要：已有纯函数或注入边界测试，尚未形成真实远端驱动。
- 本地续作已加入 Linux `/proc`、PM2、端口观察与停止适配器；真实停止通过 pidfd 定向发送 TERM，无 `kill(pid)`、SIGKILL 或 PM2 stop/delete 回退。当前只有合成内核/命令边界测试，尚无 Linux 实进程验收。
- 两个生产启动脚本已接入 SHA/非 root 身份/关闭状态检查；worker 只能在主程序开放后启动。旧 runtime restart 遇到普通维护标记或配置时提前拒绝，不进入原强停路径。
- 新增独占发布锁与阶段文件：原子替换和 fsync；中断/写失败保留锁和现有阶段，不自动抢锁或清理不明状态。

| 本轮检查 | 结果 |
| --- | --- |
| 后端全量 | 502 文件；8506 通过；1 原有跳过；附带 73 Node 通过；退出 0 |
| 维护 Node 测试组 | 48/48 通过；本地真实 socket，合成进程/发布适配器 |
| TypeScript / build | 均退出 0 |
| 原 runtime shell 测试 | 通过，但验证的是未改动旧 runtime，不是新维护接线 |
| 新发布入口草稿 | 验证了旧协议先拒绝、不上传、无隐式目标；已暂存，非正式入口 |
| 原 migration / rollback shell 测试 | 在未完成新入口上失败，仍期待旧 reset/retry/rollback；尚未更新，不得称全套发布测试绿色 |

上表是此前一轮结果。恢复原入口后，本轮 `pnpm test:ops` 已重新通过：120 个 Node 测试及 7 个原 shell 套件，退出 0；这些套件仍然验证**旧发布行为**，不是维护远端流程已完成。维护 Node 组本轮 65/65；随后新增的 journal 5/5、Python 信号辅助逻辑 4/4 分别通过。
最终合并回归：维护 Node **73/73**，Python 信号逻辑 **4/4**，四个 bash 语法检查及 `git diff --check` 均退出 0。另补停止凭据与 checkout SHA 绑定、开放后 worker 启动失败重新关闭、open 回执丢失后仍验收 worker 的回归。
日志：`/tmp/holaday-maintenance-task5-node-resume-final.log`、`/tmp/holaday-maintenance-task5-ops-resume.log`。本轮未重新跑后端全量；表中后端/类型/build 属于此前记录，不是本轮新结果。

本机现有 mysql:8.4、mysql:8.0 镜像均无 Python，两个一次性、断网、只读容器探测退出 127；未拉取镜像或更改现有容器。Linux pidfd 真正信号发送仍未验收；上线前需单独确认主机支持。

日志前缀 `/tmp/holaday-maintenance-task5-`：`partial-full.log`、`node-final.log`、`typecheck-final.log`、`build.log`。
曾有 Vite 临时配置写入/socket listen 的沙箱 EPERM；必要权限下重跑通过，不是产品失败。

## 本地恢复权限已解决；发布接线仍未完成

为避免半成品引用缺失 remote driver，暂存入口草稿后曾尝试精确恢复 `HEAD:scripts/deploy-orchestrator.sh`。
自动审核拒绝了这次**本地恢复**，理由是原脚本包含远程 reset、迁移、PM2 重启与自动回退，具有生产风险。没有执行任何生产操作；不得用间接写入绕过拒绝。

用户随后明确允许仅恢复并修改本地发布脚本。现已用 apply_patch 精确恢复 `HEAD:scripts/deploy-orchestrator.sh`，`git diff --exit-code -- scripts/deploy-orchestrator.sh` 退出 0；没有执行该发布脚本或任何线上命令。
草稿保存在 `.superpowers/sdd/2026-09-25-browser-maintenance-implementation/`：`deploy-orchestrator.draft.sh`、`deploy-browser-maintenance.draft.test.sh`。
此前的本地恢复权限阻塞已解除。恢复是为了保留可核对基线，不代表认可旧自动回退策略，也不代表可以部署。

## 下一步

继续 Task 5，不重做已完成任务：

1. 在已授权的本地脚本修改范围内，完成实际远端锁、持久阶段、独立 staging、全 SQL 摘要及失败保持维护。
2. 将已实现的 Linux 停止适配器、阶段日志和启动检查接入完整发布入口，补候选 PM2 启动及开放后的独立 worker 启动；现有测试不是 Linux 实进程停机验收。
3. 更新真实 shell 失败测试，保留祖先关系、凭据隐藏、非 root 检查。
4. Task 6 综合 HTTP/WS/子进程验收、独立整分支审阅及最终回归后才可收尾。

续作注意：`performMaintenanceRelease` 的 adapter 现在必须提供 `resumeWorker(identity)`，在同实例开放确认之后调用，成功后才记录 `opened`；停用 worker 时也要由实际配置/进程检查给出明确结果，不能省略函数。新 Linux 信号辅助依赖须在关闭服务之前探测支持；缺失即拒绝，无强杀回退。

本轮付费模型调用 0；未 push、merge、部署。原脏工作区、线上配置/数据、QA 服务未修改。维护验收不等于浏览器成功率达标。
