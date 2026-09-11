# 首次解释器前入口闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans；仅主线程实施与原review_qwen_negation只读复核。所有编译、测试、安装和浏览器工作串行；不新增智能体。

**Goal:** 交付原生首入口到隔离Python消费、现有root_launch真实编排的闭环，不再只交付接受人工字典的辅助函数。

**Architecture:** 受信PM2直接启动无loader/CRT原生程序，有界封印原始环境为HPR1并只携带最小env同PID exec隔离Python；Python读取允许键后消费原始FD、创建新boot和登记连接，调用既有launch_application，继而HPE1→setpriv→guard→Node。任何环节未证明均不启用旧/新生产路径。

**Tech Stack:** 无libc/CRT的原生入口、Python3.10标准库、既有broker模块；不新增运行时依赖。

**Spec:** docs/superpowers/specs/2026-09-11-pool-first-exec-boundary.md；继承9d-2b B身份方案及9d-2g。基线abe593a1。

## Global Constraints

- 主uid998、PM2监督及同PID不变；无通用sudo、无setuid或文件capability首入口。
- 原始HPR1上限262144字节、1024项、每项含NUL≤131072字节；选定HPE1仍≤65536字节、512项、键128字节、值UTF-8≤8192字节。
- Python环境只有PATH=/usr/bin:/bin、LANG=C.UTF-8；不读取真实.env、秘密、业务数据来编写代码。不改dotenv、账户注销、奖励支付、额度、旧模型或DivineAPI配置。
- 保留空值和缺失区别；PM2对象/IPC不传uid998，原始环境只在root匿名FD短暂保存，不落盘、不输出。
- 当前没有已核实的Linux构建目标架构、工具链和实际PM2版本；不能猜测ABI或将mac编译结果称Linux验收。可先完成平台无关测试与源码；不私自启动Docker、安装工具或沿用过期生产窗口。
- 只在现有隔离worktree修改，保护QA、主草稿及冻结候选；本计划所有闭环完成前不push/PR/合并/部署部分组件。

## Task 1：明确配置清单和跨语言数据契约

**Files:** 新增scripts/pool-broker/application_env_keys.json、bootstrap_input.py、test_bootstrap_input.py；测试夹具放同目录tests-fixtures/，只含合成值。

**Interfaces:** `decode_bootstrap_input(raw: bytes, candidate: str) -> dict[str,str]`消费HPR1字节并按构建固定清单选择应用项；它不是公开运行入口、不修改os.environ。清单记录key与源码用途，不允许运行调用方传入替代清单。清单加载由受信bootstrap在包校验后执行。

- [ ] 先审计config/env.ts schema、schema外process.env读取、动态名字的所有实参和运行脚本的PATH/HOME/USER/LOGNAME/XDG_RUNTIME_DIR。不得仅把113个表面schema行数当全集；扫描未能解释的读取在清单审查中阻断，不静默放宽。清单无值、无密钥散列。
- [ ] 写原始字节→真实解码→真实`seal_application_environment`→真实guard消费测试，核验显式覆盖/空值/Unicode等号原样保留，PM2的env对象和IPC排除。预期从字面夹具手写，不调用生产编码器计算预期。

```python
raw = b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0LOG_LEVEL=\0NODE_CHANNEL_FD=3\0env={"private":"synthetic"}\0\0'
assert decode_bootstrap_input(raw, 'a' * 40) == {'NODE_ENV': 'production', 'LOG_LEVEL': ''}
```

- [ ] 先运行`python3 -B -m unittest discover -s scripts/pool-broker -p 'test_bootstrap_input.py' -q`观察缺模块/错误放行RED。实现严格标签/candidate、预算、终止符、UTF-8、键结构和重复键检查，所有原始项先校验再筛选；不解析env对象。空包、错candidate、截断、重复（包括将丢弃的键）、原生预算越界、HPE1预算越界、禁止加载器键进入结果均有独立反例。
- [ ] 执行包含真实生产者/消费者的GREEN，再保持代码未发布进入Task2；该解析器单独通过不标记首入口完成。

## Task 2：原生生产者与Python入口形成闭环

**Files:** 新增scripts/pool-broker/native_entry.c、native_entry_start.S、bootstrap.py、test_native_entry.py、test_bootstrap.py、native-build-manifest.json；修改installation.py/test_installation.py精确清单；不修改现有PM2启动配置。

**Interfaces:** 原生启动只接受构建固定candidate及包路径，不开放任意参数；其HPR1唯一输出为FD3，执行固定Python `-I -S`与bootstrap路径。`bootstrap.main()`无调用方字典或成功provider；消费固定FD3、校验可信包/工具，`os.urandom(16).hex()`新boot，连接固定`/run/holaday-pool-broker/register.sock`后调用`root_launch.launch_application(channel,candidate,boot,values)`。

- [ ] 确认已有本地编译器可做的目标，仅选择有真实证据的目标ABI。未取得Linux目标/工具链时不伪造清单；把平台未证实记录为独立发布门禁，使用现有工具验证平台无关字节逻辑。原生入口采用真实syscall包装，测试在syscall边界替换，不在生产入口增加绕过身份开关。
- [ ] 先写RED闭环：恶意LD/PYTHON/NODE变量存在于合成envp时，第一次解释器exec实参env必须仅有固定PATH/LANG；不依赖清空模拟os.environ伪造。Native字节实际流经Python解码，再流经已有封印/登记/guard；PID保持和实际ELF加载另作Linux证据。

```python
assert observed_first_exec.path == '/usr/bin/python3'
assert observed_first_exec.env == {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}
assert observed_first_exec.owned_fds == {0, 1, 2, 3}
assert observed_node_env['LOG_LEVEL'] == ''
assert 'NODE_CHANNEL_FD' not in observed_node_env
```

- [ ] 原生逐条扫描envp并在写入前检查长度/计数/总预算；只构造HPR1，不解JSON。自建memfd、0600、完整短写处理、四封印读回，关闭非stdio且非自身FD，不从NODE_CHANNEL_FD值决定关闭目标。只FD3显式跨exec；失败固定退出，无fallback。
- [ ] Python用自包含stdlib逻辑核验固定模块及清单的不可写路径/内容后加载；`-I -S`下明确受信模块路径，不加载应用或site。FD3先CLOEXEC、元数据/封印验证、解码、解除所有权后close；失败禁止登记。只有旧输入FD3已关闭才允许新登记socket占用FD3，转交所有权后由launch_application负责消费。
- [ ] 新boot必须完整16随机字节且非零；随机失败、socket路径/对端/期限错误、包内容不符、缺文件、额外参数都固定失败。登记ACK不是ready；缺listener时退出，不启动应用。受审私有listener/新启动事务与运行通道未完备前本入口不能激活。
- [ ] 覆盖memfd失败、短写/零写、封印失败、dup/close失败、原FD已为3、stdin缺失、元数据不可信、信号/exec异常、输入读取超限、重复键、包错candidate、登记失败、同PID重启新boot等反例。所有FD取得/转交/消费精确一次，不能在FD3重用后再关旧号。
- [ ] 全部Python轻量测试、native现有可用构建检查、AST和diff串行通过，原唯一reviewer审核安全边界后精确提交完整闭环文件；QA记录哪些是模型、哪些实际运行，不能填造Linux结果。

## Task 3：Linux组合门禁与发布接入（独立平台阶段）

**Files:** 新增scripts/pool-broker/test_native_linux.py与qa-artifacts中的仅合成执行报告。现有生产runtime脚本只有在整个9d实现与发布计划门禁完成后才能改动。

- [ ] 在有效授权的Linux隔离环境核实架构、kernel、PM2/Node/Python/setpriv版本、固定构建工具链及产物摘要。ELF检查无PT_INTERP、动态依赖或隐含初始化；真实exec加载注入测试必须证明未执行注入标记，而非仅环境字符串消失。
- [ ] 真正启动合成root入口，验证同PID贯穿、封印拒绝篡改、精确FD、实际全组/caps/NNP/UID/GID下降及Node观察到的合成配置优先级。PM2实际fork/退出/重启/日志管道/IPC关闭行为组合测试失败即停止；不创建浏览器或业务任务冒充此门禁。
- [ ] 在受限维护范围核对配置清单完整性，只输出计数和一致性布尔；验证原脚本与新链的PATH、运行身份、空值和三文件优先级等效。不能加载/改变真实配置仅为方便本地测试。
- [ ] 再完成root listener、一次性新启动事务、运行命令通道、持久资源和浏览器隔离的既定计划；所有GROUP_EXIT_UNPROVEN、首次旧版维护、回滚及单合成账号发布门禁保持。任一不明都不发布。

## 本轮状态

仅完成上述源码/官方语义核对与设计，不声称Task1–3实现或通过。140项是abe593a1上一轮本地验证记录，不是本轮原生证明。下一轮直接从Task1的键清单和闭环RED开始，按Task2接完生产者/消费者，避免重做9d-2g。
