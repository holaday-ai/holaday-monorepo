# 剩余 P2 / P3 清单

完整无筛选检查：240 / 240，P1 = 0，P2 = 369，P3 = 0，覆盖缺口 = 0。

以下保留检测器全部原始信号，未更新视觉基准。`visual-difference` 表示相对 #261 冻结基准的像素变化，包含本轮要求的 UI 修复；不等于已确认产品缺陷。`unexplained-truncation` / `unexplained-text-truncation` 仍须逐项人工复核，尤其是收起侧栏的图标模式。`selected-tab-semantics` 表示视觉选中态缺少对应语义标记，留待后续补齐。计数按页面、状态和宽度累计，不等于独立缺陷数量。

截图文件位于本机报告同级 `ui-audit/` 目录；此索引随 PR 保存，完整交互原始截图保留在本机。

| 等级 | 页面 / 宽度 | 检查 | 详情 | 本地截图 |
| --- | --- | --- | --- | --- |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1440-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | `artifacts/1440-task_generate_executing-control-59.png` |
| P2 | task:generate:executing / 1440 | selected-tab-semantics | 手机登录 | `artifacts/1440-task_generate_executing.png` |
| P2 | task:generate:completed / 1440 | visual-difference | ratio=0.01343894675925926 | `artifacts/1440-task_generate_completed-diff.png` |
| P2 | task:browser:executing / 1440 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1440-task_browser_executing-control-68.png` |
| P2 | task:browser:executing / 1440 | visual-difference | ratio=0.057164351851851855 | `artifacts/1440-task_browser_executing-diff.png` |
| P2 | task:browser:completed / 1440 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1440-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1440 | visual-difference | ratio=0.022033420138888888 | `artifacts/1440-task_browser_completed-diff.png` |
| P2 | task:browser:failed / 1440 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1440-task_browser_failed-control-75.png` |
| P2 | task:browser:awaiting_user / 1440 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1440-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1440 | visual-difference | ratio=0.056950231481481484 | `artifacts/1440-task_browser_awaiting_user-diff.png` |
| P2 | task:browser:cancelled / 1440 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1440-task_browser_cancelled-control-74.png` |
| P2 | task:scrape:completed / 1440 | visual-difference | ratio=0.01759982638888889 | `artifacts/1440-task_scrape_completed-diff.png` |
| P2 | task:image:completed / 1440 | visual-difference | ratio=0.01355541087962963 | `artifacts/1440-task_image_completed-diff.png` |
| P2 | /login / 1440 | selected-tab-semantics | 手机登录 | `artifacts/1440-_login.png` |
| P2 | /register / 1440 | selected-tab-semantics | 密码登录 | `artifacts/1440-_register.png` |
| P2 | /cosmic-preview / 1440 | visual-difference | ratio=0.18205295138888888 | `artifacts/1440-_cosmic-preview-diff.png` |
| P2 | /tasks / 1440 | selected-tab-semantics | 全部 | `artifacts/1440-_tasks.png` |
| P2 | /tasks / 1440 | selected-tab-semantics | 近 30 天 | `artifacts/1440-_tasks.png` |
| P2 | /schedule / 1440 | selected-tab-semantics | 不重复 | `artifacts/1440-_schedule.png` |
| P2 | /schedule / 1440 | selected-tab-semantics | 不提醒 | `artifacts/1440-_schedule.png` |
| P2 | /calendar / 1440 | selected-tab-semantics | 不重复 | `artifacts/1440-_calendar.png` |
| P2 | /calendar / 1440 | selected-tab-semantics | 不提醒 | `artifacts/1440-_calendar.png` |
| P2 | /settings/appearance / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1440-_settings_appearance.png` |
| P2 | /settings/appearance / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1440-_settings_appearance.png` |
| P2 | /settings/appearance / 1440 | visual-difference | ratio=0.04060112847222222 | `artifacts/1440-_settings_appearance-diff.png` |
| P2 | /settings/api-keys / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1440-_settings_api-keys.png` |
| P2 | /settings/api-keys / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1440-_settings_api-keys.png` |
| P2 | /settings/api-keys / 1440 | visual-difference | ratio=0.04769892939814815 | `artifacts/1440-_settings_api-keys-diff.png` |
| P2 | /settings/memory / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1440-_settings_memory.png` |
| P2 | /settings/memory / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1440-_settings_memory.png` |
| P2 | /settings/memory / 1440 | visual-difference | ratio=0.056469907407407406 | `artifacts/1440-_settings_memory-diff.png` |
| P2 | /settings/notifications / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1440-_settings_notifications.png` |
| P2 | /settings/notifications / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1440-_settings_notifications.png` |
| P2 | /settings/notifications / 1440 | visual-difference | ratio=0.010939670138888889 | `artifacts/1440-_settings_notifications-diff.png` |
| P2 | /settings/account / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1440-_settings_account.png` |
| P2 | /settings/account / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1440-_settings_account.png` |
| P2 | /settings/account / 1440 | visual-difference | ratio=0.010987413194444445 | `artifacts/1440-_settings_account-diff.png` |
| P2 | /admin/finance / 1440 | selected-tab-semantics | 营收明细 | `artifacts/1440-_admin_finance.png` |
| P2 | /admin/learning / 1440 | selected-tab-semantics | 全部 | `artifacts/1440-_admin_learning.png` |
| P2 | /settings / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1440-_settings.png` |
| P2 | /settings / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1440-_settings.png` |
| P2 | /plan / 1440 | selected-tab-semantics | 按月 | `artifacts/1440-_plan.png` |
| P2 | /cosmic / 1440 | visual-difference | ratio=0.1694386574074074 | `artifacts/1440-_cosmic-diff.png` |
| P2 | /history / 1440 | selected-tab-semantics | 全部 | `artifacts/1440-_history.png` |
| P2 | /history / 1440 | selected-tab-semantics | 近 30 天 | `artifacts/1440-_history.png` |
| P2 | /stocks / 1440 | visual-difference | ratio=0.05676938657407407 | `artifacts/1440-_stocks-diff.png` |
| P2 | /files / 1440 | unexplained-text-truncation | 已加载 2 个文件 | `artifacts/1440-_files.png` |
| P2 | /video / 1440 | unexplained-truncation | BUTTON\|\|生活方式\|\|0 | `artifacts/1440-_video.png` |
| P2 | /video / 1440 | unexplained-text-truncation | 告诉 HOLA DAY 你的重点 | `artifacts/1440-_video.png` |
| P2 | /video / 1440 | unexplained-truncation | BUTTON\|\|产品短片\|\|0 | `artifacts/1440-_video-control-80.png` |
| P2 | /video / 1440 | unexplained-truncation | BUTTON\|\|光影氛围\|\|0 | `artifacts/1440-_video-control-106.png` |
| P2 | /video / 1440 | selected-tab-semantics | 氛围风格基调 | `artifacts/1440-_video.png` |
| P2 | /image / 1440 | unexplained-truncation | BUTTON\|\|自然光影\|\|0 | `artifacts/1440-_image-control-41.png` |
| P2 | /image / 1440 | unexplained-truncation | BUTTON\|\|商品棚拍\|\|0 | `artifacts/1440-_image-control-70.png` |
| P2 | /image / 1440 | visual-difference | ratio=0.03204861111111111 | `artifacts/1440-_image-diff.png` |
| P2 | /planned / 1440 | selected-tab-semantics | 9 每日测试计划 18:00 重复 | `artifacts/1440-_planned.png` |
| P2 | /planned/legacy-scheduled / 1440 | selected-tab-semantics | 不重复 | `artifacts/1440-_planned_legacy-scheduled.png` |
| P2 | /planned/legacy-scheduled / 1440 | selected-tab-semantics | 不提醒 | `artifacts/1440-_planned_legacy-scheduled.png` |
| P2 | /scheduled / 1440 | selected-tab-semantics | 不重复 | `artifacts/1440-_scheduled.png` |
| P2 | /scheduled / 1440 | selected-tab-semantics | 不提醒 | `artifacts/1440-_scheduled.png` |
| P2 | /batch / 1440 | selected-tab-semantics | 9 每日测试计划 18:00 重复 | `artifacts/1440-_batch.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1280-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | `artifacts/1280-task_generate_executing-control-58.png` |
| P2 | task:generate:executing / 1280 | selected-tab-semantics | 手机登录 | `artifacts/1280-task_generate_executing.png` |
| P2 | task:generate:completed / 1280 | visual-difference | ratio=0.015118815104166667 | `artifacts/1280-task_generate_completed-diff.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|0 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|1 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|2 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|3 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|4 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|5 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|6 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|7 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|8 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|9 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|10 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1280-task_browser_executing-control-88.png` |
| P2 | task:browser:executing / 1280 | visual-difference | ratio=0.0661865234375 | `artifacts/1280-task_browser_executing-diff.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1280-task_browser_completed-control-71.png` |
| P2 | task:browser:completed / 1280 | visual-difference | ratio=0.02478759765625 | `artifacts/1280-task_browser_completed-diff.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:failed / 1280 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1280-task_browser_failed-control-75.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|0 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|1 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|2 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|3 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|4 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|5 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|6 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|7 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|8 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|9 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|10 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1280-task_browser_awaiting_user-control-67.png` |
| P2 | task:browser:awaiting_user / 1280 | visual-difference | ratio=0.06541666666666666 | `artifacts/1280-task_browser_awaiting_user-diff.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1280-task_browser_cancelled-control-74.png` |
| P2 | task:scrape:completed / 1280 | visual-difference | ratio=0.0197998046875 | `artifacts/1280-task_scrape_completed-diff.png` |
| P2 | task:image:completed / 1280 | visual-difference | ratio=0.015249837239583333 | `artifacts/1280-task_image_completed-diff.png` |
| P2 | /login / 1280 | selected-tab-semantics | 手机登录 | `artifacts/1280-_login.png` |
| P2 | /register / 1280 | selected-tab-semantics | 密码登录 | `artifacts/1280-_register.png` |
| P2 | /cosmic-preview / 1280 | visual-difference | ratio=0.20366048177083335 | `artifacts/1280-_cosmic-preview-diff.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /tasks / 1280 | selected-tab-semantics | 全部 | `artifacts/1280-_tasks.png` |
| P2 | /tasks / 1280 | selected-tab-semantics | 近 30 天 | `artifacts/1280-_tasks.png` |
| P2 | /schedule / 1280 | selected-tab-semantics | 不重复 | `artifacts/1280-_schedule.png` |
| P2 | /schedule / 1280 | selected-tab-semantics | 不提醒 | `artifacts/1280-_schedule.png` |
| P2 | /calendar / 1280 | selected-tab-semantics | 不重复 | `artifacts/1280-_calendar.png` |
| P2 | /calendar / 1280 | selected-tab-semantics | 不提醒 | `artifacts/1280-_calendar.png` |
| P2 | /settings/appearance / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1280-_settings_appearance.png` |
| P2 | /settings/appearance / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1280-_settings_appearance.png` |
| P2 | /settings/appearance / 1280 | visual-difference | ratio=0.04567626953125 | `artifacts/1280-_settings_appearance-diff.png` |
| P2 | /settings/api-keys / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1280-_settings_api-keys.png` |
| P2 | /settings/api-keys / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1280-_settings_api-keys.png` |
| P2 | /settings/api-keys / 1280 | visual-difference | ratio=0.053619791666666666 | `artifacts/1280-_settings_api-keys-diff.png` |
| P2 | /settings/memory / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1280-_settings_memory.png` |
| P2 | /settings/memory / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1280-_settings_memory.png` |
| P2 | /settings/memory / 1280 | visual-difference | ratio=0.06348714192708334 | `artifacts/1280-_settings_memory-diff.png` |
| P2 | /settings/notifications / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1280-_settings_notifications.png` |
| P2 | /settings/notifications / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1280-_settings_notifications.png` |
| P2 | /settings/notifications / 1280 | visual-difference | ratio=0.012263997395833334 | `artifacts/1280-_settings_notifications-diff.png` |
| P2 | /settings/account / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1280-_settings_account.png` |
| P2 | /settings/account / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1280-_settings_account.png` |
| P2 | /settings/account / 1280 | visual-difference | ratio=0.011953125 | `artifacts/1280-_settings_account-diff.png` |
| P2 | /admin/finance / 1280 | selected-tab-semantics | 营收明细 | `artifacts/1280-_admin_finance.png` |
| P2 | /admin/learning / 1280 | selected-tab-semantics | 全部 | `artifacts/1280-_admin_learning.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1280-_app-control-51.png` |
| P2 | /settings / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1280-_settings.png` |
| P2 | /settings / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1280-_settings.png` |
| P2 | /plan / 1280 | selected-tab-semantics | 按月 | `artifacts/1280-_plan.png` |
| P2 | /cosmic / 1280 | visual-difference | ratio=0.17536214192708333 | `artifacts/1280-_cosmic-diff.png` |
| P2 | /history / 1280 | selected-tab-semantics | 全部 | `artifacts/1280-_history.png` |
| P2 | /history / 1280 | selected-tab-semantics | 近 30 天 | `artifacts/1280-_history.png` |
| P2 | /stocks / 1280 | visual-difference | ratio=0.060077311197916664 | `artifacts/1280-_stocks-diff.png` |
| P2 | /files / 1280 | unexplained-text-truncation | 已加载 2 个文件 | `artifacts/1280-_files.png` |
| P2 | /video / 1280 | unexplained-truncation | BUTTON\|\|生活方式\|\|0 | `artifacts/1280-_video.png` |
| P2 | /video / 1280 | unexplained-text-truncation | 告诉 HOLA DAY 你的重点 | `artifacts/1280-_video.png` |
| P2 | /video / 1280 | unexplained-truncation | BUTTON\|\|产品短片\|\|0 | `artifacts/1280-_video-control-80.png` |
| P2 | /video / 1280 | unexplained-truncation | BUTTON\|\|光影氛围\|\|0 | `artifacts/1280-_video-control-106.png` |
| P2 | /video / 1280 | selected-tab-semantics | 氛围风格基调 | `artifacts/1280-_video.png` |
| P2 | /image / 1280 | unexplained-truncation | BUTTON\|\|自然光影\|\|0 | `artifacts/1280-_image-control-41.png` |
| P2 | /image / 1280 | unexplained-truncation | BUTTON\|\|商品棚拍\|\|0 | `artifacts/1280-_image-control-70.png` |
| P2 | /image / 1280 | visual-difference | ratio=0.0325244140625 | `artifacts/1280-_image-diff.png` |
| P2 | /planned / 1280 | selected-tab-semantics | 9 每日测试计划 18:00 重复 | `artifacts/1280-_planned.png` |
| P2 | /planned/legacy-scheduled / 1280 | selected-tab-semantics | 不重复 | `artifacts/1280-_planned_legacy-scheduled.png` |
| P2 | /planned/legacy-scheduled / 1280 | selected-tab-semantics | 不提醒 | `artifacts/1280-_planned_legacy-scheduled.png` |
| P2 | /scheduled / 1280 | selected-tab-semantics | 不重复 | `artifacts/1280-_scheduled.png` |
| P2 | /scheduled / 1280 | selected-tab-semantics | 不提醒 | `artifacts/1280-_scheduled.png` |
| P2 | /batch / 1280 | selected-tab-semantics | 9 每日测试计划 18:00 重复 | `artifacts/1280-_batch.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1024-task_generate_executing-control-33.png` |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | `artifacts/1024-task_generate_executing-control-58.png` |
| P2 | task:generate:executing / 1024 | selected-tab-semantics | 手机登录 | `artifacts/1024-task_generate_executing.png` |
| P2 | task:generate:completed / 1024 | visual-difference | ratio=0.018646240234375 | `artifacts/1024-task_generate_completed-diff.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|0 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|1 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|2 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|3 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|4 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|5 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|6 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|7 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|8 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|9 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|10 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1024-task_browser_executing-control-86.png` |
| P2 | task:browser:executing / 1024 | visual-difference | ratio=0.052851359049479164 | `artifacts/1024-task_browser_executing-diff.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1024-task_browser_completed-control-69.png` |
| P2 | task:browser:completed / 1024 | visual-difference | ratio=0.0302276611328125 | `artifacts/1024-task_browser_completed-diff.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:failed / 1024 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1024-task_browser_failed-control-73.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|0 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|1 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|2 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|3 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|4 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|5 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|6 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|7 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|8 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|9 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|10 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1024-task_browser_awaiting_user-control-65.png` |
| P2 | task:browser:awaiting_user / 1024 | visual-difference | ratio=0.05185546875 | `artifacts/1024-task_browser_awaiting_user-diff.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | `artifacts/1024-task_browser_cancelled-control-72.png` |
| P2 | task:scrape:completed / 1024 | visual-difference | ratio=0.024312337239583332 | `artifacts/1024-task_scrape_completed-diff.png` |
| P2 | task:image:completed / 1024 | visual-difference | ratio=0.018810017903645834 | `artifacts/1024-task_image_completed-diff.png` |
| P2 | /login / 1024 | selected-tab-semantics | 手机登录 | `artifacts/1024-_login.png` |
| P2 | /register / 1024 | selected-tab-semantics | 密码登录 | `artifacts/1024-_register.png` |
| P2 | /cosmic-preview / 1024 | visual-difference | ratio=0.23868306477864584 | `artifacts/1024-_cosmic-preview-diff.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /tasks / 1024 | selected-tab-semantics | 全部 | `artifacts/1024-_tasks.png` |
| P2 | /tasks / 1024 | selected-tab-semantics | 近 30 天 | `artifacts/1024-_tasks.png` |
| P2 | /schedule / 1024 | selected-tab-semantics | 不重复 | `artifacts/1024-_schedule.png` |
| P2 | /schedule / 1024 | selected-tab-semantics | 不提醒 | `artifacts/1024-_schedule.png` |
| P2 | /calendar / 1024 | selected-tab-semantics | 不重复 | `artifacts/1024-_calendar.png` |
| P2 | /calendar / 1024 | selected-tab-semantics | 不提醒 | `artifacts/1024-_calendar.png` |
| P2 | /settings/appearance / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1024-_settings_appearance.png` |
| P2 | /settings/appearance / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1024-_settings_appearance.png` |
| P2 | /settings/appearance / 1024 | visual-difference | ratio=0.0535247802734375 | `artifacts/1024-_settings_appearance-diff.png` |
| P2 | /settings/api-keys / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1024-_settings_api-keys.png` |
| P2 | /settings/api-keys / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1024-_settings_api-keys.png` |
| P2 | /settings/api-keys / 1024 | visual-difference | ratio=0.06251220703125 | `artifacts/1024-_settings_api-keys-diff.png` |
| P2 | /settings/memory / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1024-_settings_memory.png` |
| P2 | /settings/memory / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1024-_settings_memory.png` |
| P2 | /settings/memory / 1024 | visual-difference | ratio=0.07379862467447916 | `artifacts/1024-_settings_memory-diff.png` |
| P2 | /settings/notifications / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1024-_settings_notifications.png` |
| P2 | /settings/notifications / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1024-_settings_notifications.png` |
| P2 | /settings/notifications / 1024 | visual-difference | ratio=0.015803019205729168 | `artifacts/1024-_settings_notifications-diff.png` |
| P2 | /settings/account / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1024-_settings_account.png` |
| P2 | /settings/account / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1024-_settings_account.png` |
| P2 | /settings/account / 1024 | visual-difference | ratio=0.015360514322916666 | `artifacts/1024-_settings_account-diff.png` |
| P2 | /admin/finance / 1024 | selected-tab-semantics | 营收明细 | `artifacts/1024-_admin_finance.png` |
| P2 | /admin/learning / 1024 | selected-tab-semantics | 全部 | `artifacts/1024-_admin_learning.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | `artifacts/1024-_app-control-51.png` |
| P2 | /settings / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | `artifacts/1024-_settings.png` |
| P2 | /settings / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com | `artifacts/1024-_settings.png` |
| P2 | /plan / 1024 | selected-tab-semantics | 按月 | `artifacts/1024-_plan.png` |
| P2 | /cosmic / 1024 | visual-difference | ratio=0.1941497802734375 | `artifacts/1024-_cosmic-diff.png` |
| P2 | /history / 1024 | selected-tab-semantics | 全部 | `artifacts/1024-_history.png` |
| P2 | /history / 1024 | selected-tab-semantics | 近 30 天 | `artifacts/1024-_history.png` |
| P2 | /stocks / 1024 | visual-difference | ratio=0.06441650390625 | `artifacts/1024-_stocks-diff.png` |
| P2 | /files / 1024 | unexplained-text-truncation | 已加载 2 个文件 | `artifacts/1024-_files.png` |
| P2 | /video / 1024 | unexplained-truncation | BUTTON\|\|生活方式\|\|0 | `artifacts/1024-_video.png` |
| P2 | /video / 1024 | unexplained-text-truncation | 告诉 HOLA DAY 你的重点 | `artifacts/1024-_video.png` |
| P2 | /video / 1024 | unexplained-truncation | BUTTON\|\|光影氛围\|\|0 | `artifacts/1024-_video-control-106.png` |
| P2 | /video / 1024 | unexplained-truncation | BUTTON\|\|细节特写\|\|0 | `artifacts/1024-_video-control-90.png` |
| P2 | /video / 1024 | selected-tab-semantics | 氛围风格基调 | `artifacts/1024-_video.png` |
| P2 | /image / 1024 | unexplained-truncation | BUTTON\|\|自然光影\|\|0 | `artifacts/1024-_image-control-70.png` |
| P2 | /image / 1024 | visual-difference | ratio=0.034856160481770836 | `artifacts/1024-_image-diff.png` |
| P2 | /planned / 1024 | selected-tab-semantics | 9 每日测试计划 18:00 重复 | `artifacts/1024-_planned.png` |
| P2 | /planned/legacy-scheduled / 1024 | selected-tab-semantics | 不重复 | `artifacts/1024-_planned_legacy-scheduled.png` |
| P2 | /planned/legacy-scheduled / 1024 | selected-tab-semantics | 不提醒 | `artifacts/1024-_planned_legacy-scheduled.png` |
| P2 | /scheduled / 1024 | selected-tab-semantics | 不重复 | `artifacts/1024-_scheduled.png` |
| P2 | /scheduled / 1024 | selected-tab-semantics | 不提醒 | `artifacts/1024-_scheduled.png` |
| P2 | /batch / 1024 | selected-tab-semantics | 9 每日测试计划 18:00 重复 | `artifacts/1024-_batch.png` |

## P3：后续验收边界（人工列项）

- 真实生成、长时阶段推进、退款重试及模型计费：上线后另验。
- 真实行情时效、数据降级与交易日正确性：本轮离线种子未覆盖。
- 用户 Chrome 授权、真实实时画面与外站执行：本轮只有合成浏览器协议与页面控件验证。
- 媒体编辑器许可证、真实账号权限及真实文件后端：不以本地种子结果认定上线可用。
- #259 合并后再执行约定 rebase；本轮未提前同步、未强推。
