# 原进程身份句柄实施计划（9d-2a）

> **For agentic workers:** 使用superpowers:executing-plans；主线程实现，唯一review_qwen_negation只读审查，串行执行。用户已批准限定系统服务开发，不重复要求同项确认。

**Goal:** 独占保留受信启动端已获取的原应用pidfd，拒绝退出、失效、身份不匹配及跨boot输入；不是完整客户端认证。

**Architecture:** Python标准库直接调用内核边界；无公开可注入provider。只接受root启动端已持有的pidfd，绝不根据传入PID重新打开进程。内部复制为不可继承FD，核对pidfd及/proc/self/fdinfo的Pid，poll原句柄；身份检查仅必要条件，不产出授权令牌或缓存放行。主应用uid998不变。

**Tech Stack:** Python3.10标准库os/signal/select/struct/threading/unittest；本机macOS仅syscall边界单测，非Linux路径实际拒绝，不安装或运行Linux环境。

**Spec:** 2026-09-11-pool-process-containment-decision.md、2026-09-11-pool-broker-request-boundary.md及2026-09-10-safe-execution-drain-design.md。

## Global Constraints

- 初始dff8de76，codex/qwen-safe-drain现有隔离worktree；主8草稿、冻结PR237/66f3a583不变。
- 约10GB任务预算，free<40%或磁盘<10GiB不启动重任务；单主+原reviewer串行，无安装/Docker/浏览器/真实OS服务实验或生产访问。
- 08:30 JST生产窗口已过。无部分push/PR/合并/部署，不改应用权限、浏览器身份、系统配置或原发布门禁。
- 不触支付/奖励/提现/Partner Ledger/额度/账号注销/DivineAPI/旧供应商配置，不输出秘密、真实身份或业务文本。

## 已核实语义和局限

- SO_PEERCRED是连接建立时身份；SO_PASSCRED/SCM_CREDENTIALS用于实际发送者。后续每次recvmsg都需完整凭据，拒绝缺失/重复/截断及混合发送者；拒绝SCM_RIGHTS时仍必须关闭收到的FD。EOF不是发送者证据。[unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html)
- pidfd引用原进程；poll可观察退出，但不证明原执行映像不变。root父进程取得pidfd须无PID复用窗口（未被并发reap的自有子进程或原子clone获取），不靠事后扫描登记。[pidfd_open(2)](https://man7.org/linux/man-pages/man2/pidfd_open.2.html)
- 本模块仅使用pidfd_send_signal的固定信号0来验证句柄/权限，不发送实际信号，不提供kill接口。[pidfd_send_signal(2)](https://man7.org/linux/man-pages/man2/pidfd_send_signal.2.html)
- 同UID的ptrace/内存/FD访问隔离必须实际验证；凭据相同不能证明未被注入。不修改主机Yama或用“应用被攻破不在范围”掩盖此缺口。[ptrace(2)](https://man7.org/linux/man-pages/man2/ptrace.2.html)
- root启动登记生产者、exec阶段/再exec约束、进程内存隔离、socket原始凭据来源、平台能力及完整业务排空都尚未实现/验证；本单元不能解除GROUP_EXIT_UNPROVEN或开放服务。

## 接口与生命周期

新增scripts/pool-broker/process_pin.py和test_process_pin.py。公开类PinnedApplication禁止直接构造；唯一工厂from_root_launch(pidfd, expected_pid, boot, gid)，参数仅来自未来受信root启动内部调用，禁止暴露为网络/本机注册API。精确整数fd>=0、pid>=2且<=2147483647、gid>0且<4294967295，boot非零32位小写hex。uid固定998。Linux、euid0及原生pidfd/poll能力缺失均拒绝。

工厂借入原pidfd，os.dup形成独占FD、设置不可继承；固定信号0确认实际pidfd，读取固定/proc/self/fdinfo/<内部FD>最多8193字节，超过8192或Pid行缺失/重复/负值/不匹配拒绝。poll(0)任何事件均拒绝。失败只关闭内部FD，原借入FD不归模块所有，绝不重试close（避免FD号已复用）。不按PID重开。

check_sender(credentials:bytes, boot:str)消费未来recvmsg取得的原始ucred（本机ABI =iII，共12字节），只能匹配登记PID/uid998/gid与boot；检查前后均验证原pidfd存活，返回None不是授权能力。传入普通bytes本身不证明内核来源，调用端不得把用户载荷转交这里作为凭据。无效请求不撤销合法身份；内核观察失败或退出永久失效。close先撤销再关闭，可重复调用；上下文管理器负责正常生命周期。对象锁串行check/close，但返回后不承诺持续存活，实际派发必须重新检查且纳入后续状态机。默认repr不显示FD/PID/boot/gid。

所有拒绝为固定BrokerIdentityError("POOL_BROKER_IDENTITY_UNPROVEN")，无原始异常context/cause；不打印/proc内容/凭据。只读信号0或poll成功不等于浏览器组退出。

## 一项可独立审查任务

- [x] 初始RED：from_root_launch后的原进程匹配与close后永久拒绝；缺模块记录契约不存在。测试只在os.dup/open/read/close、signal.pidfd_send_signal、select.poll等真实syscall边界替换，断言真实模块的拒绝/FD清理/调用顺序。无生产provider参数。

```python
pin = PinnedApplication.from_root_launch(9, 123, "1" * 32, 998)
pin.check_sender(struct.pack("=iII", 123, 998, 998), "1" * 32)
pin.close()
with self.assertRaises(BrokerIdentityError):
    pin.check_sender(struct.pack("=iII", 123, 998, 998), "1" * 32)
```

- [x] 最小GREEN后补安全RED矩阵：同UID不同PID、uid/gid/boot错、格式错；原进程退出/任意poll事件/零信号或fdinfo错误永久拒绝；dup/set_inheritable/open/read/close故障准确清理、close不重试；无效字段/非Linux/非root/缺能力在dup前拒绝；fdinfo重复/缺行/超长/不匹配；真实非Linux路径拒绝。
- [x] 实现并复验。命令：python3 -B -m unittest discover -s scripts/pool-broker -p 'test_*.py' -q。测试可用unittest.mock.patch补齐mac缺失原生符号，不触真实PID/FD；明确这些是边界单测，不计Linux集成通过。
- [ ] 两新文件ast.parse、git diff --check；唯一reviewer复审并修复必修项，最终精确提交计划/实现/测试。QA记录时间、计数、commit和下一步；更新原自动化断点。

## 接续顺序

接着完成受信root启动登记（应用放行前持有原pidfd）与exec/同UID隔离方案，仍不得上线；socket层每块凭据与有界完整请求、boot/capability持久状态、实际系统模板及平台门禁依次衔接。生产只读预检或合成Linux实测另按原授权边界执行，不能因为本机测试绿而跳过。

## 本轮完成证据

2026-09-11 14:31 JST最终47/47本地测试通过（21身份句柄+26协议），4文件ast.parse与diff --check通过，free69%、磁盘141GiB。初始2契约RED→2最小GREEN；19项安全矩阵出现55失败/4异常（含subTest）→44总GREEN。随后新增身份外层异常/上下文关闭2项，21项2失败→修复后46总GREEN；上一轮protocol同场景26项1失败→修复后47总GREEN。边界替身不等于Linux实测。

自查与独立reviewer发现同一Important：from None只隐藏显示，调用方已有异常时仍保留context。统一拒绝出口在实际抛出后清context并原位重抛，协议解码同步修复，复审已关闭Important、无剩余必修项。本任务精确变更范围因此扩展为本计划、process_pin.py/test_process_pin.py以及既有protocol.py/test_protocol.py，共5文件，属于同一固定错误隐私边界回归；没有新增权限。

最终staged检查、提交和原自动化断点以QA最新记录为准。没有socket认证、Linux实测或整套broker完成的声明。
