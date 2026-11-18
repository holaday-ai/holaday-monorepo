# Goal2 M3：恢复后的账号主体核验

> For agentic workers: 使用superpowers:executing-plans在当前聊天逐项执行。用户已确认单路Goal，不派并行代理，不重复确认已明确的未知身份等待规则。

**Goal:** 恢复的云端会话只有在可信站点证据仍指向已保存的账号主体时才进入模型、执行动作或确认完成。

**Architecture:** 在现有AEAD加密snapshot内加入有类型标签的私有state+identity内容，兼容读取旧state但不把旧state当主体证明。Runtime把与原授权/context绑定的异步核验器接给executor；统一runner复用现有会话中断与等待流程。

**Tech Stack:** 当前TypeScript、Node22.23.3、MySQL、Playwright/CDP、Vitest及现有KeyProvider；不增加密钥算法或新购服务。

**Spec:** 同目录`2026-11-17-browser-assistant-goal-sequence.md`的Goal2及本文件的裁定与边界。

所属已确认计划：`2026-11-17-browser-assistant-goal-sequence.md` Goal2。本文件记录授权范围内的实现裁定，不扩大到采购服务、配置生产密钥或自动发布。

## 当前证据

- M1 `2563dc7a`：实际SQL/Chromium证明持久会话、撤销/清除/过期/关闭账号和旧写入保护。
- M2 `f1fb50c5`：实际Darwin BrowserPool、原生进程、CDP、egress、真实SQL与文件服务证明借还/关页/重建/迟到文件原归属。
- 当前`worker.verify`以路径/选择器判断已登录；这不是账号主体连续性的证据。`runtime.prepare`直接加载保存的状态，统一runner只检查`sessionInterruption`，缺少主体核验接线。

## 裁定与边界

Ruling：执行已确认Goal中“身份未知则等待、账号变化不能续旧任务”的要求；沿用当前聊天和单路执行授权，具体内部接口由执行者决定，不重复要求确认既有产品规则。

考虑过仅凭URL/登录标记、每次人工核对、可信站点适配器的稳定主体核验。采用第三种，缺适配器时使用明确等待。URL/登录标记无法区分两个已登录账号；人工核对保留为无法自动核实的后续步骤。

1. 站点适配器由服务端配置可信只读路径及稳定主体读取规则；网页或客户端不能提供/更改该规则。缺规则、页面失效、登录墙或无法读取主体都不产生已核实结论。
2. 主体绑定与授权状态一起放入现有加密snapshot内容，复用现有AEAD/KeyProvider及user/origin/grant/purpose/version上下文。可用有类型标签的私有payload兼容旧`BrowserSessionState`；旧快照没有主体证据就保持未核实。不能把账号标识写到公开metadata、日志或明文SQL。
3. 保存时在既有持久同意之后核验当前状态，固定已核实的主体；写回可更新同一账号的cookie/偏好，不能静默将同一个profile变成另一账号。原有撤销、lease、版本与owner锁继续优先，迟到证明不恢复权限。
4. Runtime把与原context/授权绑定的异步核验器注册给真实executor。统一runner在第一次模型调用前、动作派发前和完成判断前检查。无法核实时使用现有`awaiting_user`，关闭/停止有问题的任务context并丢弃未确认写回；不匿名回落、不重放已生效动作。
5. 验证使用独立临时只读context，优先共享原浏览器进程、单独管理其生命周期，不切换用户页面或焦点。站点只读探针必须由适配器保证不触发登录/提交/会话轮换等副作用；没有这种适配器则等待。

## 实施与验收顺序

- [x] 先观察原生Home/真实SQL反例：没有主体证据仍进入模型管道。`goal2-identity-unknown-red-candidate/home-evidence.json`记录fixtureModelAttempts=1、actual=failed、externalModelCalls=0；模型首次调用前应awaiting_user。完成证据门禁阻止了不实完成，并不替代主体核验。
- [x] 补私有snapshot读写兼容、可信主体证明与原snapshot/context绑定；不改共享HTTP请求授权，不加入明文密钥fallback。
- [x] 接Runtime/executor和统一runner的检查点，补同一账号可继续、另一账号/无证据/页面失效等待，以及验证后迟到撤销/过期与保存竞态。
- [x] 在同一实际SQL/native池上验证模型/动作调用计数、等待状态、旧结果/文件归属和资源回收。相关288项、2048MB定向类型、静态检查通过；路由74/拦截24及本机真实公开表单通过。额外观察核验中切账号RED并修复为GREEN。
- [x] 冻结证据并提交，提交号由`goal2-identity-M3-validation.json`记录。生产KMS/真实账号/可信站点配置缺项见`docs/reports/2026-11-17-browser-assistant-goal2-session-continuity.md`，受控adapter和测试KeyProvider不冒充生产验收。

生产接线仍缺选定KeyProvider与可信站点适配器。已有本地部署配置仅检查变量名，尚无KMS配置证据；KMS问题已询问用户，未收到答案，不默认作出配置或新购服务。

## 文件与独立任务

### M3a 私有主体快照与可信保存

- 新建`src/browser-session-vault/profile-snapshot.ts`及定向测试：解码旧BrowserSessionState和带标签的私有v2内容；主体只出现在加密内容中。cookie-only站点也要能通过站点适配器保存稳定subject，不以是否存在localStorage账号键替代验证。
- 修改`vault.ts`：保存/导入回调可返回服务端核实的主体；seal原state与主体为同一内容，checkout解密后给worker。写回仍受原owner/lease/version守护，同profile不能悄悄切换主体；明确注销保留既有tombstone语义。
- 修改`worker.ts`：可信probe可配置稳定subject读取规则和适配器版本；保留旧verify登录状态API的兼容语义，增加主体证明路径。403/429/登录墙/空主体/适配器缺失均不证明一致。
- 修改`browser-home-profile.ts`和必要的Vault导入入口：持久同意后才读取状态与主体；前后都重查原document/control revision和当前授权，迟到核验不能给替换页面或已撤销授权写回。
- 先相关失败测试，再实现，再验证并提交。验证state/subject共同加密、旧快照等待、正常token轮换仍保存、账号变化拒绝，避免将全部写回一律关闭的替代方案。

### M3b Runtime、executor与runner检查点

- 修改`runtime.ts`注册与原task/context绑定的核验器；修改`playwright-executor.ts`承载核验回调，并提供受管理的临时验证context。临时验证应共享原浏览器进程，不能改变主context或用户当前页面；关闭/断开时有可核查释放。
- 修改`unified-supercar-runner.ts`：模型调用前、action gate派发前、完成判断前异步检查；复用`sessionInterruption`和`awaiting_user`，明确账号未核实/已变化及先核对已生效步骤。校验失败后不调用模型、不执行后续动作、不伪造完成、不匿名续跑。
- 回调对原snapshot/lease/context负责，原context停止后不能毒化或重新授权另一个新context；后台checkpoint和最终保存也要核对主体，不将B账号覆盖A账号profile。
- 修复已观察的原生RED，再增加可信同账号可继续、B账号/登录失效/无证据等待、核验中撤销/过期和迟到回调的实际SQL/原生场景。
- 修改执行循环后按现行TEST-POLICY先离线路由/拦截，再补本机真实网站相关项；小范围、串行、不扩成矩阵。Types2048MB、测试1536MB，默认opt-in门禁仍关闭。

### M3c 阶段结案审计

- 对照原Goal2每项要求审计M1/M2/M3证据，不能用登录存在或URL恢复证明账号一致，也不能用受控主体证明冒充真实账号。
- 明确列出生产KeyProvider、只读可信站点适配器/账号配合、已安装渠道等缺项；有可执行配置输入时再接线，不新购或充值。
- 全部所需机制及相关验证完成后冻结、提交，再结束Goal2；之后按已确认队列推进Goal3/4。
