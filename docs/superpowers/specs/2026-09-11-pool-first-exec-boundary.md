# 首次解释器前环境边界（9d-2h）

状态：基线 abe593a1 的本地接线设计；不代表已实现、生产配置已核对或可发布。沿用已批准的同PID root-owned极小启动器、PM2监督及B浏览器专用身份，不扩大系统管理权限。

## 实际问题与路线

PM2上游v6.0.8的ForkMode以`env: pm2_env`启动，并建立IPC；Node v22.18.0在spawn时追加`NODE_CHANNEL_FD`与`NODE_CHANNEL_SERIALIZATION_MODE`。`filter_env`不能证明最终子进程环境精确最小，`python -I`也不会先于ELF动态加载器执行。以上是固定上游版本证据，不声称生产安装版本相同。

采用**无动态加载器、无libc/CRT初始化的极小原生首入口**，随后同PID exec固定Python隔离入口；此技术选择细化既定root启动器。入口不设setuid位、不赋文件capability，不对uid998提供提权接口。只允许已经由受信PM2启动的全root身份；不加载应用代码。二进制架构必须与实测生产架构一致，当前未取得该证据，不猜测为x86_64或aarch64。

不采用持久化全量root密钥快照，不把整份PM2环境传给应用。原始继承环境只允许在同进程root阶段的匿名封印FD短暂搬运，原生端不解析业务键、JSON或dotenv，降低特权代码复杂度；Python选出明确允许项后关闭原始对象，控制元数据不进入非root交接。替换监督器、修改PM2守护进程实现或扩大root权限不在本设计内。

## 配置兼容契约

`apps/orchestrator/src/config/env.ts:24–35`实际顺序是：保留继承环境中已有非空值，再依次由仓库`.env`、仓库`.env.local`、应用`.env.local`补充缺失或空值。后续文件不覆盖已有非空值；文件注释的“later overrides earlier”不能取代实际行为。

1. 只转交发布版本显式审定的应用继承键及必要运行身份键；保留每个原始字符串、缺失和空字符串之间的区别。不预填`NODE_ENV`，不把空字符串过滤掉，不在root阶段读或实现dotenv。
2. 键清单必须覆盖config schema、schema外直接读取、动态名字调用及子进程运行要求。代码检索只是候选来源，不能以regex扫描等同完整依赖审计；禁止未审查的自动放宽。每个键附源码用途，清单与首入口同一候选版本固定，运行时不能用参数替换。
3. `NODE_ENV=production`必须存在；PATH、HOME、USER、LOGNAME、XDG_RUNTIME_DIR等运行项以原启动脚本及NSS契约校验，不能把root默认HOME带给应用。原脚本的Node PATH前缀、固定cwd和PM2_HOME移除须在新链体现。其他值不在本次设计中改写或输出。
4. `LD_*`、`DYLD_*`、`PYTHON*`、除NODE_ENV外的`NODE_*`、PM2控制元数据不得进入最终应用字典。PM2注入的IPC键作为已知非业务元数据丢弃，未知需要业务继承的键必须先补清单审查，不能静默声称兼容。
5. 正式维护时只允许在程序内部比较原路径与新路径的合成/实际配置结果，输出键覆盖数量、缺失数和一致性布尔；不输出原值、散列或整个环境。未核对的键及优先级不得当通过。

## 原生到Python的唯一数据通道

首入口忽略PM2的控制命令和任意解释器参数；版本包路径与候选在构建/安装清单固定。参数不允许变更命令、解释器、路径、UID/GID或环境清单。

- 首入口在任何解释器之前完成全root身份确认；只从内核提供的envp逐条有界复制字节，不解释其业务含义。原始包上限262144字节、最多1024项、单项含终止NUL不超过131072字节；超限直接退出，不截断。Python负责严格编码、键及重复项拒绝，不能采用不同语言的first/last-wins差异。
- 原始格式为4字节ASCII `HPR1`、40字节小写非零candidate、每条`key=value`原始字节加NUL，结尾额外NUL。不含boot，不能充当启动事务授权；禁止shell、pickle、eval或解析嵌套PM2 env对象。Python按清单选取后的应用字典仍受既有HPE1总65536字节、最多512项、键128字节、值UTF-8 8192字节限制。预算不同是为了容纳仅在root阶段丢弃的PM2元数据，不允许将这些元数据降权传递。
- 数据写入首入口自建的root:root0600、nlink0 memfd；完整写入、四封印、元数据读回后才允许交接。先关闭原PM2 IPC及无关继承FD；只保留可信stdio与该数据FD，交接为固定FD3。数据对象本身不证明PM2来源或一次性授权。
- 随后同PID exec固定Python `-I -S`，envp只有`PATH=/usr/bin:/bin`、`LANG=C.UTF-8`。静态ELF必须无PT_INTERP、无动态依赖/初始化代码；不能用“编译加-static”这一个标记当证明。编译器、链接器、syscall ABI、文件摘要和包根权限纳入发布清单，不在未知主机安装工具。
- Python入口必须自包含地验证包祖先及固定模块完整性后才加载业务无关的broker模块；不能依赖`-I`自动导入同目录模块，也不能把应用目录加进sys.path。输入FD3先置CLOEXEC，元数据/四封印/绑定/长度/编码/重复项验证并提取允许键后关闭，成功结果只留私有字典，绝不写回root os.environ。原始包不记录、不持久化、不返回调用方或转交uid998；匿名封印不等于加密、不可swap或安全擦除，不承诺这些额外性质。
- 每次新进程启动生成新boot；root listener以受审candidate和有界单启动事务接纳登记，失败不重试。Python在关闭输入FD3后才打开私有登记连接，调用已有`launch_application(channel,candidate,boot,values)`；由已有生产者建立新的HPE1环境对象并在ACK后交接给降权守卫。两个FD3阶段串行，绝不把原始输入对象直接当HPE1或ready证据。

## 失败和信任边界

根阶段不输出环境或底层异常，失败固定非零退出，绝不进入旧启动脚本。stdio不能是任意攻击者传入的敏感文件FD；固定PM2日志管道及权限须实际验证。当前Python入口的异常处理不追溯证明之前未发生加载器注入。

首次原生exec/后续解释器与模块的内容完整性不能由程序在执行自己之后自证，必须由固定发布安装链和不可写路径保证。环境清理不能保护已经被攻破的root PM2或主机；不声称本链可对抗恶意root。应用接纳保持关闭，登记ACK仍不是应用就绪、浏览器组退出或发布授权。

## 完整交付门槛

下一实现必须包含明确键清单、原生首入口、Python消费与已有编排接线及真实生产者到消费者的合成闭环，不能再单独交付一个只接受测试字典的helper来声称父入口完成。TDD先证明恶意加载变量不进入exec环境、重复/坏预算不登记、空值原样保留、FD不泄漏、缺模块不降级、原FD3复用安全、同PID请求参数固定。

原生Linux独立验收必须验证ELF结构/内容、实际exec不换PID、原始加载注入无作用、真实封印/FD清理、真实setpriv降权、PM2日志及退出/重启行为，并完成键清单兼容核对。mac上模型/语法检查只算本地证据；没有Linux执行环境时不得扩大测试结论或私自启动Docker。

旧生产窗口已过。本地设计/开发可继续；Linux平台实验和生产安装必须有有效授权范围。GROUP_EXIT_UNPROVEN、全链发布门禁和首次维护/回滚限制均保持。

独立review_qwen_negation对本规格及配套实施计划只读复审：无Critical/Important/必修Minor，可以存档。审查者未运行测试或访问生产；不构成实现或发布验收。

## 证据

- [PM2 v6.0.8 ForkMode](https://github.com/Unitech/pm2/blob/v6.0.8/lib/God/ForkMode.js#L89-L109)
- [PM2 v6.0.8 Common](https://github.com/Unitech/pm2/blob/v6.0.8/lib/Common.js#L167-L199)
- [Node v22.18.0 IPC环境注入](https://github.com/nodejs/node/blob/v22.18.0/lib/internal/child_process.js#L351-L360)
- [Linux execve加载器及同进程语义](https://man7.org/linux/man-pages/man2/execve.2.html)
- [Python 3.10隔离模式](https://docs.python.org/3.10/using/cmdline.html#cmdoption-I)
- 本地源码：scripts/orchestrator-runtime.sh、scripts/start-orchestrator-production.sh、apps/orchestrator/src/config/env.ts；仅代码检查，未读任何实际.env或凭据。
