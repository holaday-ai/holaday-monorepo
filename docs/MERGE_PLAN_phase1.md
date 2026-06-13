# Phase 1 三分支合并方案 — MERGE_PLAN_phase1.md

> 整合 `claude/template-fill-ae1d05`(#1) + `claude/ashare-ae1d05`(#2) + `claude/playbook-ledger-ae1d05`(#3) 回 `claude/musing-keller-ae1d05`(baseline)。
> 共同 merge-base = `9935e84`（三支都从它分出）。本文是逐文件 canonical 裁决，合并时照此解冲突。
> 权威 SESSION_STATUS 的「三分支合并方案」节给顺序/原则；本文给文件级证据。

合并顺序（沿用 SESSION_STATUS 建议）：先 `ashare`（已部署验证、稳）→ 再 `playbook-ledger`。`template-fill` 多数已是 baseline 祖先 / 与 ashare 内容一致（见下）。

---

## 重叠文件节 — #1 template-fill ∩ #2 ashare（13 文件）

**背景**：`template-fill` 与 `ashare` 在共享分支 `claude/ashare-ae1d05` 上并行推进，#1 的 template-fill 提交被 cherry-pick 到两支（**commit 哈希不同、内容一致**，如 xlsx P0 fix = `2c0de9a`(TF) / `e6b8d4e`(AS)）。故这些「重叠」文件在两支 **tip 内容逐字节相同**。

**核验方法**（2026-06-13，merge-base `9935e84`）：
- 各文件「vs baseline 改动量」两支相等；
- `git diff <template-fill-tip> <ashare-tip> -- <file>` = 空（IDENTICAL）。
- Git 三方合并按**内容**判定：两侧对同一文件做了**相同改动** → 自动解析、无冲突，取该内容。

| # | 文件 | 实质改动（两支一致，#1 template-fill 功能） | vs base | tip-vs-tip | 裁决 |
|---|---|---|---|---|---|
| 1 | `apps/orchestrator/src/agent/template/derivation-check.ts` | 填充值派生校验（防偏离来源） | +187/-0 | IDENTICAL | **任一为准**（同字节）·自动合并 |
| 2 | `…/template/derivation-check.test.ts` | 派生校验单测 | +87/-0 | IDENTICAL | **任一为准**·自动合并 |
| 3 | `…/template/placeholder-schema.ts` | 占位符 schema 定义/校验 | +60/-0 | IDENTICAL | **任一为准**·自动合并 |
| 4 | `…/template/placeholder-schema.test.ts` | 占位符 schema 单测 | +70/-0 | IDENTICAL | **任一为准**·自动合并 |
| 5 | `…/template/template-fill-runner.ts` | docx/xlsx 填充 runner 主流程 | +53/-6 | IDENTICAL | **任一为准**·自动合并 |
| 6 | `…/template/template-fill-runner.test.ts` | runner 单测 | +32/-0 | IDENTICAL | **任一为准**·自动合并 |
| 7 | `…/template/xlsx-template-engine.ts` | xlsx 引擎（含 P0 multi-row degrade fix） | +13/-6 | IDENTICAL | **任一为准**·自动合并 |
| 8 | `…/template/xlsx-template-engine.test.ts` | xlsx 引擎单测 | +19/-11 | IDENTICAL | **任一为准**·自动合并 |
| 9 | `apps/orchestrator/src/files/file-service.ts` | 文件服务支持模板上传/下载 | +57/-1 | IDENTICAL | **任一为准**·自动合并 |
| 10 | `…/files/upload-allowlist.test.ts` | 上传白名单（.docx/.xlsx MIME）测试 | +84/-0 | IDENTICAL | **任一为准**·自动合并 |
| 11 | `apps/orchestrator/src/http.ts` | multipart / 模板上传端点 | +17/-1 | IDENTICAL | **任一为准**·自动合并 |
| 12 | `apps/web-workbench/src/components/InputArea.tsx` | SPA 模板上传 UI 触点（1 行） | +1/-1 | IDENTICAL | **任一为准**·自动合并 |
| 13 | `docs/daily/SESSION_STATUS.md` | 跨 session 状态（各自 session 节） | TF +129 / AS +61 | **61/129 分歧** | **以 musing-keller 为准**（见下）·非代码 |

### 结论
- **#1–#12（全部代码 + 测试）：两支逐字节相同 → 合并零冲突，canonical 无需裁决**（取任一即同一结果）。这些是 #1 template-fill 功能，ashare 侧是 cherry-pick 镜像。合并 ashare 时这 12 文件实为 no-op；template-fill 单独合更是 baseline 增量。
- **#13 `SESSION_STATUS.md`：唯一分歧，但非代码**。两支各持一份过时快照；**canonical = `musing-keller` 自身的 SESSION_STATUS（活跃维护，最新 `41a4bd1`）**。合并时对该文件取 `--ours`（musing-keller 版）或按 session 节做 union，**勿**用任一功能分支的快照覆盖。不阻塞。

### 合并操作提示
- 这 12 文件预期 **无 `<<<<<<<` 冲突标记**；若出现，说明某支被额外改动（届时逐 hunk 比 `git diff <tip> <tip>` 复核）。
- `SESSION_STATUS.md` 冲突 → `git checkout --theirs/--ours` 取 musing-keller 版后，手工把三支 session 节并入。
- 合并后必跑：`pnpm install` + `tsc -b` + 全量 `vitest`（基线 #2 实测 **2570** 绿）才推 baseline。

### 关联（非本节、SESSION_STATUS 已记）
- `trpc/routers/tasks.ts`（热路径）：ashare ④ QA fork + playbook origin 守卫，双方加法。**ashare 已去 churn**（`394830e`，244 纯增量），两支须都保持基线格式（别 `biome --write` 整文件）→ 只解几十行加法冲突。
- `ids.ts` / `schema/index.ts` / `router.ts` / `index.ts` / `schema/tasks.ts`（schema）：ashare ∩ playbook 加法冲突，解法=两边都留（详见 SESSION_STATUS 合并方案）。

---
_生成：2026-06-13，#2(ashare) session。证据命令：`comm -12` 两支 changed-files + `git diff --numstat <tip> <tip>`，merge-base `9935e84`。_
