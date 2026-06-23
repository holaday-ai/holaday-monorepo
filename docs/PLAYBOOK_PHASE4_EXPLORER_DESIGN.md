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
**defer**：browse 试用实跑（executor 接线）/ live per-action veto（碰 loop）/ 月度聚合细化 /
热度触发 C / **任何登录态/凭据存储 = Credential Vault 大工程，v1 只做免登录能学的**。
