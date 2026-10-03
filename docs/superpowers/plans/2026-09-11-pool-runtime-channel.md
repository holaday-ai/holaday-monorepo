# 原登记对象承接运行消息实施计划（9d-2k）

> **For agentic workers:** 使用executing-plans与TDD，主线程实现，只复用review_qwen_negation只读审查；禁止并行重任务。

**Goal:** 完成私有root登记到uid998运行消息的真实验证与关闭态响应，不开放资源操作。

**Architecture:** 继承已批准9d-2b/9d-2j。RootLaunchListener保留同一LaunchRegistration及原pidfd，不导出或重建身份。运行端独立固定socket，逐消息验证SCM_CREDENTIALS、原进程存活和boot，再由真实protocol解码。资源后端未完成，合法请求也只收到固定RESOURCES_UNPROVEN拒绝，不返回能力或成功替身。

**Tech Stack:** Python3.10标准库，Linux STREAM/pidfd（root登记保持SEQPACKET）；本地仅合成系统边界测试。

**Spec:** docs/superpowers/specs/2026-09-11-pool-launch-registration-decision.md 和 docs/superpowers/specs/2026-09-11-pool-launch-listener.md。

## 约束与本单元详细契约

- 基线ce7a8f6b；沿用隔离codex/qwen-safe-drain，主8草稿/冻结PR237包不变。10GB预算、Node2GB、重任务串行；不安装/Docker/浏览器/生产/秘密读取，不触支付/奖励/额度/账号注销/DivineAPI/旧供应商。旧08:30 JST生产窗口不延长，全部发布门禁未过不部分发布。
- root注册socket仍0700父目录；不把它改成应用可遍历。运行socket独立为/run/holaday-pool-runtime/control.sock，预先管理员配置的父目录root:app_gid0750，无ACL/capability，所有祖先不可被非root写。应用仅能连接root:app_gid0660的socket，不能替换目录项。模块不mkdir/chown目录，不激活服务。
- LaunchRegistration增加仅内部使用的运行就绪状态：真实receive完成全部清理后才成立；check_runtime_sender(credentials,boot=None)核对同一原pin前后撤销/身份。启动授权过期不使已完成登记凭空消失；此接口不开放业务，不认可root凭据，不接受PID参数，不缓存鉴权结果。
- RootLaunchListener.serve_runtime_once()只在accept_once完整成功后允许，拒绝同步重入；创建固定STREAM/CLOEXEC/PASSCRED监听(backlog1)，整个accept/receive/reply/cleanup共5秒单调期限。身份/协议/IO/过期/清理错误永久撤销登记并关闭所有已接管FD，不自动重试。
- 一次连接只接受一个累计1..4096字节JSON请求，Node主进程用net.Socket直接连接并以end发送请求后写半关闭；服务端读取到EOF才解码，不使用改变PID的子进程桥。每次recvmsg预算为4097减已接收长度，加内核最多253个rights及ucred；每个非空数据块都需原发送者凭据，EOF可无凭据但不得附带rights/异常控制信息。先收集全部FD再拒绝任何SCM_RIGHTS、缺失/重复/改变凭据、未知ancillary、截断或未知flags。SO_PEERCRED必须与该消息的凭据相同，真实pin.check_sender逐次核验；连接前后的root→uid998变更不复用旧连接。
- decode_request只允许既有create/query/close；此单元无平台派发或资源能力，仅返回固定ASCII JSON：{"version":1,"status":"blocked","code":"POOL_BROKER_RESOURCES_UNPROVEN"}。不回显requestId/boot/自由文本。重复合法请求只能得到相同关闭态，不声称提供资源幂等或对账；资源store后续独立接线。
- 校验函数含原生调用，返回后必须复查撤销和同一对象。socket/path/FD交接先移走所有权再close；仅验证本实例dev/ino/root/type/mode后unlink，未知旧路径/替换路径不删。不修改永久授权消耗标记，不发信号终止业务，不从存活/拒绝响应推断GROUP_EXIT已证明。

## Task 1：完整关闭态运行通道

**Files:** 新增scripts/pool-broker/runtime_channel.py、test_runtime_channel.py；修改launch_listener.py、launch_registration.py以及installation/bootstrap精确成员和测试。无PM2/systemd启动配置变更。

**Interfaces:** RootLaunchListener.serve_runtime_once()不接受用户参数、不返回授权，内部调用runtime_channel.serve_closed(registration)；LaunchRegistration.check_runtime_sender(credentials,boot=None)只接内部内核字节；缺省boot仅使用同一私有pin的boot，解码后显式匹配请求boot，返回None仅说明瞬时检查。所有权仍由RootLaunchListener.close()撤销。

- [x] 写缺接口RED，复用test_launch_listener合成FS/syscall fixture，调用真实消费/登记，再用uid998消息驱动新运行接口，不mock登记或protocol成功。

```python
listener = RootLaunchListener.open('a' * 40)
listener.accept_once()
listener.serve_runtime_once()
assert reply == b'{"version":1,"status":"blocked","code":"POOL_BROKER_RESOURCES_UNPROVEN"}'
assert retained_fds == {42}  # 原登记pin，不是新pidfd
listener.close()
assert retained_fds == set()
```

- [x] 实现已完成登记状态、运行发送者原pin检查及固定socket生命周期；仅上述关闭态回复，无success callback或后端占位放行。测试create/query/close均关闭、到期启动window不错误当运行租约、未登记/已撤销/重入拒绝。
- [x] 逐包反例：错UID/GID/PID/boot、连接与消息凭据漂移、缺/重复凭据、rights包括截断、坏JSON/动作/长度、死pin、超时/NaN/倒退、短send和cleanup错误；核对没有回复/资源派发，FD准确关闭。用真实原pidfd检查而非凭字符串重建。
- [x] TDD补管理员目录权限/ACL/符号链接、已有/替换socket不误删、同步close在原生检查与IO边界不复活；未知失败永久撤销。
- [x] 新runtime模块加入安装精确成员和hash/preload；缺失/应用可写/哈希不匹配先RED，接线后GREEN。
- [x] 主线程串行全套unittest、Python AST/JSON/diff，原reviewer独立审查修复必修项，最终复验后完整本地提交及QA/自动化断点。Linux内核/权限/真实socket未验证不能记为平台通过。

## 后继门禁

持久资源prepare-before-dispatch与能力绑定、systemd实例/组退出组合证明、维护签发和精确交接、broker服务第一入口与Node客户端、实际Linux与首次维护/回滚/整体验收尚未完成。本关闭态通道不替代这些机制，也不提供“完整运行资源服务已完成”的声明。
## 传输兼容性审查

原运行端SEQPACKET选择经独立审查发现无法直接接Node net，并已改为STREAM；root登记不变。Node官方说明net提供stream-based IPC，[Node net文档](https://nodejs.org/api/net.html)；Linux逐段SO_PASSCRED/SCM_CREDENTIALS以[unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html)为依据。源码客户端接线和实际Linux语义仍须独立验证，不把同UID子进程桥接作为客户端。单个连接请求到EOF的5秒/4096总预算不变。

## 2026-09-11 18:37 JST 本地实施结果

- 本地完整链已实现：真实root启动消费与登记→同一LaunchRegistration/PinnedApplication→独立固定STREAM运行socket→逐块内核凭据及原pin存活检查→累计请求到EOF→真实protocol→固定blocked响应。未开放资源创建/查询结果/关闭能力；未签发能力、启动浏览器、安装服务或接线Node客户端。
- 运行父目录只读逐段校验root:app_gid0750；新socket初始root0700，核对路径身份后精确设置group/0660，应用不能改父目录项。已有未知或替换路径不删，所有已接管FD/channel一次close。发生异常永久撤销原登记；成功后仍只保留原pin。
- 设计复核把不能直接接Node net的SEQPACKET运行端改为STREAM，root登记不变。已补分片、第二发送者、累计大小、第二JSON、无写半关闭不提前回复、EOF非法rights等反例；这不是实际Node/Linux组合验证。
- 代码复核发现发送超时沿用旧预算、settimeout期间close/到期仍读取：先有两个recvmsg1次反例和预算不匹配失败，再以prepare_io在昂贵检查后更新timeout并进行最终轻量期限/撤销检查修复。重构曾漏掉listen前guard，两个chmod后close/到期仍listen1次反例RED后已恢复guard转GREEN。最终原reviewer无Critical/Important/必修Minor，审查者未运行测试。
- 最终主线程串行全套241/241通过（3.474秒），其中运行通道24测试；25 Python AST、2 JSON、unstaged diff通过。安装新成员缺失/应用可写先3失败、hash精确名单3错误，接线后全套通过。所有外部内核/文件系统身份为合成边界，不是生产或Linux端到端证明。
- 5秒是各派发/收尾边界检查及阻塞IO预算，不承诺调度停顿、系统调用与时钟读取原子化或内核永不延迟。没有额外无界线程/队列，不安装/Docker/浏览器。系统空闲70%；主8草稿、冻结66f3a583及PR237 manifest ad0f5c0064bd02887a896fbf9e4a89b16e227da29bc75a4094aa2c56759e8c40未变。
- 下一完整单元：持久资源prepare-before-dispatch与能力/实例绑定，保留查询/关闭的真实对账状态、响应丢失不重新创建。先读9d containment要求与已有生命周期/持久状态接口，明确完整资源状态转换后TDD接线；不得用无条件成功后端把本运行端开放。维护签发/精确交接、服务与Node客户端、Linux Task3及首次维护/回滚/全部发布门禁继续保留。GROUP_EXIT_UNPROVEN不放宽，旧08:30 JST生产窗口不延长。
