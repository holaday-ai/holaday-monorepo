# 降权后同 PID 应用启动守卫（9d-2e）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。主线程实现，原唯一 reviewer 只读审查，不新增智能体，不安装或运行重任务。

**Goal:** 实现实际 exec Node 前的非 root 守卫，权限或清理证据不成立时不启动应用。

**Architecture:** 上游受信父入口先完成登记及 setpriv 降权；本模块以固定入口核对当前进程，再清理描述符与信号并同 PID exec 固定 Node。先完成这一可独立反例测试的安全边界，再接 root 父环境/登记/listener，不能将守卫当登记凭证或 ready。

**Tech Stack:** Python 3.10 标准库，Linux procfs、libc close_range，unittest syscall 边界替身。

**Spec:** docs/superpowers/specs/2026-09-11-pool-launch-registration-decision.md（B 已批准）。

## Global Constraints

- 基线67f05127，既有隔离分支codex/qwen-safe-drain；约10GB预算，重任务串行，生产窗口过期不变更。
- 不改现有PM2/runtime/env配置，不读取秘密；只在受控测试内替换身份、内核和exec调用，真实执行只允许非Linux拒绝路径。
- 固定cwd=/opt/holaday-monorepo/apps/orchestrator，Node=/opt/node22/bin/node，参数--import tsx及固定src/index.ts。
- 保留业务环境原值（包括空值）供现有dotenv override:false语义；不加载dotenv，不默认补production，不静默改写配置。PM2_HOME不传给Node，LD_/DYLD_/PYTHON/NODE_注入变量拒绝（NODE_ENV=production除外）。这不是完整允许列表：上游必须在第一个解释器加载前设定受信环境，环境兼容验证仍独立。

## Task：守卫与精确安装清单

**Files:** 新增scripts/pool-broker/application_guard.py及test_application_guard.py；修改installation.py和test_installation.py精确包清单；本计划与QA。

**Interfaces:** exec_application(expected_gid: int) -> Never（Python3.10不使用Never类型）；私有固定错误POOL_BROKER_APPLICATION_UNPROVEN；无任意命令、cwd、环境参数，不授予权限。预期GID来自受信安装/父入口，不是客户端授权。

- [x] 最小RED：缺模块失败；替换os.execve为记录并抛专用BaseException，成功断言固定路径/参数/cwd及业务环境保留。

```python
with self.assertRaises(ExecObserved):
    application_guard.exec_application(998)
self.assertEqual(self.executed[0], '/opt/node22/bin/node')
self.assertEqual(self.environment['SYNTHETIC_SETTING'], 'kept')
```

- [x] 最小GREEN后扩展反例：四类UID/GID不同、root/非法gid、附加组、5种非零capability、no_new_privs关闭、线程不为1、TracerPid非零、重复/缺失/畸形/超长status、危险环境、非Linux、系统调用失败均不得exec。
- [x] 真实实现：getresuid/getresgid/getgroups与有界/proc/self/status交叉验证；只消费Uid/Gid/Groups/CapInh/CapPrm/CapEff/CapBnd/CapAmb/NoNewPrivs/Threads/TracerPid。固定procfs可信挂载由平台门禁证明。
- [x] libc close_range(3, UINT_MAX, CLOSE_RANGE_UNSHARE)成功才继续，未知或不支持拒绝，无扫描猜测或静默fallback。清理后再核对身份；umask077，清信号掩码/恢复可捕获信号默认；固定execve，返回或异常固定拒绝。
- [x] 扩展安装包清单守卫文件root:root0644、nlink1；安装测试证明缺失或不安全的守卫阻止预检。
- [x] 全套Python测试、AST、diff检查及独立审查，修复必修问题后精确提交并更新自动化断点。

## 明确未完成的接线与平台门禁

root父入口及setpriv精确版本/路径、第一解释器前环境允许列表与业务环境安全交接、私有socket监听器/新启动事务、PM2可信stdout/stderr、root程序/解释器内容完整性、内核真实FD/身份验证均尚未完成。当前文件不被任何现有应用调用。清理FD不是浏览器组退出证明，不放松GROUP_EXIT_UNPROVEN，不推送或部署部分组件。

依据：[proc status字段](https://man7.org/linux/man-pages/man5/proc_pid_status.5.html)、[close_range](https://man7.org/linux/man-pages/man2/close_range.2.html)。本轮仅核对官方语义，未核实生产libc符号/实际支持。

## 完成证据与下一断点

16:02 JST 本地102/102通过（15守卫含真实mac隔离CLI拒绝、16安装、71既有），10文件AST和diff通过。最小缺模块1RED→1GREEN；安全矩阵53失败/5异常→12GREEN；CLI和安装清单5失败→101GREEN；增加真实非Linux无输出退出1覆盖→102GREEN。原唯一reviewer最终只读复核无Critical/Important/必修Minor，准许提交本地单元；reviewer未运行测试。所有成功Linux路径仍为syscall替身，不声称平台通过。

下一步是受信root父入口的解释器前环境契约与业务环境私有交接，再连接setpriv/当前守卫及root登记listener；本轮先交付可拒绝不安全启动的后置守卫，未完成上游父环境。本文件可被固定python -I -S运行，但现有PM2启动方式未改变。不得跳过上游未完成工作而单独启用守卫。
