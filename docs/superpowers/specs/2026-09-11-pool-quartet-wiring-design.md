# 浏览器池整组接线设计

2026-09-13最新：B2本地接线及独立验收已完成，见`../plans/2026-09-13-pool-quartet-local-verification.md`。以下“实施中/未完成”为设计时的历史状态；本次不包含第3退出排空、第4真实Linux或第5维护开放，不发布部分实现。

状态：第2大项实施设计，承接已批准系统级管理服务与B专用非登录工作账号。基线 fad214e5。没有生产变更、Linux验收或完整接线完成声明。按用户要求整项交付，不拆成多个对外交付单元。

更新：用户已批准B2固定每槽位不同非登录UID/GID。以下单UID单unit/PID1方案保留为历史比较，不再实施；实施权威为本节B2与2026-09-11-pool-slot-identity-decision.md。不得将下方历史root初始化器路线重新引入B2。

## 已批准B2实施边界

- 每槽位固定不同UID/GID，与应用uid998和旧工作账号隔离；受版本/hash绑定的slot-identity-policy.json白名单，普通导入无政策，源树模板unverified/空slots，实际候选在Linux验收时固定值。名字固定holaday-pool-slot-NN，home固定/var/lib/holaday-pool-slots/slot-NN，shell固定/usr/sbin/nologin；无运行时useradd、DynamicUser或任意账户参数。白名单容量必须与候选批准容量相同，不自行扩大。
- 只读账号核验使用NSS双向查询、完整有界枚举、UID/GID唯一性、无跨组主/附加成员检查，不读取密码/GECOS。所得不可变快照不是可缓存授权，每次真实派发前重新核对；创建账号、锁定密码及真实隔离证明是独立平台门禁。
- 固定每组anchor及Xvfb/Brave/x11vnc/websockify四角色由systemd管理；不使用自写PID1/keeper或同UID PID namespace链。全部unit/cgroup绑定原manager、组、InvocationID，After/Requires/BindsTo/JoinsNamespaceOf只引用本组固定anchor，Restart=no，无替换或自动重派。
- 每组固定只读RootDirectory文件视图由候选清单与Linux验收绑定，精确暴露工具/库、当前组profile/tmp/认证和数据端点；不向工作进程挂应用环境、管理socket或旧组残留数据。PrivateNetwork/IPC/Tmp和/dev/shm独立挂载，ProtectProc与非同UID跨槽位边界；不声称systemd249提供PIDnamespace。
- 固定非root预工作守卫读取原事务私有namespace凭据并核对实际namespace、身份、能力、文件视图后才exec固定角色；namespace失败被systemd忽略时必须拒绝执行。守卫不接受调用方成功字典，不按任意PID重建原对象。
- 下方控制/数据面安全要求保留：root仅控制固定端点，不代理业务内容；原Node exec关闭所有非stdio FD，运行通道拒绝SCM_RIGHTS；私有CDP/VNC、独立egress能力及原IO归属不因改UID而省略。
- 第3项未完成前无组退出/slot复用授权；第4项真实Linux前不称隔离有效。旧单角色日志保留占位、不迁移；旧安装路径维持关闭兼容，不能当B2核验。

## 历史原B比较（不执行）

## 已确认问题

当前 xvfb_launch.py 的 PrivateTmp/PrivateNetwork 仅隔离单个服务；四份相同模板不会自然共享X11和loopback。关闭隔离又会把旧CDP/VNC裸端口暴露给本机其他任务。installation.py只有一个工作UID；同UID的0700目录、LoadCredential和ProtectProc=invisible不能独立证明跨槽位隔离。BrowserEgressProxy已承担SSRF/IP固定连接策略，不能为了沙箱联网而绕过。

## 整组边界

采用一份quartet transient unit，一份原manager GUID/owner、unit InvocationID、cgroup和私有组能力。systemd先建立组，固定root初始化器仅创建本组PID/network/mount/IPC namespace和固定端点，然后彻底降权；所有四角色及非特权数据桥都在组内。四个角色不是四份可独立重新启动的系统服务。原单角色Xvfb日志仍保留，只用于旧记录只读对账，不升级成整组、不复用身份。

不采用四个unit通过JoinsNamespaceOf拼PID隔离：systemd249仅在指定条件下共享network/IPC/tmp，并不共享PIDnamespace。四加入器方案另需keeper、setns后fork、四份原进程引用与复杂顺序；它不是本实现路径。也不新增每slot系统账号、通用namespace API或root业务代理。

组内固定非rootPID1监督Xvfb/Brave/x11vnc/websockify；只从创建操作获得原child pidfd，不扫描PID。root创建端与child在预建私有socketpair上交接原namespace FD与固定类型握手，再向原broker登记。所有工作放行前清理非允许FD、附加组、有效/保留/环境能力，降权后不可返回root。主应用仍uid998，无CAP_SYS_ADMIN/setns/manage-units权限。

文件根只包含经固定清单校验的只读工具/运行库、自己的profile/tmp/认证材料和明确数据端点；不挂宿主/proc、其他slot目录、应用配置、管理socket或宿主目录FD。挂载传播私有；proc由本PIDnamespace挂载；没有宿主网卡/default route；loopback仅本组。Chromium保留沙箱，不加--no-sandbox。所有前置校验失败都不放行任何工作。

## 控制面和数据面

原Node运行通道继续拒绝SCM_RIGHTS。root初始化器FD握手是独立root私有通道，只消费本次启动产生的引用；不按持久FD数字/PID重建授权。控制面仅固定创建、查询、关闭，不接受任意命令、路径、namespace或网络目标。

CDP/VNC：broker在root管理、仅app组可遍历目录预创建两个私有AF_UNIX listener，原对象FD只交给本组非root桥。桥仅连接本组固定CDP/VNC端口。Node直接net.connect固定私有端点，不接收FD。Playwright所需TCP/WS由uid998适配器提供，必须带不可猜私有能力和严格认证头；随机端口不当认证。VNC沿用用户与当前实例认证，不公开内部能力。

出站采用独立应用Unixlistener，不修改首次exec的非stdio全部关闭契约：
1. root安装预置唯一专用app-owned0700目录；Node原boot创建独占Unixlistener，不unlink已有路径。
2. socket叶0666的可达性仅来自受保护父目录及本组精确挂载，不把0666或只读bind称作数据权限。root逐段检查唯一固定目录/叶对象，持有该socket原对象引用。
3. root以有界固定随机challenge探针核对原登记进程；每段SCM_CREDENTIALS、原pidfd、boot均匹配。SO_PEERCRED连接快照单独不够。探针不传或解析HTTP/CDP/VNC。
4. 按原对象引用bind-mount，仅将叶socket给组；不按随后可替换的源路径重新挂载，挂载后核对原对象。listener换代/失联保持未知，不跟随新inode。
5. 各组使用独立仅限egress的数据能力，与管理capability分离。非root桥有界握手后送入原BrowserEgressProxy，所有客户端socket、DNS/策略Promise、upstream request/transport绑定原组生命周期；不能只用全局socket集合支撑单组release/adoption。
6. root不读写业务数据。组内只有固定proxy出口，目标仍由应用SSRF策略解析并连接已批准IP；不支持通用TCP/宿主网络隧道。

不承诺抵御原主应用进程内恶意代码；同PID后续exec仍按既定不支持转换处理。

## 持久化和就绪

新增整组记录有显式版本/组件类型；必须原子保留boot/candidate/slot、管理与egress能力分别绑定、unit与启动请求、原初始化握手。prepare/dispatch/accepted/observed和组内部ready分开；旧日志字节保留，未知继续占位。原内核FD仅实例内持有，重启后只读记录不等于可自动接管。

创建回应只能在固定端点实际完成协议核对后给ready；不能从job ACK、InvocationID或PID1存活推断。Node接线必须替代严格路径的旧spawn、250ms等待、按端口/PID重建与reaper/singleton退路。adoption保持同一物理组和能力，业务关联改变不能清除IO。

第3项尚未完成前，生产运行开关保持关闭，不签发groupExit/slot复用/排空成功。初始化器失败、PID1/waiter死亡、桥断联、迟到ACK和未结束的IO均保留失败/unknown，不强杀后称成功。

## 实施与验证次序

先实现整组持久契约、固定初始化/端点生产者和非root监督/桥；再接Node私有客户端、出站逐组生命周期、CDP/VNC适配与严格boot；最后整组验证和独立审查。所有内部步骤在同一大项内，不能把只有template或fake-success wiring称完整。

本地TDD使用真实文件、socket、原始Promise、进程和实际生产控制流；只有Linux内核/systemd外边界可合成。两槽位隔离、权限、Chromium沙箱和真实namespace启动必须第4项Linux独立验收，不以本地C编译/模拟syscall返回值顶替。已批准10GB预算、重任务串行、无安装/Docker/新浏览器及所有禁止业务范围不变。

## 官方依据与独立审查

- [systemd249共享namespace](https://raw.githubusercontent.com/systemd/systemd/v249/man/systemd.unit.xml)：JoinsNamespaceOf并非PIDnamespace共享。
- [systemd249执行隔离](https://raw.githubusercontent.com/systemd/systemd/v249/man/systemd.exec.xml)：ProtectProc/invisible以其他用户为边界，PrivateTmp/PrivateNetwork和credential各有具体语义。
- [Linux PID namespace](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html)：PID1、后代可见性与后续fork行为需要完整管理。
- [/proc/pid/root](https://man7.org/linux/man-pages/man5/proc_pid_root.5.html)：访问受ptrace读权限校验并可暴露目标namespace文件视图，不能只靠同UID目录mode。
- 原review_qwen_negation对单组架构与Unix出站方案只读审查：原B范围内可实施，无需新增OS账号/root数据代理；要求原socket对象绑定、逐段内核凭据挑战、独立egress能力/逐组IO、全父子降权。此结论不是代码审查或平台通过。
