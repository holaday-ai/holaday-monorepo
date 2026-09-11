# 登记至固定降权入口接线（9d-2g）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。主线程TDD与原唯一reviewer只读复核，约10GB内存，禁止重任务并行。

**Goal:** 将安装预检、真实环境封印、原进程登记及精确FD3交接串成一个失败即退出的固定setpriv执行请求。

**Architecture:** 受信父入口调用launch_application(channel,candidate,boot,values)。函数消费私有登记连接，创建自己的环境FD，等真实register_self确认ACK并关闭登记句柄后，才将环境FD原子放到3、关闭其余非stdioFD并exec固定setpriv→Python隔离守卫。无客户端任意命令/路径/GID，无CLI可单独绕过父入口。

**Tech Stack:** Python3.10标准库、已有installation/launch_registration/application_guard；不安装任何工具。

**Spec:** 2026-09-11-pool-launch-registration-decision.md、9d-2f环境交接。基线c096f37c。

## Global Constraints

- B已批准，主uid998保持；旧生产窗口结束，无生产访问/变更。主草稿和冻结候选不动。
- 顶层父入口、setpriv及解释器固定版本/内容完整性、可信stdio、首次维护仍未通过；本函数不接现有PM2，不提供运行CLI。安装快照不是持续授权，不声称实际降权或全链可发布。
- 仅预先建立最小PATH/LANG的Linux全root单线程进程可调用。检查当前环境不等于解释器前安全；必须由最终父入口保证。首次登记失败不得重发、切回旧启动或声称ready。

## Task：真实登记与环境交接编排

**Files:** 新增scripts/pool-broker/root_launch.py、test_root_launch.py；installation.py/test_installation.py加入精确文件；本计划、QA。

- [x] RED：缺模块失败。测试实际seal和register_self，仅NSS/文件安装边界、syscall/socket响应及最终exec替换为合成模型；成功必须观察正确登记包/FD、ACK后唯一FD3、固定exec参数和最小环境。

```python
with self.assertRaises(ExecObserved):
    root_launch.launch_application(channel, 'a' * 40, 'b' * 32, {'NODE_ENV': 'production'})
self.assertEqual(self.exec_path, '/usr/bin/setpriv')
self.assertEqual(self.remaining_fds, {3})
```

- [x] 固定流程：Linux、全root真实有效保存身份、单线程/proc/self/task数量1、精确bootstrap环境；安装预检得GID（不接外部GID）；seal→核验上下文→register_self（转交连接所有权前标记）→再核验root上下文→dup2至3并继承→先释放原FD所有权再close→close_range(4,UINT_MAX,UNSHARE)→最终核验上下文→固定execve。
- [x] 参数只允许--reuid=998、--regid=安装GID、--clear-groups、--inh-caps=-all、--ambient-caps=-all、--bounding-set=-all、--no-new-privs、--、/usr/bin/python3、-I、-S、受信candidate包application_guard.py及GID/candidate/boot。setpriv/Python实际版本、路径解析/依赖和哈希须后续固定安装门禁核验，不运行--version或假定生产存在。
- [x] 反例：坏平台/root/env/线程/安装失败/封印失败/错ACK或超时均不得dup或exec；dup/inherit/close/range/exec失败固定拒绝；FD已是3分支不能close自己；失败清理只处理仍拥有的FD，close失败不重试；登记函数已消费连接时不再重复close。
- [x] 加安装root_launch.py缺失与owner错误反例；全部轻量测试、AST、diff、独立复核完成；精确提交和自动化读回证据记录在QA检查点。

## 本地验证与审查证据

- TDD：原119项基线通过；缺模块1 RED→最小1 GREEN；root矩阵13失败/5异常（含subTest）→15 GREEN；安装清单3失败→全套135 GREEN。独立审查发现登记前及最终exec前上下文检查缺口，新增17项中的2失败证明会错误发送/执行；最小修复后137 GREEN。
- 补原FD3继承错误、native loader错误和末端proc读取错误清理覆盖后，全套140项通过。成功路径运行真实封印与登记协议代码，只在内核/socket、安装/NSS边界与exec使用模型；不是实际Linux/setpriv平台验收。
- 原唯一reviewer只读复审：Important已关闭，无剩余Critical/Important/必修Minor；审查者未运行测试。主线程负责新鲜测试、13文件AST及diff检查。
- 本计划完成的是编排单元，不是整个9d。首次解释器前可信父入口、固定工具完整性、真实Linux降权与完整启动链仍未完成；GROUP_EXIT_UNPROVEN保持，不得部分发布。

## PM2接线研究结论与下一边界

仅研究上游PM2 v6.0.8，不代表生产版本：Common.prepareAppConf过滤调用方环境，但God.executeApp将env并入内部结构，ForkMode.spawn实际env=pm2_env且stdio含IPC。故filter_env并不提供精确最小子环境；interpreter分支还读取daemon PM2_NODE_OPTIONS。不得用filter_env、env -i在已启动脚本内清环境等办法冒充第一加载器前证明。

下一步需固定受信父进程的真正exec边界（保留PM2监督与同PID），明确移除或安全处理PM2注入元数据/IPC，取得原业务配置而不导出秘密。当前编排函数等待该上游生产者，不修改PM2库/守护进程或应用脚本；不足以单独启用。若需要改变监督器或新增超出既定限定broker权限，必须另作决策，不能擅自扩大。

来源：[PM2 Common](https://github.com/Unitech/pm2/blob/v6.0.8/lib/Common.js)、[God](https://github.com/Unitech/pm2/blob/v6.0.8/lib/God.js)、[ForkMode](https://github.com/Unitech/pm2/blob/v6.0.8/lib/God/ForkMode.js)、[setpriv](https://man7.org/linux/man-pages/man1/setpriv.1.html)。
