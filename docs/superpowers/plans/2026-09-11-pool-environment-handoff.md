# 启动环境私有交接（9d-2f）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans；主线程TDD，原唯一reviewer只读复核，不新增智能体。

**Goal:** 业务配置不参与特权解释器加载，仅在降权守卫验证身份后从不可修改的匿名FD恢复并交给Node。

**Architecture:** 在现有自包含application_guard.py中实现root生产端seal_application_environment与uid998消费端。父入口使用固定最小bootstrap_environment；业务环境连同candidate/boot编码进root:root0600、nlink0、四重封印memfd。未来父入口只将此FD明确交接为3；守卫读取并关闭3，再关闭所有非stdioFD并exec Node，无旧继承业务环境fallback。

**Tech Stack:** Python3.10标准库os/fcntl/json/stat，Linux memfd seals；本地边界替身及真实非Linux拒绝。

**Spec:** docs/superpowers/specs/2026-09-11-pool-launch-registration-decision.md；已完成9d-2d/2e后续环境边界。

## Global Constraints

- 既有隔离工作区codex/qwen-safe-drain，基线574d8eeb；约10GB预算、串行；禁止生产变更、安装、Docker、新浏览器，不延长旧生产窗口。
- 不读取真实业务环境或秘密；测试只用合成字典和FD。保留业务值包括空字符串，现有dotenv语义不改；PM2_HOME不传给Node，不默默纠正缺少production或非法配置。
- 第一解释器前最小环境必须由受信父进程建立；本模块返回字典及检查相等不能证明这个前置动作已发生。root PM2父入口、setpriv固定版本/实际FD传递及注册listener仍须接线与原生验证。

## Task：生产端与真实守卫消费闭环

**Files:** 修改scripts/pool-broker/application_guard.py、test_application_guard.py；新增test_environment_handoff.py；本计划和QA。不新增被-I忽略的同目录import，模块保持自包含。

**Interfaces:** bootstrap_environment()->dict（只有PATH=/usr/bin:/bin、LANG=C.UTF-8）；seal_application_environment(candidate,boot,values)->int（成功FD归调用方，CLOEXEC默认保留）；exec_application(expected_gid,candidate,boot)，CLI严格3参数。candidate40/boot32小写非零hex，与既有登记格式一致，不是HTTP客户端票据。

- [x] 最小RED：不存在生产函数失败；合成memfd模型运行实际编码/write/seal、实际守卫pread/校验/close并记录最终Node环境，确认包含业务值而不含bootstrap注入值。

```python
fd = guard.seal_application_environment('a' * 40, 'b' * 32, {'NODE_ENV': 'production', 'EMPTY': ''})
self.assertEqual(self.seals, 15)
# 模型将同一个已封印对象交给3，降为合成998，运行真实exec_application。
```

- [x] 生产验证与RED矩阵：只允许Linux真实/有效/保存uid/gid0；严格字典<=512项，key ASCII规范<=128字节，value纯str无NUL且UTF8<=8192字节；整体序列化<=65536。沿用NODE_ENV/loader拒绝规则，PM2_HOME删除，schema为四元素数组[HPE1,candidate,boot,键值对数组]，重复键拒绝。短写继续，0/异常拒绝并准确close自建FD，不重试close。
- [x] memfd_create固定无身份名称，CLOEXEC|ALLOW_SEALING；fchmod0600，所有内容写完再F_ADD_SEALS(SEAL|SHRINK|GROW|WRITE)，F_GET_SEALS读回全部位，fstat确认root:root/regular/nlink0/size/mode。返回FD前不改继承位、不dup2或接触3。
- [x] 守卫最小环境精确相等、先身份检查再读取固定3。先set_inheritable(False)，fstat元数据与四封印成立才pread(size+1,0)；精确size及schema/candidate/boot匹配，严格键值验证。close3成功后才允许继续close_range和exec；不支持/缺失/非root/可改写/截断/重放错boot/错candidate全部拒绝。错误不输出任何值或源异常。
- [x] 修改既有守卫测试为真实胶囊FD替身而非mock整个消费方法，保留所有身份/信号/错误反例；CLI从1参数改为3参数，没有兼容旧绕过路径。
- [x] 102基线回归及新增交接测试、AST/diff、独立审查。修复必修项，精确提交，更新原自动化。

## 未完成与平台验证

必须先完成受信root父入口在第一个解释器exec前构造最小环境、配置来源兼容核验、匿名FD3精确继承、setpriv降权及可信stdio，再可启用此链。不可仅靠当前进程os.environ清空声称第一解释器已安全，也不把root-owned sealed FD视作注册/就绪授权。封印保证内容不可改写而非内存加密/不可swap/安全擦除；此处不改变系统swap、core或隐私策略，相关平台门禁独立。失败主CLI退出时内核回收尚未消费的继承FD；调用函数异常不允许应用继续运行。

依据：[memfd_create](https://man7.org/linux/man-pages/man2/memfd_create.2.html)、[F_ADD_SEALS](https://man7.org/linux/man-pages/man2/F_ADD_SEALS.2const.html)。

## 本地完成证据

119/119通过（18守卫含真实非LinuxCLI拒绝、14环境交接、16安装、71既有），11文件AST和diff通过。最小生产函数缺失1RED→1GREEN；交接安全矩阵33失败2异常→9GREEN；守卫签名及FD集成1失败59异常→111GREEN；补生产者到实际守卫闭环、消费IO/close/缺失FD/身份拒绝及CLI参数反例→119GREEN。独立reviewer最终复核无Critical/Important/必修Minor，CLI测试Minor已修；reviewer未运行测试。所有Linux成功路径是syscall边界模型，真实memfd或降权继承没有在本机/生产运行。

上游root父入口与第一解释器前允许列表、原配置来源兼容、唯一启动事务/登记listener、精确FD3传递、setpriv固定版本及降权验证继续作为下一项。不能把本单元当作全链完成；同一sealed对象可被重复读取，candidate/boot绑定不代替父事务一次性状态与撤销。未push/PR/合并/部署，QA记录不入提交。
