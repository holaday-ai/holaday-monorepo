# HOLA DAY — Playbook 自学习大工程 交接文档

> 跨多 session 的正式交接。**接手新 session 先读这份 + `docs/daily/SESSION_STATUS.md` 顶部 `PROD LIVE REF` 行**（频繁变，那行是权威运行态）。本文档侧重"全景 + 铁律 + 断点"，SESSION_STATUS 侧重"最近一次部署的逐条实证"。两者互链。
> 维护：每次部署后更新 §1（基线）；每完成一个能力更新 §3/§7。密钥/凭证从不进本文档。

最后更新：2026-06-23。

---

## §1 当前 PROD 基线（接手第一眼）

| 项 | 值 |
|---|---|
| **运行 orch（PROD LIVE REF）** | `dcbb478`（④ browse-试用 live-veto + veto 多信号 OR 修复 dark ship；restart 689；护栏夹具验收 8/8 PASS）|
| **分支** | `claude/musing-keller-ae1d05`（prod 合并主干）|
| **origin tip = 本地 HEAD** | `dcbb4783`（已 push，无未 push 增量；含 `51b43080`/`85f1d273` browse-试用 + `7b80320e` harness + `dcbb4783` veto 修复）|
| **SPA** | `8da47b4b`（bundle `index-DiYh_GAx.js`，本工程期间未变）|
| **edge** | holaday.ai → Vultr 直连（无 CF 层）；orch+SPA 同机 207.148.70.106，PM2+Nginx（剥 `/api/`）|

**Flag 终态**（Vultr `apps/orchestrator/.env`，进程实证）：

| flag | 态 | 作用 |
|---|---|---|
| `ACTION_CAPTURE_ENABLED` | **true** | B2 每动作多信号捕获 → `task_action_captures`（结晶料源）|
| `B4_SCREENSHOT_ANCHOR_ENABLED` | **true** | B4 关键步截图锚 → R2 + evidence_artifacts(manual_hold) + 回填 capture |
| `B3_FIXTURE_ENABLED` | **false** | B3 跨域 iframe 验收夹具（验完关；路由码留待 B 阶段清）|
| `EXPLORER_ENABLED` | **缺失 = OFF** | ④ explorer 主开关 = 自动烧钱总闸；**未设 = explorer 绝不跑** |
| `EXPLORER_VETO_FIXTURE_ENABLED` | **=false（验收后关回，进程+.env 实证、路由 404）** | browse-试用 护栏红队夹具；2026-06-23 翻 true 验收 8/8 后内联 `=false` 关回 dark |
| `EXPLORER_BREAKER_*` | **缺失 = 用默认** | 三层熔断阈值，默认即 §4 真值（$5/$3/$50/$200/×1.2）|
| `RETENTION_REAPER_ENABLED` | **true** | evidence_artifacts 留存清理器（删 `expires_at<=now AND retention_policy!='manual_hold'`；留存 `LEDGER_RETENTION_DAYS` 默认 60d）|
| `LEDGER_DB_WRITE_ENABLED` | **true** | 终态把 in-memory ledger 镜像进 evidence_artifacts/claims/links |
| `TEMPLATE_FILL_ENABLED` | **true** | #1 模板填充管线 |
| `ASHARE_QA_ENABLED` | **true** | A 股即时问答 lane（接地事实卡 + 合规闸）|
| `ASHARE_INTENT_JUDGE_ENABLED` | **true** | A 股意图判官（temp0 judge 双层：买卖/预测两红线）|
| `VIDEO_CREATION_ENABLED` | **true** | 视频创作三类型（普通/宠物/IP）页内闭环 |

**Migration：最新 `0037`**（`0037_phase1_crystallization_provenance` = operation_paths +source_task_id/metadata_json、operation_path_steps +frame_path；`0036`=task_action_captures；`0035`=video self-use consent）。
机制：`pnpm db:migrate:numbered`（`scripts/apply-numbered-migrations.ts`）**无 `__drizzle_migrations` 追踪表 → 每次重跑全部 `00NN_*.sql`**；`SKIPPABLE_ERROR_CODES`(ER_DUP_FIELDNAME/ER_DUP_KEYNAME/ER_FK_DUP_NAME + `/already exists/`) 跳已建。所以 `applied=N` 里 N>本次新增语句数 = benign（老 migration 重跑计入幂等 DDL）；**真相以「只读验表」为准，不看 count**。`db:generate` 会重emit 全量 schema = 错工具，迁移一律手写编号 SQL。expand-first：schema 先 apply+验表，后部署用它的码。

**Pack A 数据现状**（结晶产物）：`operation_paths=7` / `operation_path_steps=17` / `sites=5`（example.com、holaday.ai、figma.com、ctrip.com + **veto-fixture.local（夹具验收测试行，可清）**）/ `site_capabilities=4` / `exploration_runs=2`（**均为护栏夹具两次跑写的 halted_sensitive 测试行，可清**；doc-first/真 browse 尚无）/ `task_action_captures=22`。

---

## §2 角色与铁律（新 session 必先懂）

**三层协作**：
- **Claude（对话层）**：审 diff、出 spec/决策、连 Chrome 做真机验收、汇总。是唯一看完整上下文的层。
- **CC（执行器）**：纯落码/部署/查库，经 `message_compose` 中转，不自作主张。
- **BOSS**：唯一授权人。所有 GO/烧钱/上线由 BOSS 拍。

**铁律（闸）**：
1. **审 diff 才 GO**：commit local → 贴 diff → 对话层/BOSS 审 → 技术 GO → 才 push/deploy。不擅自 push。
2. **真机验证**：UX/行为改动从用户视角验，不只"码能跑"。
3. **不烧钱**：fal/Qwen/任何外部付费调用**逐项单独授权**；纯 DB 读 + 模板拼不算。
4. **preflight 非 SAFE 硬停**：`scripts/deploy-*.sh` 部署前 `deploy-preflight.sh` 实读 live HEAD，非祖先（会丢线上 commit）→ 拒、报 BOSS、不许 reset（`ALLOW_DIVERGENT_DEPLOY=1` 才覆盖）。部署后更新 SESSION_STATUS 顶部 `PROD LIVE REF`。
5. **expand-first 迁移**：schema 改动先 apply+只读验表，后部署用它的码（drdrizzle 生成 SQL 含全列，先部署用新列的码会 500）。
6. **tripwire 停下报**：碰约定外文件/schema/热路径/不确定的必填字段 → 硬停报 BOSS，不静默扩张。
7. **commit local 待审**，不擅自 push/deploy。
8. **概括授权**（Playbook 线）：session 内**已审代码**的 push FF + deploy-orch + env-flag 翻动已获概括授权（`feedback_deploy_autonomy`）；**但烧钱仍逐项**、migration/Aliyun/destructive/开主开关跑钱仍逐项。
9. **多 session worktree 隔离**：并行 session 必各自 `git worktree`，绝不共享工作树。本工程工作树 `/Users/yaleiqi/holaday-merge`。
10. **凭证/DB 明文不进对话/文档**；clean context 保证不了零凭据 / 要碰登录态 → 硬停报 BOSS。

---

## §3 Playbook 自学习全景（干到哪了）

闭环设计 = **B 捕获 → ① 结晶 → ②③ 复用/演化 → ④ 主动探索**（边用边学 + 主动学）。

**B 捕获四件套（全 prod 验通）**：
- **B1** 叶子表 `task_action_captures` + migration `0036`（expand-first 验表过）。
- **B2** supercar 每动作多信号捕获（visible_text 主锚 / selector / coordinate）→ 三层 seam（执行器 `captureTargetDescriptor` 400ms guard / agent-loop emit + 脱敏 / tasks.ts fire-and-forget）。运行 `635257a4`，`ACTION_CAPTURE=true`。
- **B3** 穿 frame 捕获：顶层 elementFromPoint 命中 iframe → contentFrame + boundingBox 算偏移 → frame 内文本锚 + frame_path（跨域 example.com 夹具实证）。
- **B4** 截图锚：关键步 post-action 截图 → R2 + evidence_artifacts(`manual_hold` 躲 reaper) + 回填 `screenshot_anchor_id`（PK-keyed，retry-safe）；选择性 click+turnChanged，每任务上限 8。canary 验通（anchor=82 实证）。

**① 被动结晶 v1（闭环达成）**：`scripts/crystallize-paths.ts`（默认 dry-run，`--commit` 真写；离线，不碰热路径）。单成功 task 轨迹 → 一条 draft `operation_path` + steps，挂 site + 占位 capability(`general_browse`)。幂等 by `source_task_id`；version 次序递增（uk_capability_version 不撞）；多域挂入口域；intent 原文存 metadata_json（v2 聚类料）；B3 frame + B4 anchor 载入。**首次真写：Pack A 0→7 draft path/17 steps/2→4 sites**（commit `354578a3`）。**聚类推 v2**（攒够真实多样同类轨迹，现 corpus 全是测试 task）。

**supercar 记账（预算闸地基）**：`supercar/agent-loop.ts` 自建 Anthropic client，此前不写 `llm_calls`（浏览任务 $0）→ 已补：每 turn 成功后 fire-and-forget 写 `llm_calls`（`purpose='supercar.turn'`，复用 estimateCostUsd），orch `020dff5d` 上线验通。**实测单浏览任务**（3 turn，example.com）= **$0.0635**（cache-aware，缓存折扣使多 turn 亚线性）。

**④ 主动探索**：
- **doc-first（首次真跑验通）**：Firecrawl 抓站首页文档 → upsert 全局 site + draft `explored_doc` capability。figma.com + ctrip.com 各 completed，**总 $0.02**（估价 $0.01/scrape），链路 Firecrawl→upsert→costUsd→熔断端到端通（batch `calib-2026-06-23`）。
- **browse-试用 live-veto（在途，详 §7）**：免登录 live 浏览 + Sensitive Protocol 接成 pre-action 硬拦。骨架 + clean-context 落码 local（`51b43080`/`85f1d273`），**未 push/未跑**。
- **②复用 / ③演化（draft→canary→verified）**：排后，未起。Pack C 状态机 + `canary_results` 表 schema 已就位。

---

## §4 ④ 探索烧钱授权章节（A–E + 预算逻辑 v1）—— 钱的规矩，逐字留存

> **【④主动探索烧钱授权章节 v1】（BOSS 已逐条拍）**
>
> **A. 总闸 + 预算逻辑 v1**：④是首个自动烧钱能力，explorer 代码跑前此章节须经 BOSS 确认生效；主开关 `EXPLORER_ENABLED` 默认 OFF。**预算闸 = 三层熔断 + 不掐跑通 + 标定先行**（拦异常烧钱，不掐正常 $0.5-2 跑通；数字是占位常量 env/config，标定后校准，逻辑定死）：
> - **① 种子站（阶段一）**：不设跑通上限；**单站熔断 $5**（烧到此还没跑通=异常→停该站+标记+报 BOSS，正常远不到）；**单批熔断 = 站数×$5×1.2**（余量）；**标定先行**——首批跑 1-3 标定站拿实测，据实把 $5 校准。
> - **② 陌生站（阶段二，用户触发）**：阈值 10 不同用户；**单站熔断 $3**（比种子紧）；进队列等 BOSS 批准。
> - **③ 全局总闸**：**月度硬上限 $200**（到顶一切探索停+报）；**单日硬熔断 $50**（到顶当日全停+报）。
> - **记账**：每笔走 `supercar.turn` 记账，跑批实时累计读 `llm_calls`，达单站熔断停该站、达单批/单日/月度熔断停整批；`exploration_runs` 记录；finance 可见。
>
> **B. 阶段一种子站**：BOSS 挑站列表；分批跑，每批跑前 BOSS 点确认（绝不一口气全量）；每批跑完报（几站/烧多少/几条 path）再下一批。
>
> **C. 阶段二热度触发**：用户用到的未学站累积到 10 个不同用户 → 进探索队列、等 BOSS 批准才跑（初期不自动）；受总预算+熔断管。
>
> **D. 动作边界（写死）**：explorer 只跑只读/浏览类（导航/点击/读取）；绝不自动下单/提交表单/填交数据/登录认证/支付/任何副作用敏感操作；遇反爬/失败记录跳过、不重试烧钱。
>
> **E. 产物**：探索轨迹走现有捕获→结晶链落 draft path（不直接 verified；升 verified 走 ③canary）；全程 log、每笔花费可追溯。

**成本标定基准**（只读估 + 实测）：浏览类单任务 简单 $0.04-0.10 / 典型 $0.10-0.25 / 深度(15-29turn) $0.35-0.60；深跑一站≈3-5 任务 ≈ 中心 $0.5-0.8。doc-first 实测 $0.01/scrape。$5 单站熔断是「异常」线，正常远不到；**$5 校准需 browse-试用 多 turn 真跑**（doc-first 撞不到）。

---

## §5 关键架构决定与教训（每条一句 + 位置）

- **`applied=N` tripwire**：apply-numbered 无 tracking 表、每次重跑全部 migration → applied 计数 > 本次新增（benign 幂等重跑）；真相看验表，别凭 count。（`scripts/apply-numbered-migrations.ts`）
- **`__name` (esbuild keepNames)**：prod 跑 tsx，esbuild keepNames 把 `page.evaluate` 回调里嵌套命名/箭头函数包成 `__name(fn,…)` → 序列化进浏览器抛 `ReferenceError`；**修=in-page 逻辑写字符串 IIFE**（transpiler 不碰字符串）。(`playwright-executor.ts:captureTargetDescriptor`)
- **回填竞态 (PK-keyed)**：B4 `screenshot_anchor_id` 回填用 `(task_id,action_index)` 非唯一 + auto-retry 重复行 → 锚到陈旧行；**修=回填 `WHERE eq(id, capture.id)`**（PK，retry-safe）。
- **clean context 密闭保证 (§9.6)**：browse-试用 必跑全新 `browser.newContext()`（无 storageState）+ 私有 `browseContext()` helper 把 getPage/resetPageForTask/reopenActivePage 全路由到 clean ctx、**clean 模式绝不碰共享 `contexts()[0]`** + `assertCleanContext()` fail-closed 全局零-cookie 断言；与用户会话/凭据隔离。没凭据 → 即使 veto 漏点也登/付不成。(`playwright-executor.ts`)
- **decompose-click BLOCKER**：`vetoActionKind` 原对 `left_mouse_down/up`、`left_click_drag` 返 null → 模型拆点击/拖滑块绕过 veto；**修=fail-closed**（除明确读类，一切含未知动作 → 'click' 走 veto）。(`agent-loop.ts`，对抗审发现)
- **混合 CN/EN/URL 提交须 JS 注入**：表单/输入框直接 `type` 会被 IME/受控组件搞乱 → 用 native value setter + 派发 `input`/`change` event 注入提交（非逐字 type）。
- **`manual_hold` 避 reaper**：B4 锚 evidence_artifacts `retention_policy='manual_hold'` → retention reaper 永不扫（reaper 只删 `!='manual_hold'` 的过期行）。
- **pm2 `--update-env` 只合并不删 key + OS-env 影子**：翻 flag OFF 必显式 `=false`（删 .env 行无效，pm2 留旧值）。**更深一层（2026-06-23 实测）**：orch 的 dotenv **不 override** 已存在的 OS env；pm2 进程 OS-env 一旦缓存过某 flag 旧值，`--update-env`（合并 shell env，shell 没 export 该 flag）+ 编辑 .env **都不生效**（route 仍按旧值）→ **可靠翻法 = 内联 export**：`FLAG=true pm2 restart --update-env`（同理关回 `FLAG=false ...`）。真值看 `/proc/PID/environ` + 行为（route 200/404），别只看 .env。
- **veto 须多信号 OR（`visibleText ?? ariaLabel` 短路敏感 aria/title）**：④ veto label 解析原取首个非空 → emoji/glyph 的 visibleText（💳）**短路掉**敏感 aria-label/title → icon-only「立即支付」按钮漏拦（红队夹具真机实证，真 agent-loop 真漏 = money-gate BLOCKER）。**修=`classifyExplorerAction` 多信号 fail-safe OR**（visibleText/aria-label/title/placeholder/name 任一敏感即拦）+ **type=password 一律拦**（D 边界，关上轮 pwd-type 残留）；`captureTargetDescriptor` 加 `title`/`placeholder`（**内存 veto-path-only，B2 capture 不变、无 migration**）。(`dcbb4783`；veto-path-only，钩子缺失时用户任务字节级不变)
- **expand-first**：schema migration apply + 只读验表 → 才部署用新列的码（见 §2 铁律 5）。
- **deploy-preflight 拦 reset**：实读 live HEAD，非祖先拒（避免 reset 丢线上 commit）。

---

## §6 Backlog

**Playbook/explorer 小尾巴**：
- 🔴 `playwright-executor.ts` `connect()` 横幅消除 `evaluate` 传**函数**（同 `__name` 隐患，B 收尾改字符串形）。
- B3 验收夹具路由（`/test/iframe-fixture`）+ ④ veto 夹具路由（`/test/explorer-veto-fixture`）= 验完删（B/④ 阶段统一清）。
- B4 选择性盲区：iframe 内点击 turnChanged=false（导航视觉滞后）→ 不锚；顶层点击锚。记 backlog。
- 站点可达性折扣：高频域名（如 eastmoney）对执行器反爬、挡在加载阶段 → 复用/探索的"站点可达性"要打折。
- 🟡 **CDP 端点**：`CDP_ENDPOINT=9222` 当前 **dead**（进程有 flag 但不 listen）；live 浏览器是 `HEADED_CDP_ENDPOINT=9223`（Brave，夹具验收用的就是它）→ explorer 真跑前确认 explorer 用哪个端点 + 9222 要不要修活。
- **$5 单站熔断校准**：需 browse-试用 多 turn 真跑（doc-first $0.01 撞不到）。
- `exploration_runs` browse 已补（`withExplorationRun`，本地 `85f1d273`）；doc-first 仍未写（v1.1）。
- ~~icon-only 无 aria 的敏感按钮 label 解析不到~~ **更正（已修 `dcbb4783`）**：原描述低估——不是「无 aria」，是「**有敏感 aria/title，但 visibleText(emoji glyph 💳) 短路**」→ 红队夹具抓到、多信号 OR 已修（向量 2 真机转 PASS，pwd-type 残留亦关）。`assertCleanContext` 只查 cookie 非 localStorage（fresh newContext 本就空，保留）。
- harness `explorer-veto-acceptance.ts` finally cleanup 曾因 CDP socket 滞留挂起被 timeout-124 杀（断言已全跑完，结果有效）→ 已加 8s bounded race + `process.exit`（`dcbb4783`，重跑 exit 0 验证）。
- veto 夹具真跑在 prod DB 留了测试行（`sites` veto-fixture.local ×1 + `exploration_runs` halted_sensitive ×2，两次跑各一）→ 可选清理（数据卫生，无害）。

**视频线 6 尾巴**：成片留存终态 / 过期提示 UX / bundle 版本检测 / A1 文案待白捡验 / 30d 实戳待白捡验 / fal 700s 上限观察。

**视频 GA 三 🔴（硬阻）**：
- **IP 合规闸未建**——《深度合成管理规定》硬线；最低线 = 自有肖像 + AI 标识 + 可追溯。
- **全屏误关浏览器**——疑核心 screencast 面板通病。
- **latentsync 太慢**（~12-14× 实时）——BOSS 产品决策未定。

---

## §7 下一步（断点精确）

**近场 — browse-试用 v1 护栏夹具真机验收 ✅ 已通（2026-06-23）**：
- 状态：live-veto 钩子 + clean-context + runBrowseTask + exploration_runs + 红队夹具全已 **push + dark deploy（orch `dcbb478`，EXPLORER_ENABLED 仍 OFF）**。三轮 6 镜头对抗审 + **真机红队夹具验收 8/8 PASS**（clean-context cookies=0 / 四向量真拦 / 安全链接放行 / executor.click spy 敏感=0安全=1 / exploration_runs 写入）。
- **veto BLOCKER 已闭环**：夹具首跑抓到 icon-only emoji-短路-敏感-aria（真漏）→ 多信号 fail-safe OR 修复（`dcbb4783`）→ 重跑向量 2 转 PASS、pwd-type 转拦。见 §5。
- **clean context = §9.6 硬前置**（已实现 + 真机实证：newContext-over-CDP 在 box live Brave 上 cookies=0）。
- **下一步 = 真开 `EXPLORER_ENABLED` 跑标定站（首个真烧钱，逐项授权）**：护栏已验通 → 可单独谈真开 `EXPLORER_ENABLED` 跑 figma/ctrip browse（clean context、§4 三层熔断、校准单站 $5）。**这是新的授权点：要 BOSS 逐项 GO（真烧钱）+ 跑完立即归零 EXPLORER_ENABLED**。在此之前 explorer 仍绝不真做 live browse。
- ⚠️ ops 前置（§6）：`CDP_ENDPOINT=9222` 当前 dead，live 浏览器是 `HEADED_CDP_ENDPOINT=9223`（Brave）→ explorer 真跑前需确认 explorer 用哪个端点（夹具验收用的 9223）。

**中场 — 专属账号 + Credential Vault 阶段**：护栏验通后才配钥匙进"登录后世界"（veto 要求更高）；可并行让人去注册专属账号（v1 绝不碰登录态/凭据）。

**排后**：② 复用（draft path 喂回浏览 lane 当先验）、③ 演化（draft→canary→verified 状态机，Pack C）。

**产品 GTM 悬决**：A 股 vs 视频 谁先 GA。Claude 倾向 **A 股先**（合规闸已上、无视频三 🔴 硬阻）；待 BOSS 拍。

---

*互链：`docs/daily/SESSION_STATUS.md`（运行态权威+逐条实证）、`docs/PLAYBOOK_PHASE4_EXPLORER_DESIGN.md`（④ 设计含 §9 browse-试用 + §9.6 clean-context）、memory `HANDOFF_reaper_p0.md`（跨 session 接力锚）。*
