# 浏览器池异常恢复与对账

## 当前适用范围

这是受信broker内部只读恢复接口的操作契约，不是当前生产操作指令。完整服务/Node接线与Linux验收尚未完成，运行socket仍拒绝资源命令，native manifest仍unverified。不得在生产临时运行Python、重新登记PID、修改manifest为verified或打开功能开关来尝试本接口。

上线清单第1项包含：所有持久资源记录分类、同实例状态核对、失败保留、聚合输出及反例验证。第2项浏览器池其他角色/服务接线、第3项安全停止与退出证明、第4项Linux验收、第5项维护发布工具仍独立需要完成。

## 受信调用流程

由未来完整broker启动流程取得真实 `LaunchRegistration`；journal和manager必须承接同一对象及原pidfd，不能以PID/boot字符串重新制造登记。用固定 `ResourceJournal.open(registration)` 和 `SystemManagerProbe.open(registration)` 打开受保护日志和认证管理连接，然后调用：

```python
report = resource_recovery.recover_resources(journal, manager)
```

此调用不接受路径、unit名称、成功回执或任意外部命令。检查全部日志记录，保持原flock和FD，最多128记录、32已绑定Xvfb实例，单实例5秒、整次30秒；这是接纳预算，不保证OS调用硬实时结束。失败清理只关闭本次持有的对象，不对系统服务发停止请求。

重复调用必须重新核对，不缓存上一次成功。日志重开后可以核对属于仍有效原登记的记录；broker/主应用登记丢失、新boot或系统管理器换代不能自动接管旧实例。不同账号/角色的新增接线不由本接口授权。

## 只允许输出的结果

- `total/prepared/matched/unknown`：总数、未派发准备记录、匹配实例观察、证据不足记录数量。
- `observedStates`：active/reloading/inactive/failed/activating/deactivating/maintenance的计数。仅观察期间的状态，不是全局原子快照或后续状态保证。
- `unknownReasons`：foreign_registration、missing_binding、missing_invocation、manager_changed、identity_changed、unstable_observation的计数。
- `admissionAllowed=false`、`groupExitProven=false`恒不放行。即使总数为0、全部matched或全部inactive，也不能升级或回收slot。

不输出日志行、unit、capability、requestId、boot、manager GUID/owner、InvocationID、原始D-Bus回复或错误文本。不读取认证文件/用户业务内容。报告只能用于诊断与后续维护判断，不能作为执行成功或排空的凭证。

## 异常处理

| 情况 | 应对 |
| --- | --- |
| prepare存在，没有dispatch | 保留记录和slot，不自动启动或释放 |
| dispatch无ACK或accepted无原InvocationID | 保留missing_invocation，不凭同名unit补造身份，不重发 |
| 旧boot/candidate、manager或实例换代 | 保留unknown；后续受控维护另行处理，不能手改日志清账 |
| not-found/断联/类型异常/时钟异常/超时 | 固定POOL_BROKER_RECOVERY_UNPROVEN，整次无部分成功；对象封闭，原日志保留 |
| 日志缺失、截断、损坏、权限或路径换代 | 不初始化、不截断、不删除、不自动修复；保持关闭，保留证据 |
| 恢复中登记/pin撤销或close/重入 | 停止后继派发，原始IO结束才释放所持锁/FD，不误放行 |

固定错误后不得在循环中反复重新打开并尝试创建资源。新只读检查必须由受控操作显式发起，重新核实合法原登记/文件/连接，不能把一次失败变成自动重派。某资源缺少原始身份时，重复读取不能弥补证据缺口。

## 上线前仍须另验

真实Linux上验证systemd249返回格式、全部容量下的延迟、管理连接变化、原pidfd撤销、文件权限与隔离；测试失败保持关闭，不扩大30秒或更换候选绕过。安全停止仍需job、后代/cgroup与原始IO结束的组合证据，inactive/failed/not-found均不能替代。
