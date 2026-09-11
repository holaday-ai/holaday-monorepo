# 浏览器管理服务受信启动登记实施计划（9d-2c）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans；按用户资源约束主线程实现，复用唯一只读reviewer，串行验证。

**Goal:** 提供真正获取自身pidfd的root登记发送端及受信接收端，连接既有PinnedApplication，拒绝伪造、重放和不完整传输；登记确认不开放浏览器。

**Architecture:** 专用root私有AF_UNIX/SOCK_SEQPACKET连接传送固定48字节登记记录和唯一pidfd，不接收调用者PID。接收端使用逐消息内核凭据匹配原进程，持有独占副本后才回复同事务ACK；单实例仅一次尝试，任何不确定性封闭，不重试、不覆盖旧登记。

**Tech Stack:** Python3.10标准库socket/os/array/struct/time/threading/unittest。Linux原生系统调用，本机macOS只做边界单测与真实非Linux拒绝。

**Spec:** docs/superpowers/specs/2026-09-11-pool-launch-registration-decision.md（B已批准）、2026-09-11-pool-process-containment-decision.md。

## Global Constraints

- 基线a70fd5ce，现有codex/qwen-safe-drain隔离worktree；保留主8草稿与PR237冻结记录。任务约10GB，所有重任务串行，不安装、不启动Docker/浏览器。
- 主应用uid998；B专用账号仅供浏览器工作进程，无交互登录、无sudo、无应用组、无通用管理权。本单元不创建实际账号/目录、不修改PM2或现有启动器。
- 08:30 JST窗口已过，无生产变更或平台实验，无部分push/PR/合并/部署。付款等原排除范围不变。
- 必须完成后续可信安装/路径校验/解释器前环境清理、彻底降权和同PID exec、运行请求接线、持久状态、固定系统模板、实际Linux隔离及首次维护门禁才能启用。此单元不是完整启动器或就绪证明。

## 文件与接口

- 新增scripts/pool-broker/launch_registration.py：register_self(channel, candidate, boot, gid)发送端；LaunchRegistration(candidate, gid).receive(channel)接收端；close()永久撤销。candidate为受信发布配置40位非零小写hex，boot为本次root启动产生32位非零小写hex，gid精确正整数、不接受bool。主uid固定998。两端接管channel并在完成/失败时关闭，不接受路径/命令/环境或PID。
- 新增scripts/pool-broker/test_launch_registration.py：直接测试两端及既有真实PinnedApplication，仅替换mac缺失Linux syscall边界；不注入生产成功provider。
- 既有process_pin.py/protocol.py仅复用，非必要不改动。

## Task 1：root登记的端到端本地实现

- [x] 写最小发送端和接收端反例，缺模块必须明确FAIL：

```python
self.assertIsNotNone(launch_registration, "root registration not implemented")
launch_registration.register_self(channel, "a" * 40, "b" * 32, 998)
# 断言pidfd_open只取getpid()而非请求PID；sendmsg移交同一个FD；ACK匹配才返回。
registration = launch_registration.LaunchRegistration("a" * 40, 998)
registration.receive(channel)
# 断言真实PinnedApplication独占dup、收到FD关闭、回复48字节固定事务ACK；第二次拒绝。
```

- [x] 运行python3 -B -m unittest discover -s scripts/pool-broker -p 'test_launch_registration.py' -v，观察2项缺契约FAIL。
- [x] 实现最小两端，固定网络序结构!8s20s16sI：magic=HDPLREG1；ACK=HDPLACK1，余下字段逐字相同。原生凭据=iII；只认一份SCM_CREDENTIALS和登记唯一SCM_RIGHTS。sender调用os.pidfd_open(os.getpid(),0)；receiver以内核credential PID调用PinnedApplication.from_root_launch，绝不pidfd_open客户端值。
- [x] 追加安全反例：格式/版本/候选/boot/gid、非root/非Linux、SO_TYPE/family错误、连接凭据与实际发送者不一致、缺失/重复/截断/未知ancillary、多个FD、错误pidfd、发送短写/超时、ACK丢失/错事务、已有外层异常、close失败以及重复receive/close。
- [x] 实现有界接收：一次recvmsg，数据49字节、ancillary最多253个FD加凭据；MSG_CMSG_CLOEXEC，所有收到FD无论接受/拒绝都关闭且不重试close。只允许MSG_EOR/MSG_CMSG_CLOEXEC回执标志，TRUNC/CTRUNC等拒绝。SO_PASSCRED，原生root peer与逐消息凭据精确一致。全事务5秒单调时钟期限，每次阻塞前设置剩余时间，清理后复核期限，超时后无成功。系统调用返回的FD属于本事务，不扫描或关闭外部FD。
- [x] 发送端在确认前始终root且不加载应用、不执行降权/exec；失败返回固定POOL_BROKER_REGISTRATION_UNPROVEN且无cause/context，不重试。接收端登记后仅内部保留pin，既没有ready也没有create入口；回复失败撤销pin且耗尽本实例登记次数。独立永久_revoked防止同步close重入后登记复活。服务重启必须由后续持久启动门禁重新批准，不能通过构造新对象绕过旧boot对账。
- [x] 全量运行python3 -B -m unittest discover -s scripts/pool-broker -p 'test_*.py' -q；AST解析、diff检查、独立审查修复完成。精确提交及时间以QA最新节点为准。

## 后续实施顺序（不在本单元冒充已交付）

1. 可信启动安装清单与固定root启动入口：预解释器环境、root-owned所有祖先与模块、附加组/capability/FD彻底清理及同PID降权exec；专用浏览器账号冲突校验及精确目录交接，禁止旧profile递归迁移。
2. uid998运行socket每个原生消息凭据与pin/boot绑定，应用hello仍closed；完整时间/字节预算，消费原protocol而不接受任意参数。
3. 持久capability/resource生命周期和独占systemd管理，固定工作模板、两份资源及CDP/VNC/X11隔离；最后应用接线、Linux完整组合验证和新有效生产发布窗口。每个交付需自己的TDD计划，不能用本列表充当实现或平台验收。

官方依据：SOCK_SEQPACKET保留消息边界，凭据逐消息验证，SCM_RIGHTS为FD引用移交，截断时仍清理已返回FD；Python recvmsg/sendmsg按原生接口执行。[unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html)、[Python socket](https://docs.python.org/3.10/library/socket.html)、[pidfd_open](https://man7.org/linux/man-pages/man2/pidfd_open.2.html)。

## 本地完成证据与安装前约束

2项缺模块RED→最小GREEN；安全矩阵39失败/13异常（含subTest）→19项GREEN。独立审查发现最终清理跨期和同步close重入两项Important，新增2组反例8失败→期限修复剩5失败→永久撤销修复68总GREEN。再补3项FD清理故障/原生合法flags顺序测试，最终71/71（24登记+47既有）通过，6个Python文件AST解析、diff检查通过；复审两项均关闭，无剩余必修项。未运行真实Linux或生产测试。

未来监听器必须在listen/accept前启用SO_PASSCRED，避免消息先入队导致凭据不可用；本模块仍在接管连接时设置并逐次验证，缺凭据即拒绝，不放宽为仅SO_PEERCRED。监听路径、单次启动登记实例及其跨broker重启持久门禁由后续受信服务提供，不把任意root socket、构造对象或此ACK作为安装完成/业务ready证据。
