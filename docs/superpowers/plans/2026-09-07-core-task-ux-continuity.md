# Core Task UX Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 修复已复现的建议刷新丢失和体验版计划入口被附件权限连带隐藏。

**Architecture:** 将核心任务建议以 `result.followUpSuggestions` 保存到同一完成结果，使用状态与summary的原子条件防止旧生成覆盖新结果。详情加载恢复建议，不重新调用模型。现有加号菜单始终可用，只有上传项检查附件权限。

**Tech Stack:** TypeScript、Drizzle/MySQL JSON、tRPC、Zustand、React/Radix、Vitest。

**Spec:** 用户本轮“继续”的范围来自上一轮PR227–229发布报告中明确剩余的两项UX缺陷；不改变产品设计、套餐额度或灰度资格。

## Global Constraints

- 基于已发布46749c20555ccc154c6cd23cc92f1b9050caeb07，在既有隔离工作区的新分支实施，主工作区不变。
- 不新增数据库列，不修改额度、上传权限服务端门禁、模型路由、生产开关或敏感业务配置。
- 建议仍为可选辅助内容，失败不改变主任务终态；过期结果不得保存/广播。
- 读取只走现有鉴权详情接口，不使用浏览器localStorage保存跨账号建议。
- 测试/构建串行、Vitest最多2 workers；只用合成数据。管理员登录仅在需要时使用，不扩大原唯一合成灰度。

### Task 1: 保存并恢复建议

**Files:** `apps/orchestrator/src/agent/core-task-suggestions.ts`及测试、`task-repository.ts`及测试、`apps/orchestrator/src/trpc/routers/tasks.ts`及`tasks.core-suggestions.test.ts`、`apps/web-workbench/src/stores/task-store.ts`及测试。

**Interfaces:** helper新增`persist: (suggestions: string[]) => Promise<boolean>`；仓储新增`persistCurrentCompletedSuggestions(taskId, summary, suggestions): Promise<boolean>`；详情结果新增可选JSON数组`followUpSuggestions`，无需改变接口和schema。

- [x] RED：helper必须先保存后广播；保存失败或CAS返回false不得广播。store reset后`selectTask`应从详情恢复建议；非法值/非completed不展示，旧详情不得覆盖已经收到的较新实时建议。

```ts
expect(saved).toEqual([['整理后续执行清单', '比较两种材料结构']]);
expect(events).toEqual(['persist', 'publish']);
expect(useTaskStore.getState().suggestionsByTask.tsk_restored).toEqual(['完善方案']);
```

- [x] GREEN：在完成结果上原子更新JSON，不覆盖其它结果字段；真实路由generate/scrape/resume都接仓储回调。

```sql
UPDATE tasks SET result=JSON_SET(result,'$.followUpSuggestions',CAST(? AS JSON))
WHERE external_id=? AND status='completed'
AND JSON_UNQUOTE(JSON_EXTRACT(result,'$.summary'))=?;
```

- [x] 仓储测试验证真实发出的SQL字段/参数、affectedRows=0拒绝、无状态/summary整体改写。详情测试覆盖malformed JSON数组、session reset和实时事件竞态。
- [x] 运行后端三文件与前端store测试、类型检查。两项修复合并为一个完整提交，在Task 3交付。

### Task 2: 解耦菜单入口与附件权限

**Files:** `apps/web-workbench/src/components/InputArea.tsx`、新增`InputArea.permissions.test.tsx`。

**Interfaces:** 保留现有`attachmentsAllowed`与`onSubmit(intent,fileIds,mode,expertMode,skillSelection)`；加号按钮无论套餐均打开菜单，上传项仅允许时打开file input，否则显示原升级提示。

- [x] RED：渲染真实InputArea（MemoryRouter/ToastProvider），`attachmentsAllowed=false`时加号可打开，选择“先出方案”后发送的mode为plan；受限上传不能触发file input；允许上传仍能触发。

```ts
await user.click(screen.getByRole('button', {name:'附件与任务选项'}));
await user.click(screen.getByRole('menuitem', {name:'先出方案'}));
expect(onSubmit).toHaveBeenCalledWith(expect.any(String), [], 'plan', expect.any(String), undefined);
```

- [x] GREEN：移除包住整个DropdownMenu的权限条件，保留上传项内权限检查；不增加新视觉组件、不绕过文件字节或服务器配额检查。
- [x] 验证菜单键盘关闭、选择状态、提交字段、附件权限及现有composer回归。

### Task 3: 完整验收与交付

- [x] 完整后端/前端测试、类型、构建、前端lint、Qwen合同、ops和diff检查；独立代码审查。
- [x] 本地真实渲染验证新菜单和刷新恢复交互，检查页面/控制台/截图，不用生产管理员绕过套餐来代替体验版回归。
- [ ] 验证分支完成后正常提交推送、创建PR，记录实际检查证据和未验证项；不得复用上一发布的13文件白名单或独占备份。新的发布工具调整须保留精确范围和现有安全门禁。

## Verification record

- 后端393文件6096项、前端249文件2419项通过；类型和构建通过，前端lint通过（保留既有大chunk警告）。
- 41项Qwen合同fixture和静态合同、120项ops与全部shell回归、37项QA安全/报告/发布合同fixture通过。
- 首次完整后端运行遇本地端口EPERM；只提升离线测试的本地监听权限后完整重跑通过，没有修改断言。
- 独立审查唯一Important（旧详情缓存阻止新持久化建议）已用两项RED/GREEN回归解决并复审。实时帧由真实applyServerMessage入口覆盖。
- 本地浏览器真实组件与store验证体验版plan选择/提交、上传门禁、刷新恢复、Escape关闭；console error/warn=0。此为合成tRPC边界，未宣称生产数据库或模型验收。
- 生产仅公开健康接口只读复核，均200/ok。本轮未改生产或启用灰度；上一轮发布工具授权仅PR227–229，新的精确发布边界尚未获批。
