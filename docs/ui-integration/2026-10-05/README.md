# Holaday UI 接入 · 待独立审核

本次将已确认的前端外观接入现有 React 页面，保留真实数据来源、操作回调与 capability-recovery 功能。代码已完成本地验证；**未进行 Claude Code 独立审核、真实后端验收或发布**。

## 基线与分工

- 集成分支：`codex/capability-recovery-ui`，目标分支：`claude/capability-recovery`。
- 基线：`85329cb3`。用户提供的线上版本 `2223898f` 到该基线仅有 `scripts/browser-first-cutover-coordinator.test.mjs` 变化，前端一致。线上前端标识 `index-CwXmfnXQ.js` 与后端目录 `/opt/holaday-releases/cr-2223898f` 来自用户描述，本次未登录服务器核验。
- 本会话：前端接入、本地验证、提交审核材料；只编辑 `apps/web-workbench` 与本文档。
- Claude Code：独立代码审核。本会话未代替其宣布通过。
- HD主线优化3：审核通过后的发布工作。本会话未操作其工作目录、服务器、部署、数据库或迁移。
- 此分支不自动合并，不发布。

## 已接入

1. 共用悬浮侧栏：白底/深色同宽同高、圆角与间距一致；项目整行展开/收起；导航状态唯一；全局任务记录保持。
2. 新任务输入区与通用页面标题：共用排版与留白，使用已确认的亮玫红；状态由小圆点表达，执行中轻微脉冲，支持减少动态效果。
3. 图片/视频：复用原海岸背景、深色半透明输入区与紫色描边控件；沿用原模型、参数、上传、额度报价及提交回调。视频示例分镜折叠展示。
4. 文件库：宽列表与网格切换、自定义排序菜单、整块文件类型标识。排序明确只作用于已加载数据；分页、引用、下载、删除、视频编辑入口保留。
5. 项目/团队任务：简化框线与卡片外观，沿用个人/团队数据与权限；优先用户上传头像，缺省使用已批准的角色头像。
6. 规划任务：日历事件去背景、状态点着色，进行中任务有动效。
7. 技能、股市：仅共用外观衔接，技能能力中心和股市原布局/时效性信息保留；没有引入之前撤回的股市资讯改版。

已批准的 6 张角色头像与海岸背景原图位于 `apps/web-workbench/public/holaday-ui/`。没有重新生成图片；头像按需懒加载，单张约 1.3–1.5 MB，仍可由审核决定后续做资源优化。

未新增后端功能：逐文件指定可见成员仍是后续需求（管理员全可看）；没有把静态样例中的权限标签当作访问控制，也没有新增头像选择/保存接口。

## 功能保留证据

| 能力 | 本地证据 | 边界 |
| --- | --- | --- |
| 全部侧栏入口、项目展开与任务历史 | Sidebar / AppShell 回归；真实组件的离线浏览器操作 | 未做所有角色的真实登录验收 |
| 模型管理、系统自检 | 管理页面源文件与基线完全一致；系统自检与媒体模型测试 | 未调用线上自检/修改模型 |
| 退额度重试 | FailureHeaderCard、task-failure-recovery 源文件未改；失败操作测试 | 未创建收费任务或执行真实退款 |
| 浏览器实时画面 | BrowserPanel、VncViewport、WS 客户端源文件未改；控制与停靠测试 | 未连接真实 VNC/浏览器流 |
| A股速览与股市时效 | StockTasksPage 仅根节点 class 改动；股市测试 | 未核验真实市场数据 |
| 插件页面兼容入口 | App.tsx 路由完全未改；基线 `/plugins` 重定向 `/skills` 保留 | 未虚构独立插件后端页面 |
| 图片/视频原接口 | AST 比较改动文件中的 tRPC query/mutate 调用与参数无差异；媒体组件/页面测试 | 未做真实生成/计费联调 |
| 文件/项目/团队 | 文件列表交互、ProjectsPage 102项与 TeamProjectPage 25项测试 | 未执行真实上传/删除/成员权限操作 |

`contract-audit.json` 是本次结果；`check-contracts.cjs` 可复查已纳入 Git diff 的源文件。该脚本只比较 tRPC 调用表达式、保护文件与后端/共享/运维目录差异，不等于端到端接口兼容证明。

## 本地验证

- 33 个测试文件、340 项测试通过，串行单 worker，耗时 20.71 秒。清单见 `targeted-tests.txt`。这是受影响功能回归，不是全仓测试。
- `pnpm build` 成功（包含全前端 ESLint、两项 TypeScript 检查、Vite 构建）。构建存在超过 700 kB 的分包提示，最大约 2.61 MB；此处不将其描述为已经消除或已证明为历史问题。
- `git diff --check` 通过。
- 接口表达式差异为 0；所列保护文件 hash 一致；后端、共享包、脚本及锁文件没有改动。
- 桌面 1280×720：白/深色侧栏均为 x=16、y=16、宽286、高688；文件列表宽898。
- 移动端 390×844：深色菜单正确继承主题，跳转后关闭，页面无水平溢出；图片设置弹窗保持深色可读。

复查命令（仓库根目录；依赖已按仓库流程准备）：

```sh
cd apps/web-workbench
NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run $(cat ../../docs/ui-integration/2026-10-05/targeted-tests.txt) --maxWorkers=1 --minWorkers=1
NODE_OPTIONS=--max-old-space-size=2048 pnpm build
cd ../..
node docs/ui-integration/2026-10-05/check-contracts.cjs
git diff --check 85329cb3
```

原始日志保存在本机 `/private/tmp/holaday-ui-integration/{regression-final.log,build-final.log}`。开发依赖通过已有 node_modules 的本地软链接复用，未安装/升级依赖，软链接不提交。

## 界面证据（离线样例）

截图运行的是实际前端组件，使用独立临时 fixture 提供样例数据；左下/右下的额度、任务、文件、用户名等均不能作为真实账户事实。样例没有后端代理，所有 mutation 拒绝执行，`/api` 返回 503，页面标有“本地 UI 样例 · 无后台连接”。fixture 与登录替身未加入产品源码或构建。

- [视频桌面](video-desktop.png)
- [文件列表](files-list.png)
- [文件移动端](files-mobile.png)

## 审核与后续验收

Claude Code 请先检查共享 CSS 对弹窗、侧栏收起、浏览器面板开启与移动端的影响，以及各页面是否保留原操作可达性。审核通过后由 HD主线优化3 在其批准的环境完成真实登录、文件上传/引用、媒体报价与提交、失败重试/额度恢复、VNC 实时画面、A股数据日期/降级状态与管理员入口验收。不要把本地 fixture 验证当成发布验收。
