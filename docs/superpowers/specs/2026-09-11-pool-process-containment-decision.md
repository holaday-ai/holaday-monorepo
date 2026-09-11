# 自有浏览器进程树隔离：9d 安全边界决策

状态：2026-09-11 用户在了解限定权限及作用后明确回复“好的 批准”，同意推荐系统级管理服务边界。**不是实现完成，不是生产能力证明；正式安装/启用仍需有效维护窗口和全部门禁。**

基线：codex/qwen-safe-drain，fdc0631a0eb6a99da77e2ac4df6206b8e3c9caff。承接《2026-09-10-safe-execution-drain-design.md》及覆盖清单9c。

## 结论

9c已经保留本次ChildProcess的leader/stdio关闭回执，但当前应用代码没有可认证整棵后代树退出的隔离提供者。继续给Node事件或扫描结果加一层Promise，不能补出缺失的平台权限。

建议新增一个**仅管理Holaday自建浏览器池的系统级进程管理服务**，通过systemd在运行工作之前建立独立cgroup；主Orchestrator继续以uid998运行，不获得通用sudo、任意systemd命令或主机任意进程终止能力。该服务是新增安全边界，必须先获用户批准，再写实现计划、TDD并做独立审查；实际安装另需有效维护窗口与平台门禁。

## 当前源码证据

以下是本地固定版本的证据，不推断生产此刻配置：

| 位置 | 当前行为 | 不能据此认证的内容 |
| --- | --- | --- |
| apps/orchestrator/src/browser-pool/owned-pool-process.ts:14、171 | 获取前reserve，绑定native kill及close；已启动进程最后固定GROUP_EXIT_UNPROVEN | 后代退出、跨boot恢复 |
| apps/orchestrator/src/browser-pool/spawn.ts:40、126 | detached原生spawn；无scope旧wrap依赖负PID组信号 | 启动前内核隔离、逃逸后代归属 |
| apps/orchestrator/src/browser-pool/reaper.ts:94、144、173 | 根据argv/profile/端口范围匹配；发信号后用匹配数量报告killed | 准确所有权、实际回收、扫描失败与空树的区分 |
| apps/orchestrator/src/index.ts:162、207 | 启动先reap，再建pool；异常回退singleton | 严格closed boot、旧boot对账；严格模式不可沿用这种回退作为放行 |
| scripts/orchestrator-runtime.sh:1、20、156、192 | root PM2设置应用uid998，浏览器继承同一用户 | 应用有cgroup委派或systemd管理权限；与同UID子进程隔离的鉴权 |
| qa-artifacts/pr237-release-20260910-v1/remote-boundary.mjs:31、39 | 旧固定候选/窗口的root部署动作置于systemd服务 | 应用长期可调用的浏览器资源服务；不得改SHA或窗口复用 |
| 同目录linux-platform-probe.mjs:24、26 | root执行仅自有临时目录/锁/服务的基础诊断 | 浏览器树退出、业务排空、现有uid998能力 |

在apps/scripts/packages的相关实现中未找到应用级cgroup、pidfd、subreaper、Delegate或polkit管理接线。这里是搜索范围内未找到，不是对主机安装状态的断言。本轮没有访问生产、读取环境值或扫描真实进程命令行。

## 官方语义核对

- cgroup v2的子进程继承创建时父进程所属组；事后移动父进程不会移动已经存在的后代。populated观察覆盖子树活进程；空组不等于所有僵尸已被reap。kill操作与最终空组观察是不同事实。[Linux内核文档](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- systemd区分自己启动进程的service与容纳外部已启动进程的scope；直接管理cgroup需要明确委派并遵循单一管理者。不能让应用同时私改systemd拥有的树。[systemd委派文档](https://systemd.io/CGROUP_DELEGATION/)
- KillMode=control-group为组内剩余进程提供停止策略；ExitType=cgroup从systemd 250起支持按组存活判断。它们是候选机制，未验证当前主机可用性，不能单靠版本或配置文本放行。[停止语义](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.kill.xml)、[服务语义](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.service.xml)
- systemd的启动、停止等管理操作有独立权限要求；读取状态不意味着获准管理。[systemd管理API权限](https://raw.githubusercontent.com/systemd/systemd/main/man/org.freedesktop.systemd1.xml)

## 备选方案与选择

1. **继续负PID、扫描或只加subreaper：不选。** 不能由leader close推出后代消失；事后扫描不建立启动前隔离。subreaper即便用于收养/reap，也不能单独成为限定任意后代迁出的边界。
2. **把cgroup/systemd用户级管理交给应用：当前不选。** 仓库没有可复用委派。新增委派仍是权限变化；浏览器与应用同UID时，单靠目录mode或用户身份不能证明只有主应用能操作管理接口。还需单独解决启动前归属、组间迁移和旧boot。
3. **限定系统级管理服务：推荐，已获用户批准。** 把新增权限集中在小接口里，只受理固定浏览器池资源类型，拒绝任意命令、PID、unit路径或配置属性。主应用和其他服务不迁移、不提权。比方案2多一项部署/运维对象，但能明确谁有权创建、封闭和认证这组资源。

## 推荐方案必须满足的边界

以下是后续设计必须满足的验收条件，不是已经具备的接口或平台保证。

### 权限与输入

- 仅本机调用；管理服务代码、配置和状态由系统管理员所有，应用不可改写。实际工作进程非root，保留Chromium沙箱，不使用--no-sandbox。
- 不接受任意shell、可执行文件、argv/env、系统路径、PID/PGID、unit名或systemd属性。只接受固定资源角色及受限整数槽位；profile、可执行路径、参数和环境由受信清单生成，不接用户自由文本。
- 外部动作限创建、查询、关闭；查询/关闭必须持服务签发并绑定本次实例的私有能力，不能仅凭业务ID或槽位恢复权限。能力不输出到日志或用户结果。
- 仅uid998或socket mode0600**不足以鉴权**，因为浏览器也继承该UID。实现前必须选择并验证绑定本次Orchestrator boot的不可伪造客户端通道/内核进程身份，或经另行批准的独立工作进程身份隔离；不以调用者传来的pid、JSON boot字符串或路径权限代替。未证明这一点不得启用。
- 无通用sudo/polkit manage-units授权给应用；服务不得操作外部浏览器、共享driver、其他PM2应用或未知旧资源。限制并发容量与内存，具体上限沿受审配置验证，不另加无界后台队列。

### 创建、所有权与持久状态

- 每份资源从创建前就有唯一、不可复用的资源身份，与boot/候选和私有记录关联；先持久记录准备状态，才可向平台发起启动。
- 由受信平台在工作代码运行前建立组归属。不得先普通spawn再移PID；不得从扫描命中的旧进程补造所有权。应用/浏览器无迁出本资源边界的权限，平台门禁需要验证这一点。
- 保留准备中、已派发但未ACK、已启动、停止中和终态状态。响应丢失只对账同一份操作，不能另起进程；同名unit、PID复用、manager重启或identity漂移不能视作同一实例。
- retained adoption只变更业务关联，物理资源身份不变。保留slot/profile直到本次资源和全部已派发IO完成；不根据重新启动后的空内存释放旧记录。

### 停止与证明

- 正常停止先封闭新的创建/子派发，等待既有SDK/回调原始工作，然后请求平台停止**本资源**。不能为了产生空组主动取消未完成业务并称其成功。
- TERM/宽限/KILL由固定受信策略管理；返回成功只是停止请求回执。必须收集启动/停止job完成、固定实例仍匹配、没有待启动/重启工作、组已无活进程，以及本次leader/stdio和管理传输均完成的组合证据。
- 防止观察之后重新填充组：封闭新派发、禁止restart、保持唯一管理权并绑定终态记录。单次populated0、MainPID0、ActiveState或not-found都不足以单独放行；监听断开/对象消失/读取错误/超时保留unknown。
- cgroup证明的是没有活进程；若承诺包含reap完毕，还必须有对应父进程/系统管理者的回收证据。不能混同物理退出、僵尸回收与业务提交对账。
- group证明仅能解除本次受控资源的相应不确定性，不能清除其他DB/模型/旧boot未知。不改变首次PR231维护独立门禁。

## 平台验收清单（未执行）

- 能力只读预检：Linux/内核/systemd版本、cgroup v2和需要的功能、固定服务管理权、原uid998、可信客户端鉴权、禁止迁出与Chromium沙箱兼容性；不能把源码推荐当实测。
- 隔离合成环境：double-fork/setsid、leader先退出、后代忽略TERM/保留pipe、停止期间fork、迟到启动ACK、重复stop/重启、相同名字或PID复用、manager/应用崩溃及broker响应丢失。
- 两个受控资源互不影响；无权限的同UID子进程不能调用或重定向管理接口。测试失败保留证据并关闭接纳，不临时扩大权限。
- 终态与持久记录组合对账，空组后无重新填充窗口；证明不了实际退出时保持未知，不靠sleep/计数清零通过。
- 与9c及真实SDK资源关闭组合验证；单测、OS测试、业务排空、生产验证分别出证据。macOS本地不模拟成Linux通过，也不为测试强开Docker。

## 本轮交付与下一步

本轮仅做源码/官方语义核查、备选比较和独立设计审查；无代码、配置、数据库或生产变更，无新的测试通过声明。9c的549项属于13:22历史本地结果，不是9d平台验证。

唯一review_qwen_negation完成只读架构及文档复核，无Critical/Important/必修Minor，允许作为待批准决策文档存档；非阻断源码行号已修正。审查结论不构成用户授权或实现/平台通过。

**用户已批准上述开发边界。** 无需再次请求相同授权；正式启用前仍须验证客户端身份隔离，主应用继续uid998且不获通用系统管理权限。

批准后先补完整接口/身份机制设计与TDD实施计划；安装服务/平台试验/生产发布另按有效维护窗口和原全部门禁执行。不批准则保留严格浏览器关闭与GROUP_EXIT_UNPROVEN，不用低强度证据降级安全承诺。其余未完成任务原样保留，不自动改做新的产品功能。
