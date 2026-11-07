# FIX-BATCH-LOADMORE-OCCLUSION

- 日期：2026-10-13
- 分支：`codex/fix-batch-disabled-row`，继续 [草稿 PR #270](https://github.com/holaday-ai/holaday-monorepo/pull/270)
- 修复前基线：`c6faa138a05b4ef03219776f429a7fa12decc564`
- 范围：纯前端；未合并、未部署、未访问生产或 SSH、未读写密钥、未 force push。

## 问题与修复

精确路径：`task:generate:executing` → **批量管理任务** → **UI generate cancelled 已取消**。在修复前真实 Chromium 重现 D17-UI-01：1440×960 的加载按钮位于 y=766，高 32px，任务滚动区止于 y=782，只有 16px 露出，按钮中心无法命中。原 `scroll-padding-bottom: 2rem` 会影响焦点滚动，却不增加实际内容留白。在 1366×768 中，批量栏还把历史区域压缩到 17px，容不下一个完整按钮。

1. 测量批量栏实际高度、上下 margin 和页脚 gap，以 ResizeObserver 跟随尺寸变化；把对应空白加入历史列表的真实内容末端，并与焦点滚动边界同步。
2. 批量模式下历史区域至少保留“实测栏位空间 + 64px”，足以展示一个完整控件和原有间距。短视口时快捷导航区允许收缩、滚动，全部入口仍在；页脚仍在正常 flex 布局中，不覆盖历史区域。
3. 普通模式保留原 2rem 焦点滚动修复；退出批量模式即恢复原布局。配色、行高、按钮样式、动效和任务数据逻辑未改。

## 第 1 层验证

[可复跑脚本](verify.mjs) 使用仓库原始 `startSeedServer`、`observeControl`、`measurePage`、`classifyGeometry`，未修改检测器或阈值。前后均使用本地合成数据、固定浏览器时间和真实 Chromium。脚本明确对按钮完整可见、命中、任务数增长进行额外断言，没有通过隐藏控件规避检查。

| 视口 | 精确三步 P1 | 原五条 | 加载更多实际点击 | 末项、加载按钮、焦点滚动 |
| --- | --- | --- | --- | --- |
| 1440×960 | 0 | 通过 | 8 → 16 条 | 完整可见并命中 |
| 1366×768 | 0 | 通过 | 8 → 16 条 | 完整可见并命中 |
| 1200×1000 | 0 | 通过 | 8 → 16 条 | 完整可见并命中 |
| 1280×960 | 0 | 通过 | 8 → 16 条 | 完整可见并命中 |
| 1024×960 | 0 | 通过 | 8 → 16 条 | 完整可见并命中 |

- 30 个定向场景，1,327 个控件几何记录，P1=0；加载之后的五次几何检查同样 P1=0。
- 原五条：执行中禁选行的解释语义、已取消任务、对应任务菜单、已完成浏览器任务、待确认任务。每个视口均重新执行，普通模式没有重新出现原 1366×768 遮挡。
- 相关 Vitest：5 文件 / 31 项通过。
- 前端包 typecheck、变更 TSX 的 ESLint、最终 Vite build 均通过。
- Biome 检查退出 0；仅保留原有 `p role="status"` 的语义标签建议。构建保留已有大 chunk 提示。
- 修复前脚本按预期失败（1440×960 control-occluded P1），最终脚本退出 0。完整记录见 [before.json](evidence/before.json)、[after.json](evidence/after.json)、对应日志；源码哈希见 [source-sha256.json](evidence/source-sha256.json)。

复跑：先构建前端，然后运行：

```bash
SIDEBAR_CHECK_OUTPUT=/private/tmp/sidebar-proof node docs/fix-batch-loadmore/verify.mjs after
```

这是受影响路径的定向 ui:audit 及本地合成回归，不是全站 UI 巡检、像素基线验收、生产后端验收或发布许可。按任务要求不跑全量测试。

## 前后截图

1440×960：

![修复前：加载按钮仅露出 16px](evidence/before-1440x960-batch.png)

![修复后：选择任务后无控件遮挡](evidence/after-1440x960-batch.png)

1366×768：

![修复前：批量模式历史区不足一个控件](evidence/before-1366x768-batch.png)

![修复后：导航可滚动，历史区留出完整控件空间](evidence/after-1366x768-batch.png)

全部五视口的截图与原五条回归截图均在 `evidence/`，文件哈希见 `manifest.sha256`。
