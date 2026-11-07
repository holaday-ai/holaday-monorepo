# UI suite 补充发现与已知九项对照

[草稿 PR #261](https://github.com/holaday-ai/holaday-monorepo/pull/261)。前端为 `434417b42711c6cf2251787cdd86fee3aa407c6e`，完整冻结检查为 `935348a4`。240/240 个场景已完成（60 路由 + 20 任务组合，各三宽度），0 个覆盖缺口；门禁失败。1,044 条原始告警是重复观察记录，不是 1,044 个独立缺陷。

本 PR 不改产品前端、不改 `codex/frontend-audit-1`。脚本误报校准与后续验证单独记录在 [验证台账](../ui-suite/validation.md)，不把局部复测冒充另一次完整矩阵。

## 新增 P1：技能菜单在对话框后方，选项无法点击

- 路径：`/experts` 或 `/skills` → 描述任务 → 选择技能；1440 / 1280 / 1024 均复现。
- 搜索框、自动匹配、数据报告解读三个控件被上层弹窗遮住；两个选项的普通点击超时。
- [截图](evidence/skill-menu-behind-dialog.png)。`CapabilityCenterContent.tsx` 使用默认 DropdownMenuContent；`components/ui/dropdown-menu.tsx` 默认为 z-50，`styles/approved-ui.css` 中 `.hd-catalog-dialog` / `.hd-skill-detail` 为 71、遮罩为 70。
- 额外校准：只在页面内临时把菜单及 portal wrapper 提高到 z90，遮挡从 3 项变为 0；未修改产品源码。[校准前后](../ui-suite/calibration/README.md)。修复时仍需验证关闭、键盘与选中结果。

## 新增 P1：设置页顶部导航与全局控件冲突

- 设置页滚动/分区导航后，“账号”链接与全局浏览器、通知区域冲突；1280px 及 1440px 的通知分区均有记录。校准后的局部复测还确认 1024px 的“通知／账号”被遮挡，六次点击失败全部来自这些入口。[1024px 复测](evidence/settings-account-overlap-1024.png)。
- [1280px 截图](evidence/settings-account-header-overlap.png)。来源为完整冻结矩阵；不是仅由截图估计。
- 与内容自然滚入粘性导航下方的情况分开处理：这里是两个顶部可操作区域互相占位。请分别复核账号入口和全局按钮的可点击性。

## 新增 P1：计划页滚动后“新建定时任务”被全局控件覆盖

- 路径：`/schedule` → 月视图 → 主滚动容器向下滚动 100px；1280px 独立重现。按钮 y=19.75，通知徽标、头像和浏览器入口压入按钮区域。
- [本轮独立重现](evidence/schedule-header-overlap-current.png)；[先前 1440px 快速创建状态](evidence/schedule-header-overlap.png)。未滚动时的截图正常，不应据此认为已修复。
- 不只股市页需要为全局页头预留空间。

## 新增 P1：删除定时任务确认框不响应 Escape

- 路径：新建定时任务 → 填写“UI audit” → 创建 → 点击日历事件 → 删除定时任务 → Escape。
- 完整矩阵三宽度均失败；额外独立重放在 1280px 按 Escape 后等待 1 秒，确认框仍在。
- [Escape 后截图](evidence/schedule-delete-escape.png)。`ConfirmDialog.tsx` 虽有 document keydown 处理，但实际事件链没有关闭；请结合 `ScheduledCalendarPage.tsx` / `EventDetailPopover.tsx` 检查嵌套层与键盘事件。

## 新增 P2：今日能量的头部及说明文字

- `/cosmic`：标题/面包屑、日期/头像存在重叠，底部等待任务提示覆盖部分内容。[截图](evidence/energy-header-and-pending-banner.png)。提示条可随滚动避让的情况按视觉问题处理，不直接升级为 P1。
- `/cosmic-preview`：三段无 title/tooltip 的截断说明，源于 `components/energy/explore-content.ts`：五感练习说明、五问开始说明、收集十二颗光点说明。对应完整三宽度截图及 `unexplained-text-truncation` 原始记录。独立 1280px 实测三段均为 clientHeight=18、scrollHeight=36，无 title / aria-describedby。[五感说明](evidence/energy-description-1.png)、[专注入口说明](evidence/energy-description-2.png)、[接住能量说明](evidence/energy-description-3.png)。

## P3 与需人工解释的信号

- 多处当前选项仅靠颜色/边框表示选中，缺少 aria-selected / aria-pressed；视频“氛围 / 光感 / 色彩”当前分类属于此类，不能把再次点击当前选项算作无效按钮。
- 收起侧栏已有 Tooltip 组件，未展开时的文本宽度告警不直接认定为产品缺陷。
- 原生日期选择器、滚动中暂时被粘性头部覆盖的内容、装饰按钮需结合真实操作解释，不能把所有几何告警直接当成独立 P1。

## 已知九项对照

| 已知项 | 本轮结论 / 边界 |
| --- | --- |
| 1 股市遮挡/裁切 | 三宽度均有重叠和截断信号，保留操作后截图；重复信号需按根因归并。隐藏复选框的直接点击超时是脚本问题，另行校准，不报成几十个产品缺陷。 |
| 2 非浏览器任务显示浏览器 UI | 已确认生成失败等非浏览器场景仍有“连接 Chrome”；27 条对应原始信号。不是每个状态都出现空面板。[生成失败截图](../ui-suite/baselines/2026-10-09-v2/1280-task_generate_failed.png)。 |
| 3 长生成无阶段 | 静态种子只验证初始执行态；不能验证真实 30 秒模型生命周期，不宣布通过或修复。 |
| 4 正常完成醒目缺复核结论 | 四种模式完成态 × 三宽度，共 12 条精确文案信号。 |
| 5 内部来源标识 | 抓取种子通过真实来源结果结构提供 eastmoney 标识，三宽度共 15 条显示信号。 |
| 6 外部链接空白页/反复确认 | 本地拦截的弹窗均到达请求 URL，未检测到停留 about:blank；确认策略和远端网站可用性不由此证明。 |
| 7 188 未读/全部已读 | 188 为明确合成数据；三宽度“全部已读”均产生可观察操作。真实系统是否推送过多、如何聚合仍需产品与后端调查。 |
| 8 最近操作遮画面/终态处理中 | 最近操作层可收起但默认覆盖合成画布；本轮终态未触发“正在处理/生成回答”残留规则。未测试真实网站关键区域。 |
| 9 生成失败使用浏览器建议 | 独立生成失败截图主卡片为“生成任务未能完成”；仍有 Chrome 入口属于第 2 项。不能把整项直接宣布已修复。 |

## 已排除的脚本/夹具问题

- 设置“每日 A股简报”和股市偏好使用 sr-only 原生输入。独立验证通过可见 label 可正常切换；检查框架已改用正常 label 点击，继续保留遮挡检查。
- 编辑器默认关闭时 getProject 返回明确 403，属于白名单；仅校准准确路径和控制台文本，不豁免其他错误。
- 早期未连通浏览器夹具和错误星象空数据造成的异常，不属于本轮完整冻结证据，不作为产品缺陷交接。

完整原始操作路径、共享引用和失败原因见 [JSON](../ui-suite/report.json)。校准后的局部复测与前端检查结果见验证台账；本清单不授权合并或部署。
