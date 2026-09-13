# 第2大项：浏览器池整组本地接线验收

范围：`codex/qwen-safe-drain`，起点 `fad214e5a191f9282bcc65f33f65b72cb34b579e`。本表替代9月11～13日计划中的历史“下一步”叙述；历史反例和审查记录仍保留在 QA/PROGRESS。

本项实现、独立复审和最终串行回归已通过，按计划作整项本地提交；验收只针对默认关闭的本地接线，不是生产开放、真实 Linux 隔离或全进程排空证明。提交标识以 Git 与 QA/PROGRESS 的实际回执为准。

## 实现与证据对应

| 本项要求 | 实际实现与本地验证边界 |
| --- | --- |
| 固定 B2 身份、先持久占位再派发 | `slot_identity`、`quartet_protocol/records/journal/launch`；真实文件/flock、双能力分离、跨槽/跨boot/丢ACK拒绝；NSS/systemd/Linux内核为显式合成边界 |
| 固定 anchor 与四角色、预工作守卫 | `quartet_material/root_view/worker_pin/worker_view/worker_guard/worker_channel`；原管理对象/InvocationID/namespace视图、一次性grant、固定exec与失败清理。实际 Linux 五unit隔离仍待第4项 |
| 私有端点、认证桥、egress、协议就绪 | `quartet_endpoints/bridge_channel/egress/probe_*` 与完整launch测试；真实socket/pipe/分段协议/SCM句柄、双nonce、独立egress、固定loopback与边界否决；不以job ACK当ready |
| 原应用初始化身份 | root固定启动入口及首次boot四帧；Node `BrokerBootSession` 保留原native加载、5秒总期及真实关闭回执。不把初始化身份当任务权限 |
| Node逐组私有资源与数据消费者 | `broker-*`、strict `BrowserPool`、CDP适配器及VNC用户认证；本地实际NAPI/Unix/HTTP/WS、实际固定Playwright SDK，浏览器协议端合成。双组不串用、关闭一组不影响另一组、迟到IO与adoption否决 |
| 正式默认closed入口 | `index → application-entry → startApplicationBoot → dynamic application-main`；固定预置state目录，先握手及持久closed检查再加载应用；不提供authorizeOpen、不创建空成功状态、不回退旧浏览器/reaper |
| 入口与后台原控制器传递 | 同一controller进入HTTP、WS、queue、scheduled、planned、prewarm及两cleanup，两个手工Context传入原lifetime；HTTP/tRPC/webhook与WS有原Promise/原IO专项测试。工厂接线测试不冒充完整进程集成 |
| 启动/关闭失败收口 | 原资源登记、quiesce同步拒新、单次可等待stop；HTTP/WS真实bind成功/冲突/创建即关闭；WS先等待原工作再关闲置客户端；boot同步撤销身份并分别等待两份关闭结果。错误不以exit0掩盖 |
| controlled未迁移后台 | retention/crystallize启用则在业务启动前明确拒绝；旧boot恢复、僵尸自动改状态、singleton/reaper在controlled不派发；upgrade闭门在认证前拒绝 |

## 本轮独立审查

唯一原 `review_qwen_negation`，只读且与重任务串行。市场原IO、cleanup、正式入口/对象清理均完成独立审查。最后两项 Important 及WS pending-bind分支已关闭：

- boot控制关闭延迟/失败导致身份撤销晚或跳过broker：`047b01` RED；真实控制socket与原broker测试通过。
- HTTP/WS端口冲突未进入启动清理：`569103` RED；实际监听ready/error/close接入main并等待。
- WS创建即关闭丢失原bind事件：`cbe0e4` 两条RED；空闲/占用端口原ready与close均结算后转GREEN。
- 最新局部5文件46项通过 `d9fb1c`；后端typecheck `4a5f12` exit0。原reviewer确认无新增必修、无其他已知第2本地接线缺口，准予最终回归；这不是提前宣布最终通过。

## 最终验证记录

- Python/C/NAPI：65个测试模块，`python3 -m unittest discover -s scripts/pool-broker -p 'test_*.py'`，**702项全部通过，470.635秒**，回执 `b4cd19`。
- TypeScript相关回归：固定67文件，**1278项通过、0失败、1条件入口skip**；逐文件核对实际report无缺项。格式/导入整理前后两轮一致；最终四批460/362/378/78，回执`e76353`/`13d0f5`，汇总核验`5ff0c7`。单个skip是SDK诊断子进程专用入口，父测试分别执行cached/uncached两种真实SDK子进程，并非两个场景未测。
- 复现脚本：`qa-artifacts/qwen-delivery-contract-20260908/verify-quartet-local.mjs`；最终原始结果在本机`/private/tmp/holaday-quartet-final-Umj0VB/summary.json`及同目录4份JSON报告。它只验证指定相关文件，不是整个仓库所有测试通过声明。
- 独立WS集成：显式`vitest.integration.config.ts`，**6项通过**，`c41e66`；不运行需要真实数据库的restart-recovery集成。最终WS仅生命周期lint注释调整后25项另过`0ee12f`。一次复验命令误用不支持的`LOG_LEVEL=silent`，在收集前被配置校验拒绝；改用合法fatal后通过，未放松产品schema。
- 最终typecheck及后端build：`tsc --noEmit`、`tsc -p tsconfig.build.json`，`a353e0` exit0。Python AST100文件、JSON4文件通过`3f08e8`。
- 环境审计允许键与HEAD完全相同，main16处源码引用逐行核验`2c87f7`；只更新行号后guard/installation/trust **59项另过**`6e4a2a`。
- Qwen-only静态发布契约6项及实际入口可达图扫描通过`97d48e`：438个可达文件、9个历史inventory文件、0违规；无真实模型调用，不能代替第6项千问E2E。
- 75个变更TS文件格式/导入通过；完整Biome check仍报告**10条error、4条warning**，全部14条诊断位置对应HEAD中已有源码，`028e16`；不宣称全仓lint通过。两处timer延后赋值保留以避免同步重入/认证await前的TDZ，明确注释而不改生命周期。`git diff --check`通过。

## 不得误删的下一阶段门禁

1. 第3项：剩余原始数据库/文件/模型/流与回调覆盖、真正全进程停止、提交未知对账、真实整组及后代退出与槽位复用。当前`groupExit`仍不提供成功凭据，unknown保留；tRPC纯输入/权限拒绝仍保守unknown，需准确分类。
2. 第4项：真实Linux/systemd/UID/GID/namespace/文件视图/Chromium沙箱/ELF依赖及固定Node版本验证。源树政策及native manifest保持unverified；本机Node v24.19.0测试不替代要求的Linux Node22安装验收。
3. 第5项：真实维护授权来源、预置state/epoch、旧boot对账、升级回滚。`authorizeOpen`不存在时始终拒绝开放，初始化握手不是豁免。
4. 第6/7项：真实千问端到端、完整发布门禁和新有效生产窗口；不能将本项提交推送、合并或部署成可开放版本。

资源限制：单主智能体+原只读reviewer，重任务串行，Node堆2GB/单worker，每批空闲内存≥40%、磁盘≥10GiB；无安装、新Docker或浏览器。生产、支付/奖励/提现、额度规则、账号注销和DivineAPI配置未改；环境审计清单只调整源码引用，不扩展允许键。主工作区原8份未跟踪草稿保留，worktree保留。
