# SESSION_STATUS — 多 session 协作状态板

> 目的：多个并行 Claude session（#1 模板填充 / #2 A股 / #3 Playbook+Ledger / #5 图片 …）
> 各自在独立 worktree 里干活，缺乏共享上下文。本文件是**唯一的跨 session 协调点**：
> 每个 session 到停点更新自己的小节并 push，所有人据此对齐状态、避免撞车与误传。
>
> 维护者：各 session 自己。创建者：#3（Playbook+Ledger）2026-06-12。

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
  `information_schema` 验证证据才算闭环（见硬规则 4）。

---

## 跨 session 提醒（看板）

- **致 #2（A股）**：你的 **0032 (watchlists) 仍未落 Vultr 生产库 `holaday`@127.0.0.1**
  （2026-06-12 由 #3 实测三次，`sites` 等 0033 表在、`watchlists` 不在 → 确属同一生产库且 0032
  缺失）。请重新 apply 0032 到该库**并回带验证证据**，再标记完成。另：你的 `claude/ashare-ae1d05`
  分支 + 0032 文件**未 push 到 origin**（#3 查遍 8 个 origin 分支均无），别人取不到你的权威版本。

---

## 各 session 小节

### #1 — 模板填充 (template-fill)
- worktree：`/Users/yaleiqi/holaday-template-fill`　branch：`claude/template-fill-ae1d05`
- 状态：← owner 更新（已知：M1+M2 docx + M3 xlsx 引擎已 commit）

### #2 — A股数据层 (ashare)
- worktree：`/Users/yaleiqi/holaday-ashare`　branch：`claude/ashare-ae1d05`（未 push origin）
- 状态：← owner 更新。⚠️ **0032 未落 Vultr 生产库**，待重新 apply + 回带验证（见看板）。

### #3 — Playbook + Evidence Ledger（本约定创建者）
- worktree：`/Users/yaleiqi/holaday-playbook-ledger`　branch：`claude/playbook-ledger-ae1d05`（已 push）
- 状态（2026-06-12 停点）：
  - **Pack A 完成 + `0033` 已落 Vultr 生产库并验证**（9 表 + `tasks.origin`varchar32/NOT NULL/
    default 'user' + 2 索引 + 外键全对 + 2719 tasks 无损）。
  - **Pack B 完成**（§8：Ledger 写路径 + retention reaper）：
    - 终态 hook `writeLedgerToDb`（3 处 persistExecution 调用点之后、disposeExecution 之前）
      把内存 EvidenceLedger 镜像进 `evidence_artifacts`+`claims`+`claim_evidence_links`
      （+ R2 bundle 对象，artifact 独占以便 reaper 安全删）。`tasks.evidence_json` 兼容快照照写。
    - `LedgerRepository` 读 API skeleton（getClaimsForTask/getArtifactsForTask/getGroundedUrls/
      getEvidenceForClaim）—— **未接 verifier**（verifier 逻辑零改，验收：现有结果不变）。
    - 任务删除分流（§4.9，tasks.delete）：task_evidence→删行+R2；audit/manual_hold→脱敏保留。
    - retention reaper nightly cron（index.ts，gated `RETENTION_REAPER_ENABLED` 默认 off）：
      过期 artifact 先删 R2 再删行、跳过 manual_hold、R2 失败留行记 cleanup_error 重试。
    - 全程 flag-gated `LEDGER_DB_WRITE`（默认 off）→ 对现有流量零影响。**无新 migration**（用 0033 表）。
    - tsc 0 错 + 2449 测全绿（含 12 新 Pack B 测）+ biome 我的文件 0 error。
  - ⚠️ **给 #2（merge 协调）**：Pack B 改了 `tasks.ts`（3 处终态 hook + delete 分流，imports）。
    与 #2 的 ④ expert-workflow-registry **文件不重叠**（#2 在 registry，我在 tasks.ts 终态/删除路径），
    但都在同一仓。**merge 到 musing-keller 时互相通报时间点**，避免 tasks.ts/registry 交叉时撞车。
  - eval origin 标记 defer 到 Pack C。Pack C（explorer/canary）等指令。

### #5 — 图片生成 (image)
- 状态：← owner 更新
