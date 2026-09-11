# root私有监听与单次启动授权消耗实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans；主线程实现，只复用review_qwen_negation只读复核，不新建智能体。

**Goal:** 从受信固定授权文件到持久单次消耗、固定listener和真实登记接收形成完整本地链，拒绝跨对象/进程重启重放。

**Architecture:** 严格解析短时授权，固定O_EXCL标记在listen前持久消费；单次SOCK_SEQPACKET listener只把受控连接交给真实LaunchRegistration。任何未知失败永久撤销，标记不返还。受信维护签发/重置与生产服务激活不在本单元开放。

**Tech Stack:** Python3.10标准库、既有installation/launch_registration/process_pin；合成内核和文件系统测试。

**Spec:** docs/superpowers/specs/2026-09-11-pool-launch-listener.md；继承9d-2b及first-exec。

## Global Constraints

- 仅现有codex/qwen-safe-drain，基线ad07f653，保护主8草稿与冻结候选；无部分push/PR/合并/部署。
- 主uid998，B身份已批准。无通用sudo、无任意路径/命令/环境/权限参数。私有root接纳与uid998运行通道分离。
- 当前旧生产窗口已过；不访问生产/秘密，不安装、不启动Docker/额外浏览器；约10GB，串行验证。
- 缺维护签发/资源对账/平台与发布门禁，不得激活listener。签发文件不等于业务已排空，消耗标记无重置API。

## Task 1：持久消耗和listener完整单元

**Files:** 新增scripts/pool-broker/launch_authorization.py、launch_listener.py、test_launch_authorization.py、test_launch_listener.py；修改launch_registration.py及其test，必要时同步精确安装清单。不得改PM2/service启动配置或创建实际授权文件。

**Interfaces:** `consume_launch_authorization(candidate)`无可选路径或数据参数，消费固定文件，返回私有`LaunchWindow`；`window.remaining()`只返回剩余单调秒数且同时核对墙钟。`RootLaunchListener.open(candidate)`取得安装GID/窗口并创建固定监听；`accept_once()`一次真实登记，`close()`永久撤销与本实例路径清理，正常不开放业务。

- [x] 先写缺模块RED，合成授权必须明确预期：

```python
window = consume_launch_authorization('a' * 40)
assert 0 < window.remaining() <= 60
# 第二个真实调用因固定消耗标记存在失败，不能换epoch重用。
with self.assertRaises(ValueError):
    consume_launch_authorization('a' * 40)
```

- [x] 严格JSON对象钩子拒绝重复项；candidate40/epoch32非零小写hex；时间整数、0<expires-not_before<=60000、not_before<=now<expires。固定root-owned路径逐段O_NOFOLLOW，授权<=1024字节；不读取真实.env或维护状态。加入坏窗口/缺失/额外键/owner/mode/link/ACL反例并观察RED。
- [x] 持久文件创建必须dir_fd固定目录、O_EXCL|O_CREAT|O_NOFOLLOW|O_CLOEXEC、0600；校验新FD是root常规单链接文件；完整短写，fsync(file)，fsync(parent)，所有自身FD单次close成功后才返回窗口。任何失败不unlink。合成文件系统观察“创建成功后write/fsync/close失败→下一次仍拒绝”，不是mock一个成功窗口替代。
- [x] 窗口保存墙钟截止与单调截止，remaining取两者较小且拒绝非有限/回退时间。它不是业务ready或可序列化授权。增加调用期间到期、时钟异常/倒退、重复消耗反例。
- [x] listener先调用真实consume再创建socket；Linux全root/单线程/minimalenv及真实安装预检；固定register.sock，SO_PASSCRED在listen前，root0600，backlog1，timeout不超窗口。失败消费不可恢复，已有socket不自动删除。
- [x] 使用真实LaunchRegistration接收，增加内部`receive(channel, *, window=None)`：精确LaunchWindow类校验，同一个窗口在IO/pin前后、ACK紧前/后及所有清理后检查墙钟与单调时间；原默认5秒不变，窗口只能缩短。网络不能传入此对象，不接受成功callback。新增在pin/close边界仅推进墙钟、最终清理跨期及同步撤销反例，不能用成功接收器掩盖登记协议。

```python
listener = RootLaunchListener.open('a' * 40)
listener.accept_once()
assert kernel.listen_events[0].passcred_before_listen
assert kernel.persisted_consumed_before_listen
assert kernel.registration_pin_is_actual_pinned_application
with self.assertRaises(ValueError):
    listener.accept_once()
```

- [x] 覆盖accept超时/多次/登记错peer/期限末尾/ACK后清理跨期/同步close重入；已转交channel不二次close。socket路径记录dev/ino，清理前root/type/mode及匹配失败不得unlink。固定消耗标记始终保留，不能以cleanup恢复授权。
- [x] 运行`python3 -B -m unittest discover -s scripts/pool-broker -p 'test_*.py' -q`、所有Python AST、diff；唯一reviewer独立审查并用反例修复。记录本地模型与真实Linux未验证区别后精确提交整个单元及文档，QA不提交。

## 后继门禁

受信维护执行器签发与旧账证明、标记的精确维护交接、服务入口加载与安装完整性、uid998运行通道、持久资源及系统模板依次继续；本计划不提供成功替身去填这些接口。first-exec Task3仍需有效授权Linux目标，不自行安装工具或调用生产。全部机制和首次维护/回滚门禁完成前不发布。

## 2026-09-11 本地实施与验证结果（18:00 JST）

- Task 1完整本地消费→监听→真实登记链已实现。固定短时授权通过严格解析，固定O_EXCL标记先写完并fsync文件及目录，才允许创建socket；任何失败不返还消费，换epoch/新对象不能重放。
- listener固定root私有路径、PASSCRED、backlog1、一次accept、有限超时；真实LaunchRegistration持有原始pidfd。未知原路径或替换路径不删除，FD/channel准确交接，ACK不是业务ready。受信producer、标记维护交接和服务激活仍未实现，本单元没有签发/重置/公开CLI。
- 真实LaunchWindow进入receive的IO/pin/ACK/清理边界，同时核对墙钟和单调时间；窗口只能缩短既有5秒上限。新增模块纳入installation精确文件检查与bootstrap摘要/有序模块bytes加载，避免未经验证的依赖导入。
- TDD：授权缺模块RED→8测试GREEN；窗口缺接口5失败→29登记测试GREEN；listener缺模块RED→真实链GREEN，最终17监听测试。新增安装成员先有5失败、精确hash清单3错误，再同步实现转GREEN。另覆盖坏peer、短ACK及transport关闭异常。
- 独立审查Important：守卫自身的原生边界可同步close重入，造成ACK后发或channel所有权丢失。两个反例先观察到sendmsg1次/close0次的RED；守卫返回后重查撤销及同一对象、交接前捕获receiver后转GREEN。原唯一reviewer复审无剩余Critical/Important/必修Minor，审查者未代跑测试。
- 最终主线程串行执行全套217/217通过（2.169秒），23 Python AST、2 JSON、git diff --check通过。包含原有native核心合成边界与两个ABI可重定位对象测试；不是真实Linux ELF链接/执行、内核socket或PM2端到端通过。构建manifest仍unverified/空candidate与architecture，不能激活。
- 无安装、Docker、额外浏览器、生产/秘密读取或禁止模块变更。系统空闲70%，磁盘141GiB。主8草稿、冻结delivery分支66f3a583与PR237 manifest ad0f5c0064bd02887a896fbf9e4a89b16e227da29bc75a4094aa2c56759e8c40未变。此次只提交整个本地单元，不部分push/PR/合并/部署。

## 精确下一步

先读取本次提交、QA最新检查点、9d-2b规格及总体安全排空计划，从既定uid998运行通道与同一登记对象的承接继续完整本地单元；不要重新实现授权消费或listener。持久资源、可信维护签发/精确交接、服务第一入口、Linux Task 3以及首次维护/回滚和全部发布门禁继续独立保留。GROUP_EXIT_UNPROVEN保持，旧08:30 JST生产窗口不延长；没有有效隔离目标授权不自行访问生产、安装或开启Docker。
