# 受信启动安装身份预检（9d-2d）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans；主线程实现，唯一review_qwen_negation只读审查，所有重任务串行。

**Goal:** 在接入任何root启动器前，以真实NSS与逐级文件描述符检查验证已批准B的账号、受信程序目录和私有工作目录，遇到缺失或不安全权限即拒绝。

**Architecture:** 无配置写入、无安装命令的Linux/root只读预检。candidate仅接受固定格式发布SHA，所有路径由代码生成；从根目录逐级openat/O_NOFOLLOW打开并检查权限、所有者、类型及ACL，NSS确认uid998与专用浏览器账号不共享身份或组。结果是瞬时安装信息，不是放行能力，启动时必须重新核对。

**Tech Stack:** Python3.10标准库pwd/grp/os/stat/dataclasses/unittest；不安装依赖或运行Linux服务。

**Spec:** docs/superpowers/specs/2026-09-11-pool-launch-registration-decision.md（B已批准）及9d-2c后续顺序。

## Global Constraints

- 基线787c8187，已有隔离worktree/codex/qwen-safe-drain；任务约10GB、free<40%不启重任务；主工作区8草稿、冻结PR237不动。
- 不修改生产账号、组、目录、PM2、环境、数据库或旧profile；不新增远程预检或使用已过期窗口；不输出OS账号信息、路径错误细节、身份与秘密。
- 本任务是root启动完整链的必要安装检查，不是完整降权启动器。不得把检查对象或ACK当ready，不改变GROUP_EXIT_UNPROVEN。9d-2c两端登记不重做。

## Task 1：账号与受信目录真实检查

**Files:** 新增scripts/pool-broker/installation.py、test_installation.py；本计划和QA记录。既有runtime/start脚本不改。

**Interfaces:** inspect_installation(candidate: str) -> InstallationIdentity（frozen、repr不包含字段；app_gid/browser_uid/browser_gid）；没有任意路径参数、修复/创建/迁移/运行命令接口。

- [x] 最小RED：缺模块时明确FAIL；成功场景用合成NSS与元数据，真实预检代码必须检查全部固定路径，测试只替换NSS/filesystem syscall。

```python
self.assertIsNotNone(installation, "installation preflight missing")
identity = installation.inspect_installation("a" * 40)
self.assertEqual((identity.app_gid, identity.browser_uid, identity.browser_gid), (998, 997, 997))
self.assertEqual(open_descriptors, {})
```

- [x] 运行python3 -B -m unittest discover -s scripts/pool-broker -p 'test_installation.py' -v，确认契约RED。
- [x] 最小实现：主账号由getpwuid(998)取得，固定home=/var/lib/holaday；浏览器固定名称holaday-browser-pool/home=/var/lib/holaday-pool-workers/shell=/usr/sbin/nologin，uid/gid均正数且不为0/998/65534或主gid。getpwnam/getpwuid与getgrnam/getgrgid交叉匹配，浏览器唯一组为其主组，主账号不属于浏览器组，浏览器组不列入其他成员。枚举账户/组的必要name/UID/GID/成员元数据，验证目标名称和编号唯一及其他账号主组冲突；不访问password/GECOS字段、完整记录repr、shadow或业务资料。
- [x] 安全RED矩阵：身份冲突/额外组/可登录shell/错误home/NSS错配；candidate非法；非Linux/非root；任意路径缺失、软链接、非目录/常规文件、额外hardlink、组/其他可写、setid/sticky、ACL、所有者错误；open/fstat/listxattr/close失败均固定拒绝并收回全部本次FD，close不重试。
- [x] 完成固定路径边界：祖先root所有且不可被组/其他写入，无ACL。受信包/usr/local/lib/holaday-pool-broker/releases/<candidate>目录root:root0755，installation.py/process_pin.py/protocol.py/launch_registration.py为root:root0644、nlink1；/etc/holaday-pool-broker和/var/lib/holaday-pool-broker以及/run/holaday-pool-broker为root:root0700；新浏览器home为专用uid/gid0700。不触旧/var/lib/holaday-browsers。每个具体受信启动文件增加时同步扩展精确清单，不能将当前4文件视作完整启动包。
- [x] 最终全量python3 -B -m unittest discover -s scripts/pool-broker -p 'test_*.py' -q、所有Python AST、diff检查；独立审查修复完成。精确提交和自动化断点以QA最新记录为准。

## 后续启动链必须单独验证

旧orchestrator-runtime.sh具有环境覆盖、PM2环境继承及旧profile递归chown；不能直接改成root启动。应用config/env.ts目前保留已设置进程环境优先级，再加载三份dotenv文件；把父环境全部删除可能改变生产配置，必须仅比较键/来源不输出值，并保留非root加载语义。

root父进程需在exec解释器前构造允许列表环境，不能依赖Python启动后清LD_*。后续优先使用已审核固定版本setpriv实现清附加组、capability、no_new_privs与uid/gid下降，进入固定非root守卫检查真实/有效/保存身份及caps后同PID exec Node；setpriv工具可用性和版本、所有解释器/依赖路径与PM2环境行为仍需实际核验，不把本轮文档当已验证。主应用不迁移至其他管理器。

专用账号的密码锁定、SSH/服务登录禁用及浏览器内存/FD/IPC隔离需要安装与平台验收；本预检只证明所检查的NSS shell/组和目录快照，不读取密码哈希，不宣称验证了所有登录路径。输入输出的精确文件交接、旧profile迁移和实际执行文件完整性也未由此完成。

NSS枚举必须由平台门禁确认能完整覆盖目标账号与组；不可枚举或动态后端不能凭此快照开启服务。最多接受4096条账户/组结果和每组4096成员，超限/空结果/查询异常拒绝；这是返回结果限制，不约束NSS调用自身的分配或阻塞。启动前需重新验证或持有可信安装锁与不可变版本，不能缓存快照绕过状态变化。

## 本地完成证据

1项契约缺失RED→最小GREEN；mac缺失os.listxattr通过测试syscall替身create=True补齐，未改系统。安全矩阵40失败/9异常（含subTest）→13项GREEN。自查与独立审查确认NSS别名/隐藏主组Important，新增2项反例14失败→修复后86/86（15安装预检+71既有）通过；8文件AST、diff检查通过。复审Important关闭，文档枚举范围Minor已同步。Linux NSS/FD以边界替身执行，真实非Linux拒绝有覆盖；未执行原生Linux安装校验、降权或生产操作。
