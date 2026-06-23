# Playbook ④ 主动探索 — Explorer v1 设计 (spec + 骨架)

> Status: **skeleton landed, NEVER auto-runs.** explorer 跑前需 (1) BOSS 填预算数额
> (2) `EXPLORER_ENABLED=true` (3) 烧钱授权章节 v1 最终生效。默认全 off → explorer
> 一行不跑、一分钱不烧。本文件是 spec；实现是骨架（安全模块真实 + 编排骨架 inert）。

## 0. 既定能力两类（BOSS 定）
1. **AI 站读手册 → 学会用**（v1 首个场景，本轮聚焦）。
2. **订票类操作 → 停在「用户操作前界面」**（护栏=Sensitive Site Protocol；v1 只定义识别+停，不做实跑）。

## 1. 烧钱授权章节 v1（地基，已固化 `docs/daily/SESSION_STATUS.md` ④ 块）
A 总闸（总预算上限+硬熔断，数额 BOSS 填）/ B 分批种子站（每批 BOSS 闸）/ C 热度触发（≥10 用户，等批）/
D 动作边界（只读浏览）/ E 产物（捕获→结晶 draft，全程 log、每笔可追溯）。本设计落实 A/B/D/E。

## 2. 复用地图（不新造已有的）
| 需求 | 复用现成 | 位置 |
|---|---|---|
| 读 AI 站文档 | `FirecrawlLane.scrape(url)→{markdown,title}` | `src/firecrawl/firecrawl-lane.ts` |
| 跑批记录 | `exploration_runs` + `PlaybookRepository.createExplorationRun` | 0033 / `playbook-repository.ts` |
| 捕获→结晶 draft | `crystallizeTasks` (browse 试用产 captures → draft path) | `src/playbook/crystallizer.ts` |
| 花费可追溯 | `llm_calls` `purpose='supercar.turn'`（刚补的记账） | `020dff5d` |
| 站/能力落库 | `SiteRepository` / `PlaybookRepository.createCapability` | `src/playbook/*` |
| 敏感动作模式（prior art） | `classifyOtaAction` 的 forbidden 模式 | `ota-user-browser-policy.ts`（OTA 域耦合，explorer 自建域无关版+登录/身份） |
| (可选) browse 试用派发 | `runSupercarTask` | 重、需 executor+ctx，v1 gated 不跑 |

**explorer 是完全隔离的新模块**：只 import 上述公共 API，**零编辑任何现有文件**（不碰用户热路径）。

## 3. 架构
```
scripts/explore-sites.ts  (BOSS-triggered CLI, default DISABLED)
   └─ runExplorerBatch(deps, opts)            src/playbook/explorer/explorer.ts
        ├─ [master switch] EXPLORER_ENABLED=false → 立即 return（不跑）
        ├─ readBudgetCaps() (env, 默认全 0)     src/playbook/explorer/explorer-budget.ts
        ├─ for each seed site:
        │     ├─ checkBudget(batchSpent, caps) → cap=0/超 → HALT+report
        │     ├─ createExplorationRun(pending→running)
        │     ├─ capability-1 DOC-FIRST: firecrawl.scrape(docUrl)  ← 零 live action, D-safe
        │     │     └─ (LLM 理解=spend, gated) → 写 site_capabilities (draft)
        │     ├─ [可选, gated] browse 试用: dispatch read-only task → captures → crystallize
        │     │     └─ Sensitive Site Protocol 拦敏感动作  explorer-guards.ts
        │     └─ exploration_run completed (cost 进 metadataJson)
        └─ batch summary (站数/花费/path 数) + 累计 cost 落 exploration_runs
```

## 4. 预算闸 = 三层熔断（`explorer-budget.ts`，charter §A v1）
**理念（BOSS 定）：拦异常烧钱，不掐正常跑通。** 正常站 $0.5-2 完成；熔断只在异常时触发。
- **占位常量（env 可调，默认=真实熔断值，不是 0）**：`EXPLORER_BREAKER_PER_SITE_SEED_USD=$5` /
  `PER_SITE_STRANGER_USD=$3` / `BATCH_FACTOR=1.2` / `PER_DAY_USD=$50` / `PER_MONTH_USD=$200`。
  `parsePositive` 拒 hex/科学计数/junk → 回**默认值**（不是 0）。**run 闸 = `EXPLORER_ENABLED` 主开关**，
  不是「预算必须设才跑」（预算默认就是真值）。
- `checkBreaker(spent, breaker)` → **tripped 当 `spent >= breaker`**；breaker≤0=misconfig→fail-safe tripped。
- **per-SITE 熔断（$5）→ 停该站标 `halted_budget`、批继续**（异常单站不连累整批；正常远不到 $5）。
- **per-BATCH（站数×$5×1.2）/ per-DAY（$50）/ per-MONTH（$200）→ 停整批**。pre-site（派发前查全局熔断未触）
  + post-site（每站后查）。
- **每站 REAL 花费经 `exploreSite` 回报 `costUsd`**（doc-first=Firecrawl `firecrawlScrapeCostUsd()` 默认 $0.01；
  browse-试用=`sumLlmCostForTasks` 读 `supercar.turn`）→ shell 累计 → **熔断看得见 Firecrawl 花费**（对抗审 Camera 6 修复）。
- day/month base：`readPriorDaySpendUsd()` / `readPriorMonthSpendUsd()`（注入；v1 CLI 返 0+TODO 聚合 `exploration_runs`）
  → `base + totalSpent` 比熔断线，批内即时、跨批靠 reader。
- **标定先行**：首批 1-3 标定站拿实测，据实校准 $5（charter §A）。
- **残留**：per-site 是 post-hoc（doc-first 单 scrape 原子；browse-试用 per-turn 实时拦=mid-loop veto=defer，见 §8）。

## 5. Sensitive Site Protocol（护栏，`explorer-guards.ts`）
- **识别**（域无关，mirror OTA + 加 login/身份；对抗审 Camera 2 后**已大幅拓宽**）：
  - 动作类型：`submit` **永远敏感**（表单提交绝不自动）；未知 kind = fail-closed。
  - label 关键词（label 先 **whitespace/zero-width 归一化 + lower-case**，破 `登 录` 间隔绕过）：
    提交/下单/购买/立即购买/结算/付款/支付/确认付款/确认下单/加入购物车/绑卡/实名/身份证/验证码 +
    **登录/注册/密码** + buy now/add to cart/checkout/place order/pay/order now/proceed to pay/sign in/login/register/subscribe/follow。
  - URL：pay/checkout/cashier/**order(s)**/buy/purchase/**cart**/trade/settlement/**wallet/billing/recharge** +
    login/signin/**sign_in**/signup/register/auth/oauth/**sso**/**connect/authorize**/account。
- `classifyExplorerAction(action) → { allowed, sensitive, reason }`：sensitive → `allowed=false`。
- `isCapturedStepSafe(stepType, visibleText, url?)`：**fail-closed**（未知 step_type → 不安全不结晶）+
  **label AND url 双查**（navigate step 查 url）。修复对抗审发现的 form_submit/tap→'read' 漏判 + navigate 不查 url。
- **D 边界硬编**：只允许 `navigate(非敏感url)/screenshot/read/scroll/click(非敏感label)`；
  `submit / type-into-credential / 任何 sensitive` → 拒。
- **停的机制（v1）**：
  1. doc-first（Firecrawl）= **零 live 浏览动作** → 天然在 D 边界内（v1 主路径，最安全）。
  2. browse 试用（可选）给 **read-only 受限 intent**（"只浏览/读取，绝不提交/登录/支付"）。
  3. 结晶时 **过滤敏感 captured step**（不把 submit/pay 步结晶进 path）。
  4. run-level：遇 sensitive → 标 `humanFinalClick=true`、跳过该站后续、不促升。
- **⚠️ 明确 defer**：在 **live supercar loop 内逐动作 veto**（点击前拦）= 需改 loop=**碰热路径**，
  v1 **不做**。v1 安全靠 doc-first 零动作 + 受限 intent + 结晶过滤；live veto 是 explorer 接管自有
  执行 lane 时（非用户热路径）的后续工程。**explorer 绝不跨敏感线**：v1 doc-first 根本不点。

## 6. exploration_runs 生命周期
`pending`(建) → `running`(开跑) → `completed`(成功, summary+metadataJson.costUsd+pathsCreated) /
`failed`(errorCode+errorMessage) / `halted_budget`(预算停) / `halted_sensitive`(护栏停)。
`triggerType='manual_batch'`（阶段一 BOSS 触发）/ `'heat_trigger'`（阶段二，C，初期不自动）。
`runnerType='explorer.doc_first'` / `'explorer.browse'`。

## 7. NEVER-runs 锁 + 花费边界
1. **`EXPLORER_ENABLED`（env, 默认 false）= run 主开关** → 真跑前第一关 return（dry-run 仍可预览，零派发零烧）。
2. CLI `explore-sites.ts` 默认 `--dry-run`（只打印计划+熔断判定，不派发不烧），真跑需 `--run`。
3. 无任何定时/cron 注册（阶段一纯手动 BOSS 触发）。
+ **花费边界（即使 enabled 误开）**：三层熔断默认 $5/$50/$200 兜底——单日最多烧 ~$50、单月 ~$200。
  即「主开关 + dry-run」是 run 闸，「熔断」是 enabled 后的花费天花板。

## 8. 本轮交付 vs defer
**交付（skeleton）**：design 本文 + `explorer-budget.ts`（真+测）+ `explorer-guards.ts`（真+测）+
`explorer.ts`（编排骨架，inert）+ `scripts/explore-sites.ts`（CLI disabled）。
**defer**：browse 试用实跑（executor 接线）/ 月度聚合细化 / 热度触发 C /
**任何登录态/凭据存储 = Credential Vault 大工程，v1 只做免登录能学的**。

## 9. Capability-2 BROWSE-试用 lane v1（live-veto）
**目标**：把 Sensitive Protocol 从「静态认得」变成「explorer 每个 live 动作执行前真拦」。免登录 live 浏览。

**9.1 LIVE-VETO 接入点（agent-loop，BOSS 批准的唯一改动）**
- `RunSupercarOptions += onBeforeAction?(action:{kind:'click'|'navigate'|'type', label?, url?}) => {allowed, reason?}`。
- **默认缺失 = 用户任务字节级不变**（同 B2 onAction：没传 → loop 从不调、零开销）。只有 explorer 传。
- agent-loop 在每个 live **写**动作执行前调它（覆盖全）：
  - **navigate**：在 `navPage.goto(url)` 前（CC 实证导航绕 executor、走 page.goto，这是唯一能拦导航的点）。
  - **click**（left/right/middle/double/triple）：在 `executeComputerAction` 前，用 `captureTargetDescriptor(page,x,y)` 解析 label（复用 B2 已算的 descriptor，没有则现算）。
  - **type / key / hold_key**：在 `executeComputerAction` 前（`vetoActionKind` 把键盘写也算 'type'；v1 无 label→classifier 放行，真护栏是 click/navigate/submit）。
  - scroll/screenshot/mouse_move/wait = 读类，不调钩子。
- veto（allowed=false）→ **该动作不执行**、`runSupercarTask` 立即 return `{status:'failed', reason}`（任务终止）。

**9.2 explorer browse lane（`explorer-browse.ts`，explorer 自有 veto 接线）**
- `makeBrowseExploreSite(deps)`：复用 `runBrowseTask`（注入，CLI 接 `runSupercarTask`+executor），
  `onBeforeAction` 接 `classifyExplorerAction`（命中敏感/D 边界→allowed=false）。
- veto 触发 → 记 `state.vetoed` → 站 `halted_sensitive`（note 含 reason）。costUsd = `readTaskCostUsd`(注入，读 supercar.turn)。
- read-only `browseIntent`（软护栏）+ live-veto（硬护栏）双层；v1 免登录，碰登录墙/敏感即停。

**9.3 🔴 护栏验证方案（真跑前必过验收）**
- **单元（本轮已做）**：`explorer-browse.test.ts` 用 fake agent-loop（mimic veto 合约：allowed 才"执行"、veto 即停）证明
  敏感 click「登录」/敏感 navigate `/checkout` → **veto 触发、动作从未进 executed、站 halted_sensitive**；benign 全过完成。
- **真机（acceptance，GO 后做）**：flag-gated 夹具页（仿 B3 fixture）放「登录/提交」按钮 + 一个安全链接 → explorer 真 browse →
  断言：点安全链接放行执行；走到「登录/提交」→ **veto 触发、`executor.click`/`page.goto` 内层从未被调、动作没执行、站 halted_sensitive**。
  这是 browse-试用 真开主开关前的必过验收（像 B 系列真机验收）。

**9.5 对抗审 6 镜头 — 发现的洞 + 修复（本轮）**
6 镜头对抗审证明「动作边界的 label/URL 分类器」是 **best-effort、非密闭沙箱**。已修：
- **🔴 BLOCKER（C2/C5）mouse 原子绕过**：`vetoActionKind` 原对 `left_mouse_down/up`、`left_click_drag` 返 null →
  模型可把点击拆成 down+up 点敏感按钮、或拖「滑块确认支付」绕过。**修=fail-closed**：除明确读类（screenshot/
  scroll/mouse_move/wait/cursor_position/zoom），**一切（含 mouse 原子 + 未知动作）→ 'click' 走 veto**。回归测试 `agent-loop.veto-kind.test.ts`。
- **MAJOR（C2）icon-only 按钮**：veto 原只读 `visibleText`。**修**：label = `visibleText ?? ariaLabel`（aria-label="立即支付" 的图标按钮被拦）。
- **MAJOR（C3）链接点击导航绕 URL 闸**：点 `<a href="/orders">查看订单</a>` 导航到敏感 URL，click veto 只看 label。
  **修=post-action URL 复检**：每个 computer 动作后用 `freshPage.url()` 再过 navigate veto，落到敏感 URL（含 302 重定向）→ halt。
- **MAJOR（C4）社交登录 label**：`Continue with Google/Apple`、`授权`、`Authorize`、`Connect with` 不在正则。**修=拓宽** `SENSITIVE_LABEL_RE`（+ OAuth-click→重定向 由 post-action URL 复检兜）。
- **MAJOR（C6）凭据键入+回车提交**：Tab→聚焦密码框→type→Enter 全是 'type' 无 label→放行。**修**：type/key 现解析**聚焦元素**(activeElement) descriptor → label=visibleText??ariaLabel；有标识的密码/登录框被拦。
- **nit（C1）**：navigate veto 加 call-site guard（hook 缺失零 alloc）。

**9.6 🔴 密闭护栏 = 无凭据浏览上下文（hermetic guard，runBrowseTask 接线时硬性要求）**
分类器 veto 是 **defense-in-depth、不是密闭沙箱**——动作边界的 label/URL 分类总有残角（无 label/aria 的匿名密码框 + 不导航的纯页内提交）。
**v1 免登录的密闭保证 = explorer browse 必须跑在全新、无 cookie/session/凭据的浏览上下文（incognito/fresh context）**：
没有用户凭据/会话 → 即使 veto 漏一个 login/OAuth/pay 点击，**登录/授权/支付也无法成功**（无密码可填、无会话可借）。
→ `runBrowseTask` 落地时**必须**用 clean context（不复用用户 session、不接 Credential Vault）。这条是 browse-试用 真跑的**前置硬条件**，与三层熔断、live-veto 并列。

**9.7 defer（下一阶段）**：CLI `runBrowseTask` 接线（**clean context** executor connect + `sumLlmCostForTasks` + 写 `exploration_runs`）/
真机夹具验收（必红队 decompose-click / drag / 链接导航 / Tab-type-Enter 四向量）/ 登录态 = Credential Vault + 专属账号（v1 绝不碰）。
