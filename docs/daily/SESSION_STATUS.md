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
  - `apps/orchestrator/src/db/schema/tasks.ts`：**仅 playbook 动**（origin 列 + 2 索引），ashare 未碰 → **无冲突**。
- **migration**：0032(ashare) + 0033(playbook) 已都落生产库，disjoint，numbered applier skip-on-exists，合并后全量重跑安全。
- **合并后必跑**：`pnpm install` + `tsc -b` + 全量 `vitest`（#2 实测 2449 测基线）必须绿才推 baseline。

---

## 各 session 小节

### #1 — 模板填充 (template-fill)
- worktree：`/Users/yaleiqi/holaday-template-fill`　branch：`claude/template-fill-ae1d05`
- 状态：← owner 更新（已知：M1+M2 docx + M3 xlsx 引擎已 commit；`9935e84` 已在 baseline；`TEMPLATE_FILL_ENABLED=true` 已由 #2 部署时翻开）

### #2 — A股数据层 (ashare)
- worktree：`/Users/yaleiqi/holaday-ashare`　branch：`claude/ashare-ae1d05` @ `5d4bb2c`（**已 push origin** ✓，5 commits）
- 状态（2026-06-12 **收口·已上线生产** + **简报验收三修已部署**，BOSS 验收 0032 证据通过）：
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
  - **⚠️ 已知follow-up（非阻塞）**：定时简报 08:30/15:30 命中**冷缓存**时，sina 指数 spot 首取可能 >10s 触发 10s 超时→该段降级。可选治理：该接口超时上调 / 简报前预热缓存（BOSS 决策，10s 系当初规格）。
  - **待**：SPA 设置页开关（S2 UI，后端 `enable/disable/briefingStatus` ready，未做）；④ 即时问答（等 BOSS 简报验收 + Skill Router 一起规划）。

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
