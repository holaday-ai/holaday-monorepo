# 今日能量方案 B 发布核对单

日期：2026-08-11  
分支：`codex/today-energy-b`  
已验证代码 HEAD：`f662ed8c`  
提交范围：`a376cf4a` 至 `f662ed8c`

## 结论

方案 B 的核心代码已达到 PR / 合并候选标准：后端目录与最小事件协议、统一体验容器、抽卡、三类轻测试、星座分段详情、个人资料抽屉、响应式和降级路径均已实现，目标测试、全量测试、类型检查、Lint、构建与差异检查通过。

本记录不是“已部署”声明。正式上线前仍需在同时包含本分支前后端的 staging 或 release candidate 上完成一次组合验收，重点核对真实 `energy.*` 事件、Tab / Shift+Tab 手动路径和 200% 缩放。当前没有执行 push、PR、merge 或 deploy。

## 变更范围

- 新增后端 `energy` 体验目录、鉴权查询和最小化事件输入协议。
- 新增前端体验注册表与按需加载，活动玩法为抽卡、轻测试、今日星座；小游戏只展示 coming-soon，不可点击。
- 用聚焦的“今日能量”首页替换旧 `AstroDashboard`，删除旧版约 1900 行复杂页面编排。
- 统一 intro / active / result / error 容器，支持关闭、重玩、换玩法和焦点恢复。
- 迁移本地塔罗 fallback、三类轻测试、星座日运 / 星盘 / 流年内容。
- 个人资料改为抽屉：默认只显示生日，高级字段按需展开，本地存储按用户作用域隔离。
- 浏览器验收中修复两项问题：弹窗主按钮颜色与页面不一致；移动端主 CTA 和模式入口低于 44px。

没有修改：

- 数据库 schema 或 migration；
- 支付、订单、额度、权益、账本；
- TaskStream、浏览器扩展或任务执行链；
- 生产部署配置。

## 自动化验证

| 门禁 | 实际结果 |
| --- | --- |
| 后端目标测试 | 3 个文件、14 项测试通过 |
| 前端目标测试 | 15 个文件、51 项测试通过 |
| 后端完整测试 | Node 测试 13 项通过；Vitest 251 个文件、4146 项测试通过 |
| 前端完整测试 | 147 个文件、1187 项测试通过 |
| 后端类型检查 | 通过 |
| 前端类型检查 | 通过 |
| 后端生产构建 | 通过 |
| 前端生产构建 | ESLint、类型检查、Vite build 全部通过；3099 个模块转换成功 |
| Biome（触及文件） | 通过 |
| `git diff --check` | 通过 |

关键命令：

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/energy/catalog.test.ts src/trpc/routers/energy.test.ts src/astrology/service.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy src/pages/AstrologyPage.test.tsx src/lib/astrology.test.ts src/lib/sidebar-feature-nav.test.ts src/lib/control-tooltip.test.ts
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench test
pnpm --filter @holaday/web-workbench build
git diff --check
```

说明：后端完整测试需本地监听和连接权限；在允许本地端口的环境中执行后为 0 失败。测试日志中的 `--localstorage-file` 提示为 Node 测试环境警告，不是产品错误。

## 浏览器环境

- Browser：Codex In-app Browser。
- 本地新前端：`http://localhost:5173`。
- 完整互动：`http://localhost:5173/cosmic-preview`，使用本地固定 `energy` 响应和 astrology 本地 fallback。
- 登录态首屏：`http://localhost:5173/cosmic`，使用已授权测试账号（凭据不记录）连接 Holaday 现网认证与 astrology API。
- Viewport：1440×900、390×844。
- 浏览器 console：所记录页面与互动阶段均为 0 error / 0 warn。
- 框架错误覆盖层：未出现。

## 浏览器核对结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 页面身份与非空首屏 | 通过 | 标题 `HOLA DAY`，H1 为“今日能量”，状态签到、推荐和玩法区均可见 |
| 单一主推荐 | 通过 | 初始和状态选择后均只有一个主推荐 CTA |
| 状态签到 | 通过 | 四种状态可选，`aria-pressed` 更新，鼓励文案与推荐原位切换 |
| 抽卡 | 通过 | 选择主题 → 开始抽卡 → 翻开 → `The Star` 结果 → 重玩 / 换玩法 |
| 轻测试 | 通过 | 选择测试后才显示题目；完成后出现结果、优势、提醒和行动，不显示分数排名 |
| 今日星座 | 通过 | 日运六分类只有一个 tabpanel；工作、本周、星盘档案和流年提醒可切换 |
| provider 降级 | 通过 | provider reject 自动化测试保留 `The Star` 和确定性本地日运；预览页面展示低噪声“暂时使用本地提示” |
| 真实登录态 `/cosmic` | 通过（首屏） | AppShell、用户作用域页面和现网 astrology provider 加载；无 fallback 提示、无 console 告警 |
| 个人资料抽屉 | 通过 | 默认只显示生日；高级字段按需展开；键盘输入后保存可恢复；关闭后焦点返回；测试数据已清除 |
| Escape 与焦点恢复 | 通过 | 弹窗初始焦点位于“开始体验”；Escape 后弹窗关闭并回到原 CTA |
| Tab / Shift+Tab / Enter | 自动化通过 | `EnergyHome.test.tsx` 覆盖状态选项顺序、反向移动、Enter 选择 / 打开和 Escape 返回；In-app Browser 的 Tab 注入未推动焦点，仍需 release candidate 手动点验 |
| 390px 页面布局 | 通过 | `scrollWidth = innerWidth = 390`，四个状态单列，无页面横向滚动 |
| 390px 三类玩法 | 通过 | 抽卡、今日数字结果和星座本周视图均完成；移动弹窗无页面横向滚动 |
| 触控目标 | 通过 | 实测所有可用首页按钮高度均不小于 44px；状态按钮 72px、CTA / 模式入口 44px、资料入口 53px |
| 小游戏隔离 | 通过 | coming-soon 有说明，无按钮、无点击入口 |

## 截图

- `/tmp/today-energy-b-qa/authenticated-cosmic-desktop.png`
- `/tmp/today-energy-b-qa/desktop-home.png`
- `/tmp/today-energy-b-qa/desktop-tarot-result-fixed.png`
- `/tmp/today-energy-b-qa/desktop-light-test-result.png`
- `/tmp/today-energy-b-qa/desktop-horoscope-transit.png`
- `/tmp/today-energy-b-qa/desktop-profile-drawer.png`
- `/tmp/today-energy-b-qa/mobile-home-390x844-fixed.png`
- `/tmp/today-energy-b-qa/mobile-tarot-dialog-390x844.png`
- `/tmp/today-energy-b-qa/mobile-horoscope-week-390x844.png`

## 隐私与数据边界

- 事件协议只接受稳定玩法 ID、宽泛状态枚举、时长档位和结果状态。
- 不上传生日、出生时间、出生地点、测试答案、自由文本或公开员工情绪明细。
- 个人星座资料仅保存在当前账号作用域的浏览器本地空间，并提供清除入口。
- 本阶段没有排行榜、员工比较、管理者情绪监控、付费抽卡或随机奖励经济。

## 未验证与上线前动作

1. 新 `energy` 后端尚未与本地新前端共同部署，因此没有在真实部署环境执行 `energy.home` / `energy.reportEvent` 的端到端组合请求；接口本身已由目标测试和后端 4146 项全量测试覆盖。
2. In-app Browser 的 Tab / Shift+Tab 注入未改变焦点；DOM 顺序和键盘流程自动化已通过，但上线前仍需在 Chrome / Safari 手动走一次。
3. 200% 浏览器缩放尚未实测；桌面 1440×900 和移动 390×844 已通过。
4. 未测试 Safari、Firefox、低速网络、localStorage 被浏览器禁用的真实设备场景；对应 fallback 有代码路径与自动化覆盖。
5. 部署需要单独授权，并应保证前后端同批发布或先发布向后兼容的 `energy` 后端。

