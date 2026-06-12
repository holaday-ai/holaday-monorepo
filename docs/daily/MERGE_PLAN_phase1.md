# Phase 1 三分支 → musing-keller 合并方案（草案 v1）

> 起草：#3 (Playbook+Ledger)，2026-06-12。**给 BOSS + Claude 过目。**
> 执行时机：等 #1 回归修复落地 + #2 v2 告一段落。方案现在定，降低分叉成本。
> 全部结论由 `git merge-tree --write-tree`（只读冲突预测）实测得出，非估计。

## 0. 拓扑（实测）

- 公共基 `9935e84` = template-fill M3 commit（三分支都从这分叉）。
- **合并目标 `musing-keller` = `8eee807`**（已超出公共基，自带增量）。
- 分支增量：template-fill +6 commits / ashare +22 / playbook-ledger(#3) +3。

## 1. 各分支 → musing-keller 单独冲突（实测 merge-tree）

| 分支 | vs musing-keller 冲突 | 评级 |
|---|---|---|
| **template-fill** | 无 | 🟢 clean |
| **playbook-ledger (#3)** | 仅 `docs/daily/SESSION_STATUS.md`(add/add) | 🟢 trivial |
| **ashare** | `files/file-service.ts`、`files/upload-allowlist.test.ts`(add/add)、`http.ts`、`SESSION_STATUS.md`(add/add) | 🟡 4 处，可控 |

## 2. 中心风险：ashare 把 tasks.ts 整文件重排了

- ashare 的 `tasks.ts` vs 基线 = **+2176 / −2013**（近乎全文件改写）：import 全部重新排序
  = biome 全文件 reformat 痕迹，**外加真实改动**（④ A股即时问答 lane：`ashareQaHandlesMode` 等）。
- 单独 merge 到 musing-keller 时 ashare 的 tasks.ts **不冲突**（musing-keller 那侧没动 tasks.ts）。
- 但 **#3 也改了 tasks.ts**（Pack A origin 守卫 + Pack B 终态 hook + 删除分流，~50 行 minimal）。
  一旦 #3 与 ashare 都进 musing-keller，两者在 tasks.ts 上**必冲突**——而且因为 ashare 是全文件
  reformat，冲突会铺满整个文件，逐行手解极易引 bug（生产热路径）。
- **这是整个合并的最高杠杆点。**

### 缓解（强烈建议，按优先级）
1. **请 #2 在合并前给 tasks.ts 去 reformat churn**：`git checkout <base> -- tasks.ts` 后只重贴
   ④ 的真实改动（~几十行），把 2000 行 churn 压回到真实 diff。之后 tasks.ts 合并变 trivial。
   （#3 的 Pack A/B 提交已用同样手法保持 tasks.ts minimal——churn 不是必须的。）
2. 若 #2 无法去 churn：tasks.ts 走**人工三方合并 + 全量 build/test 守门**，并指定单一 owner
   （建议 #3，因熟悉 origin 守卫 + 终态 hook 落点）操刀，#2 复核 ④ lane 不被破坏。

## 3. 其它重叠（合并时注意）

- **ashare ∩ template-fill = 13 文件**（几乎是 template-fill 的全部：`agent/template/*`、
  `files/file-service.ts`、`http.ts`、`InputArea.tsx`）。两者对同组 template 文件**分叉改动**——
  需确认哪份是 canonical（疑 ashare 拿了 template-fill 的后续工作但又各自演进）。**合并前 #1/#2 对齐。**
- **trivial append 冲突**（union 即可）：`shared-types/src/ids.ts`（各加 ID 前缀）、
  `db/schema/index.ts`（各加 export）、`SESSION_STATUS.md`（各加自己小节，add/add）。
- `apps/orchestrator/src/index.ts`：#3 的 reaper 块与 ashare/musing 增量 **auto-merge clean**（实测）。
- `feature-flags.ts`：仅 #3 动（加 `LEDGER_DB_WRITE`）——无冲突。

## 4. 推荐合并顺序 + 理由

> 原则：clean 的先进、churn 大的最后单独精解、每步全量 build+test 守门。

1. **template-fill → musing-keller**（🟢 clean）。先把无冲突的基底合进去。
2. **playbook-ledger (#3) → musing-keller**（🟢 仅 SESSION_STATUS）。此时 musing-keller 已有
   #3 的 minimal tasks.ts 改动（origin 守卫 + Pack B hook），干净落地。
3. **ashare → musing-keller**（🟡 最后，最仔细）。此步触发：
   - ashare 的 4 处自身冲突（file-service/http/upload-allowlist/SESSION_STATUS）。
   - **tasks.ts**：与第 2 步落进去的 #3 改动冲突 → 用 §2 缓解（最好 #2 已去 churn）。
   - 13 个 template 文件与 template-fill（已在第 1 步进 musing-keller）的潜在冲突 → §3 对齐后解。

   理由：把 ashare（改动面最大 + reformat churn + template 重叠）放最后单独处理，避免它的 churn
   污染前两步；前两步先把 musing-keller 推到一个 clean、已测的中间态，作为 ashare 合并的稳定底座。

## 5. 回滚点 + 守门

- 合并前给 musing-keller 打 tag：`pre-phase1-merge-<date>`。
- **每个分支单独一个 merge commit**（非 squash）——任一步出事可 `git revert -m 1 <merge>` 单独回退。
- **每步 merge 后必须**：`pnpm tsc` 0 错 + 全量 vitest 绿 + biome 我方文件 0 error，再进下一步。
- DB：musing-keller 合并不需新 migration（0032/0033 已在生产库；Pack B 用现有表）。合并后
  若要部署，按 DEPLOY RULE：先确认目标库 migration 状态再 restart。
- 任一步 build/test 不过 → 停在该步，不继续叠加。

## 6. 执行前置（boss 已定）

- 等 **#1 回归修复落地** + **#2 v2 告一段落** 再执行。
- 执行前 #1/#2/#3 各自 `SESSION_STATUS.md` 更新到最新停点。
- §2.1（#2 去 tasks.ts churn）是开工前最该先做的一件事。

---
*附：Pack B 上线（live=ashare）若先于本合并进行，需单独把 #3 的 Pack B tasks.ts hook 精贴到
ashare 的（已 reformat 的）tasks.ts——见与本方案配套的 Pack B 上线讨论。*
