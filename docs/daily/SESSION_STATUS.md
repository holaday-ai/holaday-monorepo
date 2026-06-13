# SESSION_STATUS — 多 session 协作状态板

> 目的：多个并行 Claude session（#1 模板填充 / #2 A股 / #3 Playbook+Ledger / #5 图片 …）
> 各自在独立 worktree 里干活，缺乏共享上下文。本文件是**唯一的跨 session 协调点**：
> 每个 session 到停点更新自己的小节并 push，所有人据此对齐状态、避免撞车与误传。
>
> 维护者：各 session 自己。创建者：#3（Playbook+Ledger）2026-06-12。
> **归属（BOSS 定）：本文件住共享 baseline `claude/musing-keller-ae1d05`**——三 worktree 分支最终都合回这里，协调文件理应在汇合点。各 session 更新时只对 musing-keller push 这**一个文件**（单文件无冲突风险）。

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
- 状态：← owner 更新（已知：M1+M2 docx + M3 xlsx 引擎已 commit；`9935e84` 已在 baseline；`TEMPLATE_FILL_ENABLED=true` 已由 #2 部署时翻开）

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
- worktree：`/Users/yaleiqi/holaday-playbook-ledger`　branch：`claude/playbook-ledger-ae1d05`（已 push）
- HEAD：`84e0cc5`（Pack A）
- 状态（2026-06-12 停点）：
  - **Pack A 完成**：tasks.origin 列 + 9 表 schema + migration `0033` + R2 helper + 4 repository
    + TaskOrigin 常量 + §5.6 origin='user' 读取守卫。tsc 0 错 + 31 新测绿。
  - **`0033` 已落 Vultr 生产库 `holaday` 并验证通过**：9 表 + `tasks.origin`(varchar32/NOT NULL/
    default 'user') + 2 个 origin 索引 + 外键全对 + 2719 tasks 全 origin='user' 无损。
  - **Pack B 暂缓**：等 #2 的部署 + 简报验收完成后解锁（Pack B 要碰 task 完成 hook，又是
    `tasks.ts`，避免与 #2 撞车）。
  - eval origin 标记 defer 到 Pack C。

### #5 — 图片生成 (image)
- 状态：← owner 更新
