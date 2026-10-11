# UI P2 batch

状态：修复与最终无筛选本地 UI 门禁完成；240/240，P1=0，P2=17，覆盖缺口=0，退出码=0。推送与草稿 PR 信息见文末。

分支 `codex/ui-p2-batch`，基于 `69febb6f`（含 #259/#260/#261）。仅本地桌面前端和本地种子套件；未部署、合并、SSH 或访问生产，不涉及密钥文件。

## 改动与证据

[完整代码文件列表](changed-code-files.txt)。所有前后截图见 [三个桌面宽度截图清单](screenshots.md)（1440/1280/1024，共 39 组）。截图是本地种子状态，不等同于真实后端验收。

|任务|改动文件（apps/web-workbench/src 下）|结果与测试|
|---|---|---|
|1 终态计划卡|components/PlanCard.tsx、TaskStream.tsx、PlanCard.test.tsx|终态任务隐藏过期计划计数，保留真实详细步骤，不伪造完成状态；4 种终态及恢复执行的回归测试。|
|2 设置导航|styles/approved-ui.css|桌面导航单行、支持横向溢出，吸顶上方 8px 间隙由实底覆盖；3 宽度 DOM 和截图验证。|
|3 能量留白|styles/approved-ui.css|移除重复的 62px 上边距；三个宽度标题到首卡间距均为 34px。|
|4 选中语义|components/ui/choice-button.tsx；LoginGate、notifications/AddChannelModal；pages/HistoryPage、PlanPage、VideoPage、admin/AdminFinancePage、admin/AdminLearningPage、scheduled-calendar/QuickCreatePopover、planned/PlannedTasksPage|共享原生 ChoiceButton 管理 aria-pressed，沿用原样式；日历同步 aria-selected；共享组件选择切换及禁用行为测试。|
|5 截断复核|components/ui/sidebar.tsx、BrowserPanel.tsx；ui-suite/lib/checks.mjs|手动/浏览器自适应收起均保留按钮名称及原生和自定义悬停提示；标记真实浏览器地址输入；严格区分读屏隐藏文字与可见截断。|
|6 异步重放|ui-suite/lib/interaction.mjs、ui-suite/run.mjs|重放前按语义身份等待目标控件出现（最长 4 秒），初始测量前也等待预期种子内容可见，不增加固定等待；失败、未覆盖、P1 遮挡结果不能进入共享或 canonical 缓存。|
|7 视觉基准|ui-suite/baselines/2026-10-09-v2|21 张大差异逐张复核，见 [视觉变更来源](visual-review.md)；已由独立提交 `bb174b40` 刷新。|

新增套件集成检查：`ui-suite/lib/p2-checks.mjs`；终态过期计划种子：`ui-suite/lib/seed.mjs`。

自动收起使用 Sidebar 内的显示状态 Context，而不修改用户的展开偏好；原生 title 与既有自定义 tooltip 同步适配手动/自适应两种折叠。

## 检测器规则与正反例

- 图标：仅 `data-icon-only=true`、明确非空 `aria-label`、非空 `title`、实际含 SVG/img 的控件满足图标名称与提示契约。普通文本按钮和缺任一条件的图标仍报告截断。
- URL：仅明确 `data-browser-address=true`、有名称、值为 http(s) 的 INPUT 将长 URL 横向滚动视为正常。普通表单、非 URL 输入仍报告。
- 读屏文字：只排除 absolute、宽高不超过 1px 且 clip rect(0) / clip-path inset(50%) 的隐藏提示，不按 class 名或页面放宽可见文本检测。搜索 AI 记忆、文件加载播报、视频读屏标题均符合此规则；见 [DOM 复核记录](truncation-inspect.json)。
- 日历：具有选中样式但缺 `aria-selected=true` 仍报告选中态语义问题。
- 原有几何遮挡、可见文本截断和视觉差异阈值均未放宽。

测试文件 `ui-suite/tests/truncation-contracts.test.mjs`：

1. `truncation exemptions require named icon tooltip or marked URL input; text and incomplete contracts still fail`
2. `selected calendar cells require matching aria-selected semantics`

异步与缓存测试 `ui-suite/tests/replay-readiness.test.mjs`：

1. `ancestor replay waits for asynchronously loaded pagination control and fails if it never returns`
2. `failed shared controls are retried instead of copied as successful coverage`
3. `canonical aliases cannot reuse failed, uncovered or P1-obscured coverage`
4. `initial scene ignores hidden duplicates, waits for delayed visible seed content and rejects absent data`

旧实现已实际复现失败：[终态计划](plan-red.log)、[异步重放和缓存](replay-red-confirmed.log)、[自动收起侧栏](adaptive-sidebar-red.log)。修复结果与完整测试日志在下节记录。

## 验证

- 基线前端：284 文件 / 2683 测试通过（[日志](baseline-tests.log)）。
- 最终前端：286 文件 / 2692 测试通过（[日志](frontend-tests.log)），包含补充的自动收起回归。
- UI 检测器：70/70 通过（[日志](suite-tests.log)）。
- 前端 lint、typecheck、build：通过（[日志](final-build.log)）。
- 3 宽度集成布局检查：9/9 通过（[JSON](layout-checks.json)）。
- 截图诊断：240/240，P1=0；截图模式主动保留 1 个覆盖缺口，退出 1，不是完整门禁通过证据。发现的 44 条自动收起侧栏截断已补修；最终以重新运行的无筛选门禁为准。
- 基准刷新：240 张截图，0 findings；出现一次规划页数据返回前测量缺口。补充 `waitForSeedContent` 后重拍 `/planned@1024`，确认种子内容可见、0 findings，PNG 与已提交基准字节一致（SHA-256 `f68f00dba8f47d8fd807fa075d4a081b4b4fc25f1e729760316fb41bec18e2eb`）；仅保留诊断模式自带的过滤/截图覆盖声明。
- 最终无筛选 UI 审计：候选 `1e20af782d1e24968fc4c0e4e529c7e9376771e3`，240/240，P1=0、P2=17、覆盖缺口=0，退出码=0（[完整审计](full-audit-summary.md)、[运行日志](full-audit.log)、[退出码](full-audit.exit)）。mode=verify，screenOnly=false，selectedCases=null，三宽度全部运行。
- 运行开始 `2026-10-11T06:15:33.272Z`，完成 `2026-10-11T09:43:58.008Z`。前端 sourceHash `b550cb1578d2cb7f69fc547e3d4d489526ee9d828e86e9aa663f67a5a0553f6f`；套件 suiteSourceHash `e2eb4bc7818f9dc367815e6ad6ec712cc1d39687a6a032c729d5877a5a1f0f17`。后续提交仅补充文档与证据，交付前再次核对两个源码哈希。

项目就绪补充：首次完整交互运行在项目页发现等待器误取隐藏同名文本（[真实 DOM 核对](project-readiness.json)、[回归失败证据](hidden-seed-red.log)）。改为只等待可见匹配后，68 项检测器测试通过；全 240 场景初始截图诊断为 0 findings，仅保留截图模式声明（[记录](readiness-screens-summary.json)）。先前不完整运行仅作诊断，不作为门禁通过证据。

日历选中态补充：完整运行发现已选日期在补上 aria-selected 后被旧检测器误判为死按钮；原有缺语义快捷判断被移除，而普通幂等规则只识别 tab。补充 gridcell 选中态规则，并用 `selected grid cells are idempotent; unselected cells and disclosures must still act` 证明已选日期幂等、其他日期可选择、失效日期和弹窗/展开按钮仍失败（[旧断言失败](selected-gridcell-red.log)）。中断运行另存 `diagnostic-selected-grid-full-audit/`，关闭浏览器产生的终止错误也保留为诊断，均不是通过证据。

三宽度规划交互复核完成：每个宽度 284 控件、55 次日期选择通过、1 个已选日期幂等，P1=0；仅保留已知任务名省略 P2。筛选运行主动保留覆盖缺口，退出 1，不作为全量验收（[诊断摘要](planned-grid-validation.json)）。

附件菜单补充：执行方式改用已有共享 `DropdownMenuRadioGroup/RadioItem`，增加可选的 `showIndicator=false` 保留 MiniSwitch 外观；修改 `InputArea.tsx`、`InputArea.permissions.test.tsx`、`components/ui/dropdown-menu.tsx`。检测器纳入 menuitemradio 和 aria-checked 状态；已有选项可幂等，未选或带弹窗的失效选项仍失败。嵌套菜单在 Escape 关闭后从原路径重新打开，避免点击退出动画中的旧节点。

对应测试：`menu radio choices are discovered and only checked choices without disclosures are idempotent`、`nested popup dismissal replays from reset instead of clicking its departing parent`，及输入框执行方式选择测试；旧实现分别有失败证据（[菜单扫描](menu-radio-red.log)、[嵌套重放](nested-menu-red.log)、[组件语义](composer-selection-red.log)）。实际组件三个宽度的自动执行选中项幂等、技能/模型子菜单打开均通过（[修复前](composer-menu-diagnostic.json)、[修复后](composer-menu-after-diagnostic.json)）。截图已加入前后清单。失败全量运行保存在 `diagnostic-composer-menu-full-audit/`，不作为通过证据。

类型检查首次在 1.5GB 堆上限下内存不足；保留 [原日志](typecheck-1536-oom.log)，使用 3GB 上限单路重跑 lint/typecheck/build 后全部通过。

## 剩余 P2

P2 从原完整 Round 3 的 **369** 条降至 **17** 条，减少 **352** 条（95.4%），满足 <60 目标；最终无选中态语义、文本截断或视觉差异发现。剩余均为控件边界提示，全部逐张打开复核并保留在原始结果中。见 [逐条保留原因与截图](retained-p2.md)、[复核记录](retained-reviewed.json)、[悬停 DOM 证据](media-overflow.json)。

|宽度|完成场景|P1|P2|覆盖缺口|
|---|---|---|---|---|
|1440|80|0|6|0|
|1280|80|0|6|0|
|1024|80|0|5|0|

## 交付

修复 `7d4c0c58`；独立基准 `bb174b40`；初始数据就绪等待 `211223cf`；可见内容匹配 `d6ae6215`；已选日期幂等 `f43c24f0`；菜单语义与重放 `1e20af78`。审计代码 SHA 为 `1e20af78`，独立视觉基准提交为 `bb174b40`；最终文档提交见本 PR 的 HEAD。交付分支为 `codex/ui-p2-batch`，草稿 PR 目标为 `claude/capability-recovery`；任务目录报告在创建 PR 后记录链接与完整交付 SHA。
