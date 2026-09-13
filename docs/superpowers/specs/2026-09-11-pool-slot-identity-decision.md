# 浏览器池槽位身份：B 与 B2 边界选择

2026-09-13最新：已按本B2决策完成第2整项本地接线与独立验收，证据见`../plans/2026-09-13-pool-quartet-local-verification.md`；未创建真实账号、未做Linux或生产变更。下文保留作当时的决策记录，不再代表当前实施进度。

状态：2026-09-11，用户在明确询问是否采用B2后回复“批准”，B2开发身份范围已获批准。第2大项“浏览器池完整接线”未完成；未创建账号、启动浏览器或改变生产。HEAD仍fad214e5；后续按B2实施，不再等待同一身份决策。生产创建/迁移仍受新有效窗口及完整门禁约束。

## 为什么现在提出这一次选择

原B用一个专用非登录工作账号，隔离主应用uid998。它不能单靠0700目录、不同端口或PrivateTmp隔离同UID的不同槽位。原B仍可实施，但完整实现需要每槽位PID/mount/network/IPC沙箱、自写固定root初始化器、原pidfd/namespaceFD交接和非root PID1监督四角色，特权可信代码与恢复状态明显增加。

前期“补齐另外三个角色”低估了这部分工程边界。此时应在写大量特权初始化代码前比较较小方案，而不是按原想当然继续堆实现。不是因为本地测试尚未运行、工作量大或原B技术上不可行而假造阻塞。

## 推荐 B2：每个并发槽位独立、固定的非登录系统账号

- 主应用仍uid998；每个并发浏览器槽位使用不同的固定UID/GID，同槽位四角色共用该槽位身份。
- 这是服务器内部工作身份，不是Holaday用户/管理员账号，不改变套餐、积分或付费逻辑。
- 账号/UID/GID来自受审固定清单并检查冲突。按实际受审并发容量配置，协议上限32不等于现在创建32个账号；本变更不提高现有并发数。
- 不使用DynamicUser，不允许应用或运行时请求任意创建/选择账号；不交付sudo、setns、CAP_SYS_ADMIN或manage-units权限给应用/工作进程。
- 新profile/临时目录按固定组身份隔离；不递归chown旧profile，不复制、删除或接管原用户数据。已终止组的残留数据和同槽位后续身份复用仍需显式隔离/清理门禁，不能因UID相同自动可见。
- 一个系统账号条目本身不启动新进程；不得借此扩大浏览器实例数或10GB内存预算。

相比原B，不同UID直接处理跨槽位信号、ptrace和私有文件权限的根因；不必自写“同UID跨槽位共享PIDnamespace”的keeper/加入器链。仍保持每组业务能力和原始IO归属，不能把UID当作全部授权。

## B2 不能省略的工作

1. 每组固定namespace anchor及原manager GUID/owner、unit/InvocationID绑定；四角色只共享本组network/tmp/IPC，显式启动依赖，禁止自动restart/重新加入已换代anchor。
2. systemd249 JoinsNamespaceOf不提供PIDnamespace共享。B2不声称拥有该能力，而是用不同UID、ProtectProc及限制文件视图提供跨组权限边界。PrivateIPC不覆盖POSIX共享内存，/dev/shm文件视图单独隔离。
3. 固定非root启动守卫在工作exec之前确认必要namespace实际生效，不能只看配置项或只把事后Linux验收当每次启动守卫。v249 execute.c在部分EPERM/不支持情况下会警告并忽略PrivateNetwork/PrivateIPC，必须明确拒绝这种降级。
4. CDP/VNC保留私有、认证且绑定原组的数据通道；loopback或随机端口不是认证。egress保留原SSRF/DNS与批准IP连接策略、独立egress能力及逐组原始IO生命周期。root不代理用户业务内容。
5. 全父子进程身份、能力、文件视图和Chromium沙箱核验；组停止必须聚合全部角色、job、原始IO及后代退出证据，单个unit停止不代表全组清空。
6. 保留原登记、逐段内核凭据、能力、持久日志、旧boot/未知不重派、单合成账号灰度、维护/失败回滚门禁。真实双槽位Linux测试仍为第4大项，未执行。

## 选择的含义

- 继续原B：保留单工作账号，按待完善的quartet沙箱设计实施自写固定namespace初始化器。无需新增账号范围，但需审查和验证更多特权启动/监督代码。
- 批准B2（建议）：允许将身份清单从单工作账号扩为固定每槽位非登录账号/组及其精确目录权限；再据此改写第2大项实现计划。仅开发授权；生产创建/迁移仍等新有效窗口和全部门禁。

B2降低的是自写特权隔离实现的复杂度，不是“只建几个账号就安全”。不保证省掉全部broker或平台验收，也不作未经实测的性能承诺。

## 本轮实际工作与限制

- 两种单UID数据通路已独立核查，选取应用Unixlistener可保留首次exec关闭全部非stdio FD契约，不必加FD4；root仅固定挑战探针与原socket对象挂载。
- 本轮现有318测试基线实际重跑通过，11.194秒。新增独立v2整组请求解码7项先RED（缺模块7失败），后GREEN（0.002秒）；旧v1解码不放宽，运行通道仍blocked。尚未接日志、平台或Node，不是完整接线通过。
- 新设计/计划、v2协议与测试目前均未提交草稿。没有新PR、合并、部署或生产验证。原B2选择后可复用通用v2协议部分，但整个第2大项仍须完整测试和独立代码审查。
- 原review_qwen_negation确认B可行；比较B2认为更小、更易审计，建议在大量root实现之前作一次明确身份边界选择。审查者未运行测试或生产操作。

## 依据

- [本地已批准B边界](2026-09-11-pool-launch-registration-decision.md)，以及scripts/pool-broker/installation.py中的唯一holaday-browser-pool身份。
- [systemd249共享namespace文档](https://raw.githubusercontent.com/systemd/systemd/v249/man/systemd.unit.xml)：network/IPC/tmp共享的明确条件，不包括PIDnamespace。
- [systemd249执行实现](https://raw.githubusercontent.com/systemd/systemd/v249/src/core/execute.c)：network/IPC namespace设置的警告降级路径，需要拒绝。
- [systemd249执行隔离文档](https://raw.githubusercontent.com/systemd/systemd/v249/man/systemd.exec.xml)：ProtectProc、PrivateIPC与文件视图各自的范围。
- [/proc/pid/root权限与文件视图](https://man7.org/linux/man-pages/man5/proc_pid_root.5.html)：不能用同UID目录mode推导完整跨槽位隔离。
