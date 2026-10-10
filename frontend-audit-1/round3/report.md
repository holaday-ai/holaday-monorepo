# FIX-UI-SUITE-1 · 第三轮

**状态：本地验证完成；交付记录见 PR #260。** 分支 `codex/frontend-audit-1`，同一 [PR #260](https://github.com/holaday-ai/holaday-monorepo/pull/260)。没有部署、SSH、生产账号登录、后端修改或密钥文件读写。

## 修复与证据

截图均为本轮离线种子环境采集，目录为本报告所在目录。每项有 `before-<项号>-<宽度>.jpg` 与 `after-<项号>-<宽度>.jpg`，宽度为 1440 / 1280 / 1024；确认弹窗另有 `*-4-<宽度>-open.jpg`。这不是生产截图或真实任务验收。

| 项 | 文件与处理 | 断言 / 验证 |
| --- | --- | --- |
| 1 | `styles/approved-ui.css`、`components/ui/dropdown-menu.tsx`、`components/ui/tooltip.tsx`、`components/skills/CapabilityCenterContent.tsx`：共享 dropdown/dialog/confirmation/tooltip 层级 token，技能弹窗内菜单使用弹窗浮层 token。 | ui-suite：菜单层级高于 dialog；正常点击命中选项；Escape 只关闭菜单；选中技能后触发器显示更新。 |
| 2 | `pages/SettingsPage.tsx`、`styles/approved-ui.css`：设置导航吸顶位置避开全局顶栏；分区锚点预留顶栏与导航的完整高度。 | ui-suite：滚动后通知、账号链接可点击，导航几何边界在账户控件下方；八个分区跳转后正文不得被吸顶导航覆盖。 |
| 3 | `pages/scheduled-calendar/calendar-styles.css`：日历吸顶区及列头共享全局页头偏移。 | ui-suite：月视图滚动后新建按钮可点击，边界低于账户控件。 |
| 4 | `components/ConfirmDialog.tsx`、`pages/scheduled-calendar/{ScheduledCalendarPage,EventDetailPopover,QuickCreatePopover}.tsx`：确认框 Portal；只处理最上层确认框的 Escape；暂停底层详情关闭监听。嵌套确认框沿用共享层级 token。 | ui-suite：创建种子计划→删除确认→Escape，弹窗消失、未调用 delete、计划仍在。组件测试另覆盖双层确认框和处理中 Escape。 |
| 5 | `pages/AstrologyPageShell.tsx`、`components/energy/{EnergyHome.tsx,energy.css}`：标题避开顶栏，探索卡说明完整换行；桌面内容滚动区与底部任务提示条分行，避免压住卡片按钮。 | ui-suite：标题和日期不侵入顶栏；卡片说明 scrollHeight 不超过 clientHeight；内容滚动视口底边不得越过任务提示条，轻测试按钮正常点击命中。补充截图 `after-5-<宽度>-descriptions.jpg`。 |
| 6 | `components/AppShell.tsx`、`styles/approved-ui.css`：顶栏滚动区域加入实底；创作页使用不透明深色遮罩；面包屑保留在背景层上方。 | 三宽度滚动截图、全量布局检测。 |
| 7 | `pages/StockTasksPage.tsx`：无有效报价时整块隐藏关注股涨跌数量，保留页面已有数据状态说明。 | 三宽度空行情截图；不使用模拟涨跌数量填空。 |
| 8 | `components/InputArea.tsx`：已有任务用“补充问题或下一步指令...”，等待用户回复时保留专用提示。 | 三类已有任务的组件测试、三宽度截图。 |
| 9 | `components/InputArea.tsx`：只有具备浏览器记录的任务显示 Chrome 入口，移除未指定类型的新任务入口兜底。当前 #260 的生成失败场景原本已有隔离，本轮补齐边界测试。 | 生成/图片/抓取失败与新任务组件测试；完整套件的任务模式×状态矩阵。 |
| 10 | `components/BrowserReplay.tsx`、`components/BrowserPanel.tsx`：回放入口改为可辨识按钮；空白地址显示“尚未打开网页”。 | 回放原有交互测试；新增 BrowserPanel 空地址实际渲染测试；三宽度面板截图。截图种子有有效示例地址，空地址由组件测试单独证明。 |
| 11 | `lib/search-source-link.ts`、`lib/source-attribution.ts`、`components/SearchResultCard.tsx`：按确切域名及其子域名显示站点名称；搜索标题中的明确内部标识转换为可读名称。未知/仿冒域名仍显示真实域名，不把站点名当作真实性认证。 | 精确域名、子域名、仿冒域名和内部标识测试；三宽度来源卡截图。截图使用本地种子中的 finance.eastmoney.com 示例链接；没有访问真实站点。 |
| 12 | `lib/trust-summary.ts`：缺少审核时的兜底改为中性证据说明；沿用已在 #260 实现的规则，正常完成无审核时不显示醒目复核卡，真正失败与来源不足仍保留。 | 正常完成/审核失败分支测试，三宽度完成态截图。该项部分修复已在本轮开始前存在。 |

## 验证记录

- 最终无筛选 `pnpm ui:audit`：240 / 240，P1 = 0，P2 = 369，P3 = 0，覆盖缺口 = 0，退出码 0。完整清单见 [剩余 P2/P3](remaining-findings.md)，摘要见 [audit-summary.json](audit-summary.json)。
- 前端单测：282 文件 / 2664 测试通过，日志 `/private/tmp/round3-final-tests.log`。
- lint / typecheck / build：通过，日志 `/private/tmp/round3-final-build.log`；既有大 bundle 警告保留。
- UI 检测器自测：61 / 61 通过，日志 `/private/tmp/round3-suite-calibrated-tests.log`。
- 五项 P1 的三宽度专项断言均通过，15 项断言路径；最终完整矩阵通过。
- 首次新增确认框测试误用未安装 jsdom，已改为仓库现有 happy-dom；最终通过的运行使用新进程。旧失败日志不作通过证据。

## 套件与边界

沿用 #261 的套件源码和已冻结基准（来源提交 `4b324572`），没有改写其分支或用更新基准消除差异；新增 `ui-suite/lib/round3-checks.mjs` 的 P1 专项断言。所有 HTTP/WS 均限本地种子，远端访问被拦截；已知站点链接只是离线来源展示样本。真实生成、退款重试、行情时效与真实网站浏览执行未验。

#259 交付前再次核对仍为 OPEN（head `2c8096c77a060e487e87d2cffff14a5d9fa57c8a`，mergedAt=null）；本轮未 rebase、未强推。提交内容须与下方源码哈希一致；完整提交号见 PR #260 的本轮提交记录和本机交付记录。

## 检测器校准记录

首次完整运行在浏览器取消态报控件重叠。独立测量确认：滚动容器裁切边界 y=806，输入框始于 y=807；按钮未裁切的原始边界延伸至 y=824.5，实际可见区域不重叠，普通点击也能展开。新增真实 Chromium 回归用例先复现误报，再将重叠计算改为祖先裁切后的可见矩形；同一用例仍要求真正可见的遮挡报 P1。25% 阈值、命中检测、路由覆盖和视觉基准均未放宽。

原始中断运行在 `diagnostic-initial-run/`，测量在 `overlap-measurements.txt`，截图在 `overlap-reproduction.jpg`。这些仅为诊断证据，不计作最终通过。

## 三尺寸截图索引

| 项目 | 1440 前 / 后 | 1280 前 / 后 | 1024 前 / 后 |
| --- | --- | --- | --- |
| 1 | [前](before-1-1440.jpg) / [后](after-1-1440.jpg) | [前](before-1-1280.jpg) / [后](after-1-1280.jpg) | [前](before-1-1024.jpg) / [后](after-1-1024.jpg) |
| 2 | [前](before-2-1440.jpg) / [后](after-2-1440.jpg) | [前](before-2-1280.jpg) / [后](after-2-1280.jpg) | [前](before-2-1024.jpg) / [后](after-2-1024.jpg) |
| 3 | [前](before-3-1440.jpg) / [后](after-3-1440.jpg) | [前](before-3-1280.jpg) / [后](after-3-1280.jpg) | [前](before-3-1024.jpg) / [后](after-3-1024.jpg) |
| 4 | [前](before-4-1440.jpg) / [后](after-4-1440.jpg) | [前](before-4-1280.jpg) / [后](after-4-1280.jpg) | [前](before-4-1024.jpg) / [后](after-4-1024.jpg) |
| 5 | [前](before-5-1440.jpg) / [后](after-5-1440.jpg) | [前](before-5-1280.jpg) / [后](after-5-1280.jpg) | [前](before-5-1024.jpg) / [后](after-5-1024.jpg) |
| 6 | [前](before-6-1440.jpg) / [后](after-6-1440.jpg) | [前](before-6-1280.jpg) / [后](after-6-1280.jpg) | [前](before-6-1024.jpg) / [后](after-6-1024.jpg) |
| 7 | [前](before-7-1440.jpg) / [后](after-7-1440.jpg) | [前](before-7-1280.jpg) / [后](after-7-1280.jpg) | [前](before-7-1024.jpg) / [后](after-7-1024.jpg) |
| 8 | [前](before-8-1440.jpg) / [后](after-8-1440.jpg) | [前](before-8-1280.jpg) / [后](after-8-1280.jpg) | [前](before-8-1024.jpg) / [后](after-8-1024.jpg) |
| 9 | [前](before-9-1440.jpg) / [后](after-9-1440.jpg) | [前](before-9-1280.jpg) / [后](after-9-1280.jpg) | [前](before-9-1024.jpg) / [后](after-9-1024.jpg) |
| 10 | [前](before-10-1440.jpg) / [后](after-10-1440.jpg) | [前](before-10-1280.jpg) / [后](after-10-1280.jpg) | [前](before-10-1024.jpg) / [后](after-10-1024.jpg) |
| 11 | [前](before-11-1440.jpg) / [后](after-11-1440.jpg) | [前](before-11-1280.jpg) / [后](after-11-1280.jpg) | [前](before-11-1024.jpg) / [后](after-11-1024.jpg) |
| 12 | [前](before-12-1440.jpg) / [后](after-12-1440.jpg) | [前](before-12-1280.jpg) / [后](after-12-1280.jpg) | [前](before-12-1024.jpg) / [后](after-12-1024.jpg) |

## 设置锚点追加回归

完整矩阵首次覆盖 `/settings/appearance` 时发现吸顶导航遮挡主题按钮，保留在 `diagnostic-settings-anchor/`，该次中断运行不作通过证据。三宽度独立复现证明旧 96px 锚点留白不足；新增八个设置分区的锚点边界断言后先验证失败，再修复设置页专用滚动留白。最终完整检查结果见验证记录。

## 吸顶与通知浮层的检测解释

设置锚点修复后，进一步发现两类正常行为仍被泛化几何检测标为 P1：可滚动正文经过吸顶导航下方、以及短暂可关闭通知覆盖按钮。真实页面验证：向上滚动能正常打开 API Key 表单；关闭提示后可以正常打开账号影响预览。证据为 `settings-sticky-overlay.jpg`、`settings-toast-overlay.jpg` 与 `settings-overlays.log`。

新增检测器正反例先复现误报，再校准：仅对同一滚动容器内、能通过回滚完整露出的普通正文，计算不透明吸顶导航下方的可见区域；固定/吸顶同级控件不豁免。通知只识别固定 live region 中带明确关闭语义的按钮，关闭后必须继续遍历底层控件。固定层之间的遮挡、不可关闭遮挡仍须报 P1。没有修改数值重叠阈值、视觉基准、真实点击失败门禁或页面覆盖范围。

第 7 项无行情、第 11 项已知来源的修复前截图，另从提交 `935ae492` 的独立只读源码快照重新构建补拍；与修复后使用相同离线数据。原有有行情截图不作为空行情验证证据。


## 能量页底部任务提示条

完整检查进一步发现能量页自身的 `RunningTaskDock` 在滚动时覆盖轻测试、收藏和换一组按钮。旧中断运行保留在 `diagnostic-energy-dock/`，12 条 P1 不是通过证据。新增滚动区域与任务提示条边界断言，三个宽度均先失败后通过。桌面页现在使用固定高度内容区，卡片独立滚动，提示条占独立的一行；原有图案、颜色、圆角和功能保留，移动端布局未改。补充截图 `after-5-<宽度>-task-dock.jpg`。


能量页追加诊断的首个完整视口已无控件遮挡，唯一 P1 是重复点击 `aria-current="page"` 当前导航时无变化的误报。检测器按其已有“当前路由链接”规则补齐路由按钮语义；带展开或弹出语义的按钮不豁免。新增 Chromium 正反例先失败后通过，要求失效的非当前导航与失效展开按钮仍报错、项目展开按钮必须实际点击。诊断记录在 `energy-dock-recheck/`，中断的筛选运行不作为完整门禁通过证据。


## 原生全屏确认框回归

复核共享确认框发现 `body` Portal 在原生全屏容器之外不可见。用实际 `ConfirmDialog` 组件的 Chromium 原生全屏最小用例复现后，改为订阅 `fullscreenchange` 并挂载到当前全屏元素，退出全屏后恢复到 body。测试要求实际点击取消、退出全屏后按 Escape 均能关闭，且没有触发确认动作；这是组件级真实浏览器验证，不冒充生产会话验证。日志：`/private/tmp/round3-native-confirm-red.log`、`/private/tmp/round3-native-confirm-green.log`。

为覆盖这个追加修复，先前完整检查在 1440 宽度中途停止，记录保留于 `diagnostic-fullscreen-review/`，不作最终通过证据。最终测试和无筛选 UI 检查均从新进程重跑。


## 股市研究建议追加 P1

完整检查在展开“研究建议”并选择首条建议后发现 5 条真实遮挡信号，保留在 `diagnostic-stock-suggestions/`。旧 `.hd-stock-dock [role="group"]` 绝对定位误作用于新版 details 按钮组；恢复正常排版后，1024 宽度的展开编辑又暴露旧 390px 高度上限裁切。桌面样式现让建议组正常排版、折叠区按内容高度展开，保留 620ms 折叠/位移动效和 440ms 渐隐，不改移动端布局。

`stockSuggestionChecks` 在三种宽度分别验证展开建议→选择建议→展开编辑→收起输入框→重新展开，要求标题与按钮无重叠、所有建议按钮在可见边界内且可正常点击。旧版三个宽度先失败，修复后三个宽度通过。补充截图 `before-7-<宽度>-suggestions.jpg` / `after-7-<宽度>-suggestions.jpg`，以及 `after-7-<宽度>-suggestions-expanded.jpg` / `*-reopened.jpg`；这些追加对照来自本轮修复过程，不是最初 935ae492 的空行情截图。


## 剩余页面完整诊断与追加修复

`remaining-diagnostic/` 已完成 30 / 30 个组合（1440、1024），32 条 P1，55 条 P2；仅有筛选运行声明的两条覆盖缺口。此运行用于诊断，不是最终通过证据。

- 媒体顶部渐变改为不透明深色遮罩，拦住已滚出可见区域的控件；上传卡片和移除按钮独立占位，图片生成按钮回到输入区之后。文件：`styles/approved-ui.css`。
- 旧任务菜单移入规划标签栏正常布局，避免绝对定位被标签栏挡住；已选中今天且在当前月份时，今天按钮禁用，换月后可用。文件：`pages/planned/PlannedTasksPage.tsx`、`styles/approved-ui.css`。
- 批量任务展开标题支持再次点击收起，重开后保留草稿。文件：`components/BatchTaskDialog.tsx`。
- 日期框原值已是套件默认日期，重复填入没有变化而误报。`ui-suite/lib/interaction.mjs` 改为填入不同日期；新增 `date-input.test.mjs` 正反例要求正常控件接受修改、丢弃修改的失效控件仍失败。

新增页面断言在 1440 / 1280 / 1024 全部先失败后通过（12 / 12）：`round3-extra-red.log`、`round3-extra-green.log`。日期正反例先失败后通过：`round3-date-red.log`、`round3-date-green.log`。已纳入完整 `ui:audit`。追加截图为 `after-6-<宽度>-video-header.jpg`、`after-6-<宽度>-video-upload.jpg`、`after-6-<宽度>-image-composer.jpg`、`after-3-<宽度>-legacy-menu.jpg`、`after-4-<宽度>-batch-collapsed.jpg`。最终完整 240 组合的验收结果见上方验证记录；局部通过单独保留。

本轮追加“今天”状态使用 FullCalendar 的 `getDate()` 后，现有单测 mock 缺少该接口，曾使 5 项测试失败；已补齐 mock。相关 5 项以及最终全量 2664 项均在新进程中通过，浏览器回归使用实际 FullCalendar。


## 240 组合完整诊断后的两项修复

上一轮无筛选运行已完成 240 / 240，6 条 P1、381 条 P2、覆盖缺口 0，原始结果保留于 `diagnostic-browser-input-overlap/`；该失败运行不作最终通过证据。

- `components/BrowserPanel.tsx`：浏览器输入辅助条展开时，桌面日志入口与展开的日志区上移避让，覆盖实时画面与截图回退两种渲染路径；关闭输入条恢复原位置。
- `components/ScheduledTaskDialog.tsx`：重复频率、提醒选项补齐 `aria-pressed`，与同一弹窗已有的失败通知选项一致。

新增 `browserInputOverlayChecks` / `scheduledChoiceChecks` 已纳入完整套件。三个宽度的执行中、等待用户以及定时弹窗共 9 条路径先复现失败：浏览器入口/日志区不得压住输入条，关闭后可再次展开日志；定时选项切换后新旧选中态必须更新。修复前截图为 `before-10-<宽度>-<执行状态>-input-log.jpg` 和 `before-4-<宽度>-schedule-choices.jpg`。修复后 9 / 9 路径通过，日志 `round3-browser-red.log` / `round3-browser-green.log`，对应 `after-*` 截图已保存；无筛选完整复验结果见上方验证记录。


## 最终源码对应关系

完整检查在提交前冻结的工作树上执行，因此原始 candidate 为起始 HEAD `935ae492b7c7fce03a19ad46fefefb8a224046ec`。最终交付须核对以下源码哈希与提交内容一致；提交后的核对记录见本机 `delivery-integrity.json`。

- 前端 SHA-256：`04cf9ab295a86a5a61fa8e2e6c9a6d193df88d11ad09db78825b93cfc1e45e58`
- 套件 SHA-256：`64df7757c6ef4848d4ef816ec6af06d37cf584e41edad2ac6bfd5fb728986720`
- 构建 SHA-256：`c79b825d261a088aea582df94e9fd4fdd6411a103fd2784017f22fc5bce7ff2f`
- #261 原始 481 个基准文件逐个 Git blob 对照保持一致，未更新基准。
