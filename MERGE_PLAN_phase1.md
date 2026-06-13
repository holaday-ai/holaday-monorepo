# MERGE_PLAN — Phase 1 三分支合并（template-fill #1 / ashare #2 / playbook #3 → musing-keller）

## 重叠文件节：#1 template-fill ↔ #2 ashare

> 由 #1 填写，2026-06-13，对照 ashare `394830e`（**在 #2 的 tasks.ts 去 churn 之后**）。
> 这是合并节点的权威状态。git diff 比对的是两分支的已提交状态，不依赖工作树。

### 结论（bottom line）
**ashare-ae1d05 对全部重叠文件 canonical，当前无需手工合并。**
`diff(template-fill-ae1d05 → ashare-ae1d05)` 覆盖 #1 全部 template + 共享文件 =
**400 行新增、0 行删除**。#1 的逻辑逐字保留；#2 的 a-share lane + #1 的 a-share 门 +
e2e fixture 都是"加"在其周围的。#2 的去 churn（`394830e`）**未触碰 #1 的 template_fill
fork**（对删除行 grep `template_fill fork / runTemplateFillTask / TEMPLATE_FILL_ENABLED`
= 空）。因此把 `ashare-ae1d05` 合进 `musing-keller` 即带上 #1 模板填充 + #2 a-share，
`template-fill-ae1d05` 不需要再贡献任何东西（会重复引入）。

### 13 个 template 文件（`apps/orchestrator/src/agent/template/`）
12/13 在两分支 **byte-identical**；第 13（e2e）仅在 ashare：

| # | file | tf ↔ ashare | canonical | 手工合并 |
|---|---|---|---|---|
| 1 | placeholder-schema.ts | identical | ashare(=tf) | 无 |
| 2 | placeholder-schema.test.ts | identical | ashare(=tf) | 无 |
| 3 | docx-template-engine.ts | identical | ashare(=tf) | 无 |
| 4 | docx-template-engine.test.ts | identical | ashare(=tf) | 无 |
| 5 | template-safety.ts | identical | ashare(=tf) | 无 |
| 6 | template-safety.test.ts | identical | ashare(=tf) | 无 |
| 7 | template-fill-runner.ts | identical | ashare(=tf) | 无 |
| 8 | template-fill-runner.test.ts | identical | ashare(=tf) | 无 |
| 9 | xlsx-template-engine.ts | identical | ashare(=tf) | 无 |
| 10 | xlsx-template-engine.test.ts | identical | ashare(=tf) | 无 |
| 11 | derivation-check.ts | identical | ashare(=tf) | 无 |
| 12 | derivation-check.test.ts | identical | ashare(=tf) | 无 |
| 13 | template-fill-e2e.test.ts | **ashare-only**（#1 wrap `5de94e7`） | **ashare** | 无（取 ashare） |

### #1 也碰的共享文件（非 agent/template/，但属 #1 changeset）
| file | diff | canonical | 手工合并 |
|---|---|---|---|
| `config/env.ts` | ashare = #1 `TEMPLATE_FILL_*` + #2 `ASHARE_QA_*`（纯加，#1 行未变） | **ashare** | 无（union 已在 ashare） |
| `trpc/routers/tasks.ts` | ashare = #1 template_fill fork（逐字保留）+ #2 a-share fork + #1 a-share 门；0 删除 | **ashare** | 无（#2 去 churn 已完成且未动 #1 fork） |
| `intent-classifier.ts`、`quota/concurrency-tracker.ts`、`execution/answer-verifier.ts`、`execution/template-fill-consistency.ts`、`files/file-service.ts`、`files/upload-allowlist.test.ts`、`http.ts` | identical on both | ashare(=tf) | 无 |

### #1 在 live 分支的 commit（合并即带）
merge-base = `9935e84`（#1 M1–M3，已在 base、与 musing-keller 共享）。其上：
`4e4c6c4`（docx 上传白名单）/ `31ea466`（衍生确定性复核 [待核对] + 文件名 UTF-8）/
`e6b8d4e`（xlsx 多行循环降级）/ `f8437c1`（a-share executionMode 门，**CROSS-SESSION**）/
`ca52505`（SESSION_STATUS）/ `5de94e7`（e2e fixture + backlog + merge input）。

### 绿灯门
105 个 template 测 + e2e fixture（`5de94e7`）必须保持绿——无论取哪个版本。
合 `ashare → musing-keller` 后跑 `pnpm --filter @holaday/orchestrator vitest run src/agent/template/` 复核。

### #2 待确认
- a-share 门 `f8437c1`（只在 `generate`/`scrape` 进 a-share lane，专用 lane template_fill/image/browser 优先）与你 ④ 设计一致？
- 去 churn `394830e` 已由 #1 验证未动 template_fill fork（删除行 grep 命中 fork 标记 = 空）。
