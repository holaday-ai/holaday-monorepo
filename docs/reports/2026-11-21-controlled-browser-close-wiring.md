# 原启动回执、认证关闭与 Node 单次观察消费

本轮实现三项本地接线：创建前订阅原启动回执、同一 boot 的认证关闭，以及原 Node I/O 收口后的单次观察消费。`terminal-observed` 只表示必要事实已观察到；完整物理退出能力、不可重新填充的终态封闭及真实 Linux/native 验收仍独立保留，未解除 unknown 或槽位占位。

固定角色派发前先在同一个原认证 manager socket 完成订阅；启动时持有 RefUnit，将精确 job/unit 的 JobRemoved(done) 与原 signalSerial 保存到既有 journal，再观察单位身份并进入完整 ready。缺失、失败或不同 unit 的完成不能由 ACK 补出，也不重派。提前到达的同单位完成事件仍保留为有原来源的历史事实，纳入关闭摘要；不从 JobRemoved 猜测 job 类型，五个本组显式停止 ACK/done 仍各自必需。

固定 listener 继续校验原登记应用进程及实际消息凭据，拒绝附带 FD。close 只接原 boot 和管理 capability，在内存注册表中寻找同一原运行组；不从日志重建对象，不接受 PID/unit/path，egress capability 不能管理关闭。原控制来源及绝对期限覆盖停止、终态采样、写盘和回复尾部。相同 request 复用原结果，不再 StopUnit 或追加第二条关闭观察；不同 request 不借用这条事务。

创建与关闭合计最多接收64次固定控制事务，为32个原槽位各保留一次创建及关闭的容量；journal的32资源上限未变。这样不会在32次创建后把合法关闭挡在旧的32次请求上限之外。中途停止的一轮旧源码回归仅保留诊断，不计通过；容量缺口另有先失败再通过的真实原组回归。

root 将原启动/停止/中间完成、InvocationID、原 pidfd/cgroup 观察及 manager 身份组成摘要，持久记录后才回复必要观察。回复包含原 scope、requestId、closeId 和 evidenceDigest；解码这些字段不会产生退出许可。重放只保留 `closing` 历史状态。原 cgroup/events 引用和早先观察来源在后续步骤撤销时，整组结果不能发布。

Node 的原组先封闭新工作并收口既有 SDK、会话、egress、数据传输与原始子 owner，再用原 boot/native 持有的专用清理通道发出固定 close。该通道在业务 closing/shutdown 后仍仅用于原组清理，登记或 boot 撤销仍拒绝实际 I/O。client 要核对原 scope/request、完整唯一帧、EOF 与原 native close；全部完成后才产生实例私有对象。本组只消费该对象一次；伪造对象、重复消费、迟到父来源撤销、错误 scope、截断/额外数据或 native 清理失败均拒绝。不执行全局 reconcile，不释放物理组 pin。

最终 Python broker 全套731项通过（1315.015秒，新增7项）；Node相关8文件全套223项通过（182.357秒，新增5项）。[验证、源码及输出绑定](evidence/controlled-close-wiring-20261121/verification.json)、[Python完整输出](evidence/controlled-close-wiring-20261121/python-suite.txt)及[Node完整输出](evidence/controlled-close-wiring-20261121/ts-suite.txt)已保存。

完整仓库 `tsc --noEmit` 曾在既定2048MB上限触发堆内存不足，该次不计通过；定向检查继续继承原严格配置，覆盖六个变更 TS 文件及其真实导入依赖，后端生产构建另行验证。Mac 回归使用真实临时文件、fsync、Unix socket、原始 Promise、NAPI/HTTP/WS 和生产控制流，只有 Linux 身份、内核与 systemd 边界采用明确替身。作者串行复核，不声明独立审查或真实 Linux 通过。

源树 native manifest 仍为 `unverified`。本地后端构建不等于 sealed Linux native 包或新运行候选；旧归档保持原源码绑定。完整物理许可、原 B2 五单元/两组、固定身份/文件视图/不可迁出、Chromium sandbox 和实际原 bundle 验收尚未完成。本轮不操作 Windows、不新增模型/KMS调用、不重导出或重放旧业务任务、不合并、不上线；AWS 工单按既定计划独立只读跟进。
