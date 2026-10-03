# 异常恢复与对账 Implementation Plan

> **For agentic workers:** 使用 executing-plans、TDD、原 review_qwen_negation 只读审查及完成前验证；单主实现，不另开智能体，不将内部步骤分开交付。

**Goal:** 完成上线清单第1大项：对所有持久浏览器资源记录执行只读恢复核对，给出可关联实例的状态聚合或明确未知，绝不重派、删除、清账或签发退出/接纳许可。

**Architecture:** 复用当前真实 ResourceJournal/flock、原 LaunchRegistration/pidfd 与认证 SystemManagerProbe。一次恢复扫描覆盖日志内全部记录；只对当前boot/candidate、原manager GUID/owner且已有InvocationID的Xvfb记录读取同一unit。其他记录按固定原因保留未知。恢复是观察，不是重新登记、自动接管或终态证明。

**Tech Stack:** Python3.10标准库、现有固定busctl/systemd249边界，无新依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；2026-09-11-pool-process-containment-decision.md；2026-09-11-pool-launch-registration-decision.md。承接 pool-xvfb-launch.md。

## Global Constraints

- 基线a6f7e49a，codex/qwen-safe-drain现有隔离工作树；主8草稿、PR237冻结包不变。10GB预算，单主+原只读reviewer；所有重任务串行。不安装/Docker/新浏览器/生产操作。
- 旧2026-09-11 08:30 JST窗口过期；本大项完成只本地提交，不push/PR/合并/部署部分组件。
- 不触支付、奖励、提现、Partner Ledger、额度规则、账号注销、DivineAPI、旧供应商配置；不读写真实凭据、身份或业务文本。
- 日志上限128资源/262144字节不变；不接受外部resource、unit、PID、路径、命令或成功字典。运行socket仍全部blocked。没有新服务或进程常驻。

## 恢复规则与验收边界

| 日志情况 | 处理 |
| --- | --- |
| 当前boot prepared | 计入prepared，未派发记录原样保留；不自动启动/释放slot |
| 旧boot或旧candidate | foreign_registration未知；不关联新登记或探测旧资源 |
| 旧dispatch无manager绑定 | missing_binding未知，不扫描名字/PID补身份 |
| dispatch/accepted但缺InvocationID | missing_invocation未知，不能因同名unit存在补造原实例 |
| 原manager GUID或owner不符 | manager_changed未知，不转发给新manager |
| 已有原InvocationID且绑定匹配 | 固定GetUnit，再两轮Id、InvocationID、ActiveState，最后再读InvocationID；全部精确匹配才计入对应观察状态 |
| unit路径/Id/InvocationID不符，或两轮状态不一致 | identity_changed/unstable_observation未知；不覆盖持久身份 |
| 类型损坏、not-found、超时、失联、工具/日志替换、原登记/pin撤销 | 整次固定POOL_BROKER_RECOVERY_UNPROVEN失败，不返回部分成功、不重试；旧字节与未决状态保留 |

ActiveState仅接受systemd249的active/reloading/inactive/failed/activating/deactivating/maintenance。inactive/failed也不证明后代退出、job完成或slot可用。聚合为一段时间内的逐资源观察，不是原子全局快照，更不是manager代码映像/同连接exec证明。

单资源manager作用域5秒，整次扫描固定30秒，最多32份Xvfb平台检查；新的单资源作用域不能突破整次截止。任意预算耗尽返回固定未知失败，不能截取前几项为“扫描完成”。时钟倒退/非有限值拒绝；原生登记检查之后最后轻量撤销/期限检查。整次journal._run持有原FD/flock；close/重入立即否决，直到原始IO收口再释放。无后台重试、等待线程或额外子服务。

## 一次交付：恢复扫描、失败保留、验证与交接

**Files:** 新增 scripts/pool-broker/resource_recovery.py、test_resource_recovery.py；更新bootstrap/installation及精确加载测试；manager_probe将整次扫描剩余预算严格校验后夹紧到原单资源IO超时，保留既有None型撤销守卫兼容；ResourceJournal格式与状态不变。新增操作说明 docs/ops/pool-resource-recovery.md。

**Interface:** `recover_resources(journal: ResourceJournal, manager: SystemManagerProbe) -> dict`。仅接受同一原登记/pin。返回字段固定为total/prepared/matched/unknown、七种observedStates聚合、固定unknownReasons聚合、groupExitProven=false、admissionAllowed=false。任何异常只输出固定错误，不输出原始响应、resource/capability/boot/GUID/owner/unit/InvocationID。

- [x] 先写行为测试并确认RED；用真实启动生产者生成observed日志，再关闭重开journal/manager，核对同一实例。不能mock恢复/日志/manager整体成功。
```python
report = recover_resources(reopened_journal, reopened_manager)
assert report['matched'] == 1
assert report['observedStates']['inactive'] == 1
assert report['admissionAllowed'] is False
assert report['groupExitProven'] is False
assert journal_bytes_after == journal_bytes_before
```
- [x] 实现完整只读扫描：在journal._run内分类，平台读取仅GetUnit/Properties.Get三个固定字段及已有manager身份探测；私有状态读取代码不接任意远端对象。调用原manager._live_budget和整次scope veto，不改变旧launch路径。
```python
# 每次相同输入都重新观察；不返回缓存成功，不修改日志。
first = recover_resources(journal, manager)
second = recover_resources(journal, manager)
assert first == second
assert all(method not in writes for method in observed_methods)
```
- [x] 覆盖真实prepare、无ACK dispatch、accepted、observed、重开、外国boot/candidate、legacy日志、manager GUID/owner变更、同名替换、错/零/布尔InvocationID、状态转换、not-found、断联、过期、重复检查、全部128资源分类。错误时断言真实文件不变、未执行Start/Stop/Kill/ResetFailed/任何清理、不能返回部分成功。
- [x] 覆盖collector最后时钟/原生检查点的journal/manager/registration/pin关闭；生产调用外断言Popen零调用。验证扫描中重入/二次flock失败与原FD延迟释放；扫描预算耗尽后不得继续下一资源。
- [x] 精确安装/hash/preload名单先RED后接线；验证加载后恢复引用同一真实类而非应用路径模块。文档说明合法调用流程、固定错误处理、无身份输出、重启后不能自动接管，所有放行仍依赖后续第3/4/5大项。
- [x] 独立审查、修复反例、全套Python/AST/JSON/diff验证及本地提交。将QA/自动化改为按大项续跑：本项完成后进入第2大项浏览器池完整接线，不再逐小步骤交付。

## 来源

[systemd249 Unit属性](https://raw.githubusercontent.com/systemd/systemd/v249/src/core/dbus-unit.c)的ActiveState为s，InvocationID为ay；[固定版本状态枚举](https://raw.githubusercontent.com/systemd/systemd/v249/src/basic/unit-def.c)含上述七种状态。只据源码确定解码，不声称Linux验收通过。

## 完成证据（2026-09-11 21:16 JST）

- 318/318 Python测试通过，11.502秒；33份Python AST、2份JSON解析和git diff --check通过。新增21项恢复行为测试及安装/可信加载覆盖。
- RED证据：缺恢复模块10测试34子项失败；安装名单2失败、可信加载3错误。独立审查补充真实collector/EOF管道/selector反例：整次扫描只剩0.5秒却向IO传入5秒；已改为内外预算取较小值，反例GREEN。
- 原review_qwen_negation最终复审无Critical、Important或必修Minor；审查者不代跑测试。完整128记录扫描、32 observed、关闭/重入/flock、日志损坏、manager换代、迟到失败不返回部分成功均覆盖。
- 原始日志不变，无Start/Stop/清理/自动重派；未知保留未知，不签发退出或接纳许可。真实Linux socket/systemd边界仍是合成测试，Linux验收属于第4大项，不宣称整体上线就绪。
- 主工作区8份草稿、冻结分支66f3a583与PR237 manifest ad0f5c0064bd02887a896fbf9e4a89b16e227da29bc75a4094aa2c56759e8c40未变。内存空闲70%；未安装、启Docker/浏览器或操作生产。
- 本大项仅本地交付；QA/原自动化记录准确提交后，下一大项为浏览器池完整接线，内部测试、修复和独立审查不再拆开交付。
