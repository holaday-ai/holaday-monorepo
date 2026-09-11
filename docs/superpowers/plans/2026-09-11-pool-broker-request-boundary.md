# Pool broker请求权限边界实施计划（9d-1）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。沿用隔离worktree，主实现与唯一review_qwen_negation只读审查串行。

**Goal:** 完成后续特权broker必须使用的严格、无副作用请求解码模块；任意命令/路径/环境/PID/未知字段不能穿过边界。解码成功不是身份或资源权限授权。

**Architecture:** 独立Python标准库模块解析单个有界UTF-8 JSON payload，返回冻结的类型化请求，不导入应用依赖或执行系统命令。后续Linux broker用标准库SO_PEERCRED和pidfd绑定由受信root启动记录登记的原应用进程；该原生身份层及systemd层尚未实现，本单元不放行任何运行时操作。主应用不提权，不新增HTTP入口。

**Tech Stack:** Python 3.10+标准库json/dataclasses/unittest。本机已确认3.10.6，不安装依赖；生产Python及Linux能力必须后续只读验证，不假定可用。选择标准库是为后续Unix peer credentials提供原生接口，避免root服务导入整个Node应用和第三方依赖。

**Spec:** docs/superpowers/specs/2026-09-11-pool-process-containment-decision.md（用户已批准），及2026-09-10-safe-execution-drain-design.md。

## Global Constraints

- 初始HEAD e63900ca，codex/qwen-safe-drain；保留主8草稿、冻结PR237及QA。整机制门禁前无部分push/PR/部署；过期08:30 JST窗口不延长。
- 单主+唯一只读reviewer，重任务串行；总任务约10GB、Node堆2GB；free<40%或磁盘<10GiB不启重任务。无安装/Docker/真实浏览器/OS实验/生产访问。
- 不触支付/奖励/提现/Partner Ledger/额度/账号注销/DivineAPI/旧供应商配置；不读出秘密、真实身份和业务自由文本。
- 本次只协议数据验证，不实现身份布尔替身、可注入成功provider、unit启动器或解除GROUP_EXIT_UNPROVEN。boot字符串和capability通过语法检查仍属不可信输入。

## 接口与协议

创建scripts/pool-broker/protocol.py及test_protocol.py，无导入或启动副作用。

导出decode_request(payload: bytes) -> CreateRequest | ResourceRequest。失败固定BrokerRequestError(ValueError)，对外str为POOL_BROKER_REQUEST_INVALID，不附原始payload/JSON异常内容。请求不可变，request_id/boot/capability不出现在默认repr中。

单payload长度1..4096字节，精确bytes类型，严格UTF-8，无BOM；只允许一个JSON对象。拒绝重复键（含unicode转义同名）、多余键、NaN/Infinity、非对象、过深/畸形输入；bool不当integer。传输分帧/读超时另属socket层，不把整包大小上限当读取前限流已完成。

所有请求公共键为version=1（精确int）、action、requestId和boot。requestId及boot均32位小写ASCII hex，禁止全0，都是相关性字段而非鉴权。没有用户标识或自由文本。

- create额外且仅允许component和slot；component为xvfb/brave/x11vnc/websockify之一，slot精确int且0..31。32是协议硬上限，实际容量必须由受信配置进一步限制；没有runtime配置授权时不能启动任何slot。
- query/close额外且仅允许capability，64位小写ASCII hex且非全0。真实能力签发、常量时间比较、所有权、单次创建及重放拒绝由后续broker状态机负责；解码器不声称具备这些保证。
- 不允许command/args/env/path/pid/pgid/unit/uid/gid、shell、任意action或回调；不作类型强转、trim或静默忽略未知字段。

数据类型：CreateRequest(version:int, action:str, request_id:str, boot:str, component:str, slot:int)；ResourceRequest(version:int, action:str, request_id:str, boot:str, capability:str)。frozen+slots，秘密/相关性字段repr=False。任何数据对象都不能直接当授权能力传给系统执行。

## 一个完整可审查任务

- [x] 初始契约RED：测试真实模块decode_request消费合法create/query/close字节并得到独立字面值字段；缺模块只记录为契约尚不存在，不能称发现安全漏洞。

```python
request = decode_request(b'{"version":1,"action":"create","requestId":"11111111111111111111111111111111","boot":"22222222222222222222222222222222","component":"brave","slot":0}')
self.assertEqual((request.action, request.component, request.slot), ("create", "brave", 0))
```

- [x] 最小GREEN：实现冻结类型、bytes JSON解码与固定action分支；只解决已有测试要求，不提前写其他验证。
- [x] 安全反例RED→GREEN：未知/重复字段、布尔version/slot、float/越界slot、大小/编码/嵌套/常量/多值、非法/全0 token、混合动作字段和任意执行字段写行为断言，真实模块拒绝并固定错误；默认repr不输出三个私有字段。

```python
with self.assertRaisesRegex(BrokerRequestError, '^POOL_BROKER_REQUEST_INVALID$'):
    decode_request(b'{"version":true,"action":"create","requestId":"11111111111111111111111111111111","boot":"22222222222222222222222222222222","component":"brave","slot":0}')
```

- [x] 组合矩阵：每个动作/角色、slot上下界、精确4096和4097、结构化非法字段/重复转义键、合法消息前后空白与第二JSON、拒绝后下一合法请求不受污染。测试为真实解码器，无mock、真实系统调用或平台能力假设。修改测试输入应针对明确错误分支，不只比对源代码文本。
- [x] 使用python3 -B -m unittest discover -s scripts/pool-broker -p 'test_*.py' -q串行执行；用ast.parse验证两个文件语法且不写__pycache__；git diff --check。只有Python及文档变更，不重跑不相干549项、不称后端/平台新通过。
- [x] 唯一reviewer复审，无必修项。真实JSON语法错误及非法UTF-8异常链测试建议已采纳；25项复验通过。
- [ ] 精确staged check后提交2个模块/测试及本计划/批准状态文档，更新QA和原自动化断点。最终提交及自动化状态以QA最新记录为准，未完成整个broker，不标9d完成。

## 本单元验证记录

2026-09-11 14:15–14:18 JST：初始4项缺模块契约RED后，最小解析实现4项GREEN；新增安全矩阵使25项出现120个失败、27个原始异常（含subTest，不能当147个独立产品漏洞）。严格实现后25项全部通过，追加异常context/cause和真实JSON/UTF-8分支仍25项通过。两个Python文件ast.parse成功；Python3.10.6标准库、无依赖安装、无平台副作用。独立reviewer只读审查无必修项，未替主线程运行测试。资源快照free68%、磁盘141GiB。

## 后续依赖（不是本任务已实现接口）

下一完整单元优先可信应用身份层：root启动登记原应用boot与内核进程身份，Linux Unix peer credentials匹配并持有pidfd；拒绝同UID子进程、伪造PID/boot、PID复用、跨boot和登记漂移。Python/Linux原生能力缺失则默认拒绝，不依赖客户端自述身份。应用遭同进程代码执行已属于受信主应用被攻破，不能宣称仅协议能抵御；不得通过放宽到仅UID检查绕过。

随后持久资源状态机与单次capability、固定systemd模板/参数编译、真实管理通信、cgroup/stdio组合终态、旧boot恢复、Orchestrator接线及发布维护门禁分别明确接口并完整审查。此规划不授权跳过创建前隔离、root文件完整性、seal后无restart或真实平台验证。
