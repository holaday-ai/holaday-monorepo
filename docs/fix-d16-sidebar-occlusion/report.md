# FIX-D16-SIDEBAR-OCCLUSION

## 结果

在 `codex/fix-batch-disabled-row` 上追加修复，沿用草稿 PR #270，保留先前禁选行提交 `8a527eca` 和独立报告。前端产品代码仅为 `.hd-task-history-scroll` 增加 `scroll-padding-bottom: 2rem`，给自动滚动预留一行按钮的空间。导航、页脚、历史行尺寸、颜色和动画均未修改，没有隐藏控件或删除历史数据。

根因：1366×768 下固定导航和页脚之间的历史滚动区约 77px 高；浏览器在点击任务或恢复菜单触发器焦点时居中滚动，把下一行按钮放在 y=634..666，而滚动区底部为 y=650。新增滚动留白后，对应按钮移动到 y=618..650，控件完整落在可操作区域。

## 复现与验证（TEST-POLICY 第 1 层）

- 上游提供的 [原始对照证据](original-proof.json) 记录了 Deploy-15 基线 `0cf0c4d7` 和 Deploy-16 候选 `0fef8978` 一致的 4 条控件遮挡指纹；该历史记录保留，不用本次修复冒充此前版本已通过。
- 在当前分支修复前，真实页面的“选择任务 / 复制任务文本 / 置顶”三条路径均复现任务标题遮挡，独立断言以 3 条 P1 失败（[记录](red-check.log)、[数据](before.json)）。
- 同一断言修复后覆盖 5 种尺寸 × 3 条路径，**15/15** 通过，无任何几何 P1，每组历史行数量保持一致（[记录](green-check.log)、[数据](after.json)）。
- 原 1366×768 场景完整定向 ui:audit：**1/1 视口、160 个控件，P1=0、P2=0**（[摘要](ui-summary.json)）。包含原来的任务点击、复制、置顶和其他菜单/批量管理交互。
- 相关单元测试 **5 文件 / 31 项通过**，确认先前禁选行修复保留（[记录](related-tests.log)）。
- web-workbench typecheck、CSS 与复现脚本 Biome、脚本语法检查均通过。巡检内 Vite 构建通过（[类型](typecheck.log)、[lint](final-lint.log)）。

定向巡检原始 exit=1 / status=failed，只来自下列明确覆盖范围标记，无发现项；不宣称全站或像素基线验收通过：

- Filtered run: not full release acceptance
- Case-filtered run: not full release acceptance
- 1366x768-task_generate_executing: missing explicit visual baseline

采用与 Deploy-16 原对照一致的巡检器，复制到 `/private/tmp/fix-d16-sidebar-harness/ui-suite/`，没有修改检查逻辑。suite hash：`30f8d6970b2eb49addf256635681f530b0d8b3660b24403eaf2d27f7a332ace0`。仅复制遗漏路由清单的第一次启动失败已单独保留为本地 `startup-diagnostic/`，未计入最终结果。

前端 source hash：`319728daf27e97ad1a9ffe10fd010eb11af5e4addbb4c5088bef7eb5b48b3feb`；Node v25.6.0 / Chromium 147.0.7727.15。完整原始巡检、构建日志和实验数据保存在 `/Users/yaleiqi/.holaday-recovery/tasks/fix-d16-sidebar-occlusion/`。

## 前后截图

| 操作，1366×768 | 修复前 | 修复后 |
| --- | --- | --- |
| 点击当前任务 | [截图](before-1366x768-select.png) | [截图](after-1366x768-select.png) |
| 复制任务文本 | [截图](before-1366x768-copy.png) | [截图](after-1366x768-copy.png) |
| 置顶 | [截图](before-1366x768-pin.png) | [截图](after-1366x768-pin.png) |

其余回归视口：1440×960、1280×960、1024×960、1200×1000，每个都测试三条操作，截图与路径记在 `after.json` 中。

## 复跑

在已安装依赖并构建当前前端的仓库中执行：

```bash
SIDEBAR_CHECK_OUTPUT=/private/tmp/holaday-sidebar-check \
node docs/fix-d16-sidebar-occlusion/verify.mjs after
```

脚本使用实际构建、真实鼠标操作和现有 `measurePage` / `classifyGeometry`，不改生产，也不接触真实账号或后端。最初 `before` 结果为同一脚本在修复前构建上采集。

## 边界

本地前端验证。未合并、未部署、未修改后端或服务器、未 SSH、未读写密钥、未 force push。没有删除、覆盖上游历史 P1 记录，也没有覆盖 `FIX-BATCH-DISABLED-ROW.md` 或先前报告。
