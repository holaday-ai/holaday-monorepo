# affectedRows 读法 bug — 修复（已实现）

> 状态：**已实现（BOSS 审过，本轮落码）**。16 处替换 + 4 类回归测已落；tsc 0 错、orchestrator 全套 **2877** 测绿、零回归。**未 push、未部署。**
> 部署：随视频三类型一起进 **4c**（列先于代码：先 apply 0035，再重启带「本修 + 视频」的代码）。

## 1. 根因（一句话）

`drizzle-orm@0.38.4` 的 mysql2 `.update()`/`.delete()` 返回**数组** `[ResultSetHeader, fields]`，真 affectedRows 在 `result[0].affectedRows`。下列 16 处**没用**仓库现成的数组感知 helper `readAffectedRows()`（`apps/orchestrator/src/db/mysql-result.ts`），而是内联**直接读顶层** `(x as ... { affectedRows? }).affectedRows` → 恒 `undefined` → `?? 0 = 0`、`=== 0` 恒 false。

- prod（`115ba53`，SSH 实装）= 隔离 worktree：drizzle **0.38.4** + mysql2 **3.11.5**，运行时同为 `npx tsx src/index.ts`（ESM 源码），quota-service.ts 逐字节相同 → **prod 同样中招**，非隔离独有。
- 实证：drizzle probe 返回 `[{affectedRows:1,...}, null]`；`res.affectedRows=undefined`、`res[0].affectedRows=1`；`readAffectedRows(res)=1`。零匹配 UPDATE → `res[0].affectedRows=0`、`readAffectedRows=0`。

## 2. 修法（统一）

把 16 处内联读全部替换为调用现成 helper：

```ts
import { readAffectedRows } from '<相对路径>/db/mysql-result.js';
// (x as unknown as { affectedRows?: number }).affectedRows ?? 0   →   readAffectedRows(x)
// (x as unknown as { affectedRows?: number }).affectedRows === 0  →   readAffectedRows(x) === 0
// (... .affectedRows ?? 0) === 1                                   →   readAffectedRows(x) === 1
```

`readAffectedRows`（已存在、已被 Pack A/B repo 用）：数组 → `result[0].affectedRows`；非数组 → 顶层兜底；都没有 → 0。**比当前 cast 严格更稳**（多覆盖"将来某版本返回裸 header 对象"的情况）。

### 导入路径（按目录深度）
| 目录 | 文件 | import 路径 |
|---|---|---|
| `src/quota/` | quota-service.ts | `../db/mysql-result.js` |
| `src/trpc/routers/` | payment / scheduled-tasks / notifications / files / batch-tasks .ts | `../../db/mysql-result.js` |
| `src/api-keys/` | webhook-idempotency-service.ts | `../db/mysql-result.js` |

## 3. 16 处清单（file:line / 当前 / 改后 / 守什么 / 钱? / 修后行为变化）

### 🔴 钱相关 / 上线拦路（6 处，4c 必修）

| # | file:line | 当前内联读 | 改后 | 守什么 | 修后行为变化（=本修目的） |
|---|---|---|---|---|---|
| 1 | quota-service.ts:208 | `((bonusBurn as ...).affectedRows ?? 0) === 1` | `readAffectedRows(bonusBurn) === 1` | opus bonus 扣 | 命中即 ok（原恒 fall-through） |
| 2 | quota-service.ts:221 | `((regBurn as ...).affectedRows ?? 0) === 1` | `readAffectedRows(regBurn) === 1` | opus 正额扣 | 同上 |
| 3 | quota-service.ts:234 | `((bonusBurn as ...).affectedRows ?? 0) === 1` | `readAffectedRows(bonusBurn) === 1` | 普通 bonus 扣 | 同上 |
| 4 | quota-service.ts:246 | `((regBurn as ...).affectedRows ?? 0) === 1` | `readAffectedRows(regBurn) === 1` | **普通正额扣（恒 429 真凶）** | **149/150 命中→ok**（原 undefined→0→返 monthly_limit 但计数照加） |
| 5 | payment.ts:255 | `((updateResult as ...).affectedRows ?? 0) === 1` | `readAffectedRows(updateResult) === 1` | addon 扣款后发额度 | **transitioned=true→applyAddonPack 执行**（原扣款 commit 但 addon 不发） |
| 6 | payment.ts:300 | `(updateResult as ...).affectedRows ?? 0` | `readAffectedRows(updateResult)` | 升级扣款后改 plan+首月赠（tx 内） | **affected=1→改 users.plan + 赠送执行**（原 tx 内 `return false`，plan 不升、赠送跳） |

### 🟠/🟡 非钱相关（10 处，建议同批修，避免再踩）

| # | file:line | 当前内联读 | 改后 | 守什么 | 修后行为变化 |
|---|---|---|---|---|---|
| 7 | scheduled-tasks.ts:461 | `(result as ...).affectedRows ?? 0` | `readAffectedRows(result)` | 编辑/状态翻转 | 成功不再误抛"状态已变化" |
| 8 | scheduled-tasks.ts:551 | `(result as ...).affectedRows === 0` | `readAffectedRows(result) === 0` | 删除 NOT_FOUND 守卫 | 删不存在/越权行→正确 404（原守卫从不触发） |
| 9 | scheduled-tasks.ts:639 | `(result as ...).affectedRows ?? 0` | `readAffectedRows(result)` | toggle 开关 | 成功不再误抛 |
| 10 | notifications.ts:280 | `(result as ...).affectedRows ?? 0` | `readAffectedRows(result)` | 删渠道 NOT_FOUND | 删成功不再误抛"渠道不存在" |
| 11 | files.ts:96 | `(result as ...).affectedRows === 0` | `readAffectedRows(result) === 0` | 删文件 NOT_FOUND | 删不存在/越权→正确 404（原 `undefined===0` false→恒返 ok） |
| 12 | batch-tasks.ts:309 | `(result as ...).affectedRows`（无 `?? 0`） | `readAffectedRows(result)` | 取消 happy-path vs 重读 | 真取消→`{ok,alreadyTerminal:false}`（原 undefined→falsy→恒走慢重读分支） |
| 13 | webhook-idempotency-service.ts:333 | `(delResult as ...).affectedRows ?? 0` | `readAffectedRows(delResult)` | reclaimOrphan（删孤儿占位） | 删成功→继续 re-INSERT（原恒返 false→孤儿回收永不成功，卡到 24h 超时） |
| 14 | webhook-idempotency-service.ts:398 | `(result as ...).affectedRows ?? 0` | `readAffectedRows(result)` | finalizeClaim | 终定成功→true（原恒 false，幂等账本假阴） |
| 15 | webhook-idempotency-service.ts:440 | `(result as ...).affectedRows ?? 0` | `readAffectedRows(result)` | releaseClaim | 释放成功→true（原恒 false） |
| 16 | webhook-idempotency-service.ts:468 | `(result as ...).affectedRows ?? 0` | `readAffectedRows(result)` | cleanup 扫过期 | 返/记真删除数（原恒 0，仅可观测性） |

> SAFE（无需改，已用数组感知 helper）：`index.ts`、`scheduled-runner.ts`、`batch-executor.ts`、`task-repository.ts`（含 `consumeVideoConfirm:569`，视频防双扣 OK）、`mysql-result.ts` 自身。

## 4. 机械替换可行性 + 风险

- **可行**：16 处全是同一 cast pattern，逐处一对一替换 + 加一行 import（3 条路径）。无逻辑重构。
- **风险=低**，但**有真实行为变化**（都是把"原本坏的"改对，须 Codex/测覆盖确认下游不依赖坏行为）：
  - quota/payment（#1–6）：从"恒拒/恒不发"变"命中即放行/发货"——这正是修复目的。零匹配/超限分支不变（`readAffectedRows` 返 0，与原 `?? 0` 同）。bonus-first fall-through、opus、Sonnet 降级路径结构同普通分支，同修同保。
  - NOT_FOUND 守卫（#8/#11，`=== 0`）：修后**会真正触发 404**（删不存在/越权行）。须查现有测/前端没把"删任意 id 都 ok"当契约。
  - batch 取消（#12）：修后 happy-path 不再走慢重读——行为更对，但响应 shape 变，须测。
  - webhook（#13–16）：修后幂等账本由"恒假阴"变真值——须确认 release/finalize/reclaim 配对逻辑在"真值"下仍自洽（Codex 重点看并发/幂等）。
- **无 schema/migration 改动**；drizzle/mysql2 版本不动（本就是 0.38.4/3.11.5）。

## 5. 回归测建议（钉死不复发）

1. **DB 级 `tryConsume` 测（最关键，补当前空白）**：stub `db.update().set().where()` 解析为真数组壳——命中 `[{affectedRows:1}, null]`、零匹配 `[{affectedRows:0}, null]`。断言：
   - metered pro 149/150 → `{ok:true}` 且 tasksUsed 增到 150；
   - 150/150 → `{ok:false, reason:'monthly_limit'}`；
   - bonusTasks>0 → 先扣 bonus（ok、bonus 减、tasksUsed 不变）；bonus=0 → fall-through 到正额；
   - opus bonus/正额/超限 镜像。
   - （现 `quota-service.test.ts` 66 行、从不跑 tryConsume = 本 bug 蒙混过 CI 的根因。）
2. **`readAffectedRows` 单测**：`[{affectedRows:1},null]→1`、`[{affectedRows:0},null]→0`、`{affectedRows:1}→1`（兜底）、`undefined→0`。
3. **payment capture 测**：addon capture→`applyAddonPack` 被调；plan capture→`users.plan` 更新 + 首月赠（用数组壳 stub UPDATE）。
4. **防复发源扫测**（仿 `control-tooltip.test.ts` 思路）：扫 `apps/orchestrator/src` 禁止 `mysql-result.ts` 以外出现 `as unknown as { affectedRows` 内联 cast，断言为空 → 杜绝再内联直读。

## 6. 落码（已完成）+ 部署（随 4c）

**已落码本轮**：16 处替换 + 7 import + 4 类回归测（`mysql-result.test.ts` readAffectedRows 三形状 + 源扫禁内联 cast；`quota-service.test.ts` tryConsume 真数组壳命中/超限/bonus 优先/opus 镜像；`payment.test.ts` addon/升级 翻行发货 + 重试不重发）。tsc 0 错、orchestrator 全套 2877 测绿。

**部署随 4c**：**先 apply 0035（列先），再重启带「视频 + 本 quota 修」的代码**（drizzle 全列写进生成 SQL，列不先在 → tasks.ts 热路径 500，见 4c 清单）。Free/Basic/Pro 真用户的扣费/发货在此修后才正确——视频上线对真用户才有意义。

### 删除守卫 404 下游风险（②）— LOW
files.ts:96 / scheduled-tasks.ts:551 的 `=== 0` 守卫修后会**真触发 404**（删不存在/越权/已删行）。核查：无后端测把"删任意 id 都 ok"当契约（无 files.test.ts；scheduled delete 测只验过程存在）；前端 `FilesPage`/`ScheduledPage` 的 `performDelete` 都 catch→「删除失败」toast + 成功后 refresh 移除行，正常单标签流不会重复删。**单独标出 files.ts:96 略riskier**：文件还会被 retention reaper / R2 TTL 从 UI 列表底下删掉，redundant 删更易撞 404（用户对一个本就该没的文件看到「删除失败」——观感小坑、无数据危害）。可选加固（未做）：前端把 delete 的 NOT_FOUND 当幂等成功处理。
