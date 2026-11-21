# 原组关闭意图与派发封闭

产品端新增关闭的第一层：原 `_RunningQuartet` 内部实例可先封闭运行检查，再把同一次关闭意图写入原 journal。接口不接受 PID、路径、unit、管理/egress capability 或成功字典。

首次调用在时钟、平台和 journal IO 前设置封闭状态。记录含独立 closeId、原 manager GUID/owner，以及五个原 unit、启动 job 和 InvocationID；沿用文件及父目录 fsync。重复调用复用这条意图，不产生第二次写入。等待写盘时的重入被拒绝，原始句柄仍保留。恢复读取只得到 `closing` 历史状态，不重建原运行实例。

记录核对拒绝替换 unit/InvocationID/manager、缺失角色和伪造成功字段。写盘失败时不确认意图，不重新生成事务；保留已写字节及 unknown/slot 占位。`groupExitProven` 仍为 false。

验证使用真实临时文件、fsync 和 Unix socket，Linux 身份、systemd 与内核引用仍是明确替身。三个最初测试先因缺失入口失败；最终 Python broker 全套 706/706 通过（566.333 秒），其中包含四项新增用例及待落盘期间的关闭重入断言。首轮执行另遇到沙箱拒绝既有 socket bind，通过异常溯源确认后，仅为本机合成测试使用获准的执行权限。新测试的两处 fixture 属性错误已修正，没有为求绿修改产品守卫。

[全套结果和源码绑定](evidence/controlled-close-intent-20261121/verification.json)及[原始测试输出](evidence/controlled-close-intent-20261121/broker-suite.txt)随报告保存。本报告不将 Mac 回归当作真实 Linux 退出通过。

这一步还没有接入 listener/Node 的认证关闭路由，没有发送 StopUnit，没有采集停止 JobRemoved，没有创建或消费物理终态能力。原 cgroup/events 引用的创建期持有、停止封闭条件、原 Node IO 收口和一次性终态消费仍需接线。完整 Task2/Task3、真实 B2 五单元与两组、固定 UID/GID、文件视图、不可迁出、Chromium sandbox 和 sealed native bundle 均未完成。

运行源码已变化；此前构建归档仍属于旧源码，不冒认为新源码候选。native manifest 保持 unverified，退出/槽位守卫未放宽。未新增模型或 KMS 调用，未重导出或重放业务任务，未操作 Windows 实验实例、合并或上线。
