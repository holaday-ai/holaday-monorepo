# 今日能量内容补给站发布检查

日期：2026-08-12 02:17 JST  
分支：`codex/today-energy-content-hub`  
已验证代码 HEAD：`64e59023d433382a90bbc21bca07da2c62f6bf67`

## 结论

本分支已达到合并与受控部署候选标准。星座深度内容、连续抽卡、18 套五题轻测试、36 条等待内容流、运行任务条、桌面与移动端响应式均通过目标自动化门禁和登录态浏览器验收；浏览器控制台为 0 error / 0 warn。

DivineAPI 增强内容仍受生产凭据、Translator 和 Tarot 套餐能力控制。本地组合验收明确显示 `Holaday 本地提示`，没有把本地内容伪装成 Provider 内容。部署后仍需在生产环境复核 Provider 状态和真实任务终态切换；这两项不影响本地内容安全降级，但不能在部署前声称“生产 Provider 已启用”或“任务终态已在生产实测”。

## 变更范围

- 增加日 / 周 / 月 / 年四个星座周期、六维提示、幸运信息、十二星座排行和其他星座预览入口。
- 增加 Holaday 编辑的单张、是 / 否、三张能量牌，可连续抽取、换主题、查看本次结果和收藏稳定内容 ID。
- 增加 18 套轻测试，每套 5 题，可重测、换一套和进入关联测试。
- 增加 36 条、8 个分类的等待内容流，每次展示 6 条，同一会话换组不立即重复。
- 增加运行任务条，优先展示待用户处理或运行中任务，并短暂保留终态。
- 完成亮色视觉、交互动效、390px 响应式、图片适配、键盘焦点和 reduced-motion 降级。
- 后端只接受稳定枚举和内容 ID，不接受测试答案、抽卡问题、Provider 正文或自由文本。

没有修改数据库 schema / migration、支付、订单、额度、权益、账本、浏览器扩展或任务执行控制平面。

## 自动化门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 后端目标测试 | `pnpm --filter @holaday/orchestrator exec vitest run src/astrology/divine-api-contract.test.ts src/astrology/service.test.ts src/trpc/routers/astrology.test.ts src/trpc/routers/energy.test.ts` | 退出码 0；4 个文件、29 项测试通过 |
| 后端完整测试 | `pnpm --filter @holaday/orchestrator test` | 允许本地监听权限后退出码 0；Node 13 项 + Vitest 253 个文件、4164 项测试通过。受限沙箱内仅监听相关测试出现 `EPERM`，非产品失败 |
| 后端类型检查 | `pnpm --filter @holaday/orchestrator typecheck` | 退出码 0 |
| 后端构建 | `pnpm --filter @holaday/orchestrator build` | 退出码 0 |
| 前端完整 energy 门禁 | `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy src/pages/AstrologyPage.test.tsx src/lib/astrology.test.ts src/lib/sidebar-feature-nav.test.ts src/lib/control-tooltip.test.ts` | 退出码 0；29 个文件、113 项测试通过 |
| 前端完整测试 | `pnpm --filter @holaday/web-workbench test` | 退出码 0；161 个文件、1249 项测试通过 |
| 请求清理回归 | `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx` | 退出码 0；1 个文件、5 项测试通过 |
| 前端类型检查 | `pnpm --filter @holaday/web-workbench typecheck` | 退出码 0 |
| 前端 Lint | `pnpm --filter @holaday/web-workbench lint` | 退出码 0；修正 effect cleanup ref 告警后重跑为 0 warning |
| 前端生产构建 | `pnpm --filter @holaday/web-workbench build` | 退出码 0；内部 lint、typecheck、Vite build 全通过；3116 个模块转换，5.26 秒完成 |
| 差异检查 | `git diff --check` | 退出码 0，无空白错误 |

React 性能静态复核未发现阻断项：三个玩法按需 `React.lazy` 加载；静态内容在模块级定义；日 / 周首批请求并发；内容进度使用 v2 作用域和稳定 ID；任务时钟只在活跃任务存在时启动。构建产物中 `AstrologyPage` CSS 为 46.16 kB，JS 为 61.94 kB。

## 登录态桌面浏览器验收

- Browser：Codex In-app Browser。
- 地址：本分支前端 `5175` + 本分支后端 `3001/3002`。
- 账号：Holaday 测试账号；凭据未写入本检查单。
- Viewport：1440 × 1024。
- 页面：`/cosmic`，title 为 `HOLA DAY`。
- 控制台：0 error / 0 warn；未出现框架错误覆盖层。
- 横向布局：`scrollWidth = clientWidth = 1440`。

| 路径 | 结果 | 观察值 |
| --- | --- | --- |
| 明亮首屏 | 通过 | H1“今日能量”、亮色主视觉、四种能量选择和三类玩法在首屏清楚可见 |
| 星座摘要 CTA | 通过 | 点击“进入星座深度补给”后主滚动容器到 `scrollTop = 1222`，目标标题位于视口顶部约 70px |
| 四个星座周期 | 通过 | 今日、本周、本月、本年均更新 `aria-selected=true`，分别展示日期、周范围、`2026年8月` 和 `2026` |
| 来源标识 | 通过 | 本地后端 `ASTROLOGY_ENABLED=false` 时显示“Holaday 本地提示”和“暂时使用本地提示” |
| 连续抽卡 | 通过 | 工作推进单张牌完成翻牌后可直接进入三张牌，并展示“回顾 / 当下 / 下一步”三项 |
| 完整轻测试 | 通过 | “情绪电量”依次完成 5/5 题后生成画像；“测相关主题”进入“内心天气 · 1/5” |
| 内容换组 | 通过 | 首组六个标题与第二组六个标题无内容重叠；只保留共同的区块标题“再逛一会” |
| 运行任务条 | 部分通过 | 浏览器观察到真实执行中任务、耗时更新和“返回任务”入口；未等待该任务在本轮变成终态。`RunningTaskDock.test.tsx` 已覆盖 executing → completed 且不自动导航 |

## 390 × 844 移动端验收

| 项目 | 结果 | 观察值 |
| --- | --- | --- |
| 页面溢出 | 通过 | `documentElement` 与 `body` 均为 `scrollWidth = clientWidth = 390` |
| 单列内容 | 通过 | 内容流 `grid-template-columns = 324px`，玩法卡片和星座内容均为单列 |
| 星座标签 | 通过 | tablist 为 `overflow-x: auto`，`scrollWidth = 356`、`clientWidth = 330`；四个周期均可操作 |
| 图片裁剪 | 通过 | 三张玩法主图均为 `object-fit: contain`，尺寸约 322 × 242；主视觉完整主体保持在安全区 |
| 任务条避让 | 通过 | Dock 高 108px；页面预留 124px 底部空间；滚到底时最后一张内容与 Dock 仍有约 52.8px 间距 |
| 键盘焦点 | 通过 | Tab 到星座入口时显示 3px 紫色实线 outline，offset 3px |
| reduced motion | 自动化通过 | CSS media query 将相关动画 / 过渡压缩至 `0.01ms`、滚动改为 `auto`；`energy-css.test.ts` 覆盖该契约。当前浏览器未提供切换系统偏好的能力 |
| 控制台 | 通过 | 0 error / 0 warn |

## Provider 真值与外部依赖

本轮本地组合环境没有加载生产 DivineAPI 凭据，页面状态为 `local-fallback`。生产能力不能由本地结果替代，部署后必须读取生产 `astrology.status` 再产出最终快照。

| 情形 | 已验证行为 |
| --- | --- |
| `success` | contract 测试只接受 `success: 1` 且必填字段完整的响应；service 测试确认完整日 / 周 / 月 / 年响应映射为 `provider=divineapi` |
| `not-authorized` | HTTP 200 但业务包为拒绝时识别为 `not-authorized`，对应能力暂时关闭并返回本地提示，不展示伪 Provider 内容 |
| `unavailable` | 临时网络失败优先复用最近成功且仍在 stale 窗口内的数据；无可验证缓存或缓存过期时回到 `local-fallback` |
| Translator 未启用 | 中文请求不调用英文主机，直接返回 Holaday 中文内容；页面明确标注本地来源 |
| Tarot 未订阅 | Provider 塔罗不被宣称可用；抽卡区明确标注 Holaday 编辑内容，用户问题不输入、不上传 |

外部阻塞：真实中文 DivineAPI 文本需要生产 Translator 能力激活；真实 Provider Tarot 模式需要对应套餐开通。两项均有诚实降级，不阻断 Holaday 本地内容上线。

## 部署后必须复核

1. 登录生产 `/cosmic`，读取 `astrology.status`，写入 daily / weekly / monthly / yearly / translator / tarot 的真实状态与时间。
2. 观察一个真实任务由 running 或 awaiting_user 进入 completed / failed，确认 Dock 短暂保留终态且页面不自动跳转。
3. 复跑桌面和 390 × 844 控制台检查，确认生产 bundle、接口与本地候选一致。
