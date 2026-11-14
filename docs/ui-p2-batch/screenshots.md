# 三个桌面宽度前后截图

Before：69febb6f 本地构建（补充的输入框菜单对照为 f43c24f0）；After：对应修复构建。只使用本地种子数据，非线上验收。

|项目|1440|1280|1024|
|---|---|---|---|
|终态计划卡|[前](before-1-1440.jpg) / [后](after-1-1440.jpg)|[前](before-1-1280.jpg) / [后](after-1-1280.jpg)|[前](before-1-1024.jpg) / [后](after-1-1024.jpg)|
|设置导航及吸顶遮盖|[前](before-2-1440.jpg) / [后](after-2-1440.jpg)|[前](before-2-1280.jpg) / [后](after-2-1280.jpg)|[前](before-2-1024.jpg) / [后](after-2-1024.jpg)|
|能量页首屏间距|[前](before-3-1440.jpg) / [后](after-3-1440.jpg)|[前](before-3-1280.jpg) / [后](after-3-1280.jpg)|[前](before-3-1024.jpg) / [后](after-3-1024.jpg)|
|登录选项|[前](before-4-login-1440.jpg) / [后](after-4-login-1440.jpg)|[前](before-4-login-1280.jpg) / [后](after-4-login-1280.jpg)|[前](before-4-login-1024.jpg) / [后](after-4-login-1024.jpg)|
|任务筛选|[前](before-4-filters-1440.jpg) / [后](after-4-filters-1440.jpg)|[前](before-4-filters-1280.jpg) / [后](after-4-filters-1280.jpg)|[前](before-4-filters-1024.jpg) / [后](after-4-filters-1024.jpg)|
|定时对话框兼容性（保留现有样式）|[前](before-4-schedule-1440.jpg) / [后](after-4-schedule-1440.jpg)|[前](before-4-schedule-1280.jpg) / [后](after-4-schedule-1280.jpg)|[前](before-4-schedule-1024.jpg) / [后](after-4-schedule-1024.jpg)|
|通知渠道选项|[前](before-4-notification-1440.jpg) / [后](after-4-notification-1440.jpg)|[前](before-4-notification-1280.jpg) / [后](after-4-notification-1280.jpg)|[前](before-4-notification-1024.jpg) / [后](after-4-notification-1024.jpg)|
|AI 记忆搜索|[前](before-5-memory-1440.jpg) / [后](after-5-memory-1440.jpg)|[前](before-5-memory-1280.jpg) / [后](after-5-memory-1280.jpg)|[前](before-5-memory-1024.jpg) / [后](after-5-memory-1024.jpg)|
|收起侧栏和浏览器地址栏|[前](before-5-sidebar-address-1440.jpg) / [后](after-5-sidebar-address-1440.jpg)|[前](before-5-sidebar-address-1280.jpg) / [后](after-5-sidebar-address-1280.jpg)|[前](before-5-sidebar-address-1024.jpg) / [后](after-5-sidebar-address-1024.jpg)|
|文件加载读屏提示|[前](before-5-files-1440.jpg) / [后](after-5-files-1440.jpg)|[前](before-5-files-1280.jpg) / [后](after-5-files-1280.jpg)|[前](before-5-files-1024.jpg) / [后](after-5-files-1024.jpg)|
|视频选项和读屏标题|[前](before-5-video-1440.jpg) / [后](after-5-video-1440.jpg)|[前](before-5-video-1280.jpg) / [后](after-5-video-1280.jpg)|[前](before-5-video-1024.jpg) / [后](after-5-video-1024.jpg)|
|任务加载更多|[前](before-6-pagination-1440.jpg) / [后](after-6-pagination-1440.jpg)|[前](before-6-pagination-1280.jpg) / [后](after-6-pagination-1280.jpg)|[前](before-6-pagination-1024.jpg) / [后](after-6-pagination-1024.jpg)|
|输入框执行方式菜单（外观保持）|[前](before-4-composer-menu-1440.jpg) / [后](after-4-composer-menu-1440.jpg)|[前](before-4-composer-menu-1280.jpg) / [后](after-4-composer-menu-1280.jpg)|[前](before-4-composer-menu-1024.jpg) / [后](after-4-composer-menu-1024.jpg)|

选中态的语义变化由 DOM/交互测试证明，截图用于确认视觉样式未变；定时对话框额外截图为现有 /schedule 的兼容性对照，共享 ChoiceButton 的旧日历快捷弹窗由完整 UI 审计覆盖。

## 保留的灵感卡悬停状态

实际悬停后采集，标题完整；DOM 测量见 [media-overflow.json](media-overflow.json)。

|页面|1440|1280|1024|
|---|---|---|---|
|video|[悬停](retained-media-video-1440.jpg)|[悬停](retained-media-video-1280.jpg)|[悬停](retained-media-video-1024.jpg)|
|image|[悬停](retained-media-image-1440.jpg)|[悬停](retained-media-image-1280.jpg)|[悬停](retained-media-image-1024.jpg)|
