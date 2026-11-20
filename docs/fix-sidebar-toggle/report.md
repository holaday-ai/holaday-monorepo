# 紧凑宽度侧栏切换修复

## 范围与版本

- 任务：`FIX-SIDEBAR-TOGGLE.md`，遵循 `TEST-POLICY.md` 第 1 层定向验证。
- 基线：`claude/capability-recovery`，`b450d9766eda2e2381ebacbe440d80138240c0c3`。
- 分支：`codex/fix-sidebar-toggle`。
- 源码提交：`937bad5686abde39ada1fca6744b51b5edf43215`。
- 未修改后端、生产配置、审计检测器或视觉基线；未合并、部署、SSH 或访问密钥内容。

## 原因与修复

原实现的按钮更新持久展开偏好，但子级 `forceCollapsed` 继续强制折叠，造成点击无可见变化且错误改写宽屏偏好。

现在由 `SidebarProvider` 统一管理强制收起状态，额外保存临时浮层开关。紧凑布局下展开面板覆盖内容，布局占位仍保持收起宽度；再次点击、点外部和 Escape 可以关闭。退出紧凑布局后恢复原有持久偏好。

按钮的 `aria-expanded` 与展开/收起提示跟随实际状态。浮层中的门户菜单可以正常操作，Escape 先关闭子菜单，再关闭侧栏。未修改既有宽度过渡样式及 reduced-motion 行为。

## 第 1 层验证

| 检查 | 结果 |
| --- | --- |
| 修复前新增测试 | 7 项中的 6 项失败，覆盖临时展开、关闭和提示状态缺陷；宽屏持久切换通过 |
| 修复后定向组件测试 | 2 文件、11 项通过，含新增 8 项 |
| `vitest related` | 10 文件、173 项通过 |
| 改动文件 Biome | 0 错误；保留 1 条既有 `useSemanticElements` 警告 |
| web-workbench typecheck | 通过 |
| Vite 构建 | 通过；保留既有 Tailwind/chunk-size 提示 |
| 真实页面几何断言 | 1440 / 1280 / 1024 全部通过 |

测试日志：[修复前](evidence/red.txt)、[修复后定向](evidence/green.txt)、[相关测试](evidence/related-tests.txt)、[lint](evidence/lint.txt)、[typecheck](evidence/typecheck.txt)、[构建](evidence/after-build.txt)。

### 复现命令

Node 22.23.3 / pnpm 10，单 worker 串行执行；typecheck 使用 3GB heap，UI 审计使用 1.5GB heap。

```sh
pnpm --filter @holaday/web-workbench exec vitest related src/components/ui/sidebar.tsx src/components/Sidebar.tsx src/components/AppShell.tsx --run --maxWorkers=1 --minWorkers=1
pnpm exec biome check apps/web-workbench/src/components/AppShell.tsx apps/web-workbench/src/components/Sidebar.tsx apps/web-workbench/src/components/ui/sidebar.tsx apps/web-workbench/src/components/ui/sidebar-accessibility.test.tsx apps/web-workbench/src/components/ui/sidebar-toggle.test.tsx
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench exec vite build --config vite.config.ts
```

## 页面实测与前后截图

下表为点击侧栏切换后的表现，使用本地合成浏览器执行中任务，视口高 960px。

| 宽度 | 修复前侧栏宽度 | 修复后侧栏宽度 | 修复后布局占位 | 浏览器地址栏位置 / 宽度 | 持久偏好 |
| --- | --- | --- | --- | --- | --- |
| 1280 | 82 → 82 | 82 → 318 | 80 → 80 | 1019.96875 / 119.03125，不变 | 不改写 |
| 1024 | 82 → 82 | 82 → 318 | 80 → 80 | 857.96875 / 25.03125，不变 | 不改写 |
| 1440 | 318 → 82 | 318 → 82 | 318 → 80 | 与修复前行为一致 | 正常保存折叠偏好 |

修复前紧凑模式错误写入 `sidebar:state=false`；修复后紧凑模式不写入该 cookie。

- 1280：[修复前](evidence/before-1280.jpg) / [修复后](evidence/after-1280.jpg)
- 1024：[修复前](evidence/before-1024.jpg) / [修复后](evidence/after-1024.jpg)
- 1440：[修复前](evidence/before-1440.jpg) / [修复后](evidence/after-1440.jpg)
- 原始几何数据：[修复前](evidence/before-interaction.json) / [修复后](evidence/after-interaction.json)

## 定向 UI 审计

10/10 场景完成，P1=0，P2=2；无失败或未覆盖控件，10 张初始页面截图均与现有基线一致。两档执行中场景的侧栏切换均记录为 `passed`，再次点击 / Escape 均为 `true`。

| 场景 | 宽度 | 控件数 | P1 | P2 |
| --- | --- | --- | --- | --- |
| task:browser:executing | 1280 | 256 | 0 | 1 |
| task:browser:completed | 1280 | 124 | 0 | 0 |
| task:browser:failed | 1280 | 93 | 0 | 0 |
| task:browser:awaiting_user | 1280 | 83 | 0 | 0 |
| task:browser:cancelled | 1280 | 92 | 0 | 0 |
| task:browser:executing | 1024 | 254 | 0 | 1 |
| task:browser:completed | 1024 | 122 | 0 | 0 |
| task:browser:failed | 1024 | 91 | 0 | 0 |
| task:browser:awaiting_user | 1024 | 81 | 0 | 0 |
| task:browser:cancelled | 1024 | 90 | 0 | 0 |

P2 是两档宽度各一次的侧栏长任务名省略（`UI generate awaiting_us…`），与基线中[保留的同类 P2](https://github.com/holaday-ai/holaday-monorepo/blob/b450d9766eda2e2381ebacbe440d80138240c0c3/docs/ui-p2-batch/retained-p2.md)一致；此次保留并附截图。

运行命令：

```sh
UI_AUDIT_CASES='["task:browser:executing","task:browser:completed","task:browser:failed","task:browser:awaiting_user","task:browser:cancelled"]' UI_AUDIT_WIDTHS='[1280,1024]' pnpm ui:audit
```

原始程序退出码为 1、status 为 `failed`，原因仅为预期的两条筛选声明（`Filtered run` / `Case-filtered run`）；没有其它 coverage gap。本次符合第 1 层定向验收要求，不冒充全量发布验收。

源码 hash：`8688387293788bf2dcf7eacf7c7a0de7445f2a7770ebabdfcf00cf184ec1ca20`；构建 hash：`a694f7008e4ebab1424d2aa8fbdf70ddf685fe554dcedd57d5e5c662c717ce8a`。审计期间源码与检测器未变，文档补充不改变前端源码。

证据：[汇总](evidence/ui-audit/summary.json)、[原始报告](evidence/ui-audit/report.md)、[完整 JSON 压缩件](evidence/ui-audit/report.json.gz)、[运行日志](evidence/ui-audit/run.txt)。


[证据文件 SHA-256 清单](manifest.json)。

## 验证边界

以上使用本地 seed、离线外部资源占位和 Chromium；不代表真实生成、退款、行情或生产浏览器会话验收。按第 1 层政策未运行前后端全量测试及 240 场景全量审计。
