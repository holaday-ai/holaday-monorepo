# SESSION_STATUS — 多 session 协作状态板

> 目的：多个并行 Claude session（#1 模板填充 / #2 A股 / #3 Playbook+Ledger / #5 图片 …）
> 各自在独立 worktree 里干活，缺乏共享上下文。本文件是**唯一的跨 session 协调点**：
> 每个 session 到停点更新自己的小节并 push，所有人据此对齐状态、避免撞车与误传。
>
> 维护者：各 session 自己。创建者：#3（Playbook+Ledger）2026-06-12。
> **归属（BOSS 定）：本文件住共享 baseline `claude/musing-keller-ae1d05`**——三 worktree 分支最终都合回这里，协调文件理应在汇合点。各 session 更新时只对 musing-keller push 这**一个文件**（单文件无冲突风险）。

<!-- 固定维护：每次部署后由部署者更新这一行（硬规则 7）。改 ref 前必实读 live HEAD。 -->
<!-- 2026-07-04 Codex 补充：live thinking/progress/streaming/result 变化现在会更新自动滚动依赖，避免执行中内容继续增长但视口不跟随。 -->
<!-- 2026-07-04 Codex 补充：进入 awaiting_user、用户回复恢复执行、control resume、tasks.list/detail 刷新到等待态时，都会清旧 progress/stream/thinking/subStatus 等 live-only 残留。 -->
<!-- 2026-07-04 Codex 补充：历史页把 failed 与 partial_success 拆成“失败/需复核”独立筛选；视频/图片生成历史保留带真实附件的 partial_success 产物并标“需复核”。 -->
<!-- 2026-07-04 Codex 补充：前端补齐 server.user.confirm / server.batch_confirm_required，重连恢复后的单步/批量确认会显示结构化按钮并保留 stale-frame guard。 -->
<!-- 2026-07-04 Codex 补充：批量子任务保留底层 terminal 语义；partial_success 显示“需复核”，cancelled 显示“已取消”，父级批量仍汇总为 partial/未成功数量。 -->
<!-- 2026-07-04 Codex 补充：批量任务和 Admin Learning 里的 failed+partial_success 聚合文案改为“未成功/需复核或失败”，partial 批量进度改黄色，避免把需复核误读成纯失败。 -->
<!-- 2026-07-04 Codex 补充：任务详情 lazy-load fallback 不再展示“未记录/未保存/0 个”的空证据指标；只有真实拿到页面、截图或附件才显示证据行，否则标明只能作为过程线索。 -->
<!-- 2026-07-04 Codex 补充：批量父状态 partial 的页面标签从“部分失败”改为“部分未成功”，覆盖需复核/失败/取消混合场景。 -->
<!-- 2026-07-04 Codex 补充：用量页额度说明按后端真实口径改为“提交占用”，不再误写成失败不扣额度；需复核/失败/取消会保留本次提交占用。 -->
<!-- 2026-07-04 Codex 补充：用量页加载态的 outcome 占位也补齐“需复核/失败/取消/进行中”，避免加载瞬间仍显示旧的失败口径。 -->
<!-- 2026-07-04 Codex 补充：批量任务创建弹窗说明从“部分失败不会影响其他任务”改为“部分未成功不会影响其他任务”，覆盖需复核/失败/取消混合语义。 -->
<!-- 2026-07-04 Codex 补充：技能线合并上线：shared 13 技能目录、输入框 @ 技能选择、技能页新列表与 logo；旧 selected_skills ID canonical 映射保留，避免老用户已启用技能静默掉线。 -->
<!-- 2026-07-04 Codex 补充：任务创建统一 canonical skill dispatch；手动 @ 技能优先于自动角色分类，roleId/metadata/runner/model 路由记录一致；用量结果文案不再把失败和取消合并。 -->
<!-- 2026-07-07 Codex 补充：批量任务父级计数新增 items_review；partial_success 不再塞进 items_failed，列表/详情/WS/进度百分比拆成“需复核/失败/取消”，兼容旧 WS 帧不清空既有复核计数。0039 已先 apply+db:verify，再重启 orch。 -->
<!-- 2026-07-08 Codex 补充：任务清理口径从 failed 兼容别名升级为 unsuccessful；清除入口覆盖 failed + partial_success，用户菜单/Admin Learning 文案改成“未成功任务（失败或需复核）”；取消态提示复用共享 task status guard。 -->
<!-- 2026-07-09 Codex 补充：状态机双层 guard：TaskController.start 不重启 awaiting/paused/terminal 既有态；onStepResult 只接受 executing；TaskRepository.applyStepResult 只允许 executing/awaiting_user source，防 late step result 复活已停任务。 -->
<!-- 2026-07-09 Codex 补充：状态机控制边补强：control transition 拒绝 terminal source；batch approve 仅允许 awaiting_user + pendingConfirm=batch → executing；tasks.reply still_awaiting 重播保留 video_quote awaitingKind。 -->
<!-- 2026-07-09 Codex 补充：状态机 pre-execution guard：start(existing) 不再把 pending/queued 直接派发成 executing；pause 只允许 executing source；repository control transition 同步拒绝非 executing→paused 与非 paused→executing，防 queued/pending 绕过队列恢复。 -->
<!-- 2026-07-09 Codex 补充：状态机 planning bootstrap 收口：新任务 seed 显式走 state:null + taskId + plan；start(existing planning) 改为 noop，避免历史/重连 planning 被误派发；tasks.create/smoke 与集成 fixture 已统一。 -->
<!-- 2026-07-09 Codex 补充：技能 planner 闭环：planner catalogue 现在合并 DB SKILL.md rows + shared 13 用户可见技能；手动 @ 技能会注入 planner hint，避免前端选择了技能但通用 planner 不知道。 -->
## 🔴 PROD LIVE REF = `claude/musing-keller-ae1d05@278ae4cc`（2026-08-14 JST）

SPA 与 Orchestrator 已部署 `278ae4cc`（PR #50）。今日能量在后端 8 秒预算后仍需本地回退时，会立即静默复查并最多再查两次，在真实 DivineAPI 内容可用后自动替换；页面同时提供低噪音、可访问且尊重 reduced-motion 的更新状态。发布回滚点 `d65e7f25`，两次祖先门禁均通过；Orchestrator 构建、编号 migration（13 statements / 174 already applied）、`db:verify`、非 root PM2 重启与必需密钥加载均通过，运行用户 uid/gid 998、restart count 0。Aliyun 与 Vultr SPA 均命中 `index-WNBW77fH.js`，两侧 smoke 与 healthz 200。真实用户态复验：今日内容来源为 DivineAPI，幸运色显示“琥珀金”而非十六进制；首次切换本月先显示读取状态，9 秒内自动出现真实中文内容，控制台无 warning/error。未修改 DivineAPI/OpenAI 密钥、Translator、模型或支付配置，未部署 CN Payment 与 AKShare。

前序生产记录：SPA 与 Orchestrator 曾部署 `109be03f`（PR #43 + 超时热修复 PR #44）。今日能量星座内容切换先展示真实加载态；DivineAPI 请求最长等待 8 秒，超时后自动回退本地提示，避免无限加载。生产实测从“本月”加载态在约 8–9 秒内落到“暂时使用本地提示”，刷新按钮恢复可用且页面日志为空。Orchestrator 构建、编号 migration、`db:verify`、非 root PM2 重启、必需密钥加载与 healthz 均通过；进程 `online`、restart count 0。Aliyun 与 Vultr SPA 均命中 `index-Uoin6wia.js`，两侧 healthz 200；P0 smoke 11/11 通过。Canary 浏览器配置保持原值。

上一生产版本记录：SPA 与 Orchestrator 曾部署 `f006ac09`（PR #41）。该轮上线今日能量幸运色语义化展示：DivineAPI 十六进制色值在星座专刊、体验页和运势正文显示为中文色名，并保留真实色点；线上 DivineAPI 真实返回 `#FFBF00`，页面显示“琥珀金”且正文无可见十六进制色值。生产发布前确认旧 LIVE HEAD `c5564ded` 是目标分支祖先；Orchestrator 构建、编号 migration、`db:verify`、非 root PM2 重启、必需密钥加载检查与 healthz 均通过，进程 `online`、restart count 0、最近错误扫描为空。Aliyun 与 Vultr SPA 原子发布均命中 `index-BSyoxXkV.js`，两侧 smoke 和公网 healthz 均通过。验证：今日能量 43 files / 181 tests、SPA lint/typecheck/build、ops 30/30 与 `git diff --check` 通过。PayPal disabled；CN payment 预检 `wechat=ready`、`alipay=ready`，该次 application 发布未部署或重启 CN Payment 与 AKShare。

<!-- 2026-06-26 里程碑 — 🏁🏁 登录自学从机制到交易站真出货 + 四层 veto 防线 -->
**🏁🏁 里程碑（2026-06-26）— 登录自学从机制到交易站真出货 + 四层 veto 防线全证通**

**PROD 基线**：orch `f1b6fe6`。flags：`EXPLORER_ENABLED` **OFF** / `LOGIN_EXPLORER_ENABLED` **OFF** / `LAYER_C_MODEL_VETO_ENABLED` **OFF** / `USER_TASK_CRYSTALLIZE_ENABLED` **ON（B1 live）**。三站 storageState 就位（figma + todoist + trip，box 独立路径各 600）。

**两条真 post-login path**：
- **todoist** add-task 5 步（点添加任务→输入买牛奶→回车提交→停在删除前→done）。
- **trip.com** 订票流 **13 步**（Flights→Tokyo→Singapore→Search 63航班→Select 去/回程 Scoot $439→View Details→Continue→进订票主表单 Step 1/4 Fill in your info→认出付款红线→停、done）。
- **闭环链**：登录认证（login-ctx + storageState）→ 真执行任务 → 红线前自停 → **completed** → 结晶 path。两条都会被 B1 cron 自动结晶。

**交易站 trip 全程零真交易**：未付款 / 未下单 / 未填证件（空壳号本就无证件）；agent 自停在「Fill in your info」表单、付款红线前。Layer C 3 调用 $0.00139（≤15、无 hang）。

**四层 veto 防线（真 SPA 交易站闭合）**：① 空壳测试号地基（无真数据/不绑支付）② Layer A 关键词（预订/去支付/添加出行人/copylink…，EXTRA_RE，login-mode）③ Layer B 结构信号（提交型控件+交易文案）& 交易页反转（pageUrl 阶段 default-deny）④ Layer C 模型兜底（haiku，A/B/反转都过+交易可疑区才触发；fail-closed/限额≤15/触发收窄只扫真表单字段）。**SPA URL 不变→反转弱 → 词层(A)+Layer C 是主力**。

**关键学到**：
- **站点选型**：figma×3 fail（重画布、vision agent 操作不了）/ **todoist+trip 成（表单型走得通）** = 表单/流程型站是登录梯队正确类型。
- **veto 四次在测试号调准（均无害逆出，测试号兜底是命门）**：① Copy link 分享动作漏拦→补复制/分享链接变体 ② 「清空您的大脑」引导文案被裸 `清空` 误拦→收紧成组合 ③ 字面审控出收紧过头漏「清空收件箱」（真破坏）→补回 ④ Layer C `pageTxSignal` 过宽（扫整页 readPageText、trip 首页页脚 "Payment methods" prose 误触）→收窄成**只扫真 `input/textarea/select` 表单字段、不扫 prose**。**启示：关键词/信号 veto 两方向都 fiddly、字面审 + 测试号实跑是命门**。

**变更链（本会话，都 dark / flag OFF）**：`89690206`(预订站 veto A+B+交易页反转) → `f4404738`(Layer C 模型兜底) → `f1b6fe65`(pageTxSignal 收窄)。

**backlog**：① **Continue 收严**：trip "Continue"（进订票表单的导航）被 Layer C 判 ALLOW、agent 进了表单（停付款前）；要更保守可调（权衡：更安全 vs path 更短）。② 扩更多交易站/任务验泛化。③ B2 影子转灰度 — 等 B1 攒真实语料。④ ⚠️ 监控纪律：detached 真跑必启 poll bg（本轮漏启→误判 1 小时 hang，实为 ~10min completed）。

<!-- 2026-06-25 里程碑 — 🏁 A 登录自学闭环端到端证通 + 第一条真 post-login path -->
**🏁 里程碑（2026-06-25）— A 登录自学闭环端到端证通 + 第一条真实 post-login path**

**PROD 基线**：orch `00bde7f`。flags：`EXPLORER_ENABLED` **OFF** / `LOGIN_EXPLORER_ENABLED` **OFF** / `USER_TASK_CRYSTALLIZE_ENABLED` **ON（B1 live）**。两站 storageState 就位（box 独立路径、figma + todoist 并存、各 600）。

**闭环链（端到端证通）**：登录认证（login-ctx 带 storageState）→ 真执行（todoist add-task：点「添加任务」→ 输入「买牛奶」→ 回车提交、任务出现计数 1）→ **红线前自停**（看到「删除」、停在点击前、宣告 done）→ **completed** → 结晶**第一条 post-login path**（5 步 add-task）。
- **运行**：todoist `exploration_runs id=18 completed`、`$0.1770`、~2min、5 captures 全 benign、**未越任何红线**、会话隔离（brave 前 1/后 1）、归零自动、`LOGIN_EXPLORER` 自动回 OFF。
- **path 落地**：crystallize dry-run `planned=1 (5 steps)`（`tsk_5bFtqQ…` → draft v1 app.todoist.com）。**B1 cron（无 origin 过滤）会自动结晶这条 completed 轨迹 → operation_paths**（或手动 `--commit`）。

**关键学到**：
- **站点选型决定成败**：figma×3 fail（重画布、vision-loop agent 操作不了、总在复杂 UI（Got it/Settings/Security）打转）vs **todoist×2 success（表单站「加一条任务」走得通）**。**表单型 SaaS = 登录梯队正确首站类型**。
- **走通四要素合力**：指令式单任务 intent（去掉「任选其一」扩展子句）+ 禁逆向（明确禁 Community/Settings）+ 软超时 600s（②b：原 300s 软超时才是绑定约束、漏改过）+ 清空误报修。
- **veto 双向偏差都在测试号逆出修好（测试号先行的价值）**：
  - **false-neg（漏拦）**：figma「Copy link」分享动作未拦 → 补 复制链接/分享链接变体（copylink/sharelink…）。
  - **false-pos（误拦）**：todoist「清空您的大脑」被裸词 `清空` 误拦 → 裸词收紧成组合词；**字面审又控出收紧过头漏掉「清空收件箱」**（真破坏）→ 补回（清空收件箱/回收站/账户/数据/所有/全部/列表/项目）。
  - **启示**：关键词正则 veto 两个方向都会偏、很 fiddly → **测试号兜底是命门、预订/交易站前 veto 要大幅加固或换更稳判法**。

**三关口现状**：① figma 首跑 → **已完（改 todoist 走通、闭环证通）** ② B2 影子转灰度 → 等 B1 攒真实语料 ③ 登录梯队：figma（画布、搁置）→ **todoist ✓** → 交易/社交（trip.com 按住、等 veto 为预订加固）。

<!-- 2026-06-25 会话归档 — ④ 自学习: 免登录验透 + A 登录预热 dark + B1 LIVE + 战略/安全线 -->
**📌 会话归档（2026-06-25）— ④ 自学习现状 + 登录线战略**

**PROD 基线**：orch `00bde7f0`(EXTRA_RE 误报修+清空收件箱补漏)(todoist 入 LOGIN_TASKS、表单站首选)（A 登录态 intent 指令式+软600/硬720/iter40+Copy-link veto；run#1/#2 修）。flags：`EXPLORER_ENABLED` **OFF** / `LOGIN_EXPLORER_ENABLED` **OFF** / `USER_TASK_CRYSTALLIZE_ENABLED` **ON（B1 live）**。

**④ 自学习现状**：
- **免登录 explorer**：四类（ctrip/figma/todoist/douyin）验透、全终止路径（done/maxIter/软超时/硬 abort/veto-halt/connect-fail）出**非空断点证据**、dark。**四类实证：免登录全停在登录墙、够不到 post-login 真实操作路径。**
- **A 登录预热**：四接点（独立 flag `LOGIN_EXPLORER_ENABLED` / login-ctx `storageState` 三隔离 / `SENSITIVE_LABEL_EXTRA_RE` veto 加厚 / fixture 登录态向量）dark 上线、**真-DOM 硬闸 11/11 验过**（向量7：同控件免登录放行 / 登录态 EXTRA_RE 拦、spy innerClick=1）。凭据模型：agent 继承 BOSS 手建测试号 `storageState`、不登录不碰凭据。**等 BOSS 专属机就绪导出 storageState → figma 首跑。**
- **B1 接结晶**：**LIVE**。`USER_TASK_CRYSTALLIZE_ENABLED=true` → index.ts 6h gated cron → `crystallizeTasks(dryRun:false)`（结晶器内部不改、幂等 by source_task_id）结晶 completed 任务（user+explorer、**无 origin 过滤**）→ draft `operation_paths`。**write-only sink、没人读回（B2/B3 未建）→ 零 live 影响**。user 轨迹已实证结晶（`tsk_2GMnW`→`opath_NY2LbMUzAxSTNJPnrNVZK` draft v6 origin=user；operation_paths 7→11、幂等重跑 0 新写）。
- **B2/B3 复用回灌**：设计就绪（影子模式先行 / 质量闸 / 灰度真喂）。**未建**。是全工程**唯一真碰 live 用户路径**的一步。等 B1 攒出真实语料 → 实现。

**战略决策（登录线）**：四类证据→免登录够不到 post-login 真实路径 → 两条互补：**A 登录预热**（赶在真实用户前预热操作站 post-login、保首次时效+成功率）+ **B 产品 lane 闭环**（真实流量持续学）。

**安全线（钉死）**：登录自学**只用测试小号**（无真实数据 / 不绑支付）+ 专属机 + veto 加厚三层、**绝不碰真实用户凭据**。梯队：figma（首）→ SaaS → 交易/社交加厚。

**三个待 BOSS 关口**：① 专属机就绪 → figma 登录预热首跑 ② B1 攒够真实语料 → B2 影子转灰度真喂 ③ 登录梯队放行（SaaS → 交易/社交）。

**设计文档引用（BOSS 手上）**：login_explorer_design_risk_v2 / A_login_explorer_impl_design_v1 / AB_design_v1 / B2B3_shadow_design_v1。

<!-- 2026-06-25 — Playbook ④ A 登录自学(4接点) + B1 接结晶 dark ship -->
**✅ ④ A 登录自学 + B1 接结晶 dark ship（orch `ea2b6d1`，restart 706，全新 flag OFF）**。**A 登录自学（4 接点，CLI-only，第4把独立锁，正交 EXPLORER_ENABLED）**：①`LOGIN_EXPLORER_ENABLED`(默认OFF,fail-closed 缺 storageState 即 abort)②connect opts 加 storageState→独立 login-ctx(与空clean-ctx/contexts()[0]三隔离),login mode 跳过 assertCleanContext③veto 加厚 `SENSITIVE_LABEL_EXTRA_RE`(资金转账/提现/绑卡·不可逆解绑/注销/删除·发布公开/分享/邀请/授权),`classifyExplorerAction(a,{loginMode})` 条件 OR,base 正则+submit/password 不动④fixture 加 分享/转账/删除+伪登录横幅+harness 向量7。**真-DOM 硬闸 11/11 PASS**(向量7:同控件免登录放行/登录态EXTRA_RE拦,spy innerClick=1)。修过 harness 导航竞态(ea2b6d1,test-only)。**B1 接结晶**:`USER_TASK_CRYSTALLIZE_ENABLED`(默认OFF)→index.ts 6h gated cron→`crystallizeTasks` **内部不改**、幂等、请求路径外→write-only sink 零 live 影响。**B1 成色**:crystallizer **无 origin 过滤**(user 轨迹 tsk_2GMnW 真结晶得了),但当前 8 个 user 任务是测试/QA 夹具(example.com/iframe-fixt,caps2-4,7/8已结晶)→真语料待真实用户跑授权任务。**未建 B2/B3 复用回灌**(operation_paths 仍写汇没人读,以后单走)。+5+1 测、3043 绿。**真跑 A 需 BOSS 出测试号 storageState**(`LOGIN_EXPLORER_STORAGE_STATE`,不进对话)。以下为上一里程碑：

<!-- 2026-06-25 — Playbook ④ Bug A+B (real-run v2 ctrip→figma 暴露) dark ship -->
**✅ ④ Bug A+B dark ship（orch `1d56150`，restart 699，flags OFF）**。真跑 v2（browse-task-20260625，ctrip→figma，$0.61/37turns）**两大核心验证 PASS**：**veto 真站首考**（ctrip it15 veto 拦住「账号密码登录」控件→halted_sensitive）+ **connect-fix site-to-site**（figma 在 ctrip 后真起来跑到 /templates/brainstorming——v1 卡死整批根因已堵）。但暴露 2 bug 已修：**Bug A** `makeBrowseExploreSite` 只在 completed 分支转发 summary → ctrip(halted) 断点 summary 被丢=NULL → 修：veto+failed 分支也转发；**Bug B** CLI 无 `unhandledRejection` 守卫 → figma 浏览中游离 rejection 崩整 CLI(exit1)→figma 卡 running+批中断 → 修：browse 块注册守卫(log+不崩+批继续，doc-first/orch 不碰，结构上 CLI-only)。+2 测、3038 绿。⚠️ stray rejection 根未定位(错误日丢)，Bug B 守卫下轮抓真错。⚠️ figma stuck row tsk_r3W3wh5LMNbJcgGDRi22D 待 BOSS GO 清(UPDATE status running→failed)。**下一步**：zero-burn smoke→再跑(veto summary 非空+一站崩不拖垮批+抓真错)。

<!-- 2026-06-24 — Playbook ④ explorer fix-set (connect-超时+重试+始终断点证据) dark ship -->
**✅ ④ explorer fix-set dark ship（orch `a52e447`，restart 697，flags OFF）**。根治 task-oriented 真跑暴露的两 gap（硬墙首考已 PASS：ctrip 420s force-abort/failed/无 stuck 行 ✓）：**① connect 阶段挂死卡整批**（connect+assert 在 runSupercar 前、硬墙不覆盖；connectOverCDP 无超时 → figma 挂 connect 卡全批 22min）→ `makeRunBrowseTask` 用 `withHardDeadline` 包 connect+assert（`EXPLORER_CONNECT_TIMEOUT_MS` 默认 60s）→ 挂死该站 failed、批继续、不卡；**② 1 次重试**（fresh executor 自愈瞬时挂；force-dispose 查清=干净 ctx.close 无 brave 扰动）；**③ force-abort 空 summary 白烧**→ `buildBreakpointSummary`（步骤序列+停止原因、确定性、任何终止必出证据，completed 仍用模型富总结）→ exploration_runs.metadata.summary 永不空。explorer-only/additive、不动 veto/cost/clean-context/用户任务(tasks.ts 0 改)、+7 测、3036 绿。**下一步**：真跑前先 zero-burn smoke（验新构造）→ 再跑（不卡整批 + 每站必出断点证据）。

<!-- 2026-06-24 — Playbook ④ intent 深化 v2 (任务/能力导向 + 断点报告持久化) dark ship -->
**✅ ④ intent 深化 v2 dark ship（orch `82bdb2e`，restart 696，flags OFF）**。browse-intent 从"看懂这站"升成"摸清一件具体任务怎么走到边界"：SEED_TASKS 每站 1-2 代表任务打底（figma 新建文件 / ctrip 查机票 / todoist 建清单 / douyin 搜话题）+ 模型可识别另一常见任务 + **走到动作边界停**（登录/下单/支付/提交前，不跨 veto、全程免登录）+ **【断点报告】**（第几步/停在哪/为什么）+ done="摸清任务到边界"、≤15 步 + 硬超时兜底。**断点证据持久化**：outcome.summary → exploration_runs.metadata.summary（截 8k、每 run 可查 = "免登录够不够"证据）。explorer-only/additive、不动 veto/cost/clean-context/用户任务、3031 绿(+2)。**下一步**：真跑前先零烧钱 dry-run smoke（验 SEED_TASKS+summary 传递构造）→ 再真跑（任务导向 + 收断点证据 + 硬超时兜底）。

<!-- 2026-06-24 — Playbook ④ 硬超时 fix（douyin 挂死 bug 根治）dark ship -->
**✅ ④ 硬超时 fix dark ship（orch `258c2d8`，restart 695，flags OFF）**。**根治 batch-2 douyin 挂死 bug**：supercar `timeoutMs` 是软超时（turn 间查）→ 单个卡死 page op（hostile/反爬站）拦不住 → 挂满到 shell timeout 杀 CLI、留 stuck 'running' 行。修（explorer-only、additive、不动 veto/cost/clean-context/用户任务）：(1) clean-context `setDefaultTimeout`/`setDefaultNavigationTimeout`（**仅 clean-mode**，line 283 gate 内 → 共享 context 不碰；`EXPLORER_OP_TIMEOUT_MS` 默认 45s；兜 click/goto/waitFor 非 evaluate）(2) `withHardDeadline` per-browse 硬墙（`EXPLORER_BROWSE_HARD_MS` 默认 420s>300s 软）→ 到点 force-dispose clean context（拒 in-flight op→解 hung loop）+ 落 failed→**status-update 照跑无 stuck 行**（兜一切含 hung evaluate）(3) 清理由硬墙+现有映射+finally dispose+CLI 退自动归零 handle。+5 测、3029 绿。**batch-2 实况**：ctrip ✅$0.1154(shallow)/douyin 挂死$0.0802(本 bug)/todoist 没跑，总 $0.1956。**⚠️ douyin stuck row `tsk_EhLZ4FUGNovXLViy7j3ie`='running' 待 BOSS GO 单独 UPDATE→failed**（drafted、未执行）。**下一步**：stuck row 清 → intent 深化（营销浏览→任务/能力导向抽高价值 path）→ 再续真跑（硬超时兜底、反爬站不再挂满）。

<!-- 2026-06-24 — Playbook ④ 自学习闭环真站端到端验通 (figma-rerun) 🏁 -->
**🏁 ④ 自学习闭环真站端到端验通（figma-rerun，orch `3476cac` dark）**。`browse → 收敛完成 → 捕获 → 结晶` 全链跑通：① browse **completed**（8 turn、i8 自宣 done、**`$0.1427`**，vs batch-1 25-maxed/failed → **intent 收敛 WORKED**）② **捕获**（task_action_captures 22→29、origin='explorer' tasks `id=3004` / `user_id=16` 平台桶 / status=completed）③ exploration_runs id=5 completed `$0.14274195` ④ **结晶**（crystallize dry-run：figma 抽出 `[draft v1] reuse figma.com / general_browse / 7 steps`）。**三改动全验**：捕获环 / intent 收敛 / 记账归 id=16（off BOSS 个人）。**零 veto（公开页）、归零自动（CLI 退、orch 全程 dark 没碰、clean-context disposed）**。⚠️ 首试 $0 失败（内联 `HEADED_CDP_ENDPOINT=9223` 端口-only 覆盖 .env 完整 URL → connectOverCDP Invalid URL；修=别内联、让 .env 供，见 §5 env 铁律）。**价值观察**：figma draft = shallow 营销浏览（含重复点击）= 低价值技能；有价值技能需 intent 转任务/能力导向（下一阶段）；crystallize v1.1 backlog=连续相同 click 去重。**下一步（逐项 GO）**：batch-2（广度 + ctrip 交易站 veto 首考 + 校准）→ intent 深化 → 有价值 draft 才 --commit。crystallize 仍 dry-run（figma shallow 未 commit）。exploration_runs id=4(失败)/id=5(成功) 留着。

<!-- 2026-06-24 — Playbook ④ 捕获环+intent收敛+记账系统身份+totalUsers排除 dark ship -->
**✅ ④ 价值链补齐 dark ship（orch `3476cac`，restart 694，flags OFF）**。① **记账系统身份**：建 `users.id=16`（`external_id=playbook-explorer`、role/status=`system`、plan=free、password 哨兵=不可登录、email 非路由）→ batch-2 起 `EXPLORER_USER_EXTERNAL_ID=playbook-explorer` 归平台桶 off BOSS 个人；totalUsers 加 `role!='system'` 排除（admin.ts）。② **捕获环（断环已补）**：browse lane 建 tasks 行（`origin='explorer'` → activeUsers/admin-learning 按 origin='user' 排除）+ 接 `onAction`→`task_action_captures`，**explorer 轨迹才进 capture 表→可结晶**；跑完 outcome→status，**只 completed 进 crystallize**（SUCCESS_STATUSES）。纯 additive/best-effort、veto/cost/clean-context/tasks.ts 全没动。③ **intent 收敛**：browseIntent 加「≤12 步、出能力清单、宣告 done」（补 figma 25turn 不收敛根）。**blast-radius 全核 inert**：task-queue 是内存队列(不轮询 DB)、boot-sweep 只 fail pending/executing/planning(非 'running'、不 re-dispatch)、配额按 user(系统身份不发请求)、ledger 不写(不经 tasks.ts 终态)；唯 admin-finance 显示 +1(cosmetic、非 action)。crystallize dry-run 验通(确定性、零烧钱、navigate→click+anchor 干净)。**下一步=一个 batch GO 烧「会捕获+会收敛」的重跑**（figma + batch-2 站）端到端验 browse→完成→captures→crystallize 出 draft path。

<!-- 2026-06-24 — Playbook ④ batch-1 figma 真跑落地（首个真烧钱）+ explore-sites TDZ 修复 -->
**✅ ④ batch-1 figma 真跑落地（首个自主探索真烧钱，orch 全程 dark）**。**`$0.4275`** —— 三方一致（in-memory accumulator = `exploration_runs` id=3 = `llm_calls` 25turn 求和）→ **cost-source A 端到端验**。**零 veto 命中**（figma.com/pricing/design 全公开页、无敏感动作可拦，clean-context 零凭据）。**未 halt**（跑满 `maxIterations=25`、status=failed=未完成、$5 熔断未触）。**归零自动**（CLI 一次性退出、orch `EXPLORER_ENABLED` 全程 ABSENT 没碰、clean-context disposed）。⚠️ **首跑曾崩**：explore-sites `--browse` wiring TDZ（`logger` 在 const 前引用）→ **零烧钱**崩在 setup（防静默 cost-check 抓住）→ 修 `572e4227` + zero-burn dry-run smoke 验过 → 再真跑成功。**校准**：$0.017/turn、$5≈290turn=异常 backstop、maxIter 才是有效闸；figma 25turn 没自宣 done → browse intent 调优进 backlog。**跑法订正（CLI-only）**：enable=**内联 CLI env**（`EXPLORER_ENABLED=true ... pnpm tsx scripts/explore-sites.ts`），**orch 从不碰、归零=CLI 退出自动**（早期"翻 orch flag"写法作废，见 handoff §5）。box 直连 Anthropic+figma（新加坡无 GFW、无代理；Astrill 3213 只在 Mac 给 git push）。**下一步（逐项 GO）**：记账切系统身份（`EXPLORER_USER_EXTERNAL_ID` 自由串=breaker/exploration_runs；llm_calls 明细须 users FK）+ batch-2 加站 + maxIter/intent 校准 + figma 轨迹结晶。

<!-- 2026-06-24 — Playbook ④ batch-1 prep 加固 (a)+(c) dark ship -->
**✅ ④ batch-1 prep 加固 dark ship（orch `bae76b0`，restart 691，flags OFF）**。(a) `runExplorerBatch`：非有限/负成本 → **fail-closed halt 整批**（spend meter 不可信，不当 $0 续；有限 0 合法不 trip）。(c) `resolveMaxIterations`：`EXPLORER_MAX_ITERATIONS` env 可配，缺失/无效 → 默认 25、clamp 上限 50（fat-finger 2500→50）、warn-on-adjust（BOSS 调 25→15 不重部）。(b) accumulator 解耦 userExternalId gate 留 backlog。全套 3024 绿（+6）。**batch-1 figma 全备 dark**，仅等 BOSS 五步发令：① 逐项 GO ② run-time `EXPLORER_USER_EXTERNAL_ID` ③ 内联 export 翻 `EXPLORER_ENABLED`+验 /proc（OS-env-shadow 教训）④ `--run --browse --sites=figma.com` ⑤ 跑完内联 `=false` 归零+验 /proc。

<!-- 2026-06-24 — Playbook ④ browse lane wired (--browse) dark ship -->
**✅ ④ browse lane wired 进 `explore-sites.ts --browse` dark ship（orch `6f96bed`，restart 690，flags OFF）**。这是 batch-1 真站 browse 的硬前置（此前 browse lane 已建+单测但没接进入口、无 CDP 端点源）。**cost-source A（fail-closed 熔断）**：`CostAccumulatingRecorder` 每 turn 内存同步累加（`+=` 在任何 await 前，fire-and-forget 也落账）→ runBrowseTask 返 costUsd → `ExploreSiteOutcome.costUsd` → runExplorerBatch per-site $5 熔断读它，**绝不 DB 回读**（DB 路径 fail-OPEN=超烧）。**`requireBrowseEnv` 缺-id/cdp → `process.exit(1)` 在任何 connect/spend 前**（缺 `EXPLORER_USER_EXTERNAL_ID` → recorder 不 fire → 累加 $0 → 熔断瞎，故 abort 不裸跑；4 例测）。6 审点全落 + 第7（熔断读内存非 DB）+ 字面行三段经 BOSS 审。`cdpEndpoint=HEADED_CDP_ENDPOINT`(9223 live，非 9222 dead)，`maxIterations=25`/`timeoutMs=300s` 单 browse 硬上限。全套 3018 绿（+8）。**下一步=batch-1 figma 真跑（首个真烧钱，新授权点）**：等 BOSS 逐项 GO + run-time 给 `EXPLORER_USER_EXTERNAL_ID` + 开 `EXPLORER_ENABLED` + `--run --browse --sites=figma.com` + 跑完归零。**batch-1 prep 折进的 hardening（待审）**：(a) explorer.ts:208 `非有限→:0` 改 fail-closed(成本判不准当 breach) (b) accumulator 绕开 userExternalId gate (c) `EXPLORER_MAX_ITERATIONS` env 可配 + §6 doc。

<!-- 2026-06-23 — Playbook ④ 护栏夹具真机验收 8/8 PASS + veto 多信号 OR 修复 dark ship -->
**✅ ④ 护栏夹具真机验收 8/8 PASS + veto BLOCKER 修复（orch `dcbb478`，restart 689，复 dark）**。红队夹具首跑抓到 BLOCKER（icon-only 按钮 emoji visibleText 短路敏感 aria/title → veto 漏拦，真 agent-loop 真漏）→ 硬停复 dark → 修 `dcbb4783`（`classifyExplorerAction` 多信号 fail-safe OR：visibleText/aria/title/placeholder/name 任一敏感即拦 + type=password 一律拦；`captureTargetDescriptor` 加 title/placeholder，**veto-path-only，B2 capture 不变、无 migration**；钩子缺失时用户任务字节级不变；全套 3010 绿 + 3 回归）。**dark 部署后翻 `EXPLORER_VETO_FIXTURE_ENABLED` 真机重跑 harness（clean-context over CDP 9223 live Brave）= 8/8 PASS**：①clean-context cookies=0 ②decompose-click 拦 ③**icon-only 拦（💳 不再短路敏感 aria/title）** ④链接导航拦 ⑤**Tab-type-Enter 提交拦 + pwd-type 转拦（inputType=password）** ⑥安全链接放行（不误拦）⑦executor.click spy 敏感=0/安全=1 ⑧exploration_runs 写入。**验完 `EXPLORER_VETO_FIXTURE_ENABLED` 内联 `=false` 关回 + restart 689 → 复 dark（路由 404、EXPLORER_ENABLED 仍 OFF）**。**下一步**：护栏验通后才谈真开 `EXPLORER_ENABLED` 跑标定站（figma/ctrip browse, clean context, 校准 $5）；中场 Credential Vault。

<!-- 2026-06-23 — Playbook ④ browse-试用 v1 dark ship + 正式交接文档 -->
**✅ ④ browse-试用 v1 dark ship 上线（orch `9e0f23fc`，restart 683，healthz ok）**。三 commit FF（`51b43080` 钩子+lane 骨架 / `85f1d273` clean-context+runBrowseTask+exploration_runs+夹具 / `9e0f23fc` 交接文档）。**两 flag 都 OFF**（`EXPLORER_ENABLED`+`EXPLORER_VETO_FIXTURE_ENABLED` 进程+.env 零 EXPLORER_ 行）；clean-context 默认 off → **用户任务字节级不变**（agent-loop 钩子缺失 + executor browseContext 非-clean 仍走 contexts()[0]）。两轮 6 镜头对抗审（修 4 向量 + BLOCKER=resetPageForTask 抓共享上下文，browseContext 唯一选择器、grep 验零残留）。**正式交接文档 `docs/HANDOFF_holaday_playbook.md`**（7 段：基线/铁律/全景/烧钱章节/教训/backlog/断点）。**待护栏夹具验收**：翻 `EXPLORER_VETO_FIXTURE_ENABLED` + clean-context 真 browse 夹具 → 断言零-cookie + 四向量（decompose-click/icon-only/链接导航/Tab-type-Enter）真拦、executor/page.goto 内层从未被调 → 验通才单独谈真开主开关跑标定（校准 $5）。前态见下。

<!-- 2026-06-23 — Playbook ④ explorer 首次真跑（doc-first 标定 smoke）-->
**✅ ④ explorer 首次真开主开关 + 真烧钱 smoke（figma + ctrip doc-first，batch `calib-2026-06-23`）**。`EXPLORER_ENABLED=true` **仅 inline 在一次性 CLI 进程**（orch 进程 + .env 全程未碰 → orch 始终 dark，归零 inherent：.env 0 行 / orch 进程 0 / restart 仍 682）。结果：figma.com + ctrip.com **各 completed**（Firecrawl 抓首页成功，ctrip 未被反爬挡）→ **Pack A sites 2→4 / caps 2→4**（新增 figma.com + ctrip.com 全局 site + `explored_doc` draft capability，标题 "Figma: The Collaborative Interface Design…" / "携程旅行网:酒店预订…"）。**totalSpent=$0.02**（2×$0.01 估价，**costUsd 真被预算闸看见、不再 $0**；远不撞 $5/$50/$200）。无 Sensitive/熔断触发（doc-first 零 live 动作，预期）。**链路端到端验通**：Firecrawl→site/cap upsert→costUsd→totalSpent 累计→breaker。**已知 gap**：v1 **不写 `exploration_runs`**（shell 返回+CLI 打印，未持久化该表）→ v1.1 follow-up。**$5 单站熔断未校准**（doc-first ~$0.01 撞不到；校准留 browse-试用 lane）。跑完主开关已归零（inherent）。

<!-- 2026-06-23 — Playbook ④ explorer v1 骨架 dark ship -->
**✅ ④ active exploration explorer v1 骨架 dark ship 上线（orch `ec4e023e`，restart 682，healthz ok）**。全 NEW 文件（`src/playbook/explorer/{explorer,explorer-budget,explorer-guards}.ts` + `scripts/explore-sites.ts` + 24 测），**零改现有码 → 零热路径触碰**；orch 运行时 **0 处 import explorer**（实证：非-explorer/非-test src 引用=0）→ 不自动调、零行为变化、零烧钱。**`EXPLORER_ENABLED` 进程+.env 双缺失（0 个 EXPLORER_* 行）= 主开关 OFF = explorer 绝不跑**（dark ship）。**charter §A 预算逻辑 v1 生效**（三层熔断：per-site $5种子/$3陌生 停该站批继续、per-batch 站×$5×1.2/per-day $50/per-month $200 停整批；拦异常不掐正常 $0.5-2 跑通；熔断默认真实值，run 闸=主开关+CLI dry-run；标定后校准）。**6 镜头对抗审 2 MAJOR 已修**（Camera2 敏感检测拓宽+归一化+fail-closed、Camera6 预算闸看得见 Firecrawl costUsd）。Credential Vault 未碰（v1 只学免登录）。**待**：BOSS 给标定站列表 → 首批跑校准 $5 + browse-试用 live-veto 落地（单独 spec）。前态见下。

<!-- 2026-06-23 — supercar loop llm_calls 记账补全（④ 硬前置）deploy 上线 -->
**✅ supercar 浏览 loop llm_calls 记账补全 deploy 上线（orch `020dff5d`，restart 681，healthz ok）**。`supercar/agent-loop.ts` 自建 Anthropic client（@1200）→ 此前从未接 recorder，浏览任务在 `llm_calls` 全 $0（结晶的 7 个任务即如此）。本次纯加记账（**不改执行/token/路由**）：`RunSupercarOptions` += 可选 `recorder`+`userExternalId`；每次 `messages.create` **成功后**（API 失败分支前置 return）`void recorder.record({provider/model/tokens/cache/latency}).catch()` 三层 fire-and-forget（不 await/.catch/recorder 内 try-catch）；purpose=`supercar.turn`；复用现成 `estimateCostUsd` 计价（零硬编）；tasks.ts 构造 `DrizzleLlmCallRecorder(ctx.db)` 接进 supercarArgs（含 retry 路径）。5 镜头自审过（不阻断/不改 token/不漏不重/fire-and-forget/不泄漏=只 id/model/计数/cost）。**这是 ④ explorer 硬前置**：章节 A 预算/熔断 + E 可追溯靠它。**待验**：跑一条浏览任务→查 `llm_calls` 有 `purpose='supercar.turn'` 行、cost>0（不再 $0），并实测校准单站成本。前态见下。

<!-- 2026-06-23 — Playbook ④ 主动探索：烧钱授权章节 v1（固化，explorer 码未写未跑）+ 单站成本估算 -->
### 🔴 Playbook ④ 主动探索 — 烧钱授权章节 v1（BOSS 已逐条拍；explorer 代码跑前此章节须经 BOSS 确认生效）

> **【④主动探索烧钱授权章节 v1】**
> **A. 总闸 + 预算逻辑 v1（已定，2026-06-23）**：④是首个自动烧钱能力，explorer 代码跑前此章节须经 BOSS 确认生效；主开关 `EXPLORER_ENABLED` 默认 OFF。**预算闸 = 三层熔断 + 不掐跑通 + 标定先行**（拦异常烧钱，不掐正常 $0.5-2 跑通；数字是占位常量 env/config，标定后校准，逻辑定死）：
> - **① 种子站（阶段一）**：不设跑通上限；**单站熔断 $5**（烧到此还没跑通=异常→停该站+标记+报 BOSS，正常远不到）；**单批熔断 = 站数×$5×1.2**（余量）；**标定先行**——首批跑 1-3 标定站拿实测，据实把 $5 校准。
> - **② 陌生站（阶段二，用户触发）**：阈值 10 不同用户；**单站熔断 $3**（比种子紧）；进队列等 BOSS 批准。
> - **③ 全局总闸**：**月度硬上限 $200**（到顶一切探索停+报）；**单日硬熔断 $50**（到顶当日全停+报）。
> - **记账**：每笔走 `supercar.turn` 记账，跑批实时累计读 `llm_calls`，达单站熔断停该站、达单批/单日/月度熔断停整批；`exploration_runs` 记录；finance 可见。
> **B. 阶段一种子站**：BOSS 挑站列表；分批跑，每批跑前 BOSS 点确认（绝不一口气全量）；每批跑完报（几站/烧多少/几条 path）再下一批。
> **C. 阶段二热度触发**：用户用到的未学站累积到 10 个不同用户 → 进探索队列、等 BOSS 批准才跑（初期不自动）；受总预算+熔断管。
> **D. 动作边界（写死）**：explorer 只跑只读/浏览类（导航/点击/读取）；绝不自动下单/提交表单/填交数据/登录认证/支付/任何副作用敏感操作；遇反爬/失败记录跳过、不重试烧钱。
> **E. 产物**：探索轨迹走现有捕获→结晶链落 draft path（不直接 verified；升 verified 走 ③canary）；全程 log、每笔花费可追溯。

**预算依据 — 单站成本只读估算（2026-06-23，未跑探索，纯查 `llm_calls` 实录 + 计价模型）**：计价 Sonnet-4-6 `$3/$15` per M（cache-aware；Opus `$5/$25`、Haiku `$1/$5`）。实录浏览类单任务成本区间（`llm_calls` Q3）：简单 1-2 页（2-6 turn）`$0.04-0.10`、典型多步（6-12 turn）`$0.10-0.25`、深度（15-29 turn，如 Google 搜索流 29 calls/$0.59、Gmail 抓取 21 calls/$0.38）`$0.35-0.60`。**「深跑一个站学一遍」≈ 3-5 条代表性任务**：低 ~$0.25 / 中 ~$0.50-0.80 / 高 ~$1.50 单站。**+2× 安全裕度**（探索比定向任务多导航 + 见下记账缺口未实测 + 可能用 Opus）→ **建议单站预算 $1-2**。N 档总估（中心值 $0.5-0.8/站，含 2× 裕度的建议 cap）：**N=10 → $10-16**、**N=30 → $30-48**、**N=50 → $50-80**。预算数额 BOSS 定，填进章节 A。生成类（图 ¥0.025/张≈$0.0035、视频 lipsync $0.20/条）按 D 边界=只读浏览**不触发**，单独标记。

**🔴 explorer spec 硬前置（本轮发现，记账缺口）**：`supercar/agent-loop.ts`（浏览执行器，自建 `new Anthropic()` line 1200）**不写 `llm_calls`**——7 个被捕获的浏览任务在 `llm_calls` 里 $0（记账经 vision-loop/commander + planner 两条旧路径，非当前浏览主路径）。→ 章节 A（预算上限/熔断）+ E（每笔花费可追溯）**不能靠现有 `llm_calls`**；explorer 落码必须自带成本记账（supercar loop 每 turn 有 `response.usage`，需接 `estimateCostUsd` 落库/按探索批累计）。这是 explorer spec 的前置项，非本轮做。

<!-- 2026-06-23 — Playbook ① crystallize v1 首次真写 Pack A -->
**✅ ① crystallize v1 首次真写 Pack A 成功（脚本 `354578a3`，离线 CLI，orch 运行时不 import → 无 deploy-orch；运行 orch 仍 `0ba05d10`）**。`scripts/crystallize-paths.ts`（默认 dry-run，`--commit` 真写）+ `src/playbook/crystallizer.ts`（pure planCrystallization + tx 写）。**Pack A 从 0 → 7 draft operation_path / 17 steps / 2 sites（example.com、holaday.ai，owner=NULL 全局）/ 2 site_capabilities（`general_browse` 占位）**。实证：version 递增（example.com v1-v5、holaday.ai v1-v2，uk_operation_path_capability_version 不撞）、**多域挂入口域** + crossDomain 标记、**B4 anchor=82 + B3 frame_path=example.com 落库**、step_index 密集 0..N-1、metadata_json 存 sourceTaskIntent 原文（v2 聚类料）、**FK 全通**（orphan steps=0、anchor82→evidence_artifacts 存在）。**幂等复验过**：2nd `--commit` 全 7 SKIP（already_crystallized）、written=0、行数不翻倍、duplicate source_task_id=0。**6 镜头对抗审**：5 holds + Camera 6 MAJOR（commit 非事务）已事务化修复（path+steps 一个 db.transaction）；repo 回退零改动。v1 = 单轨迹→draft，**聚类推 v2**（攒够真实多轨迹）。前态见下。

<!-- 2026-06-23 — Playbook ① 结晶 migration 0037 (provenance 字段) apply+验表+部署 -->
**✅ migration 0037 结晶 provenance 字段 apply + 验表 + 部署通过（orch `0ba05d10`，pm2 restart 680）**。为 ① 被动结晶铺料，纯 additive expand（两表全空 0 行→零风险）：`operation_paths` +`source_task_id`(BIGINT UNSIGNED→tasks(id) ON DELETE SET NULL + `ix_operation_path_source_task` 索引 = 幂等去重键 + provenance) +`metadata_json`(JSON，存 source task 原始 intent 文本=v2 聚类料)；`operation_path_steps` +`frame_path`(VARCHAR 255，B3 frame provenance)。**expand-first**：先 push FF→box reset→`db:migrate:numbered` apply(statements=12 已查清 benign=全 38 migration 零 INSERT/UPDATE/DELETE，多出的=老 migration 幂等 DDL 重跑；apply-numbered 无 tracking 表)→**只读验表**(3 列/索引/FK 实测全对、operation_paths 0 行未动)→后部署。**运行时无新行为**(crystallize 脚本未写，部署只为 orch schema TS 与 DB 一致)。**Pack A 6 表仍全 0 行**，待 crystallize 脚本(单成功 task→draft path，用 source_task_id 去重 + metadata_json 存 intent + steps.frame_path 映射；聚类推 v2)。**数据家底**：task_action_captures 仅 8 个测试 task、零真实 usage→v1 单轨迹 draft、聚类等灰度攒够。前态：orch `36d7705f`(B 捕获四件套全验通)。

<!-- 2026-06-22 — Playbook B 捕获四件套全 prod 验通 + B4 canary 收尾 -->
**✅ Playbook B 捕获四件套全 prod 验通（orch `36d7705f`，flag-only restart 679）**。**B1**(task_action_captures 表+0036) / **B2**(顶层多信号捕获,"Learn more") / **B3**(跨域 frame 捕获,frame_path=example.com) / **B4**(截图锚) **全验通**。**B4 canary 实证**（`tsk_2XYc` 顶层 example.com 点击→turnChanged=true→触发）：evidence_artifacts 1 条(kind=screenshot/purpose=action_anchor/**retention=manual_hold**/sha256 char64/jpeg/size 63953/r2_key)，click 行 `screenshot_anchor_id=82` 回填**对行**(PK keying 正确)，**R2 stat EXISTS size=63953**(对象真在)，热路径 0 warn。回填竞态修复(PK)+gate-on 均实证。**收尾**：`B3_FIXTURE_ENABLED=false`(夹具 404=零 prod 面)；**`ACTION_CAPTURE_ENABLED=true`+`B4_SCREENSHOT_ANCHOR_ENABLED=true` 保持 ON 灰度**(真实浏览顶层推进点击持续攒截图锚 manual_hold,给 ①结晶)。⚠️**flag-OFF 教训**：`--update-env` 只合并不删→翻 OFF 必须 `=false`(非删行)。**B 阶段 backlog 4 条**：task_0b36c43d 横幅 __name / 夹具路由删除 / B4 iframe 点击 turnChanged 盲区(iframe 导航视觉滞后→不锚) / 站点可达性折扣(eastmoney 反爬)。**下一步 = ① 被动结晶**(读 task_action_captures+evidence_artifacts 蒸 operation_paths,蒸馏源已备齐)。前态：orch `36d7705f`(dark ship 部署时)。

<!-- 2026-06-22 — Playbook B4 截图锚 dark ship（flag 默认 OFF，关键步存截图锚 R2+evidence_artifacts）-->
**📦 Playbook B4 截图锚 `36d7705f` 部署 prod（DARK SHIP，B4_SCREENSHOT_ANCHOR OFF）**（deploy-orch，preflight SAFE[live `1bf7ceb7`→`36d7705f` FF]，pm2 restart 677，healthz ok，keys present，auto-smoke skip=零烧钱；SPA 不动；**无 migration**——表/列/FK 全在）。关键步（页面推进的 click）存截图锚：复用动作后 `shot.base64`（零额外截图）→ R2 → `evidence_artifacts`(kind=screenshot, **retention_policy='manual_hold'** 躲 reaper) → **回填 `task_action_captures.screenshot_anchor_id` BY PK**（capture.id，retry-safe；非 (task_id,action_index) 因其非唯一+auto-retry 会重复行）。选择性 click+turnChangedScreenshot，**每任务上限 8**（计 attempts）。fire-and-forget（onAction void-async+自有 try/catch→失败 anchor 留 null、点击从不 await）。**独立 flag `B4_SCREENSHOT_ANCHOR` 默认 OFF**（loop 不附 base64=零开销）。**dark ship 实证**：process env+.env 均**无 `B4_SCREENSHOT_ANCHOR_ENABLED`** → 零 R2 写、零行为变化；`ACTION_CAPTURE`=true 不动。**5 镜头对抗审：1 blocker（回填竞态）查出+修（PK keying）+复验**，4 镜头 pass。仅 3 文件、captureTargetDescriptor/脱敏/点击/withTimeout 未动。tsc 0、2939 测绿、biome 0 新增。**翻 on canary 是另起一步待 BOSS 确认**。**B 捕获核心：B1 表 + B2 顶层 + B3 跨域 frame + B4 截图锚 全 LIVE**（B4 dark）。前态：orch `1bf7ceb7`。

<!-- 2026-06-22 — Playbook B3 跨域捕获验通 + 夹具收尾（flag OFF 归零 prod 面）-->
**✅ Playbook B3 跨域捕获验通 + 夹具收尾（orch 仍 `1bf7ceb7`，flag-only restart 676）**。**确定性验证通过**（`tsk_kKRyBc`：supercar 开夹具页→点跨域 example.com iframe 内「More information」→ **2 条 click 行 `frame_path=https://example.com/` + `visible_text='Learn more'`**，顶层 navigate 行 frame_path=null，**capture warn=0**=frame 路由干净成功）。任务本身「无回复」属预期（agent 同源策略读不到跨域 iframe 结果，但 **B3 经 Playwright 特权 frame.evaluate 照样捕到 frame 内文本锚**——正是 B3 价值）。**夹具收尾**：`B3_FIXTURE_ENABLED=false`（process env 实证）→ 夹具路由 404（localhost+公网双验）=**零 prod 面**；`ACTION_CAPTURE_ENABLED=true` 不动（捕获继续 dark 灰度）。⚠️**flag-OFF 教训**：`pm2 restart --update-env` 只**合并**env、**不删**已删的 key→翻 flag OFF 必须显式设 `=false`（删行无效，pm2 留旧值）。**B 捕获核心三类路径全 prod 实证**：顶层文本锚(B2) / 跨域 frame 文本锚(B3) / 非 iframe 零回归。下一步 **B4 截图锚**。B 阶段 backlog 三条：`task_0b36c43d`(横幅 evaluate __name) + 夹具路由删除 + 站点可达性折扣(eastmoney 反爬)。
**📦 Playbook B3 验证夹具 `1bf7ceb7` 部署 prod（B3_FIXTURE_ENABLED ON 临时）**（deploy-orch，preflight SAFE[live `437ab87c`→`1bf7ceb7` FF]，pm2 restart 674，healthz ok，auto-smoke skip=零烧钱；SPA 不动；无 migration）。orch flag-gated GET `/test/iframe-fixture`（仅 `B3_FIXTURE_ENABLED=true` 才注册，**默认 OFF=零 prod 面**）返跨域 iframe(src=example.com,border:0) 页。**两 flag ON 实证**：`B3_FIXTURE_ENABLED=true`+`ACTION_CAPTURE_ENABLED=true`（process env）。**夹具可达实证**：`localhost:4001/test/iframe-fixture` + 公网 `https://holaday.ai/api/test/iframe-fixture`（nginx 剥 /api/）均返含 example.com iframe 的 HTML。**待跑任务**：supercar 开夹具 URL→点 iframe 内「More information」→查 iframe click 行应有 visible_text+frame_path=example.com（B3 跨域确定性验证）。**验完即翻 B3_FIXTURE_ENABLED OFF**（零 prod 面），路由代码待删。前态：orch `437ab87c`。
**📦 Playbook B3 穿 frame 捕获 `437ab87c` 部署 prod（ACTION_CAPTURE ON canary 验 B3）**（deploy-orch，preflight SAFE[live `635257a4`→`437ab87c` FF]，pm2 restart 672，healthz ok，auto-smoke skip=零烧钱；SPA 不动；无 migration）。顶层 elementFromPoint 命中 `<iframe>`→**路由进该 frame 捕 frame 内目标文本锚/选择器**（那 1% iframe 拉到覆盖）。**只动 3 处 approved spot**：captureTargetDescriptor 主体 + `TargetDescriptor.framePath?`（可选、返回类型仍 TargetDescriptor|null）+ agent-loop emit 一行（`captureDescriptor?.framePath ?? null`，同款）。路由：`evaluateHandle(elementFromPoint)→asElement判空→contentFrame判空→boundingBox判空→frame-local(cx−box.x,cy−box.y)→frame.evaluate(同款 string buildProbe,marker='nested')`；**嵌套 iframe 退坐标兜底不递归**（v1 一层）。**string 形覆盖 frame 路径**（buildProbe Node 侧返不透明串；esbuild 实测 probe 串 `__name`-free）。frame_path=`frame.url()` 截 255，顶层仍 null。**热路径**：整块 `withTimeout(500)+try/catch`，任何失败（无 handle/contentFrame/box、sandbox/detached、frame.evaluate 抛、nested、超时）→退坐标兜底，**只 iframe-hit(1%)触发、99% 路径零额外延迟、点击无条件执行**。tsc 0、2939 测绿、biome 0 新增、对抗审 5 镜头 zero blocking。**待 canary 复验**：iframe 内 click 行应有 visible_text+frame_path。**B 阶段进度：B1✅ B2✅ B3✅(待验) → B4(截图锚)→ ①结晶**。🔴backlog：`task_0b36c43d` = playwright-executor.ts:336 `connect()` 横幅消除 evaluate 传函数（同源 __name 隐患，B3 scope 外，B 收尾改字符串形）。前态：orch `635257a4`。

<!-- 2026-06-22 — Playbook B2.2：captureTargetDescriptor evaluate 改字符串 IIFE，根治 esbuild keepNames 注入 __name 致 click 抛错 -->
**📦 Playbook B2.2 `635257a4` 部署 prod（ACTION_CAPTURE ON canary 复验）**（deploy-orch，preflight SAFE[live `1f04316b`→`635257a4` FF]，pm2 restart 671，healthz ok，auto-smoke skip=零烧钱；SPA 不动；无 migration）。**根因（B2.1 诊断确证）**：`captureTargetDescriptor` 的 in-page evaluate 是**函数形**，tsx/esbuild `keepNames` 把回调内 3 个 const 箭头（attr/esc/tryUnique）包了 `__name(fn,…)`，序列化进浏览器跑时 `__name`(Node 侧 helper) 不存在→**每个 click 必抛 `ReferenceError: __name is not defined`**→catch 吞→描述符 null→文本锚全 miss。**修复**：evaluate 改**字符串 IIFE**（in-page 逻辑写成模板串，inner `function` 在字符串里、build 不碰），坐标内插为 finite-number/null 字面量。**esbuild 0.24.2 实测**：函数形注入 `__name`×3、字符串形×0=根治。等价性+不变量守住（withTimeout/降级/脱敏/emit/写库/seam/外部契约全不动，B2.1 诊断保留）。tsc 0、2939 测绿、biome 0 新增 error。**✅ 验通（prod 实证 `tsk_7Pxk55`）**：click 行 `visible_text='Learn more'`、`capture:` warn=0、热路径健康（selector null 系 example.com 裸链接无稳定选择器=正合「文本锚为主」设计，实证 96% 文本锚落地）。**B1 表 + B2 捕获（含 B2.1 诊断 + B2.2 字符串形根治 __name）整体闭环。** **B 阶段进度：B1✅ B2✅(B2.1/B2.2) → 下一步 B3（穿 frame 捕获，`frame_path` 列已留位）→ B4（截图锚·关键步·独立留存躲 reaper）→ ①结晶**。前态：orch `1f04316b`。

<!-- 2026-06-22 — Playbook B2 canary + B2.1 instrument：ACTION_CAPTURE 翻 ON 真机验，click 描述符 null 诊断 -->
**📦 Playbook B2.1 capture instrument `1f04316b` 部署 prod（ACTION_CAPTURE ON canary）**（deploy-orch，preflight SAFE[live `685482b2`→`1f04316b` FF]，pm2 restart 670，healthz ok，auto-smoke skip=零烧钱；SPA 不动；无 migration）。**canary 现状**：`ACTION_CAPTURE_ENABLED=true` 已翻（process env 实证），第一条真机浏览任务（`tsk_zzUYox…`，example.com→click→iana.org）捕获 **3 行**——**navigate 捕获对**（entry_url+site_domain 都对）、**🔴 click 行整个描述符 null**（visible_text/selector/site_domain 全空、仅坐标存活，文本锚 MISS）；action_index 1→2→5 单调+间隙（非连续设计实证）；input_value 全 null（本任务无 type 动作，脱敏未触发）；热路径健康（0 capture warn、healthz 稳、pm2 不异常）。**B2.1 = 纯 instrument**（`captureTargetDescriptor` 每退出路径加 logger.warn 诊断，evaluate no-element 路径返回 `{__probe,tagName}` 映射回相同 `TargetDescriptor|null` 外部契约；只打元数据不打字段值/输入；guard/脱敏/emit/写库一行未动；2939 测绿、biome 0 新增 error、行为字节级一致）。**下一步**：再跑同款任务→只读查 `capture:` warn→四选一定位 click null 根因（threw/timeout/no-element+tagName/empty-text）→出 B2.2 对症修复。前态：orch `685482b2`。

<!-- 2026-06-22 — Playbook B2：supercar 每动作多信号捕获 → task_action_captures（flag-gated dark ship）-->
**📦 Playbook B2 捕获核心 `685482b2` 部署 prod（DARK SHIP，flag OFF）**（deploy-orch，preflight SAFE[live `e6798b48`→`685482b2` FF]，pm2 restart 668，healthz ok，keys present，auto-smoke skip=零烧钱；SPA 不动仍 `index-DiYh_GAx.js`；**无 migration**——B1 表已在）。supercar 每动作捕获多信号目标描述符（visible_text 主锚 + 稳定选择器 + 坐标）写 `task_action_captures`（①结晶蒸馏源）。**三层 seam**：执行器 `captureTargetDescriptor`（elementFromPoint/activeElement via page.evaluate，**withTimeout(400ms)+try/catch→null** 纯读不改页）｜agent-loop 派发处捕获+emit（click/type 动作前、navigate goto 后；**脱敏在 emit 前兑现**：password/OTP/cc/敏感字段+null 描述符 fail-safe→`[REDACTED:sensitive]`，原值绝不跨边界）｜tasks.ts onAction fire-and-forget insert（镜像 onTick）。**flag `ACTION_CAPTURE` 默认 OFF + tasks.ts 仅 on 时接线 onAction → OFF 时 agent-loop 整条捕获含 page.evaluate 全跳过=零热路径开销**。ext-id 前缀 `tac`（`cap` 已被 siteCapability 占）。**dark ship 实证**：process env + .env 均**无 `ACTION_CAPTURE_ENABLED`** → onAction 不接线 → 捕获全跳过，prod 零行为变化。orch 2939 测绿(+9 脱敏单测)，对抗审 5 镜头(热路径/flag-off/脱敏/seam/scope)零 blocking。**翻 on（canary 真机验）是另起一步、待 BOSS 单独确认**。B 阶段 backlog：getPage 微优化 / 未来 paste-fill 脱敏护栏。前态：orch `e6798b48`。

<!-- 2026-06-22 — Playbook B1：新建 task_action_captures 叶子表 + migration 0036（expand-first：先 apply 0036 验表、后部署代码）-->
**📦 Playbook B1 `e6798b48` 部署 prod**（expand-first 两步：先 apply `0036` 验表、后 deploy 代码；deploy-orch preflight SAFE[live `4beaa0ca`→`e6798b48` FF]，pm2 restart 667，healthz ok，keys present，auto-smoke skip=零烧钱；SPA 不动仍 `index-DiYh_GAx.js`）。**新叶子表 `task_action_captures`**（B 捕获层蒸馏源，多信号动作轨迹：visible_text 主锚 + selector + 坐标 + frame_path + screenshot_anchor + step_type；navigate 落 entry_url）—— **纯 additive**，FK 出去到 tasks(CASCADE)/evidence_artifacts(SET NULL)、无表 FK 进来，**零代码引用（B1 只建表）**。**migration 0036 手写**（drizzle meta-journal 不追踪手写 00NN，db:generate 会重发全 schema，故沿 0033 house style 手写增量）。**apply 经 `db:migrate:numbered`（幂等 skip-on-duplicate）**：首次 `applied=9`，**经核为良性**——重跑 `applied=8`(恒定) 证那 8 条是固有幂等重放（非 drift），0036 已转 alreadyApplied(149→150) 是**唯一新结构对象**；全集 0000–0036 grep **零破坏性 DDL/DML**（唯一 DROP=0004 同句重建同主键），那 8 条无论哪几条都不可能有害。**验表通过**：14 列/PK/`uk_external_id`+2×`ix_`/2×FK 全对。orch 2930 测绿，4 镜头对抗审 pass。**回滚预案（备查）**：`DROP TABLE task_action_captures;`。下一步 B2 捕获写入器（含 input_value 脱敏）。前态：orch `4beaa0ca`。

<!-- 2026-06-22 — Playbook P0：开 RETENTION_REAPER + ledger 留存 env 化 60d（orch-only，deploy-orch + 配 env flag）-->
**📦 Playbook P0 reaper `4beaa0ca` 部署 prod**（deploy-orch，preflight SAFE[live `ebc00054`→`4beaa0ca` FF]，pm2 restart 666，healthz ok，keys present，auto-smoke skip=零烧钱；SPA 不动仍 `index-DiYh_GAx.js`；**无 migration、未碰 schema**）。两件：**①留存 env 化**（`ledger-write-service.ts` 硬编 `TASK_EVIDENCE_RETENTION_DAYS=30` → `ledgerRetentionDays()` 读 `LEDGER_RETENTION_DAYS`，**默认 60**，neg/0/NaN/Infinity 守卫同 `outputFileTtlMs`；**只影响新写 artifact，旧行 expires_at 不回溯**；+3 守卫单测）｜**②开 reaper flag**（Vultr `.env` 加 `RETENTION_REAPER_ENABLED=true`，**未配 `LEDGER_RETENTION_DAYS`→走默认 60**；`index.ts:774` 的 `setInterval(24h)+unref` cron 翻 flag 即注册，process env 实证 `RETENTION_REAPER_ENABLED=true`）。reaper **只删过期 `evidence_artifacts`+级联 links**（不碰 claims/tasks/playbook 等活数据），R2 先删对象后删行，有界 200/次。**首跑 no-op**（最早 artifact 06-12 写、新写已 60d，本轮注册即可、删 0 行）。orch 2930 测绿。明确 carry backlog：孤儿 claim 清理 / R2 严格 retry。前态：orch `ebc00054`。

<!-- 2026-06-22 — 批2 IP 合规闸 SPA 段（①per-generate 授权勾选 + ②条款链接），SPA-only -->
**📦 批2 IP 合规闸 SPA 段 `8da47b4b` 部署 prod**（deploy-spa 双端 Aliyun+Vultr，smoke 双绿 http200+HOLA DAY+hash，bundle `index-DiYh_GAx.js`；无 migration、未翻 flag、orch 仍 `ebc00054`）。**①per-generate 授权勾选**：IpGenerateForm 加每次生成都要勾的 consent（默认 false），handleSubmit 守卫 + 生成按钮 `disabled={submitting||!consent}`；**onboarding consent 零改（双保险）**。**②条款链接**：consent 旁挂现有 `/terms`+`/privacy`（复用，未新建页/路由、未单列深度合成专页）。web 689 测绿。**至此 IP 合规闸 4 条齐活**：orch ③元数据+④审计(ebc00054) + SPA ①勾选+②条款(8da47b4b)，**仍 BOSS-only 灰度未 widen**。真机验收进行中（零烧钱，验到提交校验为止）。前态：SPA `index-CLucrgwa.js`。

<!-- 2026-06-21 — 批2 IP 合规闸 orch 段（③元数据埋标 + ④审计入口），orch-only -->
**📦 批2 IP 合规闸 orch 段 `ebc00054` 部署 prod**（deploy-orch，preflight SAFE[live d123c5f9→ebc00054 FF]，pm2 restart 664，healthz ok；SPA 不动仍 `index-CLucrgwa.js`；**无 migration、未翻 flag、未开放新权限面**）。**③元数据埋标**：`buildComposeCommand`+`buildPetVideoCommand` 在 outputPath 前埋 `-metadata comment="AI 生成 / AI-generated by HOLA DAY"`（深度合成机读标，**可见角标 'HOLA DAY · AI' 零改**）。**④审计入口**：新 `admin.ipComplianceAudit`(adminProcedure，沿用 role=admin 闸) 只读聚合每条 IP 成片（谁/何时生成/何时授权 videoSelfUseAuthorizedAt/文案/本人素材引用 baseVideoFileId+qwenVoiceId/输出成片），现成列拼装无新表字段。orch 2927 测绿(+7)。**验收：④接口部署后真机直验(零烧钱)；③ metadata 实标 BOSS 下次真生成 ffprobe 白捡**。SPA 段（consent 勾选+条款链接）待下条。前态：orch `d123c5f9`。

<!-- 2026-06-21 — 批1 SPA：全屏误关修(①) + bundle 版本检测(③)，SPA-only -->
**📦 批1 SPA `b6e5dea0` 部署 prod**（deploy-spa 双端 Aliyun+Vultr，smoke 双绿 http200+HOLA DAY+hash，bundle `index-CLucrgwa.js`；无 migration、未翻 flag、orch 仍 `d123c5f9`）。两 commit：**①`922ccdd5` 全屏误关修**（BrowserPanel 伪全屏退出从 2.5s 自动隐藏 bar 豁免出来→常驻右上 pill 拦原生关闭 X + 「Esc 退出」角标；核心 UI 非视频专属）｜**③`b6e5dea0` bundle 版本检测**（轮询 live index.html `cache:'no-store'` 比对 hash→可关闭「有新版本」横幅，用户点才刷新、绝不静默 reload；nginx index.html 已 no-cache 旁证）。web 689 测绿。真机验收进行中（零烧钱）。前态：SPA `index-B8q1wOE7.js`。
<!-- 2026-06-21 — 成片 TTL 24h→30d（orch-only，deploy-orch） -->
**📦 成片 TTL 24h→30d `d123c5f9` 部署 prod**（deploy-orch，preflight SAFE[live b8cc4d83→d123c5f9 FF]，pm2 restart 663，healthz ok；SPA 不动仍 `index-B8q1wOE7.js`；**无 migration、未翻 flag**）。`storeOutput` 的 `expires_at` 从 hardcoded 24h 改 `now+outputFileTtlMs()`=`OUTPUT_FILE_TTL_DAYS`(默认30d，正整数守卫)；读时闸+cleanup-cron 认每行 expires_at 自动跟随，零改。**Vultr 未设该 env→默认30d（进程env+.env 双实证 absent，新 helper 3 refs 已进 dist）**。划界守住：上传占位24h/input NULL/cron/读闸 未动，不迁移旧行。orch 2920 测绿(+5)。**验收：30d 实戳需新成片才看得到=烧钱，本轮不烧；单测绿=逻辑已证，BOSS 下次真生成白捡查 DB（expires_at≈now+30d）**。前态：orch `b8cc4d83`。

<!-- 2026-06-21 — 第二轮前端 A组+B组+ops 部署（SPA-only，orch 不动） -->
**📦 第二轮前端 `49ae6ee1` 部署 prod**（deploy-spa 双端 Aliyun+Vultr，smoke 双绿 http200+HOLA DAY+hash，bundle `index-B8q1wOE7.js`；无 migration、flag 未动、orch 仍 `b8cc4d83`）。三栈 FF push：`a655c265`(A组 UX hint/reason+retry/历史隔离/poster/videoType)+`5d23225b`(ops vultr-exec.sh)+`49ae6ee1`(B组 面板位置/IP去图片版)。**回归测 `c93dd885`(test-only) 未推**——单独审后 push-only。web 679 测绿。真机验收进行中（零烧钱，A1 文案本轮不验=需生成中态烧钱未授权）。

<!-- 2026-06-20 — IP fal 动态超时修部署 + 真机验通 -->
**📦 IP fal 动态超时修 `b8cc4d83` 部署 prod**（deploy-orch，preflight SAFE，restart 662，healthz ok；SPA 不动仍 `a70642c2`；无 migration、flag 未动）。`runLipSync` 的 `maxWaitMs` 改成 `lipSyncMaxWaitMs(audioMs)=clamp(60s+音频秒×16s, 300s, 720s)`（IP lane 传 audioMs，≤40s→≤700s）；retry 仍无；+5 单测；orch 2915 测绿。**★真机验通**：烧一条 185 字→**约 35 秒** IP（`tsk_k88u`，allowlist BOSS）→ **completed**（maxWaitMs=**620s**；fal latentsync 实耗 **~350s**——**>旧 300s，旧码必超时**，新 620s 顶住）；总 421s 出片，output+poster 都有，`videoType=ip_person`，无 timeout/无 error。前态：orch `68f28859`。配套 UX 文案（IP「生成中」「约 X 分钟」）仍归 🟡 第二轮前端。

<!-- ========== 🎬 视频 Phase 2 状态 + backlog（2026-06-19/20 换 session 收尾）========== -->
**🎬 视频 Phase 2 — 当前状态（一句话）**：三类型 prod 真机全验通（普通¥8/宠物¥1/IP¥2，BOSS 都认了）；第一批前端 polish + 第二批第一轮后端**都已 LIVE**。**PROD LIVE REF = SPA `a70642c2` / orch `68f28859`**。
- **第一批前端 polish（`a70642c2` LIVE）**：黑边修（去 bg-black/w-auto）+ 失败不进历史（toVideoRow 只留 completed 有附件）+ 切 tab 清面板（清 ?task=）。
- **第二批第一轮后端（`68f28859` LIVE）**：①poster 生成（三 lane compose 后 ffmpeg 抽首帧存 R2、posterUrl 盖 attachment、**抽帧失败兜底不拖垮成片**）②videoType（deriveVideoType 打 metadata）③reason 白名单映射（mapVideoFailureReason，**不泄 stack/url/file_id**）。真机实证：poster.jpg 生成 + posterUrl + 成片正常；reason 降级「服务繁忙」零泄露。
- **★fal lipsync timeout 根因已查清（非 fal 波动/非余额，fal 还 $18.40）**：**确定性长素材超时**——latentsync ~12-14× 实时，`DEFAULT_MAX_WAIT_MS=300s` 固定值对 >~20s 输出不够（16s 片 ~225s 成功、37s 片需 ~460-520s → 300s 客户端主动放弃）。loop_mode 让输出长度=音频长度。无 retry。

**📋 待做清单（下一 session 接续，按优先级）**
- 🔴 **IP 稳定性（fal 超时修，后端小改）**：`runLipSync` 的 maxWaitMs 改成按音频长度 `clamp(60s + 音频秒 × 16s, 300s, 720s)`（覆盖 ≤40s 上限；IP lane 已有 audioMs 传进去）。配在 `fal-lipsync-client.ts` 的 `DEFAULT_MAX_WAIT_MS`/`runLipSync`（lane 传 maxWaitMs）。**retry 已否决**（确定性超时，重试只再卡再烧）。
- 🔴 **配套 UX 期望文案（前端）**：IP「生成中」面板明确「真人换口型较慢，预计约 X 分钟，请耐心等待」（否则用户等 8-10 分钟以为卡死）。
- 🔴 **待 BOSS 决策·产品**：latentsync ~12-14× 实时太慢（40s 等 ~10 分钟），长期要不要换更快换口型方案/端点。未定。
- 🟡 **第二轮前端（完整设计已出）**：4b 成片内联播放（poster `<img>`+lazy：默认不拉全量 5MB、不渲 `<video>`，显 poster + ▶播放/下载；点播放才按需新建单个 video；poster 后端已 LIVE）｜2 面板位置（甩顶部→生成视频下方就近）｜4 历史按 tab 隔离 + IP 历史（后端 videoType 已 LIVE，前端接）｜6 失败 reason 展示+重试+清 loading 残留（后端 reason 已 LIVE，前端接）｜7 IP 去图片版｜videoType enabler（plumb 到 UiTask）。
- 🟢 **IP 合规闸（上线前必做）**：授权声明保留 + 条款 +「AI 生成」标识 + 可追溯（BOSS 拍板轻量方案）。
- 🔴 **[核心 UI，非视频专属] 全屏关闭误触浏览器**：BrowserPanel **CSS 伪全屏**（非原生 Fullscreen API）→ 浏览器原生关闭 X 一直可触；FullscreenFloatingToolbar 含唯一页内退出但 2.5s 整条自动隐藏→用户找不到出口点原生 X 关掉浏览器（真实伤害）。影响**所有 browser/scrape 执行型任务**的截屏面板。**A+B fix 已落码（待部署）**：退出 pill 豁免出 2.5s 隐藏门、常驻显眼（右上拦截「去关闭」本能）+ 常驻「Esc 退出」角标。**C（改真·原生 Fullscreen API，根治误触 surface）单独排期未动**。
- 🧹 **prod 测试数据清理**：`tsk_duct`/`tsk_RCrQ`/今天一堆 + 之前 `qa-*` 号（无害但污染统计，删 prod 数据需谨慎、先列清单给 BOSS）。
- 🧹 **MEMORY.md 超限**（30.8KB > 24.4KB）：下轮列可归档 stale 条目清单给 BOSS 过目再清。

**🅿️ 视频线尾巴/Parked（2026-06-21 录入，防躺没）**
- 🟡 成片留存终态决策(上量前):30d 之后够不够?按档位永久留存 / 用户删权?— BOSS 商业决策,defer 到上量
- 🟡 过期提示 UX:历史/详情「成片 30 天内可下载」提示 — TTL 30d 后低优;留存终态若改短 TTL 才回炉
- 🟢 bundle 版本检测/有新版自动刷新 — 小 polish,搭后续批捎带
- ⚪ A1「生成中」文案待白捡验:下次真生成 IP 时看「真人换口型较慢,预计约 X 分钟」文案
- ⚪ 30d 实戳待白捡验:下次出片查 `task_files.expires_at ≈ now+30d`(非 +24h)
- ⚪ fal 700s 上限观察:动态上限已上(b8cc4d83),待烧 38-40s 片(maxWaitMs 逼近 700s)时观察 fal 端是否自有顶
<!-- ========== 视频 Phase 2 状态 + backlog 结束 ========== -->

<!-- 2026-06-19/20 — 视频第二批·第一轮后端部署（poster/videoType/reason） -->
**📦 视频第二批·第一轮后端 `68f28859` 部署 prod**（deploy-orch，preflight SAFE，restart 661，healthz ok；**SPA 不动**仍 `a70642c2`；无 migration、flag 未动）。三笔：①**poster**（lane compose 后 ffmpeg 抽首帧 JPEG 存盘，非致命）②**videoType**（成片 metadata 打 normal/pet/ip_person）③**reason 白名单映射**（lane 失败透传安全友好 reason，不泄 stack/url/file_id）。**真机烧片实证（BOSS 授权）**：①poster 普通视频 `tsk_duct`（1段720p ¥6）→ completed、task_files 多 `holaday-video-poster.jpg`(88KB)、attachment 带 `posterUrl`、`videoType=normal`、**成片本身正常完成**（poster 没拖垮）；②reason `tsk_RCrQ`（IP，文案 37s 过了 too_long 闸→走 fal）→ fal **timeout** 失败 → DB reason=**「服务繁忙，请稍后再试。」**（具体 busy、非通用兜底）、完整 err(message/stack/路径)只进**服务端日志**、用户 reason **零泄露**。metered 无 429。**未碰钱/门控/migration**。⚠️ 顺带：fal lipsync 300s 超时（fal 侧慢/账户，本次降级正确，非本批 bug）。前端第二轮（poster `<img>`+lazy + 面板位置 + 历史隔离 + reason 展示 + IP 去图片版）待做。前态：SPA `a70642c2`/orch `6fb2dbb9`。

<!-- 2026-06-19 — 视频前端 polish 第一批部署（纯前端 SPA，orch 不动） -->
**📦 视频前端 polish 第一批 `a70642c2` 部署 prod**（SPA bundle `index-D6HnnOOe.js` 双端 smoke 过无回滚；orch 仍 `6fb2dbb9`；无 migration、flag 未动）。三项纯前端：**①黑边**（FileDownloadCard/Modal 内联 `<video>` 去 `w-full`+`bg-black`+`object-contain`→跟视频固有比例，DOM 实证 `bg:rgba(0,0,0,0)`+`w-auto`，黑边消除）；**③失败不进历史**（抽 `lib/video-history-row.ts`，只收 `completed`+有附件成片，失败/取消/报价 stub/executing 全 drop，+10 单测；真机实证历史只剩成片、失败任务消失）；**⑤切 tab 清面板**（切 tab `navigate('/video')` 清 `?task=`，真机实证切到宠物 tab 面板消失）。**真机复验**：提交→报价卡页内直出**不复发 #185**（console 零错）、首页/文件库/图片预览正常、共享组件回归干净（猫图预览不变形）、**零 Veo**。web 662 绿。⚠️**新发现（非本批、留 backlog）**：成片**内联视频播放器卡 buffering**（`readyState:0` on 有效 5MB mp4 blob，可能 6fb2dbb9 内联预览实现或 Chrome 多视频并发节流；下载可正常）→ 待查。第二批=面板位置/历史按 tab 隔离/失败原因透传/IP 图片版 + videoType enabler。前态：`8c8bdb4e`。

<!-- ========== 🎬 视频 Phase 2 今日收尾 2026-06-19（验收，无新部署） ========== -->
**🎬 视频 Phase 2 — 三类型 prod 真机全验通（BOSS-only 灰度，BOSS 逐条授权烧片）**
- **普通文生 ✅** ¥8，质量「还可以」（tsk_uT5 / tsk_7GFj）。**宠物 i2v ✅** ¥1，「动起来了」（报价 tsk_yVRa→出片 tsk_WKVj）。**IP 换口型 ✅** ¥2，嘴型「可以」（报价 tsk_N6dB→出片 tsk_tAqb，本人合格底版）。
- **三类型页内闭环全部成立**：报价→确认→生成进度→成片**内联预览**→下载，全留 `/video` 不跳主流。
- **本 session 修复并 LIVE 的 bug 链**（细节见下方部署块）：`fad7971` 段数虚高 + 面板遮报价卡 → `6fb2dbb9`(Codex) 页内闭环 + artifact 安全 → `8c8bdb4e` React #185 无限渲染崩溃。**今日纯验收无新部署**，PROD LIVE REF 不变。
- **IP 失败根因（已查实，非 bug）**：fal latentsync **422 face_detection_error**；失败 tsk_39We 用的底版是抖音 @央视新闻 民警视频（**别人的脸**），Claude 合规拦下；换 BOSS 本人合格底版后成功（tsk_tAqb）。计费：Qwen 合成那笔真扣（按字符/几分钱级），fal 422 预检无产出≈未计费，用户额度 ¥0。
- **下一轮 backlog（完整清单 + 优先级见交接 memory `handoff-2026-06-18-video` §backlog）**，标题速览：
  - 🔴 **全屏关闭误触浏览器**（视频原生全屏后顶部无页内退出→点到浏览器关闭按钮关掉整个浏览器，真实伤害）｜**IP 合规闸**（上线前必做，BOSS 拍板轻量 4 条：本人授权声明+条款+「AI 生成」标识+可追溯，不做重技术校验，《深度合成管理规定》最低线）
  - 🟡 **「视频前端体验 polish」一包**（建议同片 VideoPage+播放器+历史列表一轮改）：历史按 tab 隔离 + IP 自己的历史 / 报价面板位置就近（别甩到顶部挤乱布局）/ 失败任务不进生成历史 / 预览黑边按实际宽高比自适应 / 切 tab「当前制作」面板不切不清 / 失败原因透传（fal「检测不到人脸」等 actionable 错误被 tasks.ts:5781 抹成「请稍后重试」）+ 重试入口 / 失败态残留「正在生成回答…」
  - 🟢 IP tab 去掉无意义的「图片版」选项
  - 🧹 prod 测试数据清理（今日烧的 tsk_uT5/7GFj/yVRa/WKVj/N6dB/tAqb/39We + 一堆 qa-* 测试号；**删 prod 有风险，谨慎**）
  - **建议**：🟡+🟢 打包成「视频前端体验 polish」一轮（方案→一起修→一次部署，防零敲引新 bug）；🔴 全屏误关 + IP 合规闸 + 数据清理各自单独评估。
<!-- ========== 收尾结束 ========== -->

（2026-06-19；**#4 视频页内闭环(Codex `6fb2dbb9`) + React #185 修复(`8c8bdb4e`) 部署 prod**。SPA bundle
`index-BN6tjkhC.js` 双端 smoke 过无回滚；**orch 未重部署**(本次纯前端，8c8bdb4e vs 6fb2dbb9 只差 VideoPage 前端)，
orch 仍跑 `6fb2dbb9`(restart 660，healthz ok)。无新 migration；flag/allowlist 未动(`VIDEO_CREATION_ENABLED`=
true + allowlist=`usr_EeYp…` BOSS-only 灰度)。**`6fb2dbb9`=Codex 5 commit**：视频 报价→确认→进度→成片预览→下载
全留 /video 页内闭环(不再跳主对话流) + 附件挂 terminal 帧(成片即时呈现) + 文件产物/下载处理。拓扑核对纯快进、
敏感区(钱/门控/migration)全未碰。**部署后真机验抓到 P0 回归 React #185**：每次提交视频→切 /video?task= 那一刻
无限渲染崩到「页面暂时无法加载」错误卡，只手动 reload 恢复(仅影响 BOSS-only 灰度，零真实用户)。**`8c8bdb4e`=fix
#185(纯前端,fix-forward 不回滚)**：根因=VideoPage `CurrentVideoTaskPanel` 的 `(s)=>s.stepsByTask[id] ?? []`
每次 new 一个 `[]`，Zustand v5 裸 `useSyncExternalStore` 要求快照引用稳定→无限重渲(#185)；刚提交的任务无 steps
必踩，reload 后 detail 填了稳定数组才不崩。修：抽 `EMPTY_STEPS`(冻结模块常量)+`selectStepsFor` 返回稳定引用 +
deep-link refresh effect 加一次性 ref 守卫(`shouldRefreshForTask`)。**真机复验**：3 次提交报价卡直接渲染、不崩、
不用 reload、console 零 #185；首页/核心路径正常；**零 Veo**。+9 测(选择器引用稳定性 + getSnapshot 收敛模拟，
临时改回 `?? []` 实证红→恢复绿)；web 652 全绿、build(lint react-hooks/tsc/vite)0 错。lint 没拦住是因 selector
无依赖数组、exhaustive-deps 不分析其返回引用稳定性(运行时契约，静态 lint 不建模)。下一步=BOSS 在场授权后真机验
「确认制作→出片→进度→页内预览→下载」整条 + 真用户烧 Veo 验收。前态：#4 `fad7971`(restart 659)。）
（2026-06-19；**#4 视频 段数 P1 + 报价卡面板 P3 两修 部署 prod**，restart 659，preflight FF-safe，
无新 migration。承接 4c（视频三类型 BOSS-only 灰度 LIVE，flag `VIDEO_CREATION_ENABLED=true`+allowlist=
`usr_EeYp…`）。fad7971 经 merge `77c2afe` **含 #2 的 115ba53/判官 f1d8693，无 revert**。**P1 段数**：
`segmentCapForText`(≈每30非空白字1段,clamp1..6) 传 optimizeUserScript maxSegments + 提示词下限 max(3→1)
+ 硬截断 `slice(0,maxSegments)` → 短文案不再硬凑 6 段，报价随段数降。**P3 面板**：抽 `needsBrowserViewport`
排除 video_quote(+clarification) → 视频报价卡不再被 BrowserPanel 误挂遮挡。**双向实证(Chrome,BOSS号)**：
短文案~36字→**1段/¥8**(原6段/¥36)、长文案~145字→**5段/¥36**(仍多段没矫枉过正)；报价卡两次
`hasBrowserPanel:false`；metered 号建任务**无 429**(quota affectedRows 修未受影响)。只到报价卡、**零 Veo
消耗**、flag/allowlist 未动。SPA bundle `index-DiPfLrm_.js` 双端 smoke 过无回滚；orchestrator 2886+web
642 测绿。前态：#2 `115ba53`（restart 655）。下一步=BOSS 真用户烧 Veo 验收。）
（2026-06-15；**#2 ⑦ LLM 意图判官第二层 + 总市值万亿口径 部署 prod**，restart 655，preflight FF-safe，
无新 migration。BOSS 拍板：⑦ 要稳定出现，不接受 ~78% 降级率(同股不同次不一致)。**双层防御**(regex
之后加温度0 LLM 判官，只判买卖引导/涨跌预测两红线)：regex PASS→judge 仅明确 block 才否决(补漏网)；
regex SOFT(predict/tension/semantic)误杀→judge 仅明确 pass 才救回；regex HARD(advice/technical/
ungrounded)→regex 终判 judge 不介入；judge unclear/失败→回落 regex(PASS 仍出/SOFT 仍降级)，绝不因
judge 抖动制造新降级。flag `ASHARE_INTENT_JUDGE_ENABLED`=true 已开 Vultr(进程实证)，仅挂全景⑦不动
轻量③。**复测主因纠偏**：降级主因不是 predict 误杀，而是 ⑤ 用 fmtNum 呈现「18,402.50亿」、⑦ 天然说
「1.84万亿」→ 闸门裸值比 1.84≠18402 误判 ungrounded(千亿级 mega-cap 必踩，宁德 4/4 降)；`fmtMvYi`
≥1万亿 统一「X.XX万亿」口径(body+context 同口径，⑦ 照抄即接地)。**真路径复测⑦通过率 78%→94%**
(迪生力/茅台/宁德 4/4 稳定，治好「迪生力时好时降级」；金钼 6/6 隔离稳定)。**对抗复审**：买卖/预测
泄漏 **0/12**(判官补抓 regex 漏网 4 例：用…价格在买/会反弹/未来高增长可期/目标看翻倍)，合规误降 **0/5**。
全量 **2708** 测绿(+判官9+gate subReason+runner 双层7+fmtMvYi+万亿接地)；tasks.ts 仅 +14 行无 churn。
前态：审查批 `bfaef0e`(restart 652)。）
（2026-06-15；**#2 全景速览审查批 follow-up + ②资金面铁律 部署 prod**，restart 652，preflight 实读
live HEAD FF-safe，无新 migration。修：**P0 报告期取错**（`stock_financial_abstract_ths` 旧用
`df.head(80)` 截断长历史股最新期→驰宏取成「2022中报」与趋势矛盾=信任杀手；改 `_ths_sorted` 按报告期
升序取 `iloc[-1]`，驰宏实证 2026-03-31）+ **P1 ④补**扣非净利润/每股经营现金流/季度环比 + **P1 ⑤补**
相对行业静态PE中位（cninfo `_retry` 包裹→行业分位真渲染，⑦方向预算正确）+ **P2 ⑦真解读**（数字翻人话+
点重大信号如解禁抛压，③⑦解禁口径统一「全部N笔合计」）+ **②资金面铁律**（`bfaef0e`：⑦ prompt 加铁律——
龙虎榜/北向无数据时绝不编造主买/资金流入，regex 闸门抓不住无数字的定性脑补）。**真路径实证**：驰宏600497
（今日涨停·有龙虎榜→⑦如实引「买一主买」）+ 茅台600519（当日未上榜→② 龙虎榜「当日未上榜」、⑦「龙虎榜
当日无数据」**零编造**）；两股 ④报告期=2026Q1、⑤行业中位方向正确、零买卖词、标时效、disclaimer 全在。
前态：step1 `95ee29a`（restart 649）。）
（2026-06-15；**#2 Phase2 全景速览 step1 + ⑦闸门对抗加固 部署 prod**，restart 649，healthz ok，
全量 **2688** 测绿。**ultracode 对抗复审**：4 红队策略压测 ⑦ 合规闸门，真 complianceGate 实测初版
漏 3/12（语义迂回预测 + 技术信号 regex 盲区）→ 补 SEMANTIC_PREDICT(拐点正在积累/只是时间问题/
自然收敛)+TECHNICAL_SIGNAL(筹码锁定/控盘/缩量封板/量价背离/跳空/回到X一线，BOSS 红线 MACD金叉=买入)+
TENSION repair 词 → **复审 0/12 漏，合规⑦不误杀，+10 永久回归测**。⑦ 真 haiku 通过率 迪生力6/6、
茅台3/6、平安5/6（降级=安全网，①-⑤恒在）。**残留(诚实)**：regex 是 backstop，语义评判有天花板；主防线
=⑦ prompt；更高保证可加 LLM-intent-judge(step2，BOSS 拍板，加一次 LLM 成本)。以下为 step1 主体：）
（2026-06-15；**#2 A股 Phase2 全景速览 step1 部署 prod**，restart 648，healthz ok，preflight 实读
live HEAD 各步 FF-safe；build tsc0，全量 **2678** 测绿；无新 migration。**先验数据可达性再写码**
（push2 不可达→同花顺/百度/cninfo 替代，迪生力 603335 真调验通）。**④ 基本面**（同花顺 营收/净利+
同比增速·销售毛利率·ROE·资产负债率·近3年趋势，硬标「基于2026Q1财报，CAS」）+ **⑤ 估值**（百度
PE-TTM/PB + 近5年历史分位 + cninfo 行业静态PE中位，硬标「估值截至06-14」）+ **deep 触发**（详细分析/
全面看看/深度分析 XX→七维全景版；**不动**速览/为什么涨/割肉/指数 lane，意图区分保「一句话即得」）+
**⑦ 分析师视角**（LLM 白话状态画像，状态判断非买卖，过合规闸门；越线/失败→丢⑦留①-⑤优雅降级+计数）。
合规闸门补盲（设计评审 workflow 发现真缺口）：估值数(PE/PB/分位/倍数)**数值容差接地**(容忍 67.2/67.20
口语约数)+排年份(假目标价不被年份误接地)+张力延展拦截(高位早晚回落=predict)；④⑤ 确定性层零形容
（判断统一归⑦）。**真路径实证**：「详细分析迪生力」→ executorLane=ashare_panorama 出 ①-⑤+⑦；
「迪生力为什么涨」→ 轻量速览(①②③)不误伤。⑦ 真 haiku 通过率：迪生力 6/6、茅台/平安 4/6（降级=合规
安全网，①-⑤ 恒在）。step2(资金连续性/行业个股对位)待验证后做。
前态：`c092562`（#5 图片 P1 执行层）。）
（2026-06-14；**#5 图片 P1 执行层重修 部署 prod**，restart 644，两边 healthz 200，SPA 双边
`index-CtjniCcy.js`，preflight 实读 live HEAD=`3f76062`（ancestor of c092562）→ FF-safe；keys（GEMINI+
ANTHROPIC）在进程；无新 migration。**纠正 `707af37` 误判**：上轮把 P1 当作 FileDownloadCard 缩略图占位
来修，线上行为没变——真问题在执行层两处：① 图片任务执行期进度显示通用「正在生成回答…」→ 新增
`generating_image` 子状态（「正在生成图片…」），图片 lane 发出，贯穿 WS substatus 帧 + TaskStream 实时
chip + TaskListItem 列表 chip；② 文字结果「已生成1张图片」先 commit、缩略图一个 tasks.detail 往返后才到
（用户截图的割裂）→ 图片 lane 把 `attachments[]` 挂上 `server.task.terminal` 帧，SPA terminal handler
立即 stamp 到任务，图卡与摘要文字同帧渲染；附件校验器抽成共享 `parseUiAttachments()`。orchestrator
2657 测 + SPA 测全绿（唯一失败 `control-tooltip.test.ts` 经 stash 实证为 `5d4bb2c` NotificationBell
预存在，已开 task chip 上报，与本次无关）。**待 Claude 重测：① 执行期「正在生成图片」② 图文同帧出现。**
前态：3f76062（#1 模板）。）
（2026-06-14；**#1 模板填充 E10 P0 文件名乱码（深层根因）修复部署 prod**，restart 643，healthz ok，
build tsc0，keys in process；preflight 实读 live HEAD=`d4da1e5`（ancestor of 3f76062）→ FF-safe；
无新 migration。根因：**存储的模板名本身就是 mojibake**（SPA 存成 å¨æ¥æ¨¡æ¿.xlsx），输出名=模板名+
"-已填充" 传播坏名→下载头再正确编码也是乱码。修法：**输出名生成处防御**（`outputFilename` 先
`decodeUploadFilename` latin1→utf8 修复，仍乱码则 fallback `填充结果-<ts>.xlsx`；摘要文案同样修复→
`你的模板` 兜底）+ 新 `looksLikeMojibake`（C1 控制字节/U+FFFD，不误伤 café/CJK）。**live 实证用 BOSS
原 mojibake 文件 `file_wmCFjV2iwBhZQYj5i8mtF` 重测：输出名=`周报模板-已填充.xlsx` 干净**。2667 测绿。
前态：d4da1e5（#5 图片）。）
（2026-06-14；**#5 图片 P0 文案合规 + P1 预览占位 部署 prod**：SPA 双边 `index-bh0_PXtK.js` + orchestrator restart 642，preflight FF-safe（live a139887 是 ancestor），key 校验「GEMINI+ANTHROPIC 在进程」，healthz 200。commit `dcbf015`(P0 营销图禁编造促销文案——buildImagePrompt 硬约束 + 负向测 + live 实证「全场五折」只出一个优惠) + `707af37`(P1 FileDownloadCard 图片加载占位，消「文字先出图片后到」割裂)。一并带上 a139887(#2④) + #1 模板修复。**Phase 0 待 Claude 重跑全套对比 12/16 基线。**）
（2026-06-14；#2 A股 ④ matcher E03/E16 精修部署 prod，restart 641，healthz ok，build tsc0，
preflight 实读 live HEAD=`2617392`（ancestor of a139887）→ FF-safe；akshare-mcp 同步重启（停用词）；
无新 migration。修复（Phase 0 评测暴露的 ④ matcher 两处过激，prod 日志实证根因）：
E03「X 为什么涨」因素归纳③不再被裸词「后市」误降级——gate 改「后市+方向词」才算预测、
中性「后市表现/走势」放行（真买卖建议/割肉/补仓仍降级）；E16「查今天A股三大指数收盘」不再
误命中「今天国际(300532)」——走新**指数 lane**（确定性三大指数速览卡）+ name-search 收紧
（indexIntent/长查询跳过）+ 服务端常见词停用词。**真路径复测**（createCaller 打 prod）：
E16→executorLane=ashare_index 出大盘速览卡；E03→出③段、尾「以上因素与股价变动的关联未经证实」、
未降级。全量 2643 测绿（+13 回归锁 E03/E16 原文）。
前态：`2617392`（#1 模板填充 E10 两个 P0）；`f60e698`（视频 #4 步骤1，migration 0034）。）

---

## 协作约定（硬规则，立即生效）

1. **worktree 隔离**：每个 session 必须在独立 `git worktree` + 独立分支干活，**绝不共享工作树**。
   迁移前先把 WIP commit/stash，再 `git worktree add ../holaday-<任务名> -b <分支>`。
   破碎 session 共享树会阻塞他人 build + 提交纠缠。

2. **停点必更新 + push**：到任何停点（交付 / 阻塞 / 移交 / 长暂停）**必须**更新本文件
   「自己的小节」（状态、分支、HEAD commit、已完成、待办、阻塞、给别人的提醒）并 push。

3. **只改自己的小节**，不动别人的小节。需要提醒别人时写在「跨 session 提醒」区。

4. **落库铁律 —— 批准 ≠ 完成（lesson ②）**：DB migration 的「BOSS 确认 / 已批准」只是
   *授权 apply*，**不等于 apply 已完成**。任何「已落库」声明都必须**回带验证证据**：
   写明目标库（host + db），并附 `information_schema` 查询输出证明**表 / 列 / 索引 / 外键**
   确实存在。**无验证证据 = 未闭环**，不得标记完成。apply 前还须先验证**前序 migration
   实际已在目标库**，不能只凭口头/记忆。

5. **migration 编号 + 顺序（lesson ①）**：编号单调递增、低号先行。numbered applier
   (`pnpm db:migrate:numbered`) 是 **skip-on-exists**（对 ER_TABLE_EXISTS / ER_DUP_FIELDNAME /
   ER_DUP_KEYNAME / ER_FK_DUP_NAME 等跳过），所以**乱序 apply 可容忍、未来全量重跑不会因
   顺序报错**。但**仍应按编号顺序 apply**；只有当两个 migration 互不引用（disjoint）时顺序才
   真正无关，一旦有 FK / 列引用依赖就必须严格守序。

6. **写明目标库**：apply 时必须确认连的是哪个 DB（生产 = Vultr `holaday`@127.0.0.1，取
   `apps/orchestrator/.env` 的 `DATABASE_URL`）。多次「应用到了别的库 / 本地 dev 库」的误传
   都源于没核对目标库——apply 脚本里要 echo 出 `host/db` 并在验证里复查。

7. **部署铁律 —— 先实读 live HEAD，不许凭记忆假设 prod 分支（lesson ③）**：部署前**必须从
   live 服务器实读当前 HEAD**（`git rev-parse HEAD` + `git branch -r --contains HEAD`），
   不许凭记忆 / SESSION_STATUS / 口头假设 prod 在哪个分支。**reset 前 preflight 必打印**
   「当前 HEAD + 它在哪些 origin 分支上」；若**当前 HEAD 不是你预期部署源的祖先** → **停下报告，
   不许继续 reset**（防止把别人刚部署的 prod 覆盖回旧码）。部署后**部署者更新顶部 `PROD LIVE REF`
   行**。工具：`scripts/deploy-preflight.sh <分支>`（在 live 上跑，非 0 退出即拒绝部署）。
   　由来：#3 凭「live 跑 musing-keller@b0fd428」假设，实读发现 prod 已是 #1 的 `1ba76bb`（路由补强，
   　部署在我合并之后）；若当时盲目按 b0fd428 redeploy 会**覆盖掉 #1 刚上线的修复**。规则当场拦下。

---

## 经验教训（真实案例，约定的由来）

- **① 0033 先于 0032 落库**：因「0032 已落库」误传，#3 在 0032 实际未落生产库时先 apply 了
  自己的 0033。两者 disjoint（0033 不引用 watchlists），无害；numbered applier 全量重跑安全
  （skip-on-exists，顺序无关）。**教训**：apply 前先验证前序 migration 实际在目标库，别凭声明。

- **② 批准≠完成（0032 三次误报）**：#2 的 0032 apply 脚本失败，但被口头/记忆标记为
  「已落库（BOSS确认）」——「BOSS确认」实为*批准*而非*完成*。结果 0032 被**三次**声明落库，
  而 Vultr 生产库 `holaday` 实测**始终没有 watchlists**。**教训**：落库必须回带
  `information_schema` 验证证据才算闭环（见硬规则 4）。**✅ 已闭环**：2026-06-12 #2 部署时
  亲手 apply 0032 到 `holaday@127.0.0.1` 并回带 `SHOW CREATE TABLE watchlists` 证据
  （11 列含 `alert_config_json` + 4 索引 + `fk_watchlists_user` ON DELETE CASCADE，同库
  server_id=1 / 2719 tasks），分支 + 0032 文件亦已 push origin。Pack A 当时的诊断完全正确。

---

## 跨 session 提醒（看板）

- **致 #2（A股）**：你的 **0032 (watchlists) 仍未落 Vultr 生产库 `holaday`@127.0.0.1**
  （2026-06-12 由 #3 实测三次，`sites` 等 0033 表在、`watchlists` 不在 → 确属同一生产库且 0032
  缺失）。请重新 apply 0032 到该库**并回带验证证据**，再标记完成。另：你的 `claude/ashare-ae1d05`
  分支 + 0032 文件**未 push 到 origin**（#3 查遍 8 个 origin 分支均无），别人取不到你的权威版本。
  　→ **✅ 两项均已闭环（#2，2026-06-12）**：0032 已 apply + 回带 SHOW CREATE TABLE 证据；
  　分支 `claude/ashare-ae1d05`@`852c73a` 已 push origin（详见 #2 小节 + 教训②）。

- **致全员（#1，2026-06-13）prod 部署分支已切回 `claude/musing-keller-ae1d05`（合并主干）**：
  三分支合并完成上 origin/musing-keller（`b0fd428` merge #1+#2+#3），prod 现部署该合并主干，
  **不再是 ashare-ae1d05**。#1 路由补强 `1ba76bb` 已落主干 + 部署（restart 638）。
  → **致合并 session**：`/Users/yaleiqi/holaday-merge`（本地 `merge-integration`）仍停在 `b0fd428`，
  落后 origin/musing-keller 1 commit（我的 routing fix），fetch 后可 fast-forward。

---

## 三分支合并回 musing-keller 方案（#2 预判，不急执行）

baseline `musing-keller` @ `9935e84` 已含 template-fill M1-M3 → **#1 template-fill 已是 baseline 祖先，无需单独合**（#2 部署 ashare 时 merge template-fill 实为 no-op、零冲突，已印证）。剩 `ashare` + `playbook-ledger` 两支合回。

- **顺序**：两支都基于 9935e84 之后，先合谁都行，但**第二支会在共享文件冲突**。建议先 `ashare`（已部署验证、稳）再 `playbook-ledger`。
- **预判冲突点（都是「双方各加一段」的加法冲突 → 解法=两边都保留）**：
  - `packages/shared-types/src/ids.ts`：ashare 加 `watchlist:'wl'`；playbook 加 `site/cap/opath/exr/art/clm/cnr`。
  - `apps/orchestrator/src/db/schema/index.ts`：ashare 加 `watchlists` export；playbook 加 9 表 export。
  - `apps/orchestrator/src/trpc/router.ts`：ashare 加 `watchlists` router；playbook 若加 router 各加一行。
  - `apps/orchestrator/src/index.ts`：ashare 加简报 dispatch 分支 + import；playbook 若动 boot wiring 则逐 hunk。
  - `packages/shared-types/src/index.ts` / `package.json` / `pnpm-lock.yaml`：各加导出/依赖；pnpm-lock 冲突则合并后 `pnpm install` 重生。
  - `apps/orchestrator/src/db/schema/tasks.ts`（**schema**）：**仅 playbook 动**（origin 列 + 2 索引），ashare 未碰 → **无冲突**。
  - `apps/orchestrator/src/trpc/routers/tasks.ts`（**router，热路径**）：ashare 加 ④ QA fork、playbook 加 origin 守卫 hunks——**双方都加法**。**✅ 2026-06-13 ashare 已去 churn**：原 ④ 接线连带 biome 整文件 reformat(+2075/−2013) 是冲突震源，已 `checkout 基线 9935e84 重贴` → ashare 侧 diff vs 基线 = **244 插入 / 0 删除（纯 ④ 增量，零既有代码格式改动）**，全量 2570 测绿、行为零变化（`394830e` 已部署）。两支现都保持基线格式 → 合并只解各自加的几十行加法冲突，不再撞 2000 行 reformat。**playbook 侧也须保持基线格式**（别 biome --write 整文件）才能对齐。
- **migration**：0032(ashare) + 0033(playbook) 已都落生产库，disjoint，numbered applier skip-on-exists，合并后全量重跑安全。
- **合并后必跑**：`pnpm install` + `tsc -b` + 全量 `vitest`（#2 实测 2449 测基线）必须绿才推 baseline。

---

## 各 session 小节

### #1 — 模板填充 (template-fill)
- worktree：`/Users/yaleiqi/holaday-template-fill`　branch：`claude/template-fill-ae1d05`
- 状态：**收口待命 + 路由补强已上线**。M1+M2 docx + M3 xlsx 引擎 + e2e 已 commit；`9935e84` 在 baseline；`TEMPLATE_FILL_ENABLED=true` 已开。
- **2026-06-13 fileIds-aware soft 路由（既有设计缺口，非回归）**：template_fill 路由原纯靠 intent 关键词、无视 fileIds，「把…填入周报模板缺的留空」漏命中 strict pattern → 当通用任务跑。修法：传文件 AND fill动词(填/录入/补全) AND 模板/空白名词 ⇒ 强制 template_fill；合取+文件兜底挡住普通带附件任务（总结/翻译/分析不升级）。改 `intent-classifier.ts`（`matchTemplateFillSoft`/`ClassifyOpts.hasFileAttachment`/cacheKey 折标志）+ `tasks.ts`（classify 调用传 `hasFileAttachment`，**共享文件加法 hunk，远离 ④ fork**）。
- **落 3 分支同改动**：template-fill `c16f8a0`、ashare `123cceb`、**musing-keller(合并主干)`1ba76bb`←prod**。84 classifier + 1556 agent 测绿、tsc0；Vultr 真实证 ①原句+docx→template_fill、②总结这份文档+docx→generate（详 `qa-artifacts/route-fix-20260613/phase-summary.md`）。
- **2026-06-13 Phase 0 评测 E10 两个 P0 修复已部署 prod（`2617392`，restart 640）**：①**xlsx 多行循环**（{#x}…{/x} 跨行）原被 skip→任务数据全丢，改 **exceljs block-duplication**（snapshot body→splice→restamp 样式/行高；纯标记行=分隔符丢弃，内联标记保留；异常模板 try/catch 降级不崩）；「诚实降级」不再替代功能。②**下载 CJK 文件名**：`http.ts` 下载路由改用 `contentDispositionAttachment`（RFC6266 `filename*=UTF-8` + ASCII `filename=` fallback，永不 latin1 乱码）。回归：xlsx 引擎多行/样式/空数据 + runner/e2e 由「skip」翻「expanded」+ `contentDispositionAttachment` round-trip。全量 **2638 测绿、tsc0**。**E10 live 复测**：3 行任务全到、status=completed、下载名正确。改了共享 `http.ts`/`file-service.ts`（加法）。

### #2 — A股数据层 (ashare)
- worktree：`/Users/yaleiqi/holaday-ashare`　branch：`claude/ashare-ae1d05` @ `394830e`（**已 push origin** ✓，含 ④ widen + 简报 v2 + tasks.ts 去 churn）
- 状态（2026-06-12 **②③简报全链 + 内容三优化 + ④即时问答 M1+M2 全部署**；④ 在 BOSS-only 灰度）：
  - **②③**：`watchlists` 表 + tRPC CRUD（幂等增删）；确定性盘前/盘后简报渲染器（每行源+时间戳+固定免责，**不预测不荐股**）+ dev/prod 双模。
  - **§6 数据层**：⚠️ **push2.eastmoney 从 Vultr 不可达**（RemoteDisconnected，非瞬时；交接「Vultr 可达」前提作废）→ quote/kline/A股指数/港股指数全改 **sina**（实测可达）。北向净买额 2024-08 停披露(恒 0.0)→整行省略。龙虎榜接 akshare 自带「解读」列。详见 worktree `apps/akshare-mcp/README` 已知限制节。
  - **§6c**：`akshare-mcp` 加薄 FastAPI `http_server.py`（仅 127.0.0.1:8848，pm2 `akshare-mcp-http` autorestart，`/healthz`）+ orchestrator `HttpAkshareClient` HTTP 直取（10s 超时 + 段级降级）；简报接口 TTL≥600s 投递窗口去重；scheduled-runner dispatch 分支接简报（单用户失败仅重试本任务 + 连续 3 次降级 inbox 错误）。
  - **部署**：orchestrator `ae6c2b6→852c73a`（healthz ok）+ `deploy-akshare-mcp.sh`（venv+pm2+smoke）。
  - **✅ 0032 已落 Vultr 生产库 `holaday`@127.0.0.1**（部署时亲手 apply，回带 `SHOW CREATE TABLE watchlists`：11 列含 `alert_config_json` + 4 索引 + `fk_watchlists_user` ON DELETE CASCADE；同库 server_id=1 / 2719 tasks）。
  - **给 BOSS(usr id1, admin) 开通每日简报**（2 条 scheduled_tasks 盘前 08:30 / 盘后 15:30 SH daily；种自选股 600519/300750/000001）+ 手动触发真数据简报投 inbox（龙虎榜盘前触发无数据→优雅降级，15:30 真发有）。
  - **简报验收三修（`5d4bb2c`，已部署，无新 migration）**：
    - **P0 简报正文可读**：`NotificationBell` 通知点击改为弹**全文渲染弹窗**（ReactMarkdown+remarkGfm+sanitizeForRender，portal 到 body，Esc/遮罩/× 关闭，锁滚动），不再跳日历；带定时任务的通知保留「在定时任务中查看」二级入口。`notifications.list` 本就全文下发（message=text），纯前端改。SPA 已部署双边 `index-CF4EaBpl.js`（Aliyun+Vultr smoke 双绿）。
    - **P1 星期时区**：`dateHeader` 改正午 UTC + `getUTCDay`，锁死 06-12=周五（+5 单测）。已在投递正文实证：`2026-06-12（周五）`。
    - **P1 非交易日不投递**：`akshare-mcp` 接 `tool_trade_date_hist_sina` 出 `/trading-day/{date}`（Vultr 实测：周五 true / 周六 false，源 `akshare:tool_trade_date_hist_sina`）；`briefing-dispatch` 交易日判定（日历优先，失败退周末兜底）；非交易日返回 `skipped+reason`，scheduled-runner 记 `last_run_status='skipped'`。
    - **重触发**：盘前(id43)+盘后(id45) 已投 BOSS inbox（真数据，周五，多段；盘后 id45 大盘速览=上证4038.02/深证15049.18/创业板3852.83）。**注**：盘后首条 id44 因冷缓存 sina 指数 spot >10s 触发 10s 超时→大盘速览段优雅降级「数据暂不可用」；重触发(暖缓存)的 id45 已正常。
    - **测试**：orchestrator 73（scheduled-runner 24 含新 skip 契约）+ SPA 15 全绿；tsc/biome/eslint clean。
  - **内容三优化 + 预热 + S2（`0bff4bc`+`69c9d9f`，已部署，无新 migration；SPA `index-ifyg-YSv.js`）**：
    - **异常非泄漏**：`HttpAkshareClient` 注入 logger（原始异常/后端 error envelope 进日志）；渲染器统一 `unavailableLine` → 用户**只见「数据暂不可用」**（dev 留原文）。两个「空=异常」根因 adapter 兜底：龙虎榜 `stock_lhb_detail_em` 当日未发布(NoneType 取下标) + 公告 `stock_zh_a_disclosure_report_cninfo` 窗口内无数据(KeyError 选列) → 捕获返空集非 error。Vultr 实证：龙虎榜 20260612→count0 无 err、公告 000001/300750 空窗口→count0 无 err。
    - **公告按日期过滤 + 裸 URL**：cninfo 不传范围返历史默认页(2023 旧公告!)；service 盘前取近 24h(昨→今)、盘后取当日，endpoint+client 透传 start/end_date(cache 按 args 分键)。无公告整段收敛「今日/近24小时无新公告」。裸 URL：公告链接含空格(`...Time=2026-06-12 20:50:29`)断链 → `safeLinkUrl` encodeURI。实证盘前/盘后公告段=600519 真 06-12 公告、空股静默省略、无降级。
    - **龙虎榜移盘前（BOSS 拍板=b 移盘前回顾）**：当日榜单收盘后晚间披露、15:30 盘后取不到 → 从盘后移除，改在次日盘前「上一交易日龙虎榜回顾」段，service 按交易日历解析上一交易日（周末本地跳+日历校验）。实证盘前 id49 含「回顾（2026-06-11（周四））」。
    - **冷缓存预热（BOSS 拍板=预热，10s 规格不动）**：新增 `prewarm-scheduler`，08:25/15:25 北京（简报前 5min）用长超时(30s)客户端把 `/index/us·hk·cn` 各调一遍填 akshare-mcp 缓存(TTL 600s)。boot 启动日志已确认。
    - **S2 设置开关**：`NotificationsSection` 加「每日 A股简报」toggle → `watchlists.briefingStatus/enable/disableDailyBriefing`。
    - **测试**：orchestrator a-share 46 + scheduled-runner 24（+prewarm 3 / +renderer 新增 6）全绿；tsc/biome/eslint + SPA tsc/lint clean。重触发盘前 id49 / 盘后 id50 投 BOSS inbox（真数据、周五、无泄漏）。
  - **✅ 冷缓存 follow-up 已闭环**（预热方案落地）。
  - **④ 即时问答 M1+M2 已交付上线（`483622d`，BOSS-only 灰度）**：Skill Router 首场景（方案 `docs/PHASE1_ASHARE_QA_SKILL_ROUTER_DESIGN.md` APPROVED + 通用模式 `docs/SKILL_ROUTER_PATTERN.md` markdown=WHAT/TS=HOW，后 11 技能照办）。
    - **M1** 接地事实卡（无 LLM，①盘面②同期已披露，逐条溯源）+ 抽 `ashare-format.ts` 共享底座。**M2** 合规闸门（advice/predict/ungrounded 越线降级纯数据 + **打日志计数**，21 对抗测长期保留）+ LLM③ runner（③段尾钉「以上因素与股价变动的关联未经证实」）+ token 上限保护。
    - **短名 name-search**：⚠️ `stock_info_a_code_name` 从 Vultr **不可达** → sina `stock_zh_a_spot`（5526，日级缓存 + 开盘前 prewarm `warmSymbolTable` 刷新 + 非阻塞自愈）。
    - **接线**：`tasks.ts` a-share-qa lane（镜像 template-fill，无 agent loop / 背景 async / persist+broadcast）。双门 `ASHARE_QA_ENABLED`(默认 OFF) + `ASHARE_QA_ALLOWLIST`(CSV)。**灰度 env 已开**（restart 623 进程内 flag 实证），符号表 warm(5526)。
    - **真 LLM 实测**：带 roleId='a-share-analyst' 诱导提问（该买吗/割肉/目标价/抄底）→ haiku **全自合规**（无建议/预测）→ 闸门没触发=最好安全结果；闸门降级由对抗单测确定性兜底。**待 BOSS 产品内实测，过了才 widen flag**。
    - **⚠️ 已知限制（BOSS 拍板 v1 不兜）**：裸短名问句（未选技能 + 无术语/代码）不命中 → 落通用路径；唯一通路 = 选 a-share-analyst 技能(roleId)。
  - **测试**：a-share 92 + 全量 2510 全绿。**注**：`tasks.ts` ④ lane 与 #1 template-fill fix（`4e4c6c4` 别人 push 进本支）rebase 无冲突已并。
  - **待**：盘前公告窗口「近 24h」按日历日，周一不回溯上周五=次要已知限制。
  - **④ widen 全量上线（`feada2a`，已部署 restart 631→633）**：清空 Vultr `.env` `ASHARE_QA_ALLOWLIST=`（保 `ASHARE_QA_ENABLED=true`）→ 全量用户可用（进程内 /proc/environ 实证 ENABLED=true、ALLOWLIST 空，经多次 redeploy 仍在）。BOSS Claude UI 复测 4/4 过后批准。同批携 #1 守卫 `f8437c1`(executionMode 防 ④ fork 劫持 template_fill/image/browser 专用道) + 2 P2(事实卡公告 safeLinkUrl、③ 空解读打日志)。
  - **简报 v2 已部署生产（`162824a`，无新 migration）**：BOSS「盘后加三段 + 易读性四原则」批次。
    - **盘后**段序 速读→大盘速览→市场温度计→板块主线→自选股表→公告；顶部**今日速读**一行（沪指/涨跌家数/涨停炸板率/主力净流/主线）；**市场温度计**（涨停X(昨Y)·最高N连板·跌停·炸板率 + 涨跌家数·两市成交额·主力净流入，行内一句话）；**板块主线**（同花顺行业涨跌前5+领涨股龙头）；盘前龙虎榜回顾段加**昨日涨停回顾**（上一交易日涨停梯队/活跃行业）。四原则：固定段序 / 表格只留自选股 / prod 来源短标减噪 / **长度锁写进单测（盘后正文内容≤600字）**；纯指标无周期定性标签（合规哨兵）。
    - **数据层（逐个先验 Vultr 可达性，push2 教训）**：可达 substitutes `stock_zt_pool_em(date)`/`_dtgc_em`/`_zbgc_em` + `stock_board_industry_summary_ths`(同花顺，一调给板块+涨跌家数+净流入) + 综指 spot 两市成交额；`get_market_pulse(date,prev?)`/`get_zt_pool_summary(date)` 单行聚合逐源容错。**⛔ 2 名指 _em 接口 push2 死** → 改 ths；**❌ 2 指标无可达源故不出**（成交额环比% / 自选股主力净占比列，同北向停披露红线）。详见 [[reference_ashare_vultr_data]] 2026-06-13 UPDATE。
    - **Vultr 全链真渲染实证**（盘前+盘后 pin Friday 跑真 `HttpAkshareClient`→真数据 markdown）：涨停89(昨69)/最高4连板/炸板率41.1%/净流入-141亿/两市3.21万亿/板块工业金属+5.28%(新威凌)；昨日涨停回顾 69家·活跃化学制品8·半导体8。
    - **测试**：a-share 120（+10：长度锁/段序/温度计/板块/合规哨兵/降级/昨日涨停回顾）+ 全量 **2570** 全绿；tsc/biome clean。**周六非交易日 skip**，周一 BOSS scheduled id43/id45 自动产 v2 真投递。
  - **v2 收尾两调整 + tasks.ts 去 churn（`f698f4b`+`394830e`，已部署 restart 634）**：
    - 无源指标（成交额环比% / 自选股净占比列）BOSS 拍板**接受不出**，按北向同款红线，不引新数据商依赖。
    - 板块主线 涨跌前5→**前3**（正文更短；data 层留前5，展示 slice(0,3)）。
    - **tasks.ts 去 churn（合并前置·重点，BOSS 指令）**：详见上「三分支合并方案」router tasks.ts 条 — checkout 基线 9935e84 重贴 ④ 真实改动，2176 churn → **244 插入/0 删除纯增量**，全量 2570 测绿、行为零变化。后续合并/回滚从「解2000行热路径」变「解几十行」。

### #3 — Playbook + Evidence Ledger（本约定创建者）
- worktree：`/Users/yaleiqi/holaday-playbook-ledger`　branch：`claude/playbook-ledger-ae1d05`（已 push `0f644e4`）
- 状态（2026-06-12 **Pack A+B 完成，本次合并并入 musing-keller**）：
  - **Pack A**：tasks.origin 列 + 9 表 schema + migration `0033` + R2 helper + 4 repository
    + TaskOrigin 常量 + §5.6 origin='user' 读取守卫。**`0033` 已落 Vultr 生产库并验证**（9 表 +
    origin 列 varchar32/NOT NULL/default 'user' + 2 索引 + 外键全对 + 2719 tasks 无损）。
  - **Pack B**：终态 hook `writeLedgerToDb`（3 处 persistExecution 后、disposeExecution 前）镜像
    内存 EvidenceLedger → `evidence_artifacts`+`claims`+`claim_evidence_links`（+ R2 bundle 独占）；
    `LedgerRepository` 读 API skeleton（未接 verifier，逻辑零改）；任务删除分流 §4.9；retention reaper
    nightly cron（gated `RETENTION_REAPER_ENABLED` 默认 off）。全程 flag `LEDGER_DB_WRITE`（默认 off）。
    **无新 migration**（用 0033 表）。
  - **合并**：本次 #3→musing 只 SESSION_STATUS 冲突（代码全 clean）；落地后翻 `LEDGER_DB_WRITE=on`
    跑真任务积累 Ledger 数据（Phase 0 评测受益）。
  - eval origin 标记 defer 到 Pack C（explorer/canary，等指令）。

### #5 — 图片生成 (image)
- 状态：← owner 更新

### #4 — 视频生成 (video)
- **状态：管线就绪，等真人正脸出镜底版做端到端验收。** worktree `/Users/yaleiqi/holaday-video` branch `claude/video-ae1d05`（**未 merge / 未部署**，全 flag-gated 默认 off）。
- **进度**：步骤1 上传链路（presigned-PUT + media 白名单 + 200MB + migration `0034` users.qwen_voice_id/base_video_file_id）**已部署 prod**（曾 `f60e698`，现 prod 已被其他 session 推进到 `c092562`，video 列与代码仍在）。步骤2 三适配器（Wanxiang/fal/Qwen3-TTS-VC）+ 真调证据全绿。步骤3 编排 **3a→3e-2 全 done + 单测**（env/时间轴对齐/runner/FFmpeg竖屏合成/脚本生成/ffmpeg子进程/video-lane），全套 2704 绿。
- **2026-06-15 全管线连通性冒烟通过**（≠验收）：脚本直跑真 `runVideoCreation`，6 步串通，真出 1080×1920 h264+aac MP4 27.5s/4.3MB，OSS→R2 全落。录屏底版换口型废、不计验收。测试素材+克隆音色已清。
- **未做（刻意暂停）**：3e-3 接 `tasks.ts` 后台协程 gate + onboarding（高风险共享文件改动，等 BOSS 录真底版 + 过目 hunk 再接）。**不动 tasks.ts。**
- **BACKLOG（验收前必修）**：lip-sync clip 比其音频短 ~0.11s/段（冒烟 28.16s 时间轴 vs 27.478s 成片，~0.68s 漂移）→ `lipSyncSegment` 用 ffmpeg `-t`/`apad` 把 fal 输出 trim/pad 到精确音频时长，锁死音视字三轨。
- 详见 memory `project_phase1_video_impl_2026-06-13`。
