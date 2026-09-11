# 同 PID 启动登记与浏览器身份隔离决策（9d-2b）

状态：2026-09-11 本地源码、官方语义及生产最小只读预检完成。本文是端到端设计与新工作身份选项，**不是启动器实现、平台隔离通过或发布授权**。基线11ff064c；9d-1和9d-2a是已提交的本地基础单元。

## 已批准与本次需要区分的事

用户已批准仅管理自建浏览器池的限定系统服务，主应用仍uid998、不获通用sudo或systemd管理权。原规格明确：独立工作进程身份隔离需另行批准。不能把再次“继续”解释为已经选择更换浏览器系统账号。

启动登记本身有不迁移主服务的方案：**固定、root-owned的同PID启动器，先登记自己，再彻底降权并exec Node**。这属于既定受信启动登记的细化，不需要重复询问broker开发授权。但它不解决浏览器与主应用同UID时的内存、文件及控制通道隔离。

## 现场证据与边界

- scripts/orchestrator-runtime.sh:197–202：root PM2通过--uid/--gid启动bash；scripts/start-orchestrator-production.sh:36执行exec Node。当前PM2 PID与Node/端口owner相同，现有脚本运行时已降权，不能在其中假造root登记。
- scripts/pool-broker/process_pin.py：只消费受信启动端已有的pidfd，未提供其生产者。不能向工厂交客户端报来的PID，不能据文件/命令行扫描重新取得“原进程”身份。
- 搜索scripts和orchestrator/src未找到已接线的dumpable/LSM/ptrace/proc隔离机制。这是所查代码范围的结果，不推断所有主机策略均缺失。
- 2026-09-11本轮对主Orchestrator主机执行两次最小只读预检，仅输出版本/布尔：Linux **5.15.0-186-generic**、systemd **249**、Python **3.10.12**；cgroup v2接口和PID namespace接口存在；bubblewrap未在固定/usr/bin/bwrap路径确认可用，/usr/bin/unshare版本**2.37.2**。不读取业务、环境值、密钥或真实进程身份；未创建namespace、安装、重启、修改生产配置。
- systemd PrivatePIDs从257提供，当前249不能直接采用。接口存在不等于隔离生效；不升级systemd、不复用旧部署工具修改SHA/时间窗、不通过未知配置警告降级运行。[systemd官方执行配置](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.exec.xml)

## 共同的启动登记设计

无论下述哪个工作身份选项，都保留以下完整契约，不再增加脱离生产者的孤立句柄。

1. PM2仅在未来完整候选/维护门禁通过后，按固定root-owned配置启动极小登记程序。程序不加载应用代码、应用可写脚本或任意解释器参数，不接用户命令/路径/环境；解释器、模块路径及其祖先目录在发布时验证管理员所有且不可被运行账号改写。root阶段环境显式允许列表，解释器加载前就排除LD/PYTHON/NODE注入变量，不能依赖脚本加载后才清理。
2. 启动器只对**自己的当前进程**取得pidfd，通过独立root私有注册socket移交FD。服务端核对内核root发送凭据、凭据PID与该pidfd对象一致、候选/一次性启动事务及容量，再绑定boot。root注册通道与uid998运行命令通道分离，运行通道仍只允许create/query/close。
3. root登记ACK只表示待启动登记已持有，**不表示应用已就绪**。在ACK之前不得加载应用或创建浏览器；发送失败、响应丢失或broker重启均不盲目重复登记。仅对账同一启动事务，无法证明则退出本次尚未放行的启动，不转旧路径绕过。
4. 登记成功后清理附加组、特权、root控制连接和无关FD，设置确定的uid/gid及无提权策略，验证真实/有效/保存身份均不含root，再exec固定Node入口。同PID不增加常驻父包装进程，保留PM2 PID=Node=端口owner；应用代码始终非root。实现需要实际原生能力和启动配置测试，不能在默认旧路径中临时执行root应用代码。
5. Node启动先保持接纳关闭；运行通道每段消息验证内核实际发送者与原pidfd/boot。root阶段凭据不能作为Node就绪证据；首次uid998握手、初始化与持久对账完成后仍须原发布开放授权。PM2显示进程存在不能越过这些门禁。
6. 后续exec不创建新PID，因此pidfd不能证明代码映像没变。登记后的主进程再exec属于不支持的转换：受信更新路径先封闭/撤销该boot、排空，再新进程登记，不能按PID或一次/proc/exe检查自动恢复授权。不能宣称本模块能检测任意同进程代码执行。
7. PM2重启每次取得全新启动事务。broker丢失登记时保持关闭，旧浏览器资源进入原有持久对账，不能以新内存为空清旧账。启动失败不触未知旧资源，不对外宣称业务排空。PR231首次维护与回滚门禁仍独立。

pidfd引用原进程，不允许事后根据客户端PID重建身份；exec会改变多项安全属性，尤其不能把exec前dumpable=0当成exec后仍然保护。[pidfd_open](https://man7.org/linux/man-pages/man2/pidfd_open.2.html)、[execve](https://man7.org/linux/man-pages/man2/execve.2.html)

## 工作身份路线比较

### A：保留浏览器uid998，自定义受限进程与文件视图

技术上可行，并非因为systemd249就不可能：已有unshare可作为namespace机制的工具。若继续此路线，需要完整的受信namespace初始化/退出管理、PID与proc视图、文件根及精确挂载、继承FD/能力清理、调试访问和IPC控制设计；不能只加一条unshare命令或ProtectProc=invisible。

原因：ProtectProc=invisible主要隐藏其他UID，同UID本身仍不足；PID namespace中正确挂载的proc与不泄漏祖先namespace/目录FD是配套条件。新的namespace初始化进程退出可能终止其后代，必须纳入错误/unknown，不能算业务成功。不能靠“稍后验收”先开放，也不改变全主机Yama/LSM。[PID namespace语义](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html)、[Yama](https://docs.kernel.org/admin-guide/LSM/Yama.html)

代价是比原极小broker多出一层需要持续维护的隔离启动实现。当前未选定或实现这层，也未做任何真实namespace实验。

### B：浏览器池专用非登录系统账号（建议用户批准后采用）

主应用保持uid998和PM2监督；仅浏览器池的Xvfb/Brave/x11vnc/websockify工作进程使用不属于主应用组、无附加特权的专用系统账号。不是Holaday用户账号，不改变套餐、积分或管理员登录，不让应用获得切换任意用户的能力。账号数和数值UID不在此凭空分配，实施前按受审固定清单核实冲突。

这样可利用不同UID的基础访问边界，降低“同账号进程冒充主应用”的隔离复杂度；**不是新增账号就自动安全**。仍须核对应用配置/密钥/控制目录实际权限、无共享附加组/特权、工作进程不能读取主应用内存/FD；不能将应用目录改成全局可读/可写以便运行。

浏览器新profile、下载及临时目录使用独立受限根目录；主应用所需输入输出经受限交接，不给浏览器读取整个应用目录或管理socket。旧profile不自动递归chown、不复制或删除真实用户数据、不扩大现有scripts/orchestrator-runtime.sh:182的递归范围；迁移/回退须另有精确路径、备份和门禁。

不同UID不替代原进程登记、每段内核凭据、boot/capability和组退出证明，也不自动隔离共享loopback CDP、VNC或X11端点。现有spawn.ts的CDP loopback、Xvfb -ac及VNC访问需另作受控通信验收，不将“只监听127.0.0.1”当成对本机其他进程的认证。两个合成资源的互不影响仍为独立门禁。

这确实改变系统账号、组和目录所有权边界，原规格要求另批。批准前不写账号创建、权限迁移或模板User变更。

### 不采用的捷径

只登记PID/boot字符串、只查uid998/文件mode、只检查SO_PEERCRED连接时凭据或把dumpable/Yama某个值当全部隔离证明，都不足。不用测试替身返回成功，不放松GROUP_EXIT_UNPROVEN。

## 建议与下一步

建议保留共同的同PID启动登记，并选择B作为浏览器与主应用的工作身份边界，以控制新增特权代码与运维复杂度。A仍是有效备选，不称其技术阻塞；用户若要求维持全部uid998，则须先完整设计A的namespace/文件/FD/IPC防护再实现。

**2026-09-11 用户明确回复“批准”，选择B：浏览器池专用非登录系统账号，主应用继续uid998；允许开发精确账号/目录边界。生产安装和迁移仍按新有效窗口及全部门禁执行，不复用已过期窗口。无需再询问相同工作身份选择。**

本轮不新增运行时实现，不把47项历史本地测试当本轮平台通过。保存设计审查和只读证据，等待工作身份选择；不借此升级系统、安装bubblewrap、修改全局安全策略或发布部分组件。

以上“本轮”指a70fd5ce设计记录时点；后续获批实施证据另见实施计划和QA最新节点。

独立review_qwen_negation只读复审：无Critical/Important/必修Minor，同意作为待选择方案存档；源码行号建议已修正。审查者未重跑生产预检或测试，不扩大本轮证据范围。
