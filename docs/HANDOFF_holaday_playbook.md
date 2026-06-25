# HOLA DAY — Playbook 自学习大工程 交接文档

> 跨多 session 的正式交接。**接手新 session 先读这份 + `docs/daily/SESSION_STATUS.md` 顶部 `PROD LIVE REF` 行**（频繁变，那行是权威运行态）。本文档侧重"全景 + 铁律 + 断点"，SESSION_STATUS 侧重"最近一次部署的逐条实证"。两者互链。
> 维护：每次部署后更新 §1（基线）；每完成一个能力更新 §3/§7。密钥/凭证从不进本文档。

最后更新：2026-06-23。

---

## §1 当前 PROD 基线（接手第一眼）

| 项 | 值 |
|---|---|
| **运行 orch（PROD LIVE REF）** | `f1b6fe6`（🏁🏁 **登录自学从机制到交易站真出货 + 四层 veto 防线**：两条真 post-login path（todoist add-task 5 步 + **trip.com 订票流 13 步**，停在付款红线前）；含 A 登录 4 接点 + 预订站 veto 加固(Layer A 词+Layer B 结构+交易页反转) + **Layer C 模型兜底**(haiku、触发收窄只扫真表单字段、fail-closed、≤15/run) + B1 接结晶，全 dark ship；restart 723）。**B1 LIVE**（`USER_TASK_CRYSTALLIZE_ENABLED=true`）；`EXPLORER_ENABLED`/`LOGIN_EXPLORER_ENABLED`/`LAYER_C_MODEL_VETO_ENABLED` 仍 OFF。**三站 storageState 就位**（figma+todoist+trip、box 独立 600）。详 §7 |
| **分支** | `claude/musing-keller-ae1d05`（prod 合并主干）|
| **origin tip = 本地 HEAD** | `69ab05e4`（已 push；A 登录自学+B1 `053f29b5` → harness 修 `ea2b6d1` → docs `69ab05e4`）|
| **SPA** | `8da47b4b`（bundle `index-DiYh_GAx.js`，本工程期间未变）|
| **edge** | holaday.ai → Vultr 直连（无 CF 层）；orch+SPA 同机 207.148.70.106，PM2+Nginx（剥 `/api/`）|

**Flag 终态**（Vultr `apps/orchestrator/.env`，进程实证）：

| flag | 态 | 作用 |
|---|---|---|
| `ACTION_CAPTURE_ENABLED` | **true** | B2 每动作多信号捕获 → `task_action_captures`（结晶料源）|
| `B4_SCREENSHOT_ANCHOR_ENABLED` | **true** | B4 关键步截图锚 → R2 + evidence_artifacts(manual_hold) + 回填 capture |
| `B3_FIXTURE_ENABLED` | **false** | B3 跨域 iframe 验收夹具（验完关；路由码留待 B 阶段清）|
| `EXPLORER_ENABLED` | **缺失 = OFF** | ④ explorer（免登录）主开关 = 自动烧钱总闸；**未设 = explorer 绝不跑** |
| `LOGIN_EXPLORER_ENABLED` | **缺失 = OFF** | **A 登录自学主开关**（正交 EXPLORER_ENABLED、绝不随其自动开）；fail-closed 缺 `LOGIN_EXPLORER_STORAGE_STATE`（测试号 session 文件）即 abort。真跑需 BOSS 出 storageState |
| `USER_TASK_CRYSTALLIZE_ENABLED` | **true（2026-06-25 翻，B1 LIVE）** | **B1 接结晶**：index.ts 6h gated cron → `crystallizeTasks(dryRun:false)` 结晶 completed 任务（user+explorer、无 origin 过滤）→ draft operation_paths。**write-only sink、没人读回（B2/B3 未建）→ 零 live 影响**；幂等 by source_task_id |
| `EXPLORER_VETO_FIXTURE_ENABLED` | **=false（验收后关回，进程+.env 实证、路由 404）** | browse-试用 护栏红队夹具（含 A4 登录态向量 分享/转账/删除+伪登录横幅）；翻 true 跑 acceptance（**11/11 PASS** 2026-06-25）后关回 dark |
| `EXPLORER_BREAKER_*` | **缺失 = 用默认** | 三层熔断阈值，默认即 §4 真值（$5/$3/$50/$200/×1.2）|
| `RETENTION_REAPER_ENABLED` | **true** | evidence_artifacts 留存清理器（删 `expires_at<=now AND retention_policy!='manual_hold'`；留存 `LEDGER_RETENTION_DAYS` 默认 60d）|
| `LEDGER_DB_WRITE_ENABLED` | **true** | 终态把 in-memory ledger 镜像进 evidence_artifacts/claims/links |
| `TEMPLATE_FILL_ENABLED` | **true** | #1 模板填充管线 |
| `ASHARE_QA_ENABLED` | **true** | A 股即时问答 lane（接地事实卡 + 合规闸）|
| `ASHARE_INTENT_JUDGE_ENABLED` | **true** | A 股意图判官（temp0 judge 双层：买卖/预测两红线）|
| `VIDEO_CREATION_ENABLED` | **true** | 视频创作三类型（普通/宠物/IP）页内闭环 |

**Migration：最新 `0037`**（`0037_phase1_crystallization_provenance` = operation_paths +source_task_id/metadata_json、operation_path_steps +frame_path；`0036`=task_action_captures；`0035`=video self-use consent）。
机制：`pnpm db:migrate:numbered`（`scripts/apply-numbered-migrations.ts`）**无 `__drizzle_migrations` 追踪表 → 每次重跑全部 `00NN_*.sql`**；`SKIPPABLE_ERROR_CODES`(ER_DUP_FIELDNAME/ER_DUP_KEYNAME/ER_FK_DUP_NAME + `/already exists/`) 跳已建。所以 `applied=N` 里 N>本次新增语句数 = benign（老 migration 重跑计入幂等 DDL）；**真相以「只读验表」为准，不看 count**。`db:generate` 会重emit 全量 schema = 错工具，迁移一律手写编号 SQL。expand-first：schema 先 apply+验表，后部署用它的码。

**Pack A 数据现状**（结晶产物，2026-06-25 B1 翻开后）：`operation_paths=11`（**by source origin：user=8 / explorer=3**；user 含 `tsk_2GMnW`→`opath_NY2…` draft v6 实证、example.com/iframe-fixt 测试夹具任务 caps2-4）/ `site_capabilities`+`operation_path_steps` 随之 / `sites`（example.com、holaday.ai、figma.com、ctrip.com + veto-fixture.local 夹具行）/ `exploration_runs`（含免登录四类真跑：ctrip/figma/todoist/douyin halted/completed/failed + 断点 summary）/ `task_action_captures`（user+explorer 轨迹）。**注**：当前 user 语料仍是测试/QA 夹具（非真实 post-login 路径）；B1 cron 6h 自动蒸新 completed（真价值待真实用户授权任务沉淀）。

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
- **熔断必 fail-closed（cost-source A）**：花钱控制器的成本输入只能 fail-CLOSED。DB 回读（写 llm_calls→读回）fail-OPEN——user 缺/行未写/写失败 → 读到 $0 → 续烧。故 ④ browse 熔断读**进程内累加**（`CostAccumulatingRecorder`，每 turn `+=` 在 await 前同步落账，连 loop 的 fire-and-forget `void record()` 也落）；llm_calls DB 写降 best-effort（finance 明细，失败不动熔断）。配套两闸：① `requireBrowseEnv` 缺 `EXPLORER_USER_EXTERNAL_ID`（recorder 触发门，缺则 record 不 fire→累加 $0→瞎）或 `HEADED_CDP_ENDPOINT` → **spend 前 abort**（4 例测）；② `runExplorerBatch` 非有限/负成本 → **fail-closed halt 整批**（判不准不当 $0 续；有限 0 合法不 trip）。(`explorer.ts`/`explorer-browse-runner.ts`/`cost-accumulating-recorder.ts`)
- **CLI 入口构造段 TDZ**：`explore-sites.ts --browse` wiring 在 `const logger` 声明**之前**引用它 → 运行时 `Cannot access 'logger' before initialization`，batch-1 首跑崩在 setup（**零烧钱**，崩在 runExplorerBatch/connect/LLM 前）。tsc 被 deferred-closure 引用掩、CLI 脚本无单测 → 双双漏过；**防静默 cost-check（cost>0 + exploration_runs 行）抓住**。修=声明提到 lane branch 前。(`572e4227`)
- **真跑前 zero-burn dry-run smoke = 常驻闸**：`--browse`（**无 `--run`、无 `EXPLORER_ENABLED`**）会执行 if(browse) wiring 构造但 runExplorerBatch 不真跑 → 零 connect/零 LLM/零烧钱，**专抓 tsc + 静态审漏的 init/TDZ bug**。每次改 explorer 入口、真烧钱前先跑它。
- **explorer 是 CLI-only —— `EXPLORER_ENABLED` 不是 orch 常驻 flag**：`runExplorerBatch` LOCK1 在**跑 CLI 的进程**里读 `process.env.EXPLORER_ENABLED`；enable=**内联在 CLI 调用**（`EXPLORER_ENABLED=true pnpm tsx scripts/explore-sites.ts …`），**orch 全程真 dark、从不碰**；CLI 一次性退出 → 内联开关随之死 = **归零自动**（无须翻/验 orch flag）。⚠️ 早期文档写的"翻 orch EXPLORER_ENABLED 来 enable / 跑完归零 orch flag"**是错的**，按本条。
- **运行拓扑 ground-truth**：CLI 跑在 **box（Vultr 新加坡）**——直连 Anthropic（实测 401/0.46s）+ figma，**无 GFW、无须代理**；Astrill 代理（`127.0.0.1:3213`）**只在 BOSS 的 Mac 上、给 git push 绕 GFW 用，box 上不存在**（`HTTPS_PROXY=127.0.0.1:3213` 放 box 会指向空、断掉 Anthropic）。**真跑命令里任何网络/proxy/env 假设，先在 box 上核拓扑（CC 实测）再定，别照搬 Mac 侧。**
- **explorer 真跑 env 铁律（别向运行命令注入环境假设，交给 .env/box 权威值）**——三次实战踩坑：① `EXPLORER_ENABLED` 在**跑 CLI 的进程**里读、不是 orch 常驻 flag（enable=内联 CLI env、orch 永 dark）；② box **直连无需 proxy**（Astrill 只 Mac git push 用、box 上没有）；③ `HEADED_CDP_ENDPOINT` **要完整 URL**（`http://127.0.0.1:9223`，.env 已供）——**内联只传端口 `9223` → `connectOverCDP` Invalid URL**（figma-rerun 首试因此 $0 失败；修=别内联、让 .env 供完整值）。**dry-run smoke 已知边界**：它**不真 connect**（runExplorerBatch 不真跑）→ 只验构造（TDZ/import），**抓不到 connect-arg 错**；connect 类问题只在真跑首次 connect 暴露。

---

## §6 Backlog

**Playbook/explorer 小尾巴**：
- 🔴 `playwright-executor.ts` `connect()` 横幅消除 `evaluate` 传**函数**（同 `__name` 隐患，B 收尾改字符串形）。
- B3 验收夹具路由（`/test/iframe-fixture`）+ ④ veto 夹具路由（`/test/explorer-veto-fixture`）= 验完删（B/④ 阶段统一清）。
- B4 选择性盲区：iframe 内点击 turnChanged=false（导航视觉滞后）→ 不锚；顶层点击锚。记 backlog。
- 站点可达性折扣：高频域名（如 eastmoney）对执行器反爬、挡在加载阶段 → 复用/探索的"站点可达性"要打折。
- 🟡 **CDP 端点（已解析）**：explorer `--browse` 用 `HEADED_CDP_ENDPOINT=9223`（Brave，live；`requireBrowseEnv` 缺它即 abort）。`CDP_ENDPOINT=9222` 仍 **dead**（进程有 flag 但不 listen）——非 explorer 用，是 index.ts Lane1 的；要不要修活是独立 ops 项。
- **$5 单站熔断校准**：需 browse-试用 多 turn 真跑（doc-first $0.01 撞不到）。
- `exploration_runs` browse 已接（`--browse` 经 `withExplorationRun` 每 browse 写一行，含准的内存 cost）；doc-first 仍未写（v1.1）。
- 🔵 **(b) backlog（hardening）**：让 accumulator 直接 tap 每-turn usage、绕开 `userExternalId` gate——则熔断永不依赖某 env var 设没设。当前 `requireBrowseEnv` 缺-id abort 已封洞（缺则不跑），不急；**仅在能纯 additive、不碰用户任务热路径时才做**。
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

**🏁🏁🏁 里程碑（2026-06-26）— 登录自学从机制到交易站真出货 + 四层 veto 防线全证通**：
- **两条真 post-login path**：todoist add-task 5 步 + **trip.com 订票流 13 步**（Flights→Tokyo→Singapore→Search 63航班→Select 去/回程 Scoot $439→View Details→Continue→进订票主表单 Step 1/4 Fill in your info→认出付款红线→停、done）。交易站 trip 全程**零真交易**（未付款/未下单/未填证件，空壳号）。都会被 B1 cron 自动结晶。
- **四层 veto 防线（真 SPA 交易站闭合）**：① 空壳测试号地基 ② Layer A 关键词(EXTRA_RE,login-mode) ③ Layer B 结构信号(提交型控件+交易文案) & 交易页反转(pageUrl 阶段 default-deny) ④ Layer C 模型兜底(haiku、A/B/反转都过+交易可疑区才触发、fail-closed/限额≤15/触发收窄只扫真表单字段)。**SPA URL 不变→反转弱 → 词层+Layer C 主力**。trip Layer C 实跑 3 调用 $0.00139。
- **veto 四次在测试号调准（测试号兜底是命门）**：Copy link 漏拦→补 / 「清空您的大脑」误拦→收 / 字面审控出收紧过头漏「清空收件箱」→补 / Layer C pageTxSignal 过宽(扫页脚 prose)→收窄只扫真表单字段。**关键词/信号 veto 两方向都 fiddly、字面审+测试号实跑是命门**。
- **变更链**：`89690206`(veto A+B+反转) → `f4404738`(Layer C) → `f1b6fe65`(pageTxSignal 收窄)。
- **backlog**：① Continue 收严（trip "Continue" 进订票表单被 Layer C 判 ALLOW，agent 进了表单停付款前；更保守可调）② 扩更多交易站/任务验泛化 ③ B2 影子转灰度→等 B1 攒语料 ④ ⚠️ 监控纪律：detached 真跑必启 poll bg（本会话漏启→误判 1 小时 hang，实为 ~10min completed）。

---

**🏁🏁 里程碑（2026-06-25 晚）— A 登录自学闭环端到端证通 + 第一条真实 post-login path**：
- **闭环链**：登录认证（login-ctx + storageState）→ 真执行（todoist add-task：点「添加任务」→ 输入「买牛奶」→ 回车提交、任务计数 1）→ **红线前自停**（看到「删除」、停在点击前、宣告 done）→ **completed** → 结晶**第一条 post-login path**（`tsk_5bFtqQ…` draft v1 app.todoist.com、5 步）。todoist id=18 `completed` / `$0.1770` / ~2min / 5 captures 全 benign / 未越红线 / 会话隔离 / 自动归零。B1 cron 会自动结晶它（或 `--commit`）。
- **站点选型是命门**：figma×3 fail（重画布、agent 操作不了、在 Got it/Settings/Security 打转）vs todoist×2 success（表单站「加一条任务」走得通）→ **表单型 SaaS = 登录梯队正确首站类型**。
- **走通四要素**：指令式单任务 intent（去「任选其一」扩展子句）+ 禁逆向 + 软超时 600s（②b：原 300s 软超时是绑定约束、漏改）+ 清空误报修。
- **veto 双向偏差都在测试号逆出修好**（测试号先行的价值）：false-neg figma「Copy link」漏拦→补复制/分享链接变体；false-pos todoist「清空您的大脑」误拦→裸词收紧成组合，字面审又控出收紧过头漏「清空收件箱」→补回。**启示：关键词正则 veto 两向都偏、fiddly → 测试号兜底是命门，预订/交易站前 veto 要大幅加固或换更稳判法。**
- **三关口**：① figma 首跑→**已完（todoist 走通、闭环证通）** ② B2 影子转灰度→等 B1 攒语料 ③ 登录梯队：figma（画布、搁置）→**todoist ✓**→交易/社交（trip.com 按住、等 veto 为预订加固）。
- **下一步候选（BOSS 定）**：commit 这条 path / 扩 todoist 更多任务（新建项目、设提醒）/ 下一个表单站（notion?）/ 收尾归档。

---

**🏁 会话末态（2026-06-25）— 免登录验透 + A 登录预热 dark + B1 LIVE**：
- **免登录 explorer 四类验透**：ctrip/figma/todoist/douyin 全跑过、全终止路径（done/maxIter/软超时/硬 abort/veto-halt/connect-fail）出**非空断点证据**。**核心实证：免登录全停在登录墙、够不到 post-login 真实操作路径**（ctrip/douyin 都 veto 拦在登录控件、figma/todoist 跑公开页）。途中修了 connect-超时/重试（figma site-to-site 起来）+ Bug A(summary 转发)+Bug B(unhandledRejection 守卫)+始终断点 summary。
- **A 登录预热 dark + 硬闸 11/11**：四接点（`LOGIN_EXPLORER_ENABLED` 独立锁 / login-ctx storageState 三隔离 / `SENSITIVE_LABEL_EXTRA_RE` veto 加厚 / fixture 登录态向量）上线 dark。真-DOM acceptance **11/11 PASS**（向量7：同控件免登录放行/登录态拦、spy=1）。**凭据模型**：agent 继承 BOSS 手建测试号 storageState、不登录不碰凭据。**待 BOSS 专属机就绪导出 storageState → figma 登录预热首跑**（翻 `LOGIN_EXPLORER_ENABLED=true` + `LOGIN_EXPLORER_STORAGE_STATE` 指文件）。
- **B1 接结晶 LIVE**：`USER_TASK_CRYSTALLIZE_ENABLED=true`，6h cron 结晶 completed 任务→draft operation_paths（write-only、零 live、幂等）。实证 user 轨迹 `tsk_2GMnW`→`opath_NY2…` draft v6。当前 user 语料=测试夹具，真价值待真实用户授权任务沉淀。
- **B2/B3 复用回灌**：设计就绪（影子模式先行/质量闸/灰度真喂），**未建**——是**全工程唯一真碰 live 用户路径**的一步，等 B1 攒真实语料后实现。
- **战略（登录线）**：免登录够不到 post-login → 两条互补 = **A 登录预热**（赶在真实用户前预热站点 post-login、保首次时效+成功率）+ **B 产品 lane 闭环**（真实流量持续学）。
- **安全线（钉死）**：登录自学**只用测试小号**（无真实数据/不绑支付）+ 专属机 + veto 加厚三层、**绝不碰真实用户凭据**。梯队 figma(首)→SaaS→交易/社交加厚。
- **三个待 BOSS 关口**：① 专属机就绪→figma 登录预热首跑 ② B1 攒够真实语料→B2 影子转灰度真喂 ③ 登录梯队放行（SaaS→交易/社交）。
- **设计文档（BOSS 手上）**：login_explorer_design_risk_v2 / A_login_explorer_impl_design_v1 / AB_design_v1 / B2B3_shadow_design_v1。

---

**近场 — browse lane wired + dark ✅，护栏夹具 8/8 PASS（2026-06-24）**：
- 状态：live-veto 钩子 + clean-context + runBrowseTask + exploration_runs + 红队夹具 + veto 多信号 OR 修复 + **browse lane 接进 `explore-sites.ts --browse`** 全已 **push + dark deploy（orch `6f96bed`，两 explorer flag OFF）**。**真机红队夹具验收 8/8 PASS**（cookies=0 / 四向量真拦 / 安全链接放行 / executor.click spy 敏感=0安全=1 / exploration_runs 写）。veto BLOCKER 闭环（见 §5）。
- **batch-1 prep 加固 commit local 待审（未部署）**：(a) 非有限成本 fail-closed halt + (c) `EXPLORER_MAX_ITERATIONS` env 可配（默认 25/上限 50，fail-safe+clamp）；(b) accumulator 解耦留 backlog（§6）。审过 dark 部署。
- **✅ batch-1 figma 真跑落地（首个 ④ 自主探索真烧钱，2026-06-24）**：`$0.4275`（三方一致 accumulator=exploration_runs id=3=llm_calls 25turn 求和 → cost-source A 端到端验）；**零 veto 命中**（figma.com/pricing/design 全公开页、无敏感动作可拦，clean-context 零凭据）；**未 halt**（跑满 `maxIterations=25`、status=failed=未完成、$5 熔断未触）；**归零自动**（CLI 退出、orch 全程 dark 没碰、clean-context disposed）。跑法=CLI 内联 `EXPLORER_ENABLED=true EXPLORER_USER_EXTERNAL_ID=<id>`（box 直连、无代理）。
- **校准**：`$0.017/turn` → `$5` 熔断 ≈ 290turn = 合理异常 backstop，**真正有效闸是 maxIterations**；figma 25turn 没自宣 done（模型逛营销页没收敛）→ intent 调优（已做，见下）。
- **🏁 figma-rerun = ④ 自学习闭环真站端到端验通（2026-06-24，orch `3476cac`）**：browse → **收敛完成**（status=completed、8 turn、i8 自宣 done、`$0.1427`，vs batch-1 25-maxed/failed → **intent 收敛 WORKED**）→ **捕获**（task_action_captures 22→29、origin='explorer' tasks `id=3004`/`user_id=16` 平台桶/status=completed）→ exploration_runs id=5 completed `$0.14274195` → **结晶**（crystallize dry-run：figma 抽出 `[draft v1] reuse figma.com / create general_browse / 7 steps`）。三改动全验：捕获环 / intent 收敛 / 记账归 id=16。**全程 orch dark、$0.14、零 veto（公开页）、归零自动。** 链路终点 PASS。
- **价值观察**：figma draft = **shallow 营销浏览**（Products/Solutions/Pricing、含重复点击）→ **低价值技能**。有价值技能需 **intent 转任务/能力导向**（深入读文档、搞懂"怎么用"、产出可复用操作 path）——下一阶段。crystallize v1.1 backlog：**连续相同 click 去重**（draft 更干净）。
- **下一步（逐项 GO）**：① **batch-2**（广度加站 + **ctrip 交易站 = veto 首次真考**（登录/下单/支付墙）+ 成本校准）② **intent 深化**（营销浏览 → 任务/能力导向，抽高价值 path）③ **有价值 draft 才 `--commit`** 真写 Pack A（figma 这条 shallow 的暂不 commit）。explorer 绝不自动跑（orch 永 dark、每次真跑 BOSS 逐项 GO + 内联 CLI env + 跑完退出归零）。

**中场 — 专属账号 + Credential Vault 阶段**：护栏验通后才配钥匙进"登录后世界"（veto 要求更高）；可并行让人去注册专属账号（v1 绝不碰登录态/凭据）。

**排后**：② 复用（draft path 喂回浏览 lane 当先验）、③ 演化（draft→canary→verified 状态机，Pack C）。

**产品 GTM 悬决**：A 股 vs 视频 谁先 GA。Claude 倾向 **A 股先**（合规闸已上、无视频三 🔴 硬阻）；待 BOSS 拍。

---

*互链：`docs/daily/SESSION_STATUS.md`（运行态权威+逐条实证）、`docs/PLAYBOOK_PHASE4_EXPLORER_DESIGN.md`（④ 设计含 §9 browse-试用 + §9.6 clean-context）、memory `HANDOFF_reaper_p0.md`（跨 session 接力锚）。*
