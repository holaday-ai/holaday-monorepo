# 21 张大差异图逐张复核

本轮已直接打开每张原始 diff，以下为来源判断；最终基准刷新另行记录。

|宽度|页面|原 ratio|有意变化来源|
|---|---|---|---|
|1440|task:browser:executing|ratio=0.057164351851851855|已合入的浏览器工具栏、回放入口及操作日志避让改变右侧上下区域；执行态续问文案与侧栏常驻导航间距同步。|
|1440|task:browser:awaiting_user|ratio=0.056950231481481484|已合入的浏览器工具栏、回放入口及操作日志避让改变右侧上下区域；执行态续问文案与侧栏常驻导航间距同步。|
|1440|/cosmic-preview|ratio=0.18205295138888888|已合入的标题顶栏避让、卡片完整说明和独立内容滚动区改变纵向位置；正式页底部任务条独立占位。|
|1440|/settings/memory|ratio=0.056469907407407406|已合入的设置吸顶区下移和分区 scroll-margin 留白使导航与分区内容整体下移，避开全局账号控件。|
|1440|/cosmic|ratio=0.1694386574074074|已合入的标题顶栏避让、卡片完整说明和独立内容滚动区改变纵向位置；正式页底部任务条独立占位。|
|1440|/stocks|ratio=0.05676938657407407|已合入的股市页容器间距和底部输入框布局修正使首屏研究内容重排，保留原卡片和色彩。|
|1280|task:browser:executing|ratio=0.0661865234375|已合入的浏览器工具栏、回放入口及操作日志避让改变右侧上下区域；执行态续问文案与侧栏常驻导航间距同步。|
|1280|task:browser:awaiting_user|ratio=0.06541666666666666|已合入的浏览器工具栏、回放入口及操作日志避让改变右侧上下区域；执行态续问文案与侧栏常驻导航间距同步。|
|1280|/cosmic-preview|ratio=0.20366048177083335|已合入的标题顶栏避让、卡片完整说明和独立内容滚动区改变纵向位置；正式页底部任务条独立占位。|
|1280|/settings/api-keys|ratio=0.053619791666666666|已合入的设置吸顶区下移和分区 scroll-margin 留白使导航与分区内容整体下移，避开全局账号控件。|
|1280|/settings/memory|ratio=0.06348714192708334|已合入的设置吸顶区下移和分区 scroll-margin 留白使导航与分区内容整体下移，避开全局账号控件。|
|1280|/cosmic|ratio=0.17536214192708333|已合入的标题顶栏避让、卡片完整说明和独立内容滚动区改变纵向位置；正式页底部任务条独立占位。|
|1280|/stocks|ratio=0.060077311197916664|已合入的股市页容器间距和底部输入框布局修正使首屏研究内容重排，保留原卡片和色彩。|
|1024|task:browser:executing|ratio=0.052851359049479164|已合入的浏览器工具栏、回放入口及操作日志避让改变右侧上下区域；执行态续问文案与侧栏常驻导航间距同步。|
|1024|task:browser:awaiting_user|ratio=0.05185546875|已合入的浏览器工具栏、回放入口及操作日志避让改变右侧上下区域；执行态续问文案与侧栏常驻导航间距同步。|
|1024|/cosmic-preview|ratio=0.23868306477864584|已合入的标题顶栏避让、卡片完整说明和独立内容滚动区改变纵向位置；正式页底部任务条独立占位。|
|1024|/settings/appearance|ratio=0.0535247802734375|已合入的设置吸顶区下移和分区 scroll-margin 留白使导航与分区内容整体下移，避开全局账号控件。|
|1024|/settings/api-keys|ratio=0.06251220703125|已合入的设置吸顶区下移和分区 scroll-margin 留白使导航与分区内容整体下移，避开全局账号控件。|
|1024|/settings/memory|ratio=0.07379862467447916|已合入的设置吸顶区下移和分区 scroll-margin 留白使导航与分区内容整体下移，避开全局账号控件。|
|1024|/cosmic|ratio=0.1941497802734375|已合入的标题顶栏避让、卡片完整说明和独立内容滚动区改变纵向位置；正式页底部任务条独立占位。|
|1024|/stocks|ratio=0.06441650390625|已合入的股市页容器间距和底部输入框布局修正使首屏研究内容重排，保留原卡片和色彩。|

## 本轮候选图复核

同一组 21 个场景仍是 ratio > 0.05；其中设置页增加单行与实底覆盖，正式能量页去除 62px 重复上边距，其余来源与上表一致。以下链接指向本轮实际 diff；未发现来源不明的大差异。

|宽度|页面|本轮 ratio|diff|
|---|---|---|---|
|1440|task:browser:executing|0.057164|[图](screens/artifacts/1440-task_browser_executing-diff.png)|
|1440|task:browser:awaiting_user|0.056950|[图](screens/artifacts/1440-task_browser_awaiting_user-diff.png)|
|1440|/cosmic-preview|0.182053|[图](screens/artifacts/1440-_cosmic-preview-diff.png)|
|1440|/settings/memory|0.056377|[图](screens/artifacts/1440-_settings_memory-diff.png)|
|1440|/cosmic|0.111073|[图](screens/artifacts/1440-_cosmic-diff.png)|
|1440|/stocks|0.056769|[图](screens/artifacts/1440-_stocks-diff.png)|
|1280|task:browser:executing|0.066187|[图](screens/artifacts/1280-task_browser_executing-diff.png)|
|1280|task:browser:awaiting_user|0.065417|[图](screens/artifacts/1280-task_browser_awaiting_user-diff.png)|
|1280|/cosmic-preview|0.203660|[图](screens/artifacts/1280-_cosmic-preview-diff.png)|
|1280|/settings/api-keys|0.053258|[图](screens/artifacts/1280-_settings_api-keys-diff.png)|
|1280|/settings/memory|0.063383|[图](screens/artifacts/1280-_settings_memory-diff.png)|
|1280|/cosmic|0.114113|[图](screens/artifacts/1280-_cosmic-diff.png)|
|1280|/stocks|0.060077|[图](screens/artifacts/1280-_stocks-diff.png)|
|1024|task:browser:executing|0.052851|[图](screens/artifacts/1024-task_browser_executing-diff.png)|
|1024|task:browser:awaiting_user|0.051855|[图](screens/artifacts/1024-task_browser_awaiting_user-diff.png)|
|1024|/cosmic-preview|0.238683|[图](screens/artifacts/1024-_cosmic-preview-diff.png)|
|1024|/settings/appearance|0.053166|[图](screens/artifacts/1024-_settings_appearance-diff.png)|
|1024|/settings/api-keys|0.062145|[图](screens/artifacts/1024-_settings_api-keys-diff.png)|
|1024|/settings/memory|0.073725|[图](screens/artifacts/1024-_settings_memory-diff.png)|
|1024|/cosmic|0.133248|[图](screens/artifacts/1024-_cosmic-diff.png)|
|1024|/stocks|0.064417|[图](screens/artifacts/1024-_stocks-diff.png)|

其余较小差异：完成任务按已合入的 `task-trust-summary` 规则不再展示无审核证据的信任摘要；图片页动作区按已合入 CSS 调整间距；设置通知/账号和常驻侧栏间距随已合入布局修复变化。本轮不更改这些产品行为。
