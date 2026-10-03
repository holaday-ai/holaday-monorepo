# 固定 systemd 管理通信生产者（9d-2m）

> **For agentic workers:** 使用executing-plans、TDD和原review_qwen_negation只读审查；单主实现，重任务串行。

**Goal:** 从固定本机总线真实认证握手和固定busctl类型化读取取得管理器连接绑定；不接受调用方成功字典，不启动资源。

**Architecture:** 保留原LaunchRegistration；固定root受保护system bus路径取得AUTH GUID。每次busctl读取固定address+guid、禁自动激活与交互，查systemd unique owner及该连接UID/PID；必须root/PID1。只读probe不声称资源实例、manager跨exec或组退出证明。现成busctl负责D-Bus编解码，不自写完整协议。

**Tech Stack:** Python3.10标准库socket/subprocess/selectors，systemd249 busctl；不安装依赖。

**Spec:** 2026-09-11-pool-process-containment-decision.md、2026-09-11-pool-launch-registration-decision.md、2026-09-10-safe-execution-drain-design.md。

## Global Constraints

- 基线1cc4fdde，codex/qwen-safe-drain隔离工作树；主草稿与PR237冻结包不变；10GB预算、禁止安装/Docker/新浏览器/生产/秘密与原禁止业务模块。旧08:30 JST窗口不延长。只读通信代码不在本轮连接真实系统总线或生产。
- 安装前固定/usr/bin/busctl与root祖先、0600/0644配置、sha256由native-build-manifest精确tools条目验证；manifest仍unverified。不允许调用方指定可执行文件、总线地址、方法、PID或环境。
- 固定/run/dbus/system_bus_socket，祖先root所有不可组/其他写、无ACL/capability；socket必须root所有、常规UNIX socket，不能软链接。root创建socket的路径是可信来源边界；不把socket peer UID当必须root（系统dbus daemon可降权）。每次调用前后复核目录项dev/ino和socket身份。
- AUTH仅NUL+AUTH EXTERNAL 30 CRLF，读取精确OK+32位小写非零GUID+CRLF，最多37字节；来自此连接的GUID，不使用GetId替代。认证连接持有到close。SO_PEERCRED只检查合法内核结构；root所属固定路径与GUID验证共同约束后续CLI连接。
- 固定busctl选项：address=unix:path=/run/dbus/system_bus_socket,guid=握手值，--json=short、--no-pager、--auto-start=no、--allow-interactive-authorization=no、--timeout=2s。只允许GetNameOwner(org.freedesktop.systemd1)、GetConnectionUnixUser(unique owner)、GetConnectionUnixProcessID(unique owner)。使用唯一连接名校验，重复probe不得接受owner漂移。
- 每次probe完整周期5秒，子进程 stdout/stderr累计最多16384字节，原始pipe EOF及wait退出0才接受；stderr非空也拒绝。输出JSON精确type/data，重复键/额外字段/非有限数/错类型拒绝。unique owner限制:[0-9]+.[0-9]+、长度64；uid0、pid1。捕获信任工具FD并通过/proc/self/fd/FD执行，clean env PATH/LANG、stdin DEVNULL、close_fds、无shell/无pager。只终止本次尚存的busctl子进程；错误永久封闭，不把kill/timeout当资源完成。
- 同步重入close立即封闭，但在途IO持有FD到finally；只释放自己FD/连接，不删除系统路径。失败输出固定错误，不含stderr、身份、GUID或原始字段。probe公开仅reachable/managerBound/groupExitProven=false，私有GUID/owner不打印、不序列化。managerBound仅当前总线唯一连接绑定，不能证明manager没有在相同连接exec；后续资源需InvocationID/完整job和生命周期证据。

## Task 1：认证与类型化只读探测完整单元

**Files:** 新增scripts/pool-broker/manager_probe.py及test_manager_probe.py；修改bootstrap/installation及可信加载测试精确名单。资源journal与运行通道保持原状态，不签发或接受资源完成回执。

**Interfaces:** SystemManagerProbe.open(registration)、probe()返回固定聚合、close()。没有任意call/dispatch/markDone方法。

- [x] 先缺模块RED；真实原LaunchRegistration与合成Linux/socket/tool边界，断言实际固定argv、GUID与unique owner绑定、清洁env；不模拟probe成功。
```python
probe = SystemManagerProbe.open(registration)
assert probe.probe() == {'reachable': True, 'managerBound': True, 'groupExitProven': False}
```
- [x] 实现固定路径握手、工具hash、精确三种只读调用；测试fragment AUTH、错误GUID/身份/目录替换/owner换代/工具变化/重复键、pipe错误/超时/超量/关闭重入。初次与末次owner读取相同才返回；未来写操作必须直接以unique owner为destination，不能以本probe替代绑定。
- [x] 用真实本地无副作用子进程验证有界stdout/stderr、EOF/退出及超时清理；不启动busctl或任何系统服务。工具测试替身只在OS/外部程序边界，不进入生产实现。
- [x] installation/bootstrap精确成员和busctl固定工具清单先RED后GREEN；全套Python、AST/JSON/diff、原reviewer审查修复后本地提交，QA与原自动化保存新断点。

## 本地验证结果（2026-09-11 19:21 JST）

- 最终280/280通过（4.544秒），其中18项manager测试；29 Python AST、2 JSON、diff检查通过。初始8项缺模块RED；精确安装名单3失败、可信加载3错误后接线GREEN。
- 独立审查两项Important均RED→GREEN：collector沿用旧remaining重开期限/已撤销仍Popen，以及stdout关闭失败漏关stderr。现传原绝对deadline及原实例否决，Popen/selector/read/wait/清理后检查；connect/send/recv更新预算。真实故障注入曾观察到旧实现Popen被调用、只关stdout；修复后反例通过。原reviewer复审无Critical/Important/必修Minor，未代跑测试。
- 5秒是成功接纳/IO预算，不是OS调度或阻塞系统调用的硬实时保证；错误清理仅对尚属本次的CLI子进程，最多额外1秒等待reap，失败仍拒绝，不返回资源完成。测试子进程为本地无副作用Python，未执行Linux busctl或系统管理写入。macOS运行时与Python可能自行添加locale/CoreFoundation环境项，测试明确排除这些运行时自产项，不给生产增加环境权限。
- 已核对固定v249源码及D-Bus认证语义，未核对生产二进制/动态链接库或实机权限；native manifest仍unverified，不填造hash。当前绑定只能证明本次总线唯一连接的只读观察，不证明相同连接上的manager代码映像未变，更不是unit InvocationID/组退出证明。

## 后续非本单元

固定Xvfb受信模板及Xauthority预置/跨进程通信隔离，journal.prepare→claim_dispatch→绑定manager的StartTransientUnit→同unit InvocationID持久回执；其他角色、停止/组退出证据、维护签发、Linux与整体发布。不得仅凭本只读probe或CLI退出0开放运行通道。

## 语义依据

- systemd v249 [busctl](https://raw.githubusercontent.com/systemd/systemd/v249/man/busctl.xml)支持固定address、typed JSON、禁止auto-start/交互。
- [sd-bus address解析](https://raw.githubusercontent.com/systemd/systemd/v249/src/libsystemd/sd-bus/sd-bus.c)读取guid；[认证校验](https://raw.githubusercontent.com/systemd/systemd/v249/src/libsystemd/sd-bus/bus-socket.c)拒绝与预期server_id不符的认证peer。源码核查不是已安装二进制的实测。
