# 第二轮交付


针对 FIX-PR260-2.md 与 pr260-review/review.md 收敛修复。以下取代第一轮相关结论，不扩大到其他页面改版。

### 修复与证据

| 项目 | 处理 | 证据 |
| --- | --- | --- |
| P1 浏览器任务刷新/重开丢失入口 | 通用浏览器及直接打开网页分支在入库时写入已有 result JSON 的 executionMode=browser，list/detail 沿既有字段返回。旧任务收到浏览器独有 tick.start/tick.end/screencast/thinking/web_search 事件即恢复 browser 模式；终态迟到事件不复活任务。不恢复正文含URL/搜索的宽泛猜测。 | 后端持久化/路由回归；前端“去京东…”、“【验收 GitHub】…”收到步骤后应连接的测试；[本地刷新](after-browser-jd-refresh.jpg)、[本地重开](after-browser-github-reopen.jpg)。 |
| P2 错误阶段映射 | 删除 thinking→planning、web_search→extracting，浏览器保持 browsing 及计时，使2/5分钟浏览器长时说明可达。保留 stream→generating 和30秒提示；恢复规划/提取原标签。 | 回归验证浏览器时钟不被思考/搜索重置、生成流正常、终态清理。第一轮错误使用浏览器专属事件模拟生成阶段的测试已替换。 |
| P1 股市输入卡遮挡 | 输入卡及“我的关注/最近交易日”均位于研究区正常文档流中，清除范围栏残留绝对定位。覆盖旧顶部padding，首屏标题回到y约86。股市新布局仅在min-width:769px生效。 | [第一轮原图](round1-original/after-stocks-1440.jpg)、[第二轮首屏](after-stocks-top-1440.jpg)、第二轮研究区：[1440](after-stocks-research-1440.jpg) / [1280](after-stocks-research-1280.jpg) / [1024](after-stocks-research-1024.jpg)。 |
| P1 主导航被滚走 | FeatureNav移出SidebarContent；只有下方任务历史单独滚动，页头页尾固定。 | [第一轮完成任务](round1-original/after-result-1440.jpg) / 第二轮：[1440](after-result-sidebar-1440.jpg)、[1280](after-result-sidebar-1280.jpg)、[1024](after-result-sidebar-1024.jpg)；[第一轮失败任务](round1-original/after-failed-1280.jpg) / [第二轮失败任务](after-failed-sidebar-1280.jpg)。 |
| P3 深色股市面包屑 | 浅色阅读面上的面包屑统一#595757，保留全局深色侧栏。 | [第一轮](round1-original/after-stocks-dark.jpg) / [第二轮](after-stocks-dark-breadcrumb.jpg)，DOM计算色为rgb(89,87,87)。 |
| P3 通知日期 | 聚合标题增加本地日期；标题与正文经过已有渲染清洗，无效日期显示“日期未知”。 | [第一轮](round1-original/after-notifications-1440.jpg) / [第二轮](after-notification-dates.jpg)。 |
| #259 最近操作语义 | 已采用其 recentActivitySteps 终态返回空数组的行为，同时保留默认折叠；完整基线同步仍待#259合并。 | BrowserPanel.control新增终态清空回归。 |
| 已确认取舍 | 非浏览器任务继续隐藏连接Chrome入口。 | 第二轮完成/失败任务截图保留此行为。 |

### 测量与验证边界

- 三宽度均900高，研究区整体在y75.59—755.59（1440/1280）、y75.59—775.09（1024）内；研究内容底部与输入卡顶部相隔20px。输入卡position:static，范围栏在卡内。见[DOM边界记录](layout-metrics.json)。
- 三宽度均scrollWidth等于视口宽度。选择底部任务后，历史区域自身scrollTop=158，主导航仍位于y187—573且全部可见。
- 浏览器截图来自独立本地数据库的执行中合成行，只验证刷新/重开进入浏览器连接分支。没有真实运行会话，截图显示连接断开，不算实时画面或接管验收。真实实时连接仍待有运行会话的环境验收。
- 后端仅为已有result JSON写入执行模式，无数据库迁移、生产后端部署或重启。回归使用离线fixture，无真实模型调用。
- 第一轮对照图来自0494c56f提交，已核对内容哈希，保留原名置于round1-original目录；其余修复后截图均本轮新拍。证据同步到仓库frontend-audit-1/round2/及本机/private/tmp/holaday-tasks/frontend-audit-1/round2/。

### 第二轮验证

- 最终冻结版本：前端 **281文件、2656测试全部通过**（123.36秒）。
- 前端 lint、typecheck、build 通过（Vite 12.35秒）；保留既有大分块提示，无新增构建错误。
- 相关后端回归：repository、browser-qwen、direct-open **3文件、128测试全部通过**；后端typecheck通过。非全量后端测试。
- git diff --check通过。本轮浏览器读取的最后8条error级控制台记录为空，不替代实时浏览器会话验收。
- 最终日志：/private/tmp/pr260-r2-verified-tests.log、pr260-r2-verified-build.log、pr260-r2-verified-backend.log、pr260-r2-backend-typecheck.log。最后修改后从新进程重跑，以这些日志为最终结果。

### #259 基线同步

交付前查询 GitHub：#259 仍为 OPEN，mergedAt=null。本轮未擅自合并#259，尚未进行其合并后的基线同步。清单同时要求“rebase”和“普通push”，对已发布分支二者有冲突；已向用户询问优先普通push采用merge，还是允许rebase后的force-with-lease，目前未收到答复。因此本轮只普通push修复，保留提交历史；基线同步仍是明确待办，不宣称完成。同步时保留task-store.test.ts两边回归，并以#259的终态清空最近操作为准。
