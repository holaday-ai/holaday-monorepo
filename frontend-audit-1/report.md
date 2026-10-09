# FRONTEND-AUDIT-1 前端走查与修复

- 分支：`codex/frontend-audit-1`；基线：`claude/capability-recovery` / `434417b42711c6cf2251787cdd86fee3aa407c6e`。
- PR：[草稿 #260](https://github.com/holaday-ai/holaday-monorepo/pull/260)。
- 本轮只修改前端及前端测试。未部署、未 SSH、未登录生产、未修改后端或生产数据、未读取密钥文件。
- 本地前端 `127.0.0.1:4331`、后端 `127.0.0.1:3131`，独立测试数据库 `holaday_web_qa_frontend_audit1_m`、独立 Redis `6391`。使用合成管理员账号、7 个任务状态样本、188 条合成通知、1 个项目和2个本地测试文本文件。未调用付费模型。
- 桌面截图尺寸为 1024/1280/1440 × 900；手机版未验收。截图由本轮本地页面真实捕获；加载中截图不代表真实任务执行成功。

## 已知问题与处理

严重度：P1 影响使用；P2 明显显示问题；P3 非阻断细节。代码与本地验证完成，并不表示对应生产链路已经验收。

| 编号 | 严重度 / 位置 | 修复与证据 | 验证边界 |
| --- | --- | --- | --- |
| 1 | P1 股市页范围下拉、关注研究、涨跌统计 | 输入卡改为占据布局空间的底部区域，研究区独立滚动；下拉实色背景；右侧统计允许收缩换行。[修复前](screenshots/before-stocks-1024.jpg)、[下拉前](screenshots/before-stock-menu-1440.jpg)、[研究区后](screenshots/after-stock-research-1024.jpg)、[下拉后](screenshots/after-stock-menu-1440.jpg) | 三宽度无页面横向溢出，研究区可完整滚到输入卡上方；行情为不可用/降级状态，非实时行情验收。 |
| 2 | P1 非浏览器任务详情 | 以明确执行模式/浏览器记录判断；旧任务不再仅凭“搜索”或正文 URL 打开空浏览器；连接 Chrome 入口同样受任务类型约束。[修复前](screenshots/before-legacy-browser-1024.jpg)、[修复后](screenshots/after-running-1024.jpg) | 本地旧任务及生成任务验证；新任务仍保留选择浏览器能力。 |
| 3 | P2 任务进度 | 实际 web_search/thinking/stream 事件分别映射取数、分析规划、生成；同阶段保留计时，切阶段重置；生成超过30秒显示未收到下一阶段更新的说明。 | WS 事件单元测试通过；没有伪造进度百分比。未调用真实模型，无法提供真实生成前后截图；[本地运行状态](screenshots/after-running-1440.jpg)只证明布局，真实阶段时序留待上线后验收。 |
| 4 | P2 正常完成结果顶部 | 未收到审核结论本身不再触发醒目复核卡；真实复核失败、失败检查和来源不足仍显示。[修复前](screenshots/before-result-1024.jpg)、[修复后](screenshots/after-result-1024.jpg) | 合成正常完成结果与失败条件回归测试，不将“无审核”冒充“审核通过”。 |
| 5 | P2 报告来源行 | 仅将来源元数据行中的已知内部标识映射为东方财富、巨潮资讯等可读名称，保留 URL。[修复前](screenshots/before-result-1024.jpg)、[修复后](screenshots/after-result-1024.jpg) | 本地渲染与 URL 不被重写的单元测试通过。 |
| 6 | P1 外链打开 | 可信 HTTPS 来源直接打开目标 URL；未知域、伪装域、凭据 URL、重定向参数继续确认。统一 `noopener,noreferrer`，不先创建空窗口。[确认框前](screenshots/before-external-confirm-1024.jpg)、[未知来源确认后](screenshots/after-external-confirm.jpg) | 本地可信链接无确认框，未知链接可 Esc 关闭；单元测试验证目标 URL 和参数。基线本身已有直接 window.open，本地没有复现 about:blank；IAB 未暴露新目标标签，不能声称目标落地加载已验证。普通浏览器实际落地需后续复核。 |
| 7 | P2 通知菜单 | 相同日期、类型、标题、正文和任务引用的重复通知聚合，可展开逐条看；不丢 ID 或跳转目标；保留全部已读及错误恢复。[188徽标](screenshots/before-home-1440.jpg)、[聚合](screenshots/after-notifications-1440.jpg)、[全部已读](screenshots/after-notifications-read.jpg) | 本地188条→0，刷新仍为0。源码检查未发现所有通用系统事件一律转通知；生产188条的实际来源未访问生产，无法确认。聚合只针对已加载记录，保留加载更多。 |
| 8 | P2 浏览器最近操作浮层 | 默认折叠并在切换任务时复位；终态操作行显示已完成/未完成/已结束，清除“正在处理”类动词。 | 组件测试覆盖终态文案；[本地终态布局](screenshots/after-browser-terminal-1440.jpg)。本地未启动真实浏览器执行链路，无运行画面浮层前后证据；与后端联动仍需上线后验收。 |
| 9 | P1 生成任务失败卡 | 明确按任务执行类型选择文案；旧的非浏览器任务默认生成模式，视频保留视频类型。[修复后](screenshots/after-failed-1024.jpg) | 本地 MODEL_TIMEOUT 生成失败样本显示生成处理超时，不显示浏览器/换网址。未复现真实上游失败，未拍摄同一失败样本的修复前截图。 |

## 新发现并修复

| 编号 | 严重度 / 位置 | 问题与处理 | 前 / 后 |
| --- | --- | --- | --- |
| 10 | P2 文件库文本预览 | 文本容器被垂直居中；改为填满预览区域并从顶部阅读。 | [前](screenshots/before-file-preview.jpg) / [后](screenshots/after-file-preview.jpg) |
| 11 | P2 今日能量页顶部 | 桌面日期与右上角账号控件重叠；增加桌面头部间距，保留移动端间距。 | [前](screenshots/before-energy-header-1024.jpg) / [后](screenshots/after-energy-1024.jpg) |
| 12 | P2 设置深色模式 | 白色卡片与浅色文字对比不足；共用 Section/LoadingPanel 使用深色卡片变量。 | [前](screenshots/before-settings-dark.jpg) / [后](screenshots/after-settings-dark.jpg) |
| 13 | P2 首页深色模式 | 光晕过亮、标题仍深色；调整暗色背景遮罩与标题/输入卡/入口对比。 | [前](screenshots/before-home-dark.jpg) / [后](screenshots/after-home-dark.jpg) |
| 14 | P2 文件库深色模式 | 标题、日期和文件名沿用深色字；补齐深色文字/搜索控件样式。 | [前](screenshots/before-files-dark.jpg) / [后](screenshots/after-files-dark.jpg) |
| 15 | P2 项目深色模式 | 项目名称与分区标题对比不足；使用前景色变量。 | [前](screenshots/before-projects-dark.jpg) / [后](screenshots/after-projects-dark.jpg) |
| 16 | P2 规划深色模式 | 月历、日期、编辑面板与聚焦输入框沿用白底/深字；补齐深色表面与文字。 | [前](screenshots/before-planned-dark.jpg) / [后](screenshots/after-planned-dark.jpg) / [编辑弹层](screenshots/after-planned-editor-dark.jpg) |
| 17 | P2 股市页深色模式 | 保留既定浅色阅读面，但右上角图标随全局变浅而不可见；图标按阅读面设深色。 | [前](screenshots/before-stocks-dark.jpg) / [后](screenshots/after-stocks-dark.jpg) |

布局与已有动效保持现有方向；品牌色源码继续使用 `#FF0061`。截图颜色可能受捕获/显示色彩管理影响，不以截图取色替代源码值。

## 页面与状态覆盖

以下表格链接是当前本地页面证据。三宽度均检查页面横向滚动宽度与视口相等。并非所有页面的每一种服务错误/加载态都被人为注入；未做的链路在后文明确列出。

| 页面 / 状态 | 1024 | 1280 | 1440 | 范围 |
| --- | --- | --- | --- | --- |
| 登录 | [1024](screenshots/after-login-1024.jpg) | [1280](screenshots/after-login-1280.jpg) | [1440](screenshots/after-login-1440.jpg) | 验证码入口、密码登录；本地账号登录成功 |
| 首页 / 新任务 | [1024](screenshots/after-home-1024.jpg) | [1280](screenshots/after-home-1280.jpg) | [1440](screenshots/after-home-1440.jpg) | 类型入口与空输入态；不提交真实生成 |
| 视频任务 | [1024](screenshots/after-video-1024.jpg) | [1280](screenshots/after-video-1280.jpg) | [1440](screenshots/after-video-1440.jpg) | 类型/模型/参数入口；无真实生成 |
| 图片任务 | [1024](screenshots/after-image-1024.jpg) | [1280](screenshots/after-image-1280.jpg) | [1440](screenshots/after-image-1440.jpg) | 模型下拉、强制深色；无真实生成 |
| 规划任务 | [1024](screenshots/after-planned-1024.jpg) | [1280](screenshots/after-planned-1280.jpg) | [1440](screenshots/after-planned-1440.jpg) | 空月历、当天安排、编辑弹层 |
| 文件库空态 | [1024](screenshots/after-files-1024.jpg) | [1280](screenshots/after-files-1280.jpg) | [1440](screenshots/after-files-1440.jpg) | 空态 |
| 文件库列表 | [1024](screenshots/after-files-list-1024.jpg) | [1280](screenshots/after-files-list-1280.jpg) | [1440](screenshots/after-files-list-1440.jpg) | 2个本地文件、列表与长名称 |
| 项目 | [1024](screenshots/after-projects-1024.jpg) | [1280](screenshots/after-projects-1280.jpg) | [1440](screenshots/after-projects-1440.jpg) | 合成项目卡片 |
| 项目详情 | [1024](screenshots/after-project-detail-1024.jpg) | [1280](screenshots/after-project-detail-1280.jpg) | [1440](screenshots/after-project-detail-1440.jpg) | 空任务、参考资料即将上线 |
| 今日能量 | [1024](screenshots/after-energy-1024.jpg) | [1280](screenshots/after-energy-1280.jpg) | [1440](screenshots/after-energy-1440.jpg) | 首屏、日期避让、二级弹窗 |
| 股市 | [1024](screenshots/after-stocks-1024.jpg) | [1280](screenshots/after-stocks-1280.jpg) | [1440](screenshots/after-stocks-1440.jpg) | 行情不可用/降级首屏 |
| 股市关注研究 | [1024](screenshots/after-stock-research-1024.jpg) | [1280](screenshots/after-stock-research-1280.jpg) | [1440](screenshots/after-stock-research-1440.jpg) | 滚动后研究完整可见 |
| 任务进行中 | [1024](screenshots/after-running-1024.jpg) | [1280](screenshots/after-running-1280.jpg) | [1440](screenshots/after-running-1440.jpg) | 合成执行中状态；不是模型执行证据 |
| 任务完成 | [1024](screenshots/after-result-1024.jpg) | [1280](screenshots/after-result-1280.jpg) | [1440](screenshots/after-result-1440.jpg) | 来源、复核卡、外链 |
| 任务失败 | [1024](screenshots/after-failed-1024.jpg) | [1280](screenshots/after-failed-1280.jpg) | [1440](screenshots/after-failed-1440.jpg) | 生成失败文案 |
| 等待用户 | [1024](screenshots/after-waiting-1024.jpg) | [1280](screenshots/after-waiting-1280.jpg) | [1440](screenshots/after-waiting-1440.jpg) | 补充时间范围 |
| 任务取消 | [1024](screenshots/after-cancelled-1024.jpg) | [1280](screenshots/after-cancelled-1280.jpg) | [1440](screenshots/after-cancelled-1440.jpg) | 终态布局 |
| 浏览器终态 | [1024](screenshots/after-browser-terminal-1024.jpg) | [1280](screenshots/after-browser-terminal-1280.jpg) | [1440](screenshots/after-browser-terminal-1440.jpg) | 面板布局；无真实实时连接 |
| 管理后台 | [1024](screenshots/after-admin-1024.jpg) | [1280](screenshots/after-admin-1280.jpg) | [1440](screenshots/after-admin-1440.jpg) | 概览；另查模型/自检入口 |
| 设置 | [1024](screenshots/after-settings-1024.jpg) | [1280](screenshots/after-settings-1280.jpg) | [1440](screenshots/after-settings-1440.jpg) | 外观、账号与空状态 |
| 通知 | [1024](screenshots/after-notifications-1024.jpg) | [1280](screenshots/after-notifications-1280.jpg) | [1440](screenshots/after-notifications-1440.jpg) | 聚合菜单 |


补充交互：图片模型下拉/暗色样式与 Esc；股市范围下拉、折叠输入卡、研究/风险切换；通知分组展开、全部已读及刷新；文件列表、长文件名与真实本地文本预览；规划编辑与 Esc 后放弃本地未保存草稿；今日能量二级弹窗；设置浅/深/跟随系统切换；管理后台模型管理入口与系统自检页面入口。没有执行真实模型自检、生成、支付或系统配置修改。

## 已还原 / 本地已验证

- 已知1—9的前端代码处理以及10—17的本轮新发现修复。
- 本地生成类、旧任务、完成、失败、等待输入、取消等详情状态；项目空任务和参考资料“即将上线”；文件空态和上传后列表/预览。
- 三种桌面宽度的布局与选定二级弹层；深色的首页、文件库、项目、规划、设置、股市图标与图片页下拉。
- 通知重复聚合及全部已读持久化；外链域名规则与直接目标打开参数；任务阶段与终态清理回归。

## 上线后验收（本轮未操作生产）

- 真实取数→分析→生成事件的端到端顺序、30秒等待提示，以及后端A7错误类型联动。
- 实时浏览器画面、最近操作展开/收起、失败/结束后的真实后端状态同步。
- 普通 Chrome 外链新标签落地加载，特别是此前 about:blank 的具体目标及浏览器环境。
- 真实行情与交易日时效、股票研究生成、视频/图片生成、退款重试。
- 生产188条通知的源事件分布及是否存在测试数据误投；本地样本无法替代该结论。

这些项目须在另行授权的验收环境验证；本 PR 不把它们列为通过，也不自行部署或登录生产。

## 留待后续 / P3

| 编号 | 位置 | 细节与证据 |
| --- | --- | --- |
| P3-1 | 规划空态 | 工具栏、空月历、右侧当天安排均有新建入口，略重复但功能正常；[截图](screenshots/after-planned-1440.jpg)。 |
| P3-2 | 文件列表1024宽度 | 长文件名用省略号和悬停完整名称，非裁切失效；可考虑更细的名称/元数据比例；[截图](screenshots/after-files-list-1024.jpg)。 |
| P3-3 | 股市深色主题 | 按既定方案保留浅色阅读面，与深色侧栏形成双色；如要全深色需单独确认设计，不在本轮换版；[截图](screenshots/after-stocks-dark.jpg)。 |
| 后续功能 | 项目参考资料 | 关联API未实现的入口继续“即将上线”空态，不新增无效添加按钮；[截图](screenshots/after-project-detail-1440.jpg)。 |

## 验证命令与结果

使用 Node 22.23.3 / pnpm 10.33.0，单进程串行运行重型验证，测试一名 worker，内存上限3072MB。

```sh
NODE_OPTIONS='--max-old-space-size=3072 --v8-pool-size=1'   pnpm --filter @holaday/web-workbench exec vitest run --maxWorkers=1 --minWorkers=1
NODE_OPTIONS='--max-old-space-size=3072 --v8-pool-size=1'   pnpm --filter @holaday/web-workbench build
git diff --check
```

- 全量测试：**281/281 文件、2652/2652 测试通过**，耗时301.29秒。
- 最终 build 链会依次执行 lint、typecheck（含 tsconfig.node）、Vite build；最终结果见下方验证记录。
- 日志只保留于本机 `/private/tmp/frontend-audit-1-tests-final.log` 与 `/private/tmp/frontend-audit-1-build-final.log`，不提交环境文件、数据库或认证信息。
- 所有截图来自本地合成账号；不包含生产用户信息。HMR过程中的无效空白截图已剔除。

最终验证：**lint 通过；typecheck 通过；Vite build 通过（14.14秒）；git diff --check 通过**。Vite 提示存在大于700KB的产物分块（最大约2.61MB），为非阻断构建警告，本轮没有调整拆包策略。
