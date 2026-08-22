# File Library Legacy Filename Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让文件库正确显示历史乱码文件名，并允许用户用正确中文名称搜索这些旧记录。

**Architecture:** 复用上传服务现有的安全文件名解码器，在 files tRPC 路由的返回边界做只读规范化；搜索侧生成原查询和旧 Latin-1 存储候选，以参数化 OR 条件兼容新旧数据。无需迁移数据库或修改存储对象。

**Tech Stack:** TypeScript, tRPC, Drizzle ORM, Vitest, pnpm

**Spec:** `docs/superpowers/specs/2026-08-22-file-library-legacy-filename-trust-design.md`

## Global Constraints

- 不回写数据库，不重命名存储对象，不改变文件 ID、下载或删除行为。
- 复用 `decodeUploadFilename`，不复制第二套乱码判断逻辑。
- 查询仍限制为 100 字符，并使用 Drizzle 参数化 SQL 条件。
- 已正确的 Unicode、ASCII 和真实 Latin-1 文件名必须保持不变。
- 不改通知设置、AI 记忆页面、支付、密钥或生产配置。
- 仅在含 C1 乱码控制字节且 UTF-8 序列正等待续字节时恢复被归一化的 `0xA0`，不得改写普通空格。

---

### Task 1: 文件名显示与搜索候选纯函数

**Files:**
- Modify: `apps/orchestrator/src/trpc/routers/files.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/files.ts`

**Interfaces:**
- Consumes: `decodeUploadFilename(name: string): string` from `apps/orchestrator/src/files/file-service.ts`
- Produces: `normalizeLibraryFilename(filename: string): string`
- Produces: `libraryFilenameSearchTerms(query: string): string[]`

- [x] **Step 1: 写失败测试**

在 `files.test.ts` 中添加用例，断言：

```ts
expect(normalizeLibraryFilename('å¨æ¥æ¨¡æ¿.xlsx')).toBe('周报模板.xlsx');
expect(normalizeLibraryFilename('正常文件.pdf')).toBe('正常文件.pdf');
expect(normalizeLibraryFilename('café.docx')).toBe('café.docx');
expect(libraryFilenameSearchTerms('周报模板')).toEqual([
  '周报模板',
  Buffer.from('周报模板', 'utf8').toString('latin1'),
]);
expect(libraryFilenameSearchTerms('report')).toEqual(['report']);
```

- [x] **Step 2: 运行测试并确认失败原因**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/files.test.ts`

Expected: FAIL because `normalizeLibraryFilename` and `libraryFilenameSearchTerms` are not exported.

- [x] **Step 3: 写最小实现**

在 `files.ts` 中导入 `decodeUploadFilename`，并实现：

```ts
function normalizeLibraryFilename(filename: string): string {
  return decodeUploadFilename(filename);
}

function libraryFilenameSearchTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const legacyEncoded = Buffer.from(trimmed, 'utf8').toString('latin1');
  return legacyEncoded === trimmed ? [trimmed] : [trimmed, legacyEncoded];
}
```

把两个函数加入 `__filesRouterInternals`。

- [x] **Step 4: 运行定向测试并确认通过**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/files.test.ts`

Expected: PASS.

### Task 2: 路由接入兼容搜索与显示规范化

**Files:**
- Modify: `apps/orchestrator/src/trpc/routers/files.ts`
- Test: `apps/orchestrator/src/trpc/routers/files.test.ts`

**Interfaces:**
- Consumes: `normalizeLibraryFilename(filename: string): string`
- Consumes: `libraryFilenameSearchTerms(query: string): string[]`
- Produces: `files.list` 返回规范化后的 `filename`，并用新旧查询候选过滤

- [x] **Step 1: 将搜索条件接入路由**

用 `libraryFilenameSearchTerms(input.q ?? '')` 生成候选，每个候选转换为 `like(taskFiles.filename, \`%${term}%\`)`，多个候选以 `or(...matches)` 加入 `conds`。

- [x] **Step 2: 将返回文件名接入规范化**

在 `items` 映射中将 `filename: r.filename` 改为：

```ts
filename: normalizeLibraryFilename(r.filename),
```

- [x] **Step 3: 运行路由定向测试**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/files.test.ts`

Expected: PASS.

### Task 3: 发布门禁与生产验收

**Files:**
- Verify: `apps/orchestrator/src/trpc/routers/files.ts`
- Verify: `apps/orchestrator/src/trpc/routers/files.test.ts`

**Interfaces:**
- Consumes: 完成后的 `files.list` 行为
- Produces: 可审查、可部署、具备生产证据的变更

- [x] **Step 1: 运行 Orchestrator 门禁**

Run: `pnpm --filter @holaday/orchestrator typecheck`

Expected: exit 0.

Run: `pnpm --filter @holaday/orchestrator build`

Expected: exit 0.

Run: `git diff --check`

Expected: no output and exit 0.

- [x] **Step 2: 审查最终差异并提交**

Run: `git diff -- apps/orchestrator/src/trpc/routers/files.ts apps/orchestrator/src/trpc/routers/files.test.ts docs/superpowers/specs/2026-08-22-file-library-legacy-filename-trust-design.md docs/superpowers/plans/2026-08-22-file-library-legacy-filename-trust.md`

Expected: only the scoped compatibility fix, tests, spec and plan.

- [ ] **Step 3: 推送并创建 Ready PR**

提交信息：`fix(files): recover legacy encoded filenames`

PR 必须说明不迁移数据、不重命名对象，并列出定向测试、类型检查和构建证据。

- [ ] **Step 4: 合并、部署 application 并验证生产**

在生产 `/files` 验证：旧记录显示正确中文；搜索 `周报模板` 命中同一文件；正常文件名不变；健康检查保持 200/status ok。

### Task 4: 生产验收发现的空格归一化旧数据

**Files:**
- Modify: `apps/orchestrator/src/files/upload-allowlist.test.ts`
- Modify: `apps/orchestrator/src/files/file-service.ts`
- Modify: `apps/orchestrator/src/trpc/routers/files.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/files.ts`

**Interfaces:**
- Consumes: `decodeUploadFilename(name: string): string`
- Produces: 对 UTF-8 续字节 `0xA0` 被归一化为空格的窄恢复逻辑
- Produces: `libraryFilenameSearchTerms` 的空格归一化旧存储候选

- [x] **Step 1: 写失败测试并复现生产值**

使用生产页面实际字符序列 `åä¹±ç´ æ.txt`，验证显示恢复、搜索候选与真实 Latin-1 普通空格保护；确认修复前 3 项测试失败。

- [x] **Step 2: 实现最小续字节修复**

逐字节验证 UTF-8 序列，只把续字节槽位中的 `0x20` 恢复为 `0xA0`；必须同时存在 C1 乱码信号，最终解码不得含 U+FFFD。

- [x] **Step 3: 扩展旧存储搜索候选**

当 Latin-1 候选含 U+00A0 时，追加其 ASCII 空格变体并去重。

- [x] **Step 4: 运行定向测试**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/files/upload-allowlist.test.ts src/trpc/routers/files.test.ts`

Expected: 47/47 PASS.
