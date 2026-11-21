# 原五单元停止回执与终态观察

内部原组对象现可执行固定停止事务并收集必要终态证据。公开认证关闭通道、原启动 job 完成回执、Node 原始 I/O 的一次性消费及完整物理退出许可仍未接通；本轮没有发放槽位复用许可，记录继续保持 `closing`。

创建阶段的原 worker 在取得 pidfd/proc 后，持有原 cgroup2 目录链与 events FD，并通过原 FD 的 fstatfs 核对文件系统类型。运行复查不重新打开这些对象；目录、events 或原来源撤销后拒绝继续。停止后不要求 nlink=0，也不以路径消失单独证明退出。[内核 cgroup v2 文档](https://docs.kernel.org/admin-guide/cgroup-v2.html)

job 通道沿用同一个已认证 manager socket、GUID、唯一 owner 和应用登记引用，完成 Hello、匹配规则及 Subscribe。仅支持固定有界 D-Bus 类型，拒绝 FD 类型、额外传入的真实 SCM_RIGHTS、重复 header/消息/job、来源漂移和 EOF。无关系统 job 不升级成自己的回执；较早到达的本组 JobRemoved 等待对应 ACK 后才可使用。通道不重连，错误不自动重发。[D-Bus 协议](https://dbus.freedesktop.org/doc/dbus-specification.html)

`stop_original()` 不接受 PID、unit、路径或成功字典。它先完成关闭意图，再依次停止四角色和 anchor。每个角色在派发前持久记录 intent，核对原 Id/InvocationID/Restart，保存 StopUnit ACK，最后匹配同源 JobRemoved 的 job、unit 和 done 结果并落盘。依赖早已触发而未观察到的信号不能追认；创建阶段的原启动完成回执仍须另接。[systemd v249 接口](https://raw.githubusercontent.com/systemd/systemd/v249/man/org.freedesktop.systemd1.xml)

`collect_terminal_evidence()` 仅消费原停止对象。它在内核采样前后复查原单位身份、无当前 job、无自动重启及重启记录、MainPID0 和 inactive/failed 状态，并组合原 pidfd 的退出事件与原 cgroup/events 空或退役观察。ENODEV 必须与原对象身份、原路径退役、原停止回执和其他检查组合；不从单个错误生成许可。早先原对象在后续检查或写盘期间撤销时，整组结果不会发布。这些对象不证明全部僵尸回收，也不代替 Node I/O 排空。

本地 TDD 已覆盖独立 wire 样例、消息早到/晚到、丢 ACK、InvocationID 换代、真实传入 FD 清理、原 cgroup 替换/撤销、活 pidfd、重启记录、空/退役 cgroup 及迟到撤销。真实临时文件、socket、journal/fsync 与生产控制流参与测试；Linux 身份、systemd 和内核边界在 Mac 测试中明确使用替身。最终 Python broker 全套 724/724 通过（888.866 秒），其中18项新增用例；[验证和源码绑定](evidence/controlled-stop-evidence-20261121/verification.json)与[完整测试输出](evidence/controlled-stop-evidence-20261121/broker-suite.txt)已保存。作者按原连接、错误路径和所有权进行串行复核，不声明独立审查。

源树 native manifest 仍为 unverified，新源码未重新构建，旧归档仍属于旧输入。真实 B2 五单元与两组、固定身份/文件视图/不可迁出、Chromium sandbox、原 sealed native bundle 和正式退出消费仍是独立门禁。未新增模型或 KMS 调用、网站导出、业务任务重放、Windows 实验操作、合并或部署。
