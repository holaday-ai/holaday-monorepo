# UI regression report

Result: **failed** · candidate `935348a472a77852ff0fd5636a981de4d8a5e806` · seed `2026-10-09-v2`

Frontend source: `345eb8b47855551898ea5f1e0f49e55e1b9ac197ce1d7262fea418b0fc5243a4`; build: `f8a3ea427b5f5777cb14e3d583db14c25f1ba974ef442403464ca0cffd632e39`.

Local seeded frontend/backend only. Production, paid services and real accounts are not contacted. Baseline creation is not a passed comparison.

Pages: 240/240; findings: 1044; coverage gaps: 0.

## Findings

| Severity | Route / width | Rule | Detail | Screenshot |
| --- | --- | --- | --- | --- |
| P1 | task:generate:executing / 1280 | wrong-task-browser-ui |  | [image](artifacts/1280-task_generate_executing.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1280-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1280 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | [image](artifacts/1280-task_generate_executing-control-59.png) |
| P2 | task:generate:executing / 1280 | selected-tab-semantics | 手机登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-task_generate_executing.png) |
| P2 | task:generate:completed / 1280 | known-4-alarming-verification-copy |  | [image](artifacts/1280-task_generate_completed.png) |
| P1 | task:generate:failed / 1280 | wrong-task-browser-ui |  | [image](artifacts/1280-task_generate_failed.png) |
| P1 | task:generate:cancelled / 1280 | wrong-task-browser-ui |  | [image](artifacts/1280-task_generate_cancelled.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|1 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|2 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|3 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|4 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|5 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|6 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|7 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|8 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|9 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|10 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:executing / 1280 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1280-task_browser_executing-control-88.png) |
| P2 | task:browser:completed / 1280 | known-4-alarming-verification-copy |  | [image](artifacts/1280-task_browser_completed.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:completed / 1280 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1280-task_browser_completed-control-74.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:failed / 1280 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1280-task_browser_failed-control-77.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|1 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|2 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|3 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|4 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|5 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|6 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|7 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|8 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|9 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | BUTTON\|\|BUTTON\|\|10 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P2 | task:browser:awaiting_user / 1280 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1280-task_browser_awaiting_user-control-67.png) |
| P1 | task:browser:cancelled / 1280 | control-overlap | BUTTON\|\|详细步骤，12/12 步完成\|\|0 / TEXTAREA\|\|补充问题或下一步指令...\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-75.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P2 | task:browser:cancelled / 1280 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1280-task_browser_cancelled-control-76.png) |
| P1 | task:scrape:executing / 1280 | wrong-task-browser-ui |  | [image](artifacts/1280-task_scrape_executing.png) |
| P2 | task:scrape:executing / 1280 | known-5-raw-provider-label |  | [image](artifacts/1280-task_scrape_executing.png) |
| P2 | task:scrape:completed / 1280 | known-4-alarming-verification-copy |  | [image](artifacts/1280-task_scrape_completed.png) |
| P2 | task:scrape:completed / 1280 | known-5-raw-provider-label |  | [image](artifacts/1280-task_scrape_completed.png) |
| P1 | task:scrape:completed / 1280 | control-overlap | BUTTON\|\|复制纯文本结果\|\|0 / TEXTAREA\|\|补充问题或下一步指令...\|\|0 | [image](artifacts/1280-task_scrape_completed-control-37.png) |
| P1 | task:scrape:completed / 1280 | control-overlap | BUTTON\|\|打开更多结果操作\|\|0 / TEXTAREA\|\|补充问题或下一步指令...\|\|0 | [image](artifacts/1280-task_scrape_completed-control-37.png) |
| P1 | task:scrape:failed / 1280 | wrong-task-browser-ui |  | [image](artifacts/1280-task_scrape_failed.png) |
| P2 | task:scrape:failed / 1280 | known-5-raw-provider-label |  | [image](artifacts/1280-task_scrape_failed.png) |
| P2 | task:scrape:awaiting_user / 1280 | known-5-raw-provider-label |  | [image](artifacts/1280-task_scrape_awaiting_user.png) |
| P1 | task:scrape:cancelled / 1280 | wrong-task-browser-ui |  | [image](artifacts/1280-task_scrape_cancelled.png) |
| P2 | task:scrape:cancelled / 1280 | known-5-raw-provider-label |  | [image](artifacts/1280-task_scrape_cancelled.png) |
| P1 | task:image:executing / 1280 | wrong-task-browser-ui |  | [image](artifacts/1280-task_image_executing.png) |
| P2 | task:image:completed / 1280 | known-4-alarming-verification-copy |  | [image](artifacts/1280-task_image_completed.png) |
| P1 | task:image:failed / 1280 | wrong-task-browser-ui |  | [image](artifacts/1280-task_image_failed.png) |
| P1 | task:image:cancelled / 1280 | wrong-task-browser-ui |  | [image](artifacts/1280-task_image_cancelled.png) |
| P2 | /login / 1280 | selected-tab-semantics | 手机登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_login.png) |
| P2 | /register / 1280 | selected-tab-semantics | 密码登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_register.png) |
| P2 | /cosmic-preview / 1280 | unexplained-text-truncation | 依次找出眼前五种颜色、四种触感和三种声音，让注意力从纷乱想法回到真实环境。 | [image](artifacts/1280-_cosmic-preview.png) |
| P2 | /cosmic-preview / 1280 | unexplained-text-truncation | 如果任务很多却很难开始，用五个问题找出注意力最容易安定的位置，再带走一个小动作。 | [image](artifacts/1280-_cosmic-preview.png) |
| P2 | /cosmic-preview / 1280 | unexplained-text-truncation | 用不到一分钟接住十二颗能量光点，让注意力从等待和焦虑里暂时转向简单、即时的反馈。 | [image](artifacts/1280-_cosmic-preview.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /app / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | /tasks / 1280 | selected-tab-semantics | 全部: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_tasks.png) |
| P2 | /tasks / 1280 | selected-tab-semantics | 近 30 天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_tasks.png) |
| P2 | /schedule / 1280 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_schedule.png) |
| P2 | /schedule / 1280 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_schedule.png) |
| P2 | /schedule / 1280 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_schedule.png) |
| P1 | /schedule / 1280 | dead-control | 删除定时任务: opened popup cannot dismiss with Escape | [image](artifacts/1280-_schedule-control-177.png) |
| P2 | /calendar / 1280 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_calendar.png) |
| P2 | /calendar / 1280 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_calendar.png) |
| P2 | /calendar / 1280 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_calendar.png) |
| P1 | /experts / 1280 | control-occluded | INPUT\|searchbox\|搜索技能\|\|0 | [image](artifacts/1280-_experts-control-67.png) |
| P1 | /experts / 1280 | control-occluded | DIV\|menuitem\|自动匹配\|\|0 | [image](artifacts/1280-_experts-control-67.png) |
| P1 | /experts / 1280 | control-occluded | DIV\|menuitem\|数据报告解读\|\|0 | [image](artifacts/1280-_experts-control-57.png) |
| P1 | /experts / 1280 | dead-control | 自动匹配: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_experts-control-68.png) |
| P1 | /experts / 1280 | dead-control | 数据报告解读: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_experts-control-69.png) |
| P1 | /plugins / 1280 | control-occluded | INPUT\|searchbox\|搜索技能\|\|0 | [image](artifacts/1280-_experts-control-67.png) |
| P1 | /plugins / 1280 | control-occluded | DIV\|menuitem\|自动匹配\|\|0 | [image](artifacts/1280-_experts-control-67.png) |
| P1 | /plugins / 1280 | control-occluded | DIV\|menuitem\|数据报告解读\|\|0 | [image](artifacts/1280-_experts-control-57.png) |
| P1 | /settings/appearance / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings_appearance-control-83.png) |
| P1 | /settings/appearance / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_appearance-control-83.png) |
| P1 | /settings/appearance / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_appearance-control-83.png) |
| P2 | /settings/appearance / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings_appearance.png) |
| P1 | /settings/appearance / 1280 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_settings_appearance-control-55.png) |
| P2 | /settings/appearance / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings_appearance.png) |
| P1 | /settings/api-keys / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings_api-keys-control-83.png) |
| P1 | /settings/api-keys / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_api-keys-control-83.png) |
| P1 | /settings/api-keys / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_api-keys-control-83.png) |
| P2 | /settings/api-keys / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings_api-keys.png) |
| P1 | /settings/api-keys / 1280 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_settings_api-keys-control-55.png) |
| P2 | /settings/api-keys / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings_api-keys.png) |
| P1 | /settings/memory / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings_memory-control-83.png) |
| P1 | /settings/memory / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_memory-control-83.png) |
| P1 | /settings/memory / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_memory-control-83.png) |
| P2 | /settings/memory / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings_memory.png) |
| P1 | /settings/memory / 1280 | dead-control | 账号: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_settings_memory-control-41.png) |
| P1 | /settings/memory / 1280 | control-occluded | BUTTON\|\|查看关闭影响\|\|0 | [image](artifacts/1280-_settings_memory-control-71.png) |
| P1 | /settings/memory / 1280 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_settings_memory-control-55.png) |
| P1 | /settings/memory / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|取消\|\|0 | [image](artifacts/1280-_settings_memory-control-64.png) |
| P2 | /settings/memory / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings_memory.png) |
| P1 | /settings/notifications / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1280 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings_notifications-control-82.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings_notifications-control-82.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1280 | control-overlap | BUTTON\|\|删除记忆：报告偏好\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_notifications-control-82.png) |
| P2 | /settings/notifications / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings_notifications.png) |
| P1 | /settings/notifications / 1280 | dead-control | 账号: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_settings_notifications-control-41.png) |
| P1 | /settings/notifications / 1280 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1280 | control-occluded | BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1280-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1280-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1280 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_settings_notifications-control-55.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|取消\|\|0 | [image](artifacts/1280-_settings_notifications-control-64.png) |
| P2 | /settings/notifications / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings_notifications.png) |
| P1 | /settings/account / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings_account-control-83.png) |
| P1 | /settings/account / 1280 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings_account-control-82.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings_account-control-82.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_account-control-83.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_account-control-83.png) |
| P1 | /settings/account / 1280 | control-overlap | BUTTON\|\|删除记忆：报告偏好\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_account-control-82.png) |
| P2 | /settings/account / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings_account.png) |
| P1 | /settings/account / 1280 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_settings_account-control-50.png) |
| P1 | /settings/account / 1280 | control-occluded | BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1280-_settings_account-control-50.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_settings_account-control-50.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1280-_settings_account-control-50.png) |
| P1 | /settings/account / 1280 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_settings_account-control-55.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|取消\|\|0 | [image](artifacts/1280-_settings_account-control-64.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|外观\|/settings#appearance\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_account-control-66.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_account-control-66.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|数据区域\|/settings#model-region\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_account-control-66.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|API Key\|/settings#api-keys\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_account-control-66.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|浏览器数据\|/settings#browser-data\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_account-control-66.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|AI 记忆\|/settings#memory\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_account-control-66.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|通知\|/settings#notifications\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_account-control-66.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_account-control-66.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_account-control-66.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_account-control-66.png) |
| P2 | /settings/account / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings_account.png) |
| P2 | /admin/finance / 1280 | selected-tab-semantics | 营收明细: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_admin_finance.png) |
| P2 | /admin/learning / 1280 | selected-tab-semantics | 全部: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_admin_learning.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P2 | / / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1280-_app-control-52.png) |
| P1 | /profile / 1280 | control-overlap | A\|\|联系支持\|mailto:support@holaday.ai?subject=%E6%9B%B4%E6%96%B0+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99&body=%E8%AF%B7%E5%8D%8F%E5%8A%A9%E6%9B%B4%E6%96%B0%E6%88%91%E7%9A%84+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99%E3%80%82%0A%0A%E6%B3%A8%E5%86%8C%E9%82%AE%E7%AE%B1%EF%BC%9Aui%40example.test%0A%E9%9C%80%E8%A6%81%E6%9B%B4%E6%96%B0%E7%9A%84%E5%86%85%E5%AE%B9%EF%BC%9A\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_profile-control-54.png) |
| P1 | /profile / 1280 | control-overlap | A\|\|联系支持\|mailto:support@holaday.ai?subject=%E6%9B%B4%E6%96%B0+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99&body=%E8%AF%B7%E5%8D%8F%E5%8A%A9%E6%9B%B4%E6%96%B0%E6%88%91%E7%9A%84+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99%E3%80%82%0A%0A%E6%B3%A8%E5%86%8C%E9%82%AE%E7%AE%B1%EF%BC%9Aui%40example.test%0A%E9%9C%80%E8%A6%81%E6%9B%B4%E6%96%B0%E7%9A%84%E5%86%85%E5%AE%B9%EF%BC%9A\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_profile-control-54.png) |
| P1 | /profile / 1280 | control-occluded | A\|\|联系支持\|mailto:support@holaday.ai?subject=%E6%9B%B4%E6%96%B0+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99&body=%E8%AF%B7%E5%8D%8F%E5%8A%A9%E6%9B%B4%E6%96%B0%E6%88%91%E7%9A%84+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99%E3%80%82%0A%0A%E6%B3%A8%E5%86%8C%E9%82%AE%E7%AE%B1%EF%BC%9Aui%40example.test%0A%E9%9C%80%E8%A6%81%E6%9B%B4%E6%96%B0%E7%9A%84%E5%86%85%E5%AE%B9%EF%BC%9A\|0 | [image](artifacts/1280-_profile-control-54.png) |
| P2 | /settings / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings.png) |
| P1 | /settings / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings-control-83.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings-control-83.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings-control-83.png) |
| P1 | /settings / 1280 | control-occluded | BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1280-_settings-control-50.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1280-_settings-control-50.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1280-_settings-control-50.png) |
| P1 | /settings / 1280 | control-overlap | BUTTON\|\|新建 API Key\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings-control-50.png) |
| P1 | /settings / 1280 | control-overlap | BUTTON\|\|新建 API Key\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings-control-50.png) |
| P1 | /settings / 1280 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_settings-control-55.png) |
| P1 | /settings / 1280 | control-occluded | BUTTON\|\|取消\|\|0 | [image](artifacts/1280-_settings-control-65.png) |
| P1 | /settings / 1280 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings-control-80.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings-control-80.png) |
| P1 | /settings / 1280 | control-overlap | BUTTON\|\|删除记忆：报告偏好\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings-control-80.png) |
| P2 | /settings / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings.png) |
| P2 | /plan / 1280 | selected-tab-semantics | 按月: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_plan.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|做一个轻测试\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1280-_cosmic-control-178.png) |
| P2 | /cosmic / 1280 | unexplained-text-truncation | 把视线放到远处一个固定物体，慢慢吸气和呼气八次，让肩膀在每次呼气时放低一点。 | [image](artifacts/1280-_cosmic.png) |
| P2 | /cosmic / 1280 | unexplained-text-truncation | 今天的好运更像一个容易完成的小步骤，先让一件事情顺利结束，再带着这股轻盈继续。 | [image](artifacts/1280-_cosmic.png) |
| P2 | /cosmic / 1280 | unexplained-text-truncation | 太阳星座更接近你主动发展和表达自我的方向，它是认识自己的入口，而不是限制性格的标签。 | [image](artifacts/1280-_cosmic.png) |
| P2 | /cosmic / 1280 | unexplained-text-truncation | 如果任务很多却很难开始，用五个问题找出注意力最容易安定的位置，再带走一个小动作。 | [image](artifacts/1280-_cosmic.png) |
| P2 | /cosmic / 1280 | unexplained-text-truncation | 开始前先写清怎样算完成，明确的终点会减少无谓打磨，也让今天更容易获得成就感。 | [image](artifacts/1280-_cosmic.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|tab\|今日\|\|0 | [image](artifacts/1280-_cosmic-control-44.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|tab\|本周\|\|0 | [image](artifacts/1280-_cosmic-control-44.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|tab\|本月\|\|0 | [image](artifacts/1280-_cosmic-control-44.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|tab\|本年\|\|0 | [image](artifacts/1280-_cosmic-control-44.png) |
| P1 | /cosmic / 1280 | control-occluded | A\|\|回到星座补给开头\|#energy-astrology-world-title\|0 | [image](artifacts/1280-_cosmic-control-115.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|测个相关主题\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1280-_cosmic-control-55.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|打开推荐小游戏：专注一轮\|\|0 | [image](artifacts/1280-_cosmic-control-132.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|打开推荐抽卡：三张能量牌\|\|0 | [image](artifacts/1280-_cosmic-control-132.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|打开今日投票：专注背景声\|\|0 | [image](artifacts/1280-_cosmic-control-132.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|收藏太阳星座代表什么\|\|0 | [image](artifacts/1280-_cosmic-control-64.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|收藏推荐测试：专注入口\|\|0 | [image](artifacts/1280-_cosmic-control-64.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|收藏今日幸运签：看见终点\|\|0 | [image](artifacts/1280-_cosmic-control-64.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|测个相关主题\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_cosmic-control-64.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|测个相关主题\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_cosmic-control-64.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|收藏今日幸运签：看见终点\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1280-_cosmic-control-64.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|收藏今日幸运签：小事先成\|\|0 | [image](artifacts/1280-_cosmic-control-70.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|tab\|最近玩过 0\|\|0 | [image](artifacts/1280-_cosmic-control-138.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|tab\|我的收藏 0\|\|0 | [image](artifacts/1280-_cosmic-control-138.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|收藏今日幸运签：小事先成\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_cosmic-control-70.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|tab\|我的收藏 0\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1280-_cosmic-control-138.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|做一个轻测试\|\|0 | [image](artifacts/1280-_cosmic-control-160.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|做一个轻测试\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_cosmic-control-160.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|做一个轻测试\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_cosmic-control-160.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|做一个轻测试\|\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1280-_cosmic-control-160.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|收藏今日投票：专注背景声\|\|0 | [image](artifacts/1280-_cosmic-control-138.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|收藏今日投票：专注背景声\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_cosmic-control-138.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|再来一组\|\|0 | [image](artifacts/1280-_cosmic-control-162.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|再来一组\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_cosmic-control-162.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|再来一组\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_cosmic-control-162.png) |
| P1 | /cosmic / 1280 | control-overlap | BUTTON\|\|再来一组\|\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1280-_cosmic-control-162.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|打开太阳星座代表什么\|\|0 | [image](artifacts/1280-_cosmic-control-196.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|打开推荐测试：专注入口\|\|0 | [image](artifacts/1280-_cosmic-control-196.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|打开今日幸运签：看见终点\|\|0 | [image](artifacts/1280-_cosmic-control-196.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|打开今日投票：完成后的奖励\|\|0 | [image](artifacts/1280-_cosmic-control-183.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|打开火象星座怎样充电\|\|0 | [image](artifacts/1280-_cosmic-control-183.png) |
| P1 | /cosmic / 1280 | control-occluded | BUTTON\|\|打开日周月年怎样看\|\|0 | [image](artifacts/1280-_cosmic-control-183.png) |
| P2 | /history / 1280 | selected-tab-semantics | 全部: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_history.png) |
| P2 | /history / 1280 | selected-tab-semantics | 近 30 天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_history.png) |
| P1 | /skills / 1280 | control-occluded | INPUT\|searchbox\|搜索技能\|\|0 | [image](artifacts/1280-_experts-control-67.png) |
| P1 | /skills / 1280 | control-occluded | DIV\|menuitem\|自动匹配\|\|0 | [image](artifacts/1280-_experts-control-67.png) |
| P1 | /skills / 1280 | control-occluded | DIV\|menuitem\|数据报告解读\|\|0 | [image](artifacts/1280-_experts-control-57.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|tab\|关注股票\|\|0 | [image](artifacts/1280-_stocks-control-96.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1280-_stocks-control-96.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1280-_stocks-control-96.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|tab\|交易日简报\|\|0 | [image](artifacts/1280-_stocks-control-96.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1280-_stocks-control-96.png) |
| P2 | /stocks / 1280 | unexplained-text-truncation | 贵州茅台 | [image](artifacts/1280-_stocks.png) |
| P2 | /stocks / 1280 | unexplained-text-truncation | 上证指数 +0.50% | [image](artifacts/1280-_stocks.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|刷新风险雷达\|\|0 | [image](artifacts/1280-_stocks-control-36.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|刷新风险雷达\|\|0 | [image](artifacts/1280-_stocks-control-36.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|基于 10/09 生成交易日复盘\|\|0 | [image](artifacts/1280-_stocks-control-111.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|基于 10/09 生成交易日复盘\|\|0 | [image](artifacts/1280-_stocks-control-56.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|移除ui.png\|\|0 / BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1280-_stocks-control-85.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|上证指数 3300.00+0.50%\|\|0 / BUTTON\|\|选择研究范围\|\|0 | [image](artifacts/1280-_stocks-control-47.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|上证指数 3300.00+0.50%\|\|0 / BUTTON\|\|选择时间范围\|\|0 | [image](artifacts/1280-_stocks-control-47.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1280-_stocks-control-47.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1280-_stocks-control-47.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|tab\|交易日简报\|\|0 | [image](artifacts/1280-_stocks-control-47.png) |
| P1 | /stocks / 1280 | control-occluded | SUMMARY\|\|研究建议\|\|0 | [image](artifacts/1280-_stocks-control-89.png) |
| P1 | /stocks / 1280 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|基于 10/09 生成交易日复盘\|\|1 | [image](artifacts/1280-_stocks-control-89.png) |
| P1 | /stocks / 1280 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|哪些股票存在已核验的风险信号？\|\|0 | [image](artifacts/1280-_stocks-control-89.png) |
| P1 | /stocks / 1280 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|查看 AI 板块已核验信息\|\|0 | [image](artifacts/1280-_stocks-control-89.png) |
| P1 | /stocks / 1280 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|分析 600519 的风险点\|\|0 | [image](artifacts/1280-_stocks-control-89.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|排除ST，市盈率低于30，资产负债率低于50%\|\|0 | [image](artifacts/1280-_stocks-control-233.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|近三年持续盈利，ROE高于10%，近期无减持\|\|0 | [image](artifacts/1280-_stocks-control-233.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|刷新选股偏好\|\|0 | [image](artifacts/1280-_stocks-control-149.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|暂停画像\|\|0 | [image](artifacts/1280-_stocks-control-149.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|调整画像\|\|0 | [image](artifacts/1280-_stocks-control-149.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / BUTTON\|\|排除ST，市盈率低于30，资产负债率低于50%\|\|0 | [image](artifacts/1280-_stocks-control-149.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / BUTTON\|\|排除ST，市盈率低于30，资产负债率低于50%\|\|0 | [image](artifacts/1280-_stocks-control-149.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|展开编辑\|\|0 / BUTTON\|\|调整画像\|\|0 | [image](artifacts/1280-_stocks-control-149.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|提交股市任务\|\|0 / BUTTON\|\|调整画像\|\|0 | [image](artifacts/1280-_stocks-control-149.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|查看更多新闻\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|自选股新闻 1\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|重要公告 0\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|A股要闻 0\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|美股要闻 0\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|港股要闻 0\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|展开编辑\|\|0 / BUTTON\|\|查看更多新闻\|\|0 | [image](artifacts/1280-_stocks-control-57.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|提交股市任务\|\|0 / BUTTON\|\|查看更多新闻\|\|0 | [image](artifacts/1280-_stocks-control-57.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|管理列表\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|查看更多新闻\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|添加本地资料\|\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|已开启引用来源，点击关闭\|\|0 / BUTTON\|\|自选股新闻 1\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择输出内容\|\|0 / BUTTON\|\|重要公告 0\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|管理列表\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_stocks-control-101.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|正在加载\|\|0 | [image](artifacts/1280-_stocks-control-60.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|查看第 1 页动态\|\|0 | [image](artifacts/1280-_stocks-control-60.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1280-_stocks-control-115.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1280-_stocks-control-115.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1280-_stocks-control-115.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|正在加载\|\|0 | [image](artifacts/1280-_stocks-control-60.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|查看第 1 页动态\|\|0 | [image](artifacts/1280-_stocks-control-60.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1280-_stocks-control-124.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|查看详情\|\|2 | [image](artifacts/1280-_stocks-control-71.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1280-_stocks-control-71.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1280-_stocks-control-71.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|自选股新闻 1\|\|0 | [image](artifacts/1280-_stocks-control-79.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|重要公告 0\|\|0 | [image](artifacts/1280-_stocks-control-79.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|A股要闻 0\|\|0 | [image](artifacts/1280-_stocks-control-79.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|美股要闻 0\|\|0 | [image](artifacts/1280-_stocks-control-79.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|港股要闻 0\|\|0 | [image](artifacts/1280-_stocks-control-79.png) |
| P1 | /stocks / 1280 | control-occluded | INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1280-_stocks-control-233.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|识别条件\|\|0 | [image](artifacts/1280-_stocks-control-233.png) |
| P1 | /stocks / 1280 | control-overlap | SUMMARY\|\|研究建议\|\|0 / INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1280-_stocks-control-96.png) |
| P1 | /stocks / 1280 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|识别条件\|\|0 | [image](artifacts/1280-_stocks-control-96.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1280-_stocks-control-233.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1280-_stocks-control-233.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|收起输入框\|\|0 / BUTTON\|\|识别条件\|\|0 | [image](artifacts/1280-_stocks-control-233.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / BUTTON\|\|排除ST，市盈率低于30，资产负债率低于50%\|\|0 | [image](artifacts/1280-_stocks-control-233.png) |
| P1 | /stocks / 1280 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|基于 10/09 生成交易日复盘\|\|0 | [image](artifacts/1280-_stocks-control-111.png) |
| P1 | /stocks / 1280 | control-occluded | ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1280-_stocks-control-115.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1280-_stocks-control-115.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|添加本地资料\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1280-_stocks-control-115.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|已开启引用来源，点击关闭\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1280-_stocks-control-115.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择输出内容\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1280-_stocks-control-115.png) |
| P1 | /stocks / 1280 | control-overlap | SUMMARY\|\|研究建议\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1280-_stocks-control-115.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|打开选股与偏好\|\|0 | [image](artifacts/1280-_stocks-control-121.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|详情\|\|0 | [image](artifacts/1280-_stocks-control-121.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|查看详情\|\|0 | [image](artifacts/1280-_stocks-control-121.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|详情\|\|0 | [image](artifacts/1280-_stocks-control-121.png) |
| P1 | /stocks / 1280 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|查看详情\|\|0 | [image](artifacts/1280-_stocks-control-121.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|打开选股与偏好\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_stocks-control-121.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|打开选股与偏好\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_stocks-control-121.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|跌幅榜\|\|0 | [image](artifacts/1280-_stocks-control-124.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|成交额榜\|\|0 | [image](artifacts/1280-_stocks-control-124.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|当前 AkShare 可达源暂缺换手率字段\|\|0 | [image](artifacts/1280-_stocks-control-124.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|\|查看详情\|\|1 | [image](artifacts/1280-_stocks-control-123.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|收起输入框\|\|0 / BUTTON\|\|查看详情\|\|1 | [image](artifacts/1280-_stocks-control-123.png) |
| P1 | /stocks / 1280 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1280-_stocks-control-123.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / BUTTON\|\|跌幅榜\|\|0 | [image](artifacts/1280-_stocks-control-124.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / BUTTON\|\|成交额榜\|\|0 | [image](artifacts/1280-_stocks-control-124.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / BUTTON\|\|当前 AkShare 可达源暂缺换手率字段\|\|0 | [image](artifacts/1280-_stocks-control-124.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|添加本地资料\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1280-_stocks-control-124.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|已开启引用来源，点击关闭\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1280-_stocks-control-124.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择输出内容\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1280-_stocks-control-124.png) |
| P1 | /stocks / 1280 | dead-control | INPUT: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_stocks-control-182.png) |
| P2 | /files / 1280 | unexplained-text-truncation | 已加载 2 个文件 | [image](artifacts/1280-_files.png) |
| P2 | /video / 1280 | unexplained-text-truncation | 告诉 HOLA DAY 你的重点 | [image](artifacts/1280-_video.png) |
| P2 | /video / 1280 | unexplained-truncation | BUTTON\|\|产品短片\|\|0 | [image](artifacts/1280-_video-control-80.png) |
| P1 | /video / 1280 | control-occluded | BUTTON\|\|细节特写\|\|0 | [image](artifacts/1280-_video-control-56.png) |
| P1 | /video / 1280 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_video-control-56.png) |
| P1 | /video / 1280 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_video-control-56.png) |
| P1 | /video / 1280 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1280-_video-control-56.png) |
| P1 | /video / 1280 | control-overlap | BUTTON\|\|上传一位真人或写实虚构人物的清晰照片；当前模型仅支持单人换单人，取景和身体比例相近；暂不支持宠物、物体或多人替换。\|\|0 / BUTTON\|\|移除主角照片\|\|0 | [image](artifacts/1280-_video-control-64.png) |
| P1 | /video / 1280 | control-occluded | BUTTON\|\|全部\|\|0 | [image](artifacts/1280-_video-control-66.png) |
| P1 | /video / 1280 | control-occluded | BUTTON\|\|最近\|\|0 | [image](artifacts/1280-_video-control-66.png) |
| P1 | /video / 1280 | control-occluded | BUTTON\|\|置顶\|\|0 | [image](artifacts/1280-_video-control-66.png) |
| P2 | /video / 1280 | unexplained-truncation | BUTTON\|\|光影氛围\|\|0 | [image](artifacts/1280-_video-control-106.png) |
| P1 | /video / 1280 | dead-control | 氛围风格基调: no observable effect | [image](artifacts/1280-_video-control-127.png) |
| P1 | /video/edit/:projectId / 1280 | console-error | Failed to load resource: the server responded with a status of 403 (Forbidden) | [image](artifacts/1280-_video_edit_projectId.png) |
| P1 | /image / 1280 | control-overlap | TEXTAREA\|\|描述你想要的最终画面\|\|0 / BUTTON\|\|准备生成\|\|0 | [image](artifacts/1280-_image-control-114.png) |
| P2 | /image / 1280 | unexplained-truncation | BUTTON\|\|自然光影\|\|0 | [image](artifacts/1280-_image-control-41.png) |
| P2 | /image / 1280 | unexplained-truncation | BUTTON\|\|商品棚拍\|\|0 | [image](artifacts/1280-_image-control-70.png) |
| P1 | /planned / 1280 | control-occluded | BUTTON\|\|旧任务记录\|\|0 | [image](artifacts/1280-_planned-control-188.png) |
| P1 | /planned / 1280 | dead-control | 旧任务记录: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_planned-control-34.png) |
| P1 | /planned / 1280 | dead-control | 今天: no observable effect | [image](artifacts/1280-_planned-control-40.png) |
| P2 | /planned / 1280 | selected-tab-semantics | 9 每日测试计划 18:00 重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_planned.png) |
| P1 | /planned / 1280 | dead-control | 日期: no observable effect | [image](artifacts/1280-_planned-control-127.png) |
| P1 | /planned / 1280 | control-occluded | BUTTON\|\|取消\|\|0 | [image](artifacts/1280-_planned-control-140.png) |
| P1 | /planned / 1280 | control-occluded | BUTTON\|\|保存规划\|\|0 | [image](artifacts/1280-_planned-control-140.png) |
| P1 | /planned / 1280 | dead-control | 结束日期: no observable effect | [image](artifacts/1280-_planned-control-180.png) |
| P2 | /planned/legacy-scheduled / 1280 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_planned_legacy-scheduled.png) |
| P2 | /planned/legacy-scheduled / 1280 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_planned_legacy-scheduled.png) |
| P2 | /planned/legacy-scheduled / 1280 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_planned_legacy-scheduled.png) |
| P1 | /planned/legacy-batch / 1280 | dead-control | 1 任务 1 空白: no observable effect | [image](artifacts/1280-_planned_legacy-batch-control-41.png) |
| P1 | /planned/legacy-batch / 1280 | dead-control | 2 任务 2 空白: no observable effect | [image](artifacts/1280-_planned_legacy-batch-control-53.png) |
| P1 | /planned/legacy-batch / 1280 | dead-control | 2 任务 2 缺目标: no observable effect | [image](artifacts/1280-_planned_legacy-batch-control-56.png) |
| P1 | /planned/legacy-batch / 1280 | dead-control | 3 任务 3 缺目标: no observable effect | [image](artifacts/1280-_planned_legacy-batch-control-58.png) |
| P2 | /scheduled / 1280 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_scheduled.png) |
| P2 | /scheduled / 1280 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_scheduled.png) |
| P2 | /scheduled / 1280 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_scheduled.png) |
| P1 | /batch / 1280 | control-occluded | BUTTON\|\|旧任务记录\|\|0 | [image](artifacts/1280-_planned-control-188.png) |
| P2 | /batch / 1280 | selected-tab-semantics | 9 每日测试计划 18:00 重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_batch.png) |
| P1 | /batch / 1280 | control-occluded | BUTTON\|\|取消\|\|0 | [image](artifacts/1280-_planned-control-140.png) |
| P1 | /batch / 1280 | control-occluded | BUTTON\|\|保存规划\|\|0 | [image](artifacts/1280-_planned-control-140.png) |
| P1 | task:generate:executing / 1024 | wrong-task-browser-ui |  | [image](artifacts/1024-task_generate_executing.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1024-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1024 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | [image](artifacts/1024-task_generate_executing-control-59.png) |
| P2 | task:generate:executing / 1024 | selected-tab-semantics | 手机登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-task_generate_executing.png) |
| P2 | task:generate:completed / 1024 | known-4-alarming-verification-copy |  | [image](artifacts/1024-task_generate_completed.png) |
| P1 | task:generate:failed / 1024 | wrong-task-browser-ui |  | [image](artifacts/1024-task_generate_failed.png) |
| P1 | task:generate:cancelled / 1024 | wrong-task-browser-ui |  | [image](artifacts/1024-task_generate_cancelled.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|1 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|2 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|3 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|4 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|5 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|6 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|7 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|8 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|9 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|10 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1024-task_browser_executing-control-86.png) |
| P2 | task:browser:completed / 1024 | known-4-alarming-verification-copy |  | [image](artifacts/1024-task_browser_completed.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:completed / 1024 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1024-task_browser_completed-control-72.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:failed / 1024 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1024-task_browser_failed-control-75.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|1 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|2 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|3 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|4 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|5 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|6 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|7 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|8 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|9 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | BUTTON\|\|BUTTON\|\|10 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P2 | task:browser:awaiting_user / 1024 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1024-task_browser_awaiting_user-control-65.png) |
| P1 | task:browser:cancelled / 1024 | control-overlap | BUTTON\|\|详细步骤，12/12 步完成\|\|0 / TEXTAREA\|\|补充问题或下一步指令...\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-73.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P2 | task:browser:cancelled / 1024 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1024-task_browser_cancelled-control-74.png) |
| P1 | task:scrape:executing / 1024 | wrong-task-browser-ui |  | [image](artifacts/1024-task_scrape_executing.png) |
| P2 | task:scrape:executing / 1024 | known-5-raw-provider-label |  | [image](artifacts/1024-task_scrape_executing.png) |
| P2 | task:scrape:completed / 1024 | known-4-alarming-verification-copy |  | [image](artifacts/1024-task_scrape_completed.png) |
| P2 | task:scrape:completed / 1024 | known-5-raw-provider-label |  | [image](artifacts/1024-task_scrape_completed.png) |
| P1 | task:scrape:completed / 1024 | control-overlap | BUTTON\|\|复制纯文本结果\|\|0 / TEXTAREA\|\|补充问题或下一步指令...\|\|0 | [image](artifacts/1024-task_scrape_completed-control-37.png) |
| P1 | task:scrape:completed / 1024 | control-overlap | BUTTON\|\|打开更多结果操作\|\|0 / TEXTAREA\|\|补充问题或下一步指令...\|\|0 | [image](artifacts/1024-task_scrape_completed-control-37.png) |
| P1 | task:scrape:failed / 1024 | wrong-task-browser-ui |  | [image](artifacts/1024-task_scrape_failed.png) |
| P2 | task:scrape:failed / 1024 | known-5-raw-provider-label |  | [image](artifacts/1024-task_scrape_failed.png) |
| P2 | task:scrape:awaiting_user / 1024 | known-5-raw-provider-label |  | [image](artifacts/1024-task_scrape_awaiting_user.png) |
| P1 | task:scrape:cancelled / 1024 | wrong-task-browser-ui |  | [image](artifacts/1024-task_scrape_cancelled.png) |
| P2 | task:scrape:cancelled / 1024 | known-5-raw-provider-label |  | [image](artifacts/1024-task_scrape_cancelled.png) |
| P1 | task:image:executing / 1024 | wrong-task-browser-ui |  | [image](artifacts/1024-task_image_executing.png) |
| P2 | task:image:completed / 1024 | known-4-alarming-verification-copy |  | [image](artifacts/1024-task_image_completed.png) |
| P1 | task:image:failed / 1024 | wrong-task-browser-ui |  | [image](artifacts/1024-task_image_failed.png) |
| P1 | task:image:cancelled / 1024 | wrong-task-browser-ui |  | [image](artifacts/1024-task_image_cancelled.png) |
| P2 | /login / 1024 | selected-tab-semantics | 手机登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_login.png) |
| P2 | /register / 1024 | selected-tab-semantics | 密码登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_register.png) |
| P2 | /cosmic-preview / 1024 | unexplained-text-truncation | 只收好桌面上三件最碍眼的东西，完成后立刻停下，用小范围秩序换回一点呼吸空间。 | [image](artifacts/1024-_cosmic-preview.png) |
| P2 | /cosmic-preview / 1024 | unexplained-text-truncation | 今天的好运更像一个容易完成的小步骤，先让一件事情顺利结束，再带着这股轻盈继续。 | [image](artifacts/1024-_cosmic-preview.png) |
| P2 | /cosmic-preview / 1024 | unexplained-text-truncation | 依次找出眼前五种颜色、四种触感和三种声音，让注意力从纷乱想法回到真实环境。 | [image](artifacts/1024-_cosmic-preview.png) |
| P2 | /cosmic-preview / 1024 | unexplained-text-truncation | 如果任务很多却很难开始，用五个问题找出注意力最容易安定的位置，再带走一个小动作。 | [image](artifacts/1024-_cosmic-preview.png) |
| P2 | /cosmic-preview / 1024 | unexplained-text-truncation | 用不到一分钟接住十二颗能量光点，让注意力从等待和焦虑里暂时转向简单、即时的反馈。 | [image](artifacts/1024-_cosmic-preview.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /app / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | /tasks / 1024 | selected-tab-semantics | 全部: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_tasks.png) |
| P2 | /tasks / 1024 | selected-tab-semantics | 近 30 天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_tasks.png) |
| P2 | /schedule / 1024 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_schedule.png) |
| P2 | /schedule / 1024 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_schedule.png) |
| P2 | /schedule / 1024 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_schedule.png) |
| P1 | /schedule / 1024 | control-occluded | A\|\|UI audit\|\|0 | [image](artifacts/1024-_schedule-control-175.png) |
| P1 | /schedule / 1024 | dead-control | 删除定时任务: opened popup cannot dismiss with Escape | [image](artifacts/1024-_schedule-control-177.png) |
| P2 | /calendar / 1024 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_calendar.png) |
| P2 | /calendar / 1024 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_calendar.png) |
| P2 | /calendar / 1024 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_calendar.png) |
| P1 | /calendar / 1024 | control-occluded | A\|\|UI audit\|\|0 | [image](artifacts/1024-_schedule-control-175.png) |
| P1 | /experts / 1024 | control-occluded | INPUT\|searchbox\|搜索技能\|\|0 | [image](artifacts/1024-_experts-control-67.png) |
| P1 | /experts / 1024 | control-occluded | DIV\|menuitem\|自动匹配\|\|0 | [image](artifacts/1024-_experts-control-67.png) |
| P1 | /experts / 1024 | control-occluded | DIV\|menuitem\|数据报告解读\|\|0 | [image](artifacts/1024-_experts-control-57.png) |
| P1 | /experts / 1024 | dead-control | 自动匹配: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_experts-control-68.png) |
| P1 | /experts / 1024 | dead-control | 数据报告解读: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_experts-control-69.png) |
| P1 | /plugins / 1024 | control-occluded | INPUT\|searchbox\|搜索技能\|\|0 | [image](artifacts/1024-_experts-control-67.png) |
| P1 | /plugins / 1024 | control-occluded | DIV\|menuitem\|自动匹配\|\|0 | [image](artifacts/1024-_experts-control-67.png) |
| P1 | /plugins / 1024 | control-occluded | DIV\|menuitem\|数据报告解读\|\|0 | [image](artifacts/1024-_experts-control-57.png) |
| P1 | /settings/appearance / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings_appearance-control-83.png) |
| P1 | /settings/appearance / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings_appearance-control-83.png) |
| P1 | /settings/appearance / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings_appearance-control-83.png) |
| P1 | /settings/appearance / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_appearance-control-83.png) |
| P1 | /settings/appearance / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings_appearance-control-83.png) |
| P2 | /settings/appearance / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings_appearance.png) |
| P1 | /settings/appearance / 1024 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_appearance-control-55.png) |
| P2 | /settings/appearance / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_appearance.png) |
| P1 | /settings/api-keys / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings_api-keys-control-83.png) |
| P1 | /settings/api-keys / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings_api-keys-control-83.png) |
| P1 | /settings/api-keys / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings_api-keys-control-83.png) |
| P1 | /settings/api-keys / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_api-keys-control-83.png) |
| P1 | /settings/api-keys / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings_api-keys-control-83.png) |
| P2 | /settings/api-keys / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings_api-keys.png) |
| P1 | /settings/api-keys / 1024 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_api-keys-control-55.png) |
| P2 | /settings/api-keys / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_api-keys.png) |
| P1 | /settings/memory / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings_memory-control-83.png) |
| P1 | /settings/memory / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings_memory-control-83.png) |
| P1 | /settings/memory / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings_memory-control-83.png) |
| P1 | /settings/memory / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_memory-control-83.png) |
| P1 | /settings/memory / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings_memory-control-83.png) |
| P2 | /settings/memory / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings_memory.png) |
| P1 | /settings/memory / 1024 | dead-control | 通知: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_memory-control-40.png) |
| P1 | /settings/memory / 1024 | dead-control | 账号: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_memory-control-41.png) |
| P1 | /settings/memory / 1024 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_memory-control-55.png) |
| P2 | /settings/memory / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_memory.png) |
| P1 | /settings/notifications / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings_notifications-control-83.png) |
| P2 | /settings/notifications / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings_notifications.png) |
| P1 | /settings/notifications / 1024 | dead-control | 账号: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_notifications-control-41.png) |
| P1 | /settings/notifications / 1024 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_notifications-control-55.png) |
| P2 | /settings/notifications / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_notifications.png) |
| P1 | /settings/account / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings_account-control-83.png) |
| P1 | /settings/account / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings_account-control-83.png) |
| P1 | /settings/account / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings_account-control-83.png) |
| P1 | /settings/account / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_account-control-83.png) |
| P1 | /settings/account / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings_account-control-83.png) |
| P2 | /settings/account / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings_account.png) |
| P1 | /settings/account / 1024 | dead-control | 通知: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_account-control-40.png) |
| P1 | /settings/account / 1024 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_account-control-55.png) |
| P1 | /settings/account / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|创建\|\|0 | [image](artifacts/1024-_settings_account-control-64.png) |
| P2 | /settings/account / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_account.png) |
| P2 | /admin/finance / 1024 | selected-tab-semantics | 营收明细: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_admin_finance.png) |
| P2 | /admin/learning / 1024 | selected-tab-semantics | 全部: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_admin_learning.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P2 | / / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1024-_app-control-52.png) |
| P1 | /profile / 1024 | control-occluded | A\|\|联系支持\|mailto:support@holaday.ai?subject=%E6%9B%B4%E6%96%B0+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99&body=%E8%AF%B7%E5%8D%8F%E5%8A%A9%E6%9B%B4%E6%96%B0%E6%88%91%E7%9A%84+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99%E3%80%82%0A%0A%E6%B3%A8%E5%86%8C%E9%82%AE%E7%AE%B1%EF%BC%9Aui%40example.test%0A%E9%9C%80%E8%A6%81%E6%9B%B4%E6%96%B0%E7%9A%84%E5%86%85%E5%AE%B9%EF%BC%9A\|0 | [image](artifacts/1024-_profile-control-54.png) |
| P1 | /profile / 1024 | control-overlap | A\|\|联系支持\|mailto:support@holaday.ai?subject=%E6%9B%B4%E6%96%B0+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99&body=%E8%AF%B7%E5%8D%8F%E5%8A%A9%E6%9B%B4%E6%96%B0%E6%88%91%E7%9A%84+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99%E3%80%82%0A%0A%E6%B3%A8%E5%86%8C%E9%82%AE%E7%AE%B1%EF%BC%9Aui%40example.test%0A%E9%9C%80%E8%A6%81%E6%9B%B4%E6%96%B0%E7%9A%84%E5%86%85%E5%AE%B9%EF%BC%9A\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_profile-control-54.png) |
| P1 | /profile / 1024 | control-overlap | A\|\|联系支持\|mailto:support@holaday.ai?subject=%E6%9B%B4%E6%96%B0+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99&body=%E8%AF%B7%E5%8D%8F%E5%8A%A9%E6%9B%B4%E6%96%B0%E6%88%91%E7%9A%84+HOLA+DAY+%E4%B8%AA%E4%BA%BA%E8%B5%84%E6%96%99%E3%80%82%0A%0A%E6%B3%A8%E5%86%8C%E9%82%AE%E7%AE%B1%EF%BC%9Aui%40example.test%0A%E9%9C%80%E8%A6%81%E6%9B%B4%E6%96%B0%E7%9A%84%E5%86%85%E5%AE%B9%EF%BC%9A\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_profile-control-54.png) |
| P2 | /settings / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings.png) |
| P1 | /settings / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings-control-83.png) |
| P1 | /settings / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings-control-83.png) |
| P1 | /settings / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings-control-83.png) |
| P1 | /settings / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings-control-83.png) |
| P1 | /settings / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings-control-83.png) |
| P1 | /settings / 1024 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings-control-55.png) |
| P1 | /settings / 1024 | control-occluded | BUTTON\|\|创建\|\|0 | [image](artifacts/1024-_settings-control-65.png) |
| P1 | /settings / 1024 | control-occluded | BUTTON\|\|取消\|\|0 | [image](artifacts/1024-_settings-control-65.png) |
| P1 | /settings / 1024 | control-occluded | BUTTON\|\|查看关闭影响\|\|0 | [image](artifacts/1024-_settings-control-71.png) |
| P1 | /settings / 1024 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1024-_settings-control-78.png) |
| P1 | /settings / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1024-_settings-control-78.png) |
| P1 | /settings / 1024 | control-overlap | BUTTON\|\|删除记忆：报告偏好\|\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings-control-78.png) |
| P2 | /settings / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings.png) |
| P2 | /plan / 1024 | selected-tab-semantics | 按月: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_plan.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|做一个轻测试\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1024-_cosmic-control-178.png) |
| P2 | /cosmic / 1024 | unexplained-text-truncation | 把视线放到远处一个固定物体，慢慢吸气和呼气八次，让肩膀在每次呼气时放低一点。 | [image](artifacts/1024-_cosmic.png) |
| P2 | /cosmic / 1024 | unexplained-text-truncation | 今天的好运更像一个容易完成的小步骤，先让一件事情顺利结束，再带着这股轻盈继续。 | [image](artifacts/1024-_cosmic.png) |
| P2 | /cosmic / 1024 | unexplained-text-truncation | 太阳星座更接近你主动发展和表达自我的方向，它是认识自己的入口，而不是限制性格的标签。 | [image](artifacts/1024-_cosmic.png) |
| P2 | /cosmic / 1024 | unexplained-text-truncation | 如果任务很多却很难开始，用五个问题找出注意力最容易安定的位置，再带走一个小动作。 | [image](artifacts/1024-_cosmic.png) |
| P2 | /cosmic / 1024 | unexplained-text-truncation | 开始前先写清怎样算完成，明确的终点会减少无谓打磨，也让今天更容易获得成就感。 | [image](artifacts/1024-_cosmic.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|tab\|今日\|\|0 | [image](artifacts/1024-_cosmic-control-160.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|tab\|本周\|\|0 | [image](artifacts/1024-_cosmic-control-160.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|tab\|本月\|\|0 | [image](artifacts/1024-_cosmic-control-160.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|tab\|本年\|\|0 | [image](artifacts/1024-_cosmic-control-160.png) |
| P1 | /cosmic / 1024 | control-occluded | A\|\|回到星座补给开头\|#energy-astrology-world-title\|0 | [image](artifacts/1024-_cosmic-control-115.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|测个相关主题\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1024-_cosmic-control-54.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|再来一组\|\|0 | [image](artifacts/1024-_cosmic-control-162.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|再来一组\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1024-_cosmic-control-55.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|打开推荐小游戏：专注一轮\|\|0 | [image](artifacts/1024-_cosmic-control-132.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|打开推荐抽卡：三张能量牌\|\|0 | [image](artifacts/1024-_cosmic-control-132.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|打开今日投票：专注背景声\|\|0 | [image](artifacts/1024-_cosmic-control-132.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|打开今日投票：专注背景声\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1024-_cosmic-control-132.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|收藏太阳星座代表什么\|\|0 | [image](artifacts/1024-_cosmic-control-64.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|收藏推荐测试：专注入口\|\|0 | [image](artifacts/1024-_cosmic-control-64.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|收藏今日幸运签：看见终点\|\|0 | [image](artifacts/1024-_cosmic-control-64.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|测个相关主题\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_cosmic-control-64.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|测个相关主题\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_cosmic-control-64.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|收藏今日幸运签：看见终点\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1024-_cosmic-control-64.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|收藏今日幸运签：小事先成\|\|0 | [image](artifacts/1024-_cosmic-control-123.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|收藏今日幸运签：小事先成\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_cosmic-control-70.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|收藏土象星座的安心节奏\|\|0 | [image](artifacts/1024-_cosmic-control-123.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|收藏窗边八次慢呼吸\|\|0 | [image](artifacts/1024-_cosmic-control-123.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|收藏今日幸运签：小事先成\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1024-_cosmic-control-123.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|收藏今日投票：专注背景声\|\|0 | [image](artifacts/1024-_cosmic-control-138.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|收藏今日投票：专注背景声\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_cosmic-control-138.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|再来一组\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_cosmic-control-162.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|再来一组\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_cosmic-control-162.png) |
| P1 | /cosmic / 1024 | control-overlap | BUTTON\|\|再来一组\|\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_cosmic-control-162.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|打开太阳星座代表什么\|\|0 | [image](artifacts/1024-_cosmic-control-196.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|打开推荐测试：专注入口\|\|0 | [image](artifacts/1024-_cosmic-control-196.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|打开今日幸运签：看见终点\|\|0 | [image](artifacts/1024-_cosmic-control-196.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|打开今日投票：完成后的奖励\|\|0 | [image](artifacts/1024-_cosmic-control-183.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|打开火象星座怎样充电\|\|0 | [image](artifacts/1024-_cosmic-control-183.png) |
| P1 | /cosmic / 1024 | control-occluded | BUTTON\|\|打开日周月年怎样看\|\|0 | [image](artifacts/1024-_cosmic-control-183.png) |
| P2 | /history / 1024 | selected-tab-semantics | 全部: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_history.png) |
| P2 | /history / 1024 | selected-tab-semantics | 近 30 天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_history.png) |
| P1 | /skills / 1024 | control-occluded | INPUT\|searchbox\|搜索技能\|\|0 | [image](artifacts/1024-_experts-control-67.png) |
| P1 | /skills / 1024 | control-occluded | DIV\|menuitem\|自动匹配\|\|0 | [image](artifacts/1024-_experts-control-67.png) |
| P1 | /skills / 1024 | control-occluded | DIV\|menuitem\|数据报告解读\|\|0 | [image](artifacts/1024-_experts-control-57.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|tab\|关注股票\|\|0 | [image](artifacts/1024-_stocks-control-96.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1024-_stocks-control-96.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1024-_stocks-control-96.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|tab\|交易日简报\|\|0 | [image](artifacts/1024-_stocks-control-96.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / BUTTON\|tab\|关注股票\|\|0 | [image](artifacts/1024-_stocks-control-89.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|刷新风险雷达\|\|0 | [image](artifacts/1024-_stocks-control-36.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|刷新风险雷达\|\|0 | [image](artifacts/1024-_stocks-control-36.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|基于 10/09 生成交易日复盘\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|基于 10/09 生成交易日复盘\|\|0 | [image](artifacts/1024-_stocks-control-37.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|上证指数 3300.00+0.50%\|\|0 / BUTTON\|\|选择研究范围\|\|0 | [image](artifacts/1024-_stocks-control-47.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|上证指数 3300.00+0.50%\|\|0 / BUTTON\|\|选择时间范围\|\|0 | [image](artifacts/1024-_stocks-control-47.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|tab\|关注股票\|\|0 | [image](artifacts/1024-_stocks-control-47.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1024-_stocks-control-47.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1024-_stocks-control-47.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|tab\|交易日简报\|\|0 | [image](artifacts/1024-_stocks-control-47.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|添加本地资料\|\|0 | [image](artifacts/1024-_stocks-control-89.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|已开启引用来源，点击关闭\|\|0 | [image](artifacts/1024-_stocks-control-89.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|选择输出内容\|\|0 | [image](artifacts/1024-_stocks-control-89.png) |
| P1 | /stocks / 1024 | control-occluded | SUMMARY\|\|研究建议\|\|0 | [image](artifacts/1024-_stocks-control-89.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|添加本地资料\|\|0 / BUTTON\|\|基于 10/09 生成交易日复盘\|\|1 | [image](artifacts/1024-_stocks-control-89.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|已开启引用来源，点击关闭\|\|0 / BUTTON\|\|基于 10/09 生成交易日复盘\|\|1 | [image](artifacts/1024-_stocks-control-89.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择输出内容\|\|0 / BUTTON\|\|哪些股票存在已核验的风险信号？\|\|0 | [image](artifacts/1024-_stocks-control-89.png) |
| P1 | /stocks / 1024 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|分析 600519 的风险点\|\|0 | [image](artifacts/1024-_stocks-control-89.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|排除ST，市盈率低于30，资产负债率低于50%\|\|0 | [image](artifacts/1024-_stocks-control-233.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|近三年持续盈利，ROE高于10%，近期无减持\|\|0 | [image](artifacts/1024-_stocks-control-233.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|刷新选股偏好\|\|0 | [image](artifacts/1024-_stocks-control-149.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|暂停画像\|\|0 | [image](artifacts/1024-_stocks-control-149.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|调整画像\|\|0 | [image](artifacts/1024-_stocks-control-149.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / BUTTON\|\|排除ST，市盈率低于30，资产负债率低于50%\|\|0 | [image](artifacts/1024-_stocks-control-149.png) |
| P1 | /stocks / 1024 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|刷新选股偏好\|\|0 | [image](artifacts/1024-_stocks-control-149.png) |
| P1 | /stocks / 1024 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|暂停画像\|\|0 | [image](artifacts/1024-_stocks-control-149.png) |
| P1 | /stocks / 1024 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|调整画像\|\|0 | [image](artifacts/1024-_stocks-control-149.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|查看更多新闻\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|自选股新闻 1\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|重要公告 0\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|A股要闻 0\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|美股要闻 0\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|港股要闻 0\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|展开编辑\|\|0 / BUTTON\|\|查看更多新闻\|\|0 | [image](artifacts/1024-_stocks-control-57.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|提交股市任务\|\|0 / BUTTON\|\|查看更多新闻\|\|0 | [image](artifacts/1024-_stocks-control-57.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|查看风险证据\|\|1 | [image](artifacts/1024-_stocks-control-101.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|打开选股与偏好\|\|0 | [image](artifacts/1024-_stocks-control-121.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|自选股新闻 1\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|重要公告 0\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|A股要闻 0\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|美股要闻 0\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|港股要闻 0\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|上一页动态\|\|0 | [image](artifacts/1024-_stocks-control-60.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|正在加载\|\|0 | [image](artifacts/1024-_stocks-control-60.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|查看第 1 页动态\|\|0 | [image](artifacts/1024-_stocks-control-60.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|下一页动态\|\|0 | [image](artifacts/1024-_stocks-control-60.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|上一页动态\|\|0 | [image](artifacts/1024-_stocks-control-60.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|正在加载\|\|0 | [image](artifacts/1024-_stocks-control-60.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|查看第 1 页动态\|\|0 | [image](artifacts/1024-_stocks-control-60.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|下一页动态\|\|0 | [image](artifacts/1024-_stocks-control-60.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|查看详情\|\|2 | [image](artifacts/1024-_stocks-control-71.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1024-_stocks-control-71.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1024-_stocks-control-71.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|查看更多新闻\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-occluded | INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1024-_stocks-control-233.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|识别条件\|\|0 | [image](artifacts/1024-_stocks-control-233.png) |
| P1 | /stocks / 1024 | control-overlap | SUMMARY\|\|研究建议\|\|0 / INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1024-_stocks-control-96.png) |
| P1 | /stocks / 1024 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|识别条件\|\|0 | [image](artifacts/1024-_stocks-control-96.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1024-_stocks-control-233.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|添加本地资料\|\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|已开启引用来源，点击关闭\|\|0 / BUTTON\|\|自选股新闻 1\|\|0 | [image](artifacts/1024-_stocks-control-111.png) |
| P1 | /stocks / 1024 | control-occluded | ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|添加本地资料\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|已开启引用来源，点击关闭\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择输出内容\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | SUMMARY\|\|研究建议\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|基于 10/09 生成交易日复盘\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|基于 10/09 生成交易日复盘\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_stocks-control-115.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|详情\|\|0 | [image](artifacts/1024-_stocks-control-121.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|查看详情\|\|0 | [image](artifacts/1024-_stocks-control-121.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|详情\|\|0 | [image](artifacts/1024-_stocks-control-121.png) |
| P1 | /stocks / 1024 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|查看详情\|\|0 | [image](artifacts/1024-_stocks-control-121.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|打开选股与偏好\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_stocks-control-121.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|打开选股与偏好\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_stocks-control-121.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|涨幅榜\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|跌幅榜\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|成交额榜\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|当前 AkShare 可达源暂缺换手率字段\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|\|查看详情\|\|1 | [image](artifacts/1024-_stocks-control-123.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|收起输入框\|\|0 / BUTTON\|\|查看详情\|\|1 | [image](artifacts/1024-_stocks-control-123.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / BUTTON\|\|涨幅榜\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / BUTTON\|\|跌幅榜\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / BUTTON\|\|成交额榜\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / BUTTON\|\|当前 AkShare 可达源暂缺换手率字段\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|添加本地资料\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|已开启引用来源，点击关闭\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择输出内容\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1024-_stocks-control-124.png) |
| P1 | /stocks / 1024 | dead-control | INPUT: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_stocks-control-182.png) |
| P2 | /files / 1024 | unexplained-text-truncation | 已加载 2 个文件 | [image](artifacts/1024-_files.png) |
| P2 | /video / 1024 | unexplained-text-truncation | 告诉 HOLA DAY 你的重点 | [image](artifacts/1024-_video.png) |
| P1 | /video / 1024 | control-occluded | BUTTON\|\|细节特写\|\|0 | [image](artifacts/1024-_video-control-56.png) |
| P1 | /video / 1024 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_video-control-56.png) |
| P1 | /video / 1024 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_video-control-56.png) |
| P1 | /video / 1024 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_video-control-56.png) |
| P1 | /video / 1024 | control-overlap | BUTTON\|\|上传一位真人或写实虚构人物的清晰照片；当前模型仅支持单人换单人，取景和身体比例相近；暂不支持宠物、物体或多人替换。\|\|0 / BUTTON\|\|移除主角照片\|\|0 | [image](artifacts/1024-_video-control-64.png) |
| P2 | /video / 1024 | unexplained-truncation | BUTTON\|\|光影氛围\|\|0 | [image](artifacts/1024-_video-control-106.png) |
| P2 | /video / 1024 | unexplained-truncation | BUTTON\|\|细节特写\|\|0 | [image](artifacts/1024-_video-control-90.png) |
| P1 | /video / 1024 | control-occluded | BUTTON\|\|氛围 / 光感 / 色彩 随机\|\|0 | [image](artifacts/1024-_video-control-115.png) |
| P1 | /video / 1024 | dead-control | 氛围风格基调: no observable effect | [image](artifacts/1024-_video-control-127.png) |
| P1 | /video/edit/:projectId / 1024 | console-error | Failed to load resource: the server responded with a status of 403 (Forbidden) | [image](artifacts/1024-_video_edit_projectId.png) |
| P1 | /image / 1024 | control-overlap | TEXTAREA\|\|描述你想要的最终画面\|\|0 / BUTTON\|\|准备生成\|\|0 | [image](artifacts/1024-_image-control-114.png) |
| P2 | /image / 1024 | unexplained-truncation | BUTTON\|\|自然光影\|\|0 | [image](artifacts/1024-_image-control-70.png) |
| P1 | /planned / 1024 | control-occluded | BUTTON\|\|旧任务记录\|\|0 | [image](artifacts/1024-_planned-control-188.png) |
| P1 | /planned / 1024 | dead-control | 旧任务记录: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_planned-control-34.png) |
| P1 | /planned / 1024 | dead-control | 今天: no observable effect | [image](artifacts/1024-_planned-control-40.png) |
| P2 | /planned / 1024 | selected-tab-semantics | 9 每日测试计划 18:00 重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_planned.png) |
| P1 | /planned / 1024 | dead-control | 日期: no observable effect | [image](artifacts/1024-_planned-control-127.png) |
| P1 | /planned / 1024 | control-occluded | BUTTON\|\|取消\|\|0 | [image](artifacts/1024-_planned-control-140.png) |
| P1 | /planned / 1024 | control-occluded | BUTTON\|\|保存规划\|\|0 | [image](artifacts/1024-_planned-control-140.png) |
| P1 | /planned / 1024 | dead-control | 结束日期: no observable effect | [image](artifacts/1024-_planned-control-180.png) |
| P2 | /planned/legacy-scheduled / 1024 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_planned_legacy-scheduled.png) |
| P2 | /planned/legacy-scheduled / 1024 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_planned_legacy-scheduled.png) |
| P2 | /planned/legacy-scheduled / 1024 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_planned_legacy-scheduled.png) |
| P1 | /planned/legacy-scheduled / 1024 | control-occluded | A\|\|UI audit\|\|0 | [image](artifacts/1024-_schedule-control-175.png) |
| P1 | /planned/legacy-batch / 1024 | dead-control | 1 任务 1 空白: no observable effect | [image](artifacts/1024-_planned_legacy-batch-control-41.png) |
| P1 | /planned/legacy-batch / 1024 | dead-control | 2 任务 2 空白: no observable effect | [image](artifacts/1024-_planned_legacy-batch-control-53.png) |
| P1 | /planned/legacy-batch / 1024 | dead-control | 2 任务 2 缺目标: no observable effect | [image](artifacts/1024-_planned_legacy-batch-control-56.png) |
| P1 | /planned/legacy-batch / 1024 | dead-control | 3 任务 3 缺目标: no observable effect | [image](artifacts/1024-_planned_legacy-batch-control-58.png) |
| P2 | /scheduled / 1024 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_scheduled.png) |
| P2 | /scheduled / 1024 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_scheduled.png) |
| P2 | /scheduled / 1024 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_scheduled.png) |
| P1 | /scheduled / 1024 | control-occluded | A\|\|UI audit\|\|0 | [image](artifacts/1024-_schedule-control-175.png) |
| P1 | /batch / 1024 | control-occluded | BUTTON\|\|旧任务记录\|\|0 | [image](artifacts/1024-_planned-control-188.png) |
| P2 | /batch / 1024 | selected-tab-semantics | 9 每日测试计划 18:00 重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_batch.png) |
| P1 | /batch / 1024 | control-occluded | BUTTON\|\|取消\|\|0 | [image](artifacts/1024-_planned-control-140.png) |
| P1 | /batch / 1024 | control-occluded | BUTTON\|\|保存规划\|\|0 | [image](artifacts/1024-_planned-control-140.png) |
| P1 | task:generate:executing / 1440 | wrong-task-browser-ui |  | [image](artifacts/1440-task_generate_executing.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1440-task_generate_executing-control-33.png) |
| P2 | task:generate:executing / 1440 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | [image](artifacts/1440-task_generate_executing-control-60.png) |
| P2 | task:generate:executing / 1440 | selected-tab-semantics | 手机登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-task_generate_executing.png) |
| P2 | task:generate:completed / 1440 | known-4-alarming-verification-copy |  | [image](artifacts/1440-task_generate_completed.png) |
| P1 | task:generate:failed / 1440 | wrong-task-browser-ui |  | [image](artifacts/1440-task_generate_failed.png) |
| P1 | task:generate:cancelled / 1440 | wrong-task-browser-ui |  | [image](artifacts/1440-task_generate_cancelled.png) |
| P2 | task:browser:executing / 1440 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1440-task_browser_executing-control-68.png) |
| P2 | task:browser:completed / 1440 | known-4-alarming-verification-copy |  | [image](artifacts/1440-task_browser_completed.png) |
| P2 | task:browser:completed / 1440 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1440-task_browser_completed-control-74.png) |
| P2 | task:browser:failed / 1440 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1440-task_browser_failed-control-77.png) |
| P2 | task:browser:awaiting_user / 1440 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1440-task_browser_awaiting_user-control-67.png) |
| P1 | task:browser:cancelled / 1440 | control-overlap | BUTTON\|\|详细步骤，12/12 步完成\|\|0 / TEXTAREA\|\|补充问题或下一步指令...\|\|0 | [image](artifacts/1440-task_browser_cancelled-control-75.png) |
| P2 | task:browser:cancelled / 1440 | unexplained-truncation | INPUT\|\|浏览器地址栏 (Enter 跳转, Esc 还原)\|\|0 | [image](artifacts/1440-task_browser_cancelled-control-76.png) |
| P1 | task:scrape:executing / 1440 | wrong-task-browser-ui |  | [image](artifacts/1440-task_scrape_executing.png) |
| P2 | task:scrape:executing / 1440 | known-5-raw-provider-label |  | [image](artifacts/1440-task_scrape_executing.png) |
| P2 | task:scrape:completed / 1440 | known-4-alarming-verification-copy |  | [image](artifacts/1440-task_scrape_completed.png) |
| P2 | task:scrape:completed / 1440 | known-5-raw-provider-label |  | [image](artifacts/1440-task_scrape_completed.png) |
| P1 | task:scrape:completed / 1440 | control-overlap | BUTTON\|\|复制纯文本结果\|\|0 / TEXTAREA\|\|补充问题或下一步指令...\|\|0 | [image](artifacts/1440-task_scrape_completed-control-37.png) |
| P1 | task:scrape:completed / 1440 | control-overlap | BUTTON\|\|打开更多结果操作\|\|0 / TEXTAREA\|\|补充问题或下一步指令...\|\|0 | [image](artifacts/1440-task_scrape_completed-control-37.png) |
| P1 | task:scrape:failed / 1440 | wrong-task-browser-ui |  | [image](artifacts/1440-task_scrape_failed.png) |
| P2 | task:scrape:failed / 1440 | known-5-raw-provider-label |  | [image](artifacts/1440-task_scrape_failed.png) |
| P2 | task:scrape:awaiting_user / 1440 | known-5-raw-provider-label |  | [image](artifacts/1440-task_scrape_awaiting_user.png) |
| P1 | task:scrape:cancelled / 1440 | wrong-task-browser-ui |  | [image](artifacts/1440-task_scrape_cancelled.png) |
| P2 | task:scrape:cancelled / 1440 | known-5-raw-provider-label |  | [image](artifacts/1440-task_scrape_cancelled.png) |
| P1 | task:image:executing / 1440 | wrong-task-browser-ui |  | [image](artifacts/1440-task_image_executing.png) |
| P2 | task:image:completed / 1440 | known-4-alarming-verification-copy |  | [image](artifacts/1440-task_image_completed.png) |
| P1 | task:image:failed / 1440 | wrong-task-browser-ui |  | [image](artifacts/1440-task_image_failed.png) |
| P1 | task:image:cancelled / 1440 | wrong-task-browser-ui |  | [image](artifacts/1440-task_image_cancelled.png) |
| P2 | /login / 1440 | selected-tab-semantics | 手机登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_login.png) |
| P2 | /register / 1440 | selected-tab-semantics | 密码登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_register.png) |
| P2 | /cosmic-preview / 1440 | unexplained-text-truncation | 依次找出眼前五种颜色、四种触感和三种声音，让注意力从纷乱想法回到真实环境。 | [image](artifacts/1440-_cosmic-preview.png) |
| P2 | /cosmic-preview / 1440 | unexplained-text-truncation | 如果任务很多却很难开始，用五个问题找出注意力最容易安定的位置，再带走一个小动作。 | [image](artifacts/1440-_cosmic-preview.png) |
| P2 | /cosmic-preview / 1440 | unexplained-text-truncation | 用不到一分钟接住十二颗能量光点，让注意力从等待和焦虑里暂时转向简单、即时的反馈。 | [image](artifacts/1440-_cosmic-preview.png) |
| P2 | /tasks / 1440 | selected-tab-semantics | 全部: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_tasks.png) |
| P2 | /tasks / 1440 | selected-tab-semantics | 近 30 天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_tasks.png) |
| P2 | /schedule / 1440 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_schedule.png) |
| P2 | /schedule / 1440 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_schedule.png) |
| P2 | /schedule / 1440 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_schedule.png) |
| P1 | /schedule / 1440 | dead-control | 删除定时任务: opened popup cannot dismiss with Escape | [image](artifacts/1440-_schedule-control-177.png) |
| P2 | /calendar / 1440 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_calendar.png) |
| P2 | /calendar / 1440 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_calendar.png) |
| P2 | /calendar / 1440 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_calendar.png) |
| P1 | /experts / 1440 | control-occluded | INPUT\|searchbox\|搜索技能\|\|0 | [image](artifacts/1440-_experts-control-67.png) |
| P1 | /experts / 1440 | control-occluded | DIV\|menuitem\|自动匹配\|\|0 | [image](artifacts/1440-_experts-control-67.png) |
| P1 | /experts / 1440 | control-occluded | DIV\|menuitem\|数据报告解读\|\|0 | [image](artifacts/1440-_experts-control-57.png) |
| P1 | /experts / 1440 | dead-control | 自动匹配: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1440-_experts-control-68.png) |
| P1 | /experts / 1440 | dead-control | 数据报告解读: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1440-_experts-control-69.png) |
| P1 | /plugins / 1440 | control-occluded | INPUT\|searchbox\|搜索技能\|\|0 | [image](artifacts/1440-_experts-control-67.png) |
| P1 | /plugins / 1440 | control-occluded | DIV\|menuitem\|自动匹配\|\|0 | [image](artifacts/1440-_experts-control-67.png) |
| P1 | /plugins / 1440 | control-occluded | DIV\|menuitem\|数据报告解读\|\|0 | [image](artifacts/1440-_experts-control-57.png) |
| P1 | /settings/appearance / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_appearance-control-83.png) |
| P2 | /settings/appearance / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings_appearance.png) |
| P1 | /settings/appearance / 1440 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1440-_settings_appearance-control-55.png) |
| P2 | /settings/appearance / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_appearance.png) |
| P1 | /settings/api-keys / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_api-keys-control-83.png) |
| P2 | /settings/api-keys / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings_api-keys.png) |
| P1 | /settings/api-keys / 1440 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1440-_settings_api-keys-control-55.png) |
| P2 | /settings/api-keys / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_api-keys.png) |
| P1 | /settings/memory / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_memory-control-83.png) |
| P2 | /settings/memory / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings_memory.png) |
| P1 | /settings/memory / 1440 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1440-_settings_memory-control-55.png) |
| P2 | /settings/memory / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_memory.png) |
| P1 | /settings/notifications / 1440 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings_notifications-control-82.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings_notifications-control-82.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_notifications-control-83.png) |
| P2 | /settings/notifications / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings_notifications.png) |
| P1 | /settings/notifications / 1440 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1440-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1440 | control-occluded | BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1440-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1440-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1440-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1440 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1440-_settings_notifications-control-55.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|取消\|\|0 | [image](artifacts/1440-_settings_notifications-control-64.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|外观\|/settings#appearance\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-65.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-65.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|数据区域\|/settings#model-region\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-65.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|API Key\|/settings#api-keys\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-65.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|浏览器数据\|/settings#browser-data\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-65.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|AI 记忆\|/settings#memory\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-65.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|通知\|/settings#notifications\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-65.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-65.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_notifications-control-65.png) |
| P2 | /settings/notifications / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_notifications.png) |
| P1 | /settings/account / 1440 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings_account-control-82.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings_account-control-82.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_account-control-83.png) |
| P2 | /settings/account / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings_account.png) |
| P1 | /settings/account / 1440 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1440-_settings_account-control-50.png) |
| P1 | /settings/account / 1440 | control-occluded | BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1440-_settings_account-control-50.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1440-_settings_account-control-50.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1440-_settings_account-control-50.png) |
| P1 | /settings/account / 1440 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1440-_settings_account-control-55.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|取消\|\|0 | [image](artifacts/1440-_settings_account-control-64.png) |
| P2 | /settings/account / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_account.png) |
| P2 | /admin/finance / 1440 | selected-tab-semantics | 营收明细: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_admin_finance.png) |
| P2 | /admin/learning / 1440 | selected-tab-semantics | 全部: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_admin_learning.png) |
| P2 | /settings / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings-control-83.png) |
| P1 | /settings / 1440 | control-occluded | BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1440-_settings-control-50.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1440-_settings-control-50.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1440-_settings-control-50.png) |
| P1 | /settings / 1440 | dead-control | 每日 A股简报: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1440-_settings-control-55.png) |
| P1 | /settings / 1440 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings-control-80.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings-control-80.png) |
| P2 | /settings / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings.png) |
| P2 | /plan / 1440 | selected-tab-semantics | 按月: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_plan.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|做一个轻测试\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1440-_cosmic-control-178.png) |
| P2 | /cosmic / 1440 | unexplained-text-truncation | 今天的好运更像一个容易完成的小步骤，先让一件事情顺利结束，再带着这股轻盈继续。 | [image](artifacts/1440-_cosmic.png) |
| P2 | /cosmic / 1440 | unexplained-text-truncation | 太阳星座更接近你主动发展和表达自我的方向，它是认识自己的入口，而不是限制性格的标签。 | [image](artifacts/1440-_cosmic.png) |
| P2 | /cosmic / 1440 | unexplained-text-truncation | 如果任务很多却很难开始，用五个问题找出注意力最容易安定的位置，再带走一个小动作。 | [image](artifacts/1440-_cosmic.png) |
| P2 | /cosmic / 1440 | unexplained-text-truncation | 开始前先写清怎样算完成，明确的终点会减少无谓打磨，也让今天更容易获得成就感。 | [image](artifacts/1440-_cosmic.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|做一个轻测试\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_cosmic-control-160.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|做一个轻测试\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1440-_cosmic-control-160.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|做一个轻测试\|\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1440-_cosmic-control-160.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|测个相关主题\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1440-_cosmic-control-115.png) |
| P1 | /cosmic / 1440 | control-occluded | A\|\|回到星座补给开头\|#energy-astrology-world-title\|0 | [image](artifacts/1440-_cosmic-control-53.png) |
| P1 | /cosmic / 1440 | control-occluded | BUTTON\|\|收藏土象星座的安心节奏\|\|0 | [image](artifacts/1440-_cosmic-control-54.png) |
| P1 | /cosmic / 1440 | control-occluded | BUTTON\|\|收藏窗边八次慢呼吸\|\|0 | [image](artifacts/1440-_cosmic-control-54.png) |
| P1 | /cosmic / 1440 | control-occluded | BUTTON\|\|收藏今日幸运签：小事先成\|\|0 | [image](artifacts/1440-_cosmic-control-70.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|收藏今日幸运签：小事先成\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1440-_cosmic-control-54.png) |
| P1 | /cosmic / 1440 | control-occluded | BUTTON\|\|收藏太阳星座代表什么\|\|0 | [image](artifacts/1440-_cosmic-control-64.png) |
| P1 | /cosmic / 1440 | control-occluded | BUTTON\|\|收藏推荐测试：专注入口\|\|0 | [image](artifacts/1440-_cosmic-control-64.png) |
| P1 | /cosmic / 1440 | control-occluded | BUTTON\|\|收藏今日幸运签：看见终点\|\|0 | [image](artifacts/1440-_cosmic-control-64.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|测个相关主题\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_cosmic-control-64.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|测个相关主题\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1440-_cosmic-control-64.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|收藏今日幸运签：看见终点\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1440-_cosmic-control-64.png) |
| P1 | /cosmic / 1440 | control-occluded | BUTTON\|tab\|最近玩过 0\|\|0 | [image](artifacts/1440-_cosmic-control-138.png) |
| P1 | /cosmic / 1440 | control-occluded | BUTTON\|tab\|我的收藏 0\|\|0 | [image](artifacts/1440-_cosmic-control-138.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|收藏今日幸运签：小事先成\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1440-_cosmic-control-70.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|tab\|我的收藏 0\|\|0 / BUTTON\|\|返回任务处理\|\|0 | [image](artifacts/1440-_cosmic-control-138.png) |
| P1 | /cosmic / 1440 | control-occluded | BUTTON\|\|收藏今日投票：专注背景声\|\|0 | [image](artifacts/1440-_cosmic-control-138.png) |
| P1 | /cosmic / 1440 | control-overlap | BUTTON\|\|收藏今日投票：专注背景声\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1440-_cosmic-control-138.png) |
| P2 | /history / 1440 | selected-tab-semantics | 全部: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_history.png) |
| P2 | /history / 1440 | selected-tab-semantics | 近 30 天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_history.png) |
| P1 | /skills / 1440 | control-occluded | INPUT\|searchbox\|搜索技能\|\|0 | [image](artifacts/1440-_experts-control-67.png) |
| P1 | /skills / 1440 | control-occluded | DIV\|menuitem\|自动匹配\|\|0 | [image](artifacts/1440-_experts-control-67.png) |
| P1 | /skills / 1440 | control-occluded | DIV\|menuitem\|数据报告解读\|\|0 | [image](artifacts/1440-_experts-control-57.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1440-_stocks-control-96.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1440-_stocks-control-96.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|tab\|交易日简报\|\|0 | [image](artifacts/1440-_stocks-control-96.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1440-_stocks-control-96.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|基于 10/09 生成交易日复盘\|\|0 | [image](artifacts/1440-_stocks-control-111.png) |
| P1 | /stocks / 1440 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|基于 10/09 生成交易日复盘\|\|0 | [image](artifacts/1440-_stocks-control-56.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|移除ui.png\|\|0 / BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1440-_stocks-control-85.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|上证指数 3300.00+0.50%\|\|0 / BUTTON\|\|选择研究范围\|\|0 | [image](artifacts/1440-_stocks-control-47.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|上证指数 3300.00+0.50%\|\|0 / BUTTON\|\|选择时间范围\|\|0 | [image](artifacts/1440-_stocks-control-47.png) |
| P1 | /stocks / 1440 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1440-_stocks-control-47.png) |
| P1 | /stocks / 1440 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|tab\|交易日简报\|\|0 | [image](artifacts/1440-_stocks-control-47.png) |
| P1 | /stocks / 1440 | control-occluded | SUMMARY\|\|研究建议\|\|0 | [image](artifacts/1440-_stocks-control-89.png) |
| P1 | /stocks / 1440 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|基于 10/09 生成交易日复盘\|\|1 | [image](artifacts/1440-_stocks-control-89.png) |
| P1 | /stocks / 1440 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|哪些股票存在已核验的风险信号？\|\|0 | [image](artifacts/1440-_stocks-control-89.png) |
| P1 | /stocks / 1440 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|查看 AI 板块已核验信息\|\|0 | [image](artifacts/1440-_stocks-control-89.png) |
| P1 | /stocks / 1440 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|分析 600519 的风险点\|\|0 | [image](artifacts/1440-_stocks-control-89.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|排除ST，市盈率低于30，资产负债率低于50%\|\|0 | [image](artifacts/1440-_stocks-control-233.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|近三年持续盈利，ROE高于10%，近期无减持\|\|0 | [image](artifacts/1440-_stocks-control-233.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|刷新选股偏好\|\|0 | [image](artifacts/1440-_stocks-control-233.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|暂停画像\|\|0 | [image](artifacts/1440-_stocks-control-233.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / BUTTON\|\|排除ST，市盈率低于30，资产负债率低于50%\|\|0 | [image](artifacts/1440-_stocks-control-233.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / BUTTON\|\|近三年持续盈利，ROE高于10%，近期无减持\|\|0 | [image](artifacts/1440-_stocks-control-233.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|展开编辑\|\|0 / BUTTON\|\|刷新选股偏好\|\|0 | [image](artifacts/1440-_stocks-control-233.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|提交股市任务\|\|0 / BUTTON\|\|暂停画像\|\|0 | [image](artifacts/1440-_stocks-control-233.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|自选股新闻 1\|\|0 | [image](artifacts/1440-_stocks-control-101.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|重要公告 0\|\|0 | [image](artifacts/1440-_stocks-control-101.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|A股要闻 0\|\|0 | [image](artifacts/1440-_stocks-control-101.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|美股要闻 0\|\|0 | [image](artifacts/1440-_stocks-control-101.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|港股要闻 0\|\|0 | [image](artifacts/1440-_stocks-control-101.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|管理列表\|\|0 | [image](artifacts/1440-_stocks-control-101.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|添加本地资料\|\|0 / BUTTON\|\|自选股新闻 1\|\|0 | [image](artifacts/1440-_stocks-control-101.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|已开启引用来源，点击关闭\|\|0 / BUTTON\|\|重要公告 0\|\|0 | [image](artifacts/1440-_stocks-control-101.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择输出内容\|\|0 / BUTTON\|\|A股要闻 0\|\|0 | [image](artifacts/1440-_stocks-control-101.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|管理列表\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1440-_stocks-control-101.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|查看第 1 页动态\|\|0 | [image](artifacts/1440-_stocks-control-60.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1440-_stocks-control-115.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1440-_stocks-control-115.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1440-_stocks-control-115.png) |
| P1 | /stocks / 1440 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|查看第 1 页动态\|\|0 | [image](artifacts/1440-_stocks-control-60.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1440-_stocks-control-124.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1440-_stocks-control-124.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1440-_stocks-control-124.png) |
| P1 | /stocks / 1440 | control-occluded | INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1440-_stocks-control-98.png) |
| P1 | /stocks / 1440 | control-overlap | SUMMARY\|\|研究建议\|\|0 / INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1440-_stocks-control-96.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择研究范围\|\|0 / INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1440-_stocks-control-98.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择时间范围\|\|0 / INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1440-_stocks-control-98.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|收起输入框\|\|0 / INPUT\|\|例如：排除 ST，市盈率低于 30，近三年持续盈利\|\|0 | [image](artifacts/1440-_stocks-control-98.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / BUTTON\|\|排除ST，市盈率低于30，资产负债率低于50%\|\|0 | [image](artifacts/1440-_stocks-control-98.png) |
| P1 | /stocks / 1440 | control-overlap | SUMMARY\|\|研究建议\|\|0 / BUTTON\|\|基于 10/09 生成交易日复盘\|\|0 | [image](artifacts/1440-_stocks-control-111.png) |
| P1 | /stocks / 1440 | control-occluded | ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1440-_stocks-control-115.png) |
| P1 | /stocks / 1440 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1440-_stocks-control-115.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|添加本地资料\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1440-_stocks-control-115.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|已开启引用来源，点击关闭\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1440-_stocks-control-115.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择输出内容\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1440-_stocks-control-115.png) |
| P1 | /stocks / 1440 | control-overlap | SUMMARY\|\|研究建议\|\|0 / ARTICLE\|button\|新闻 10:00 与你的关注相关 本地市场测试新闻 东方财富 · 1 个关联\|\|0 | [image](artifacts/1440-_stocks-control-115.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|打开选股与偏好\|\|0 | [image](artifacts/1440-_stocks-control-121.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|详情\|\|0 | [image](artifacts/1440-_stocks-control-121.png) |
| P1 | /stocks / 1440 | control-overlap | TEXTAREA\|\|交代股市研究任务\|\|0 / BUTTON\|\|详情\|\|0 | [image](artifacts/1440-_stocks-control-121.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|打开选股与偏好\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_stocks-control-121.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|打开选股与偏好\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1440-_stocks-control-121.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|成交额榜\|\|0 | [image](artifacts/1440-_stocks-control-123.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|\|当前 AkShare 可达源暂缺换手率字段\|\|0 | [image](artifacts/1440-_stocks-control-123.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|添加本地资料\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1440-_stocks-control-123.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|已开启引用来源，点击关闭\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1440-_stocks-control-123.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择输出内容\|\|0 / BUTTON\|\|查看全部榜单\|\|0 | [image](artifacts/1440-_stocks-control-123.png) |
| P1 | /stocks / 1440 | dead-control | INPUT: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1440-_stocks-control-182.png) |
| P2 | /files / 1440 | unexplained-text-truncation | 已加载 2 个文件 | [image](artifacts/1440-_files.png) |
| P2 | /video / 1440 | unexplained-text-truncation | 告诉 HOLA DAY 你的重点 | [image](artifacts/1440-_video.png) |
| P2 | /video / 1440 | unexplained-truncation | BUTTON\|\|产品短片\|\|0 | [image](artifacts/1440-_video-control-80.png) |
| P1 | /video / 1440 | control-occluded | BUTTON\|\|细节特写\|\|0 | [image](artifacts/1440-_video-control-56.png) |
| P1 | /video / 1440 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_video-control-56.png) |
| P1 | /video / 1440 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1440-_video-control-56.png) |
| P1 | /video / 1440 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1440-_video-control-56.png) |
| P1 | /video / 1440 | control-overlap | BUTTON\|\|上传一位真人或写实虚构人物的清晰照片；当前模型仅支持单人换单人，取景和身体比例相近；暂不支持宠物、物体或多人替换。\|\|0 / BUTTON\|\|移除主角照片\|\|0 | [image](artifacts/1440-_video-control-64.png) |
| P1 | /video / 1440 | control-occluded | BUTTON\|\|全部\|\|0 | [image](artifacts/1440-_video-control-66.png) |
| P1 | /video / 1440 | control-occluded | BUTTON\|\|最近\|\|0 | [image](artifacts/1440-_video-control-66.png) |
| P1 | /video / 1440 | control-occluded | BUTTON\|\|置顶\|\|0 | [image](artifacts/1440-_video-control-66.png) |
| P2 | /video / 1440 | unexplained-truncation | BUTTON\|\|光影氛围\|\|0 | [image](artifacts/1440-_video-control-106.png) |
| P1 | /video / 1440 | dead-control | 氛围风格基调: no observable effect | [image](artifacts/1440-_video-control-127.png) |
| P1 | /video/edit/:projectId / 1440 | console-error | Failed to load resource: the server responded with a status of 403 (Forbidden) | [image](artifacts/1440-_video_edit_projectId.png) |
| P1 | /image / 1440 | control-overlap | TEXTAREA\|\|描述你想要的最终画面\|\|0 / BUTTON\|\|准备生成\|\|0 | [image](artifacts/1440-_image-control-114.png) |
| P2 | /image / 1440 | unexplained-truncation | BUTTON\|\|自然光影\|\|0 | [image](artifacts/1440-_image-control-41.png) |
| P2 | /image / 1440 | unexplained-truncation | BUTTON\|\|商品棚拍\|\|0 | [image](artifacts/1440-_image-control-70.png) |
| P1 | /planned / 1440 | control-occluded | BUTTON\|\|旧任务记录\|\|0 | [image](artifacts/1440-_planned-control-188.png) |
| P1 | /planned / 1440 | dead-control | 旧任务记录: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1440-_planned-control-34.png) |
| P1 | /planned / 1440 | dead-control | 今天: no observable effect | [image](artifacts/1440-_planned-control-40.png) |
| P2 | /planned / 1440 | selected-tab-semantics | 9 每日测试计划 18:00 重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_planned.png) |
| P1 | /planned / 1440 | dead-control | 日期: no observable effect | [image](artifacts/1440-_planned-control-127.png) |
| P1 | /planned / 1440 | control-occluded | BUTTON\|\|取消\|\|0 | [image](artifacts/1440-_planned-control-140.png) |
| P1 | /planned / 1440 | control-occluded | BUTTON\|\|保存规划\|\|0 | [image](artifacts/1440-_planned-control-140.png) |
| P1 | /planned / 1440 | dead-control | 结束日期: no observable effect | [image](artifacts/1440-_planned-control-180.png) |
| P2 | /planned/legacy-scheduled / 1440 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_planned_legacy-scheduled.png) |
| P2 | /planned/legacy-scheduled / 1440 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_planned_legacy-scheduled.png) |
| P2 | /planned/legacy-scheduled / 1440 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_planned_legacy-scheduled.png) |
| P1 | /planned/legacy-batch / 1440 | dead-control | 1 任务 1 空白: no observable effect | [image](artifacts/1440-_planned_legacy-batch-control-41.png) |
| P1 | /planned/legacy-batch / 1440 | dead-control | 2 任务 2 空白: no observable effect | [image](artifacts/1440-_planned_legacy-batch-control-53.png) |
| P1 | /planned/legacy-batch / 1440 | dead-control | 2 任务 2 缺目标: no observable effect | [image](artifacts/1440-_planned_legacy-batch-control-56.png) |
| P1 | /planned/legacy-batch / 1440 | dead-control | 3 任务 3 缺目标: no observable effect | [image](artifacts/1440-_planned_legacy-batch-control-58.png) |
| P2 | /scheduled / 1440 | selected-tab-semantics | 每天: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_scheduled.png) |
| P2 | /scheduled / 1440 | selected-tab-semantics | 不提醒: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_scheduled.png) |
| P2 | /scheduled / 1440 | selected-tab-semantics | 不重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_scheduled.png) |
| P1 | /batch / 1440 | control-occluded | BUTTON\|\|旧任务记录\|\|0 | [image](artifacts/1440-_planned-control-188.png) |
| P2 | /batch / 1440 | selected-tab-semantics | 9 每日测试计划 18:00 重复: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_batch.png) |
| P1 | /batch / 1440 | control-occluded | BUTTON\|\|取消\|\|0 | [image](artifacts/1440-_planned-control-140.png) |
| P1 | /batch / 1440 | control-occluded | BUTTON\|\|保存规划\|\|0 | [image](artifacts/1440-_planned-control-140.png) |

## Coverage gaps


## Page and control coverage

| Route | Width | Total | Passed / shared / disabled / protocol / uncovered / failed | Screenshot |
| --- | --- | --- | --- | --- | --- |
| task:generate:executing | 1280 | 134 | 121 / 8 / 5 / 0 / 0 / 0 | [image](artifacts/1280-task_generate_executing.png) |
| task:generate:completed | 1280 | 47 | 10 / 36 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_generate_completed.png) |
| task:generate:failed | 1280 | 46 | 9 / 36 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_generate_failed.png) |
| task:generate:awaiting_user | 1280 | 40 | 3 / 36 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_generate_awaiting_user.png) |
| task:generate:cancelled | 1280 | 42 | 5 / 36 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_generate_cancelled.png) |
| task:browser:executing | 1280 | 89 | 38 / 45 / 6 / 0 / 0 / 0 | [image](artifacts/1280-task_browser_executing.png) |
| task:browser:completed | 1280 | 75 | 32 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1280-task_browser_completed.png) |
| task:browser:failed | 1280 | 78 | 35 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1280-task_browser_failed.png) |
| task:browser:awaiting_user | 1280 | 68 | 23 / 39 / 6 / 0 / 0 / 0 | [image](artifacts/1280-task_browser_awaiting_user.png) |
| task:browser:cancelled | 1280 | 77 | 32 / 39 / 6 / 0 / 0 / 0 | [image](artifacts/1280-task_browser_cancelled.png) |
| task:scrape:executing | 1280 | 47 | 8 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_scrape_executing.png) |
| task:scrape:completed | 1280 | 51 | 12 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_scrape_completed.png) |
| task:scrape:failed | 1280 | 52 | 13 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_scrape_failed.png) |
| task:scrape:awaiting_user | 1280 | 46 | 7 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_scrape_awaiting_user.png) |
| task:scrape:cancelled | 1280 | 48 | 9 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_scrape_cancelled.png) |
| task:image:executing | 1280 | 43 | 4 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_image_executing.png) |
| task:image:completed | 1280 | 49 | 11 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_image_completed.png) |
| task:image:failed | 1280 | 48 | 10 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_image_failed.png) |
| task:image:awaiting_user | 1280 | 42 | 4 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_image_awaiting_user.png) |
| task:image:cancelled | 1280 | 44 | 6 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1280-task_image_cancelled.png) |
| /account/closure-recovery | 1280 | 8 | 6 / 0 / 1 / 1 / 0 / 0 | [image](artifacts/1280-_account_closure-recovery.png) |
| /login | 1280 | 19 | 17 / 0 / 2 / 0 / 0 / 0 | [image](artifacts/1280-_login.png) |
| /register | 1280 | 21 | 18 / 0 / 3 / 0 / 0 / 0 | [image](artifacts/1280-_register.png) |
| /privacy | 1280 | 14 | 11 / 0 / 0 / 3 / 0 / 0 | [image](artifacts/1280-_privacy.png) |
| /terms | 1280 | 4 | 3 / 0 / 0 / 1 / 0 / 0 | [image](artifacts/1280-_terms.png) |
| /500 | 1280 | 4 | 3 / 0 / 0 / 1 / 0 / 0 | [image](artifacts/1280-_500.png) |
| /cosmic-preview | 1280 | 160 | 159 / 0 / 1 / 0 / 0 / 0 | [image](artifacts/1280-_cosmic-preview.png) |
| /app | 1280 | 55 | 15 / 38 / 2 / 0 / 0 / 0 | [image](artifacts/1280-_app.png) |
| /roles | 1280 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_roles.png) |
| /tasks | 1280 | 64 | 27 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_tasks.png) |
| /schedule | 1280 | 182 | 101 / 37 / 43 / 0 / 0 / 1 | [image](artifacts/1280-_schedule.png) |
| /calendar | 1280 | 182 | 0 / 182 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_calendar.png) |
| /experts | 1280 | 73 | 32 / 37 / 2 / 0 / 0 / 2 | [image](artifacts/1280-_experts.png) |
| /plugins | 1280 | 73 | 0 / 73 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_plugins.png) |
| /settings/appearance | 1280 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1280-_settings_appearance.png) |
| /settings/api-keys | 1280 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1280-_settings_api-keys.png) |
| /settings/memory | 1280 | 88 | 49 / 37 / 0 / 0 / 0 / 2 | [image](artifacts/1280-_settings_memory.png) |
| /settings/notifications | 1280 | 88 | 49 / 37 / 0 / 0 / 0 / 2 | [image](artifacts/1280-_settings_notifications.png) |
| /settings/account | 1280 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1280-_settings_account.png) |
| /admin | 1280 | 9 | 9 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_admin.png) |
| /admin/users | 1280 | 16 | 5 / 9 / 2 / 0 / 0 / 0 | [image](artifacts/1280-_admin_users.png) |
| /admin/users/:userId | 1280 | 10 | 1 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_admin_users_userId.png) |
| /admin/finance | 1280 | 14 | 4 / 9 / 1 / 0 / 0 / 0 | [image](artifacts/1280-_admin_finance.png) |
| /admin/partners | 1280 | 10 | 1 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_admin_partners.png) |
| /admin/learning | 1280 | 14 | 5 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_admin_learning.png) |
| /admin/models | 1280 | 23 | 13 / 9 / 1 / 0 / 0 / 0 | [image](artifacts/1280-_admin_models.png) |
| /admin/self-check | 1280 | 10 | 1 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_admin_self-check.png) |
| /admin/learning/:domain | 1280 | 11 | 2 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_admin_learning_domain.png) |
| / | 1280 | 55 | 0 / 55 / 0 / 0 / 0 / 0 | [image](artifacts/1280-home.png) |
| /profile | 1280 | 55 | 15 / 37 / 2 / 1 / 0 / 0 | [image](artifacts/1280-_profile.png) |
| /settings | 1280 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1280-_settings.png) |
| /settings/roles | 1280 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_settings_roles.png) |
| /partner | 1280 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_partner.png) |
| /partner/recharge | 1280 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_partner_recharge.png) |
| /partner/ledger | 1280 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_partner_ledger.png) |
| /partner/withdraw | 1280 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_partner_withdraw.png) |
| /plan | 1280 | 47 | 7 / 37 / 1 / 2 / 0 / 0 | [image](artifacts/1280-_plan.png) |
| /billing | 1280 | 46 | 6 / 37 / 0 / 3 / 0 / 0 | [image](artifacts/1280-_billing.png) |
| /usage | 1280 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_usage.png) |
| /cosmic | 1280 | 198 | 160 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1280-_cosmic.png) |
| /history | 1280 | 64 | 0 / 64 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_history.png) |
| /skills | 1280 | 73 | 0 / 73 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_skills.png) |
| /stocks | 1280 | 258 | 79 / 40 / 106 / 0 / 0 / 33 | [image](artifacts/1280-_stocks.png) |
| /stocks/discovery | 1280 | 55 | 12 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1280-_stocks_discovery.png) |
| /projects | 1280 | 58 | 19 / 37 / 2 / 0 / 0 / 0 | [image](artifacts/1280-_projects.png) |
| /projects/:projectId | 1280 | 73 | 35 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1280-_projects_projectId.png) |
| /organizations/invitations/accept | 1280 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_organizations_invitations_accept.png) |
| /starred | 1280 | 46 | 9 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_starred.png) |
| /files | 1280 | 57 | 20 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_files.png) |
| /video | 1280 | 167 | 127 / 37 / 2 / 0 / 0 / 1 | [image](artifacts/1280-_video.png) |
| /video/edit/:projectId | 1280 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_video_edit_projectId.png) |
| /image | 1280 | 115 | 77 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1280-_image.png) |
| /planned | 1280 | 189 | 144 / 37 / 2 / 0 / 0 / 6 | [image](artifacts/1280-_planned.png) |
| /planned/legacy-scheduled | 1280 | 182 | 0 / 182 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_planned_legacy-scheduled.png) |
| /planned/legacy-batch | 1280 | 61 | 15 / 38 / 4 / 0 / 0 / 4 | [image](artifacts/1280-_planned_legacy-batch.png) |
| /scheduled | 1280 | 182 | 0 / 182 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_scheduled.png) |
| /batch | 1280 | 189 | 0 / 189 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_batch.png) |
| /batch/:batchId | 1280 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_batch_batchId.png) |
| /connections | 1280 | 38 | 0 / 37 / 0 / 1 / 0 / 0 | [image](artifacts/1280-_connections.png) |
| * | 1280 | 40 | 3 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-not-found.png) |
| task:generate:executing | 1024 | 134 | 121 / 8 / 5 / 0 / 0 / 0 | [image](artifacts/1024-task_generate_executing.png) |
| task:generate:completed | 1024 | 47 | 10 / 36 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_generate_completed.png) |
| task:generate:failed | 1024 | 46 | 9 / 36 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_generate_failed.png) |
| task:generate:awaiting_user | 1024 | 40 | 3 / 36 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_generate_awaiting_user.png) |
| task:generate:cancelled | 1024 | 42 | 5 / 36 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_generate_cancelled.png) |
| task:browser:executing | 1024 | 87 | 36 / 45 / 6 / 0 / 0 / 0 | [image](artifacts/1024-task_browser_executing.png) |
| task:browser:completed | 1024 | 73 | 30 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1024-task_browser_completed.png) |
| task:browser:failed | 1024 | 76 | 33 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1024-task_browser_failed.png) |
| task:browser:awaiting_user | 1024 | 66 | 21 / 39 / 6 / 0 / 0 / 0 | [image](artifacts/1024-task_browser_awaiting_user.png) |
| task:browser:cancelled | 1024 | 75 | 30 / 39 / 6 / 0 / 0 / 0 | [image](artifacts/1024-task_browser_cancelled.png) |
| task:scrape:executing | 1024 | 47 | 8 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_scrape_executing.png) |
| task:scrape:completed | 1024 | 51 | 12 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_scrape_completed.png) |
| task:scrape:failed | 1024 | 52 | 13 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_scrape_failed.png) |
| task:scrape:awaiting_user | 1024 | 46 | 7 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_scrape_awaiting_user.png) |
| task:scrape:cancelled | 1024 | 48 | 9 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_scrape_cancelled.png) |
| task:image:executing | 1024 | 43 | 4 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_image_executing.png) |
| task:image:completed | 1024 | 49 | 11 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_image_completed.png) |
| task:image:failed | 1024 | 48 | 10 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_image_failed.png) |
| task:image:awaiting_user | 1024 | 42 | 4 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_image_awaiting_user.png) |
| task:image:cancelled | 1024 | 44 | 6 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1024-task_image_cancelled.png) |
| /account/closure-recovery | 1024 | 8 | 6 / 0 / 1 / 1 / 0 / 0 | [image](artifacts/1024-_account_closure-recovery.png) |
| /login | 1024 | 19 | 17 / 0 / 2 / 0 / 0 / 0 | [image](artifacts/1024-_login.png) |
| /register | 1024 | 21 | 18 / 0 / 3 / 0 / 0 / 0 | [image](artifacts/1024-_register.png) |
| /privacy | 1024 | 14 | 11 / 0 / 0 / 3 / 0 / 0 | [image](artifacts/1024-_privacy.png) |
| /terms | 1024 | 4 | 3 / 0 / 0 / 1 / 0 / 0 | [image](artifacts/1024-_terms.png) |
| /500 | 1024 | 4 | 3 / 0 / 0 / 1 / 0 / 0 | [image](artifacts/1024-_500.png) |
| /cosmic-preview | 1024 | 160 | 159 / 0 / 1 / 0 / 0 / 0 | [image](artifacts/1024-_cosmic-preview.png) |
| /app | 1024 | 55 | 15 / 38 / 2 / 0 / 0 / 0 | [image](artifacts/1024-_app.png) |
| /roles | 1024 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_roles.png) |
| /tasks | 1024 | 64 | 27 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_tasks.png) |
| /schedule | 1024 | 182 | 101 / 37 / 43 / 0 / 0 / 1 | [image](artifacts/1024-_schedule.png) |
| /calendar | 1024 | 182 | 0 / 182 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_calendar.png) |
| /experts | 1024 | 73 | 32 / 37 / 2 / 0 / 0 / 2 | [image](artifacts/1024-_experts.png) |
| /plugins | 1024 | 73 | 0 / 73 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_plugins.png) |
| /settings/appearance | 1024 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1024-_settings_appearance.png) |
| /settings/api-keys | 1024 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1024-_settings_api-keys.png) |
| /settings/memory | 1024 | 88 | 48 / 37 / 0 / 0 / 0 / 3 | [image](artifacts/1024-_settings_memory.png) |
| /settings/notifications | 1024 | 88 | 49 / 37 / 0 / 0 / 0 / 2 | [image](artifacts/1024-_settings_notifications.png) |
| /settings/account | 1024 | 88 | 49 / 37 / 0 / 0 / 0 / 2 | [image](artifacts/1024-_settings_account.png) |
| /admin | 1024 | 9 | 9 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_admin.png) |
| /admin/users | 1024 | 16 | 5 / 9 / 2 / 0 / 0 / 0 | [image](artifacts/1024-_admin_users.png) |
| /admin/users/:userId | 1024 | 10 | 1 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_admin_users_userId.png) |
| /admin/finance | 1024 | 14 | 4 / 9 / 1 / 0 / 0 / 0 | [image](artifacts/1024-_admin_finance.png) |
| /admin/partners | 1024 | 10 | 1 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_admin_partners.png) |
| /admin/learning | 1024 | 14 | 5 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_admin_learning.png) |
| /admin/models | 1024 | 23 | 13 / 9 / 1 / 0 / 0 / 0 | [image](artifacts/1024-_admin_models.png) |
| /admin/self-check | 1024 | 10 | 1 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_admin_self-check.png) |
| /admin/learning/:domain | 1024 | 11 | 2 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_admin_learning_domain.png) |
| / | 1024 | 55 | 0 / 55 / 0 / 0 / 0 / 0 | [image](artifacts/1024-home.png) |
| /profile | 1024 | 55 | 15 / 37 / 2 / 1 / 0 / 0 | [image](artifacts/1024-_profile.png) |
| /settings | 1024 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1024-_settings.png) |
| /settings/roles | 1024 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_settings_roles.png) |
| /partner | 1024 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_partner.png) |
| /partner/recharge | 1024 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_partner_recharge.png) |
| /partner/ledger | 1024 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_partner_ledger.png) |
| /partner/withdraw | 1024 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_partner_withdraw.png) |
| /plan | 1024 | 47 | 7 / 37 / 1 / 2 / 0 / 0 | [image](artifacts/1024-_plan.png) |
| /billing | 1024 | 46 | 6 / 37 / 0 / 3 / 0 / 0 | [image](artifacts/1024-_billing.png) |
| /usage | 1024 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_usage.png) |
| /cosmic | 1024 | 198 | 160 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1024-_cosmic.png) |
| /history | 1024 | 64 | 0 / 64 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_history.png) |
| /skills | 1024 | 73 | 0 / 73 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_skills.png) |
| /stocks | 1024 | 258 | 79 / 40 / 106 / 0 / 0 / 33 | [image](artifacts/1024-_stocks.png) |
| /stocks/discovery | 1024 | 55 | 12 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1024-_stocks_discovery.png) |
| /projects | 1024 | 58 | 19 / 37 / 2 / 0 / 0 / 0 | [image](artifacts/1024-_projects.png) |
| /projects/:projectId | 1024 | 73 | 35 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1024-_projects_projectId.png) |
| /organizations/invitations/accept | 1024 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_organizations_invitations_accept.png) |
| /starred | 1024 | 46 | 9 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_starred.png) |
| /files | 1024 | 57 | 20 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_files.png) |
| /video | 1024 | 167 | 127 / 37 / 2 / 0 / 0 / 1 | [image](artifacts/1024-_video.png) |
| /video/edit/:projectId | 1024 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_video_edit_projectId.png) |
| /image | 1024 | 115 | 77 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1024-_image.png) |
| /planned | 1024 | 189 | 144 / 37 / 2 / 0 / 0 / 6 | [image](artifacts/1024-_planned.png) |
| /planned/legacy-scheduled | 1024 | 182 | 0 / 182 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_planned_legacy-scheduled.png) |
| /planned/legacy-batch | 1024 | 61 | 15 / 38 / 4 / 0 / 0 / 4 | [image](artifacts/1024-_planned_legacy-batch.png) |
| /scheduled | 1024 | 182 | 0 / 182 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_scheduled.png) |
| /batch | 1024 | 189 | 0 / 189 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_batch.png) |
| /batch/:batchId | 1024 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_batch_batchId.png) |
| /connections | 1024 | 38 | 0 / 37 / 0 / 1 / 0 / 0 | [image](artifacts/1024-_connections.png) |
| * | 1024 | 40 | 3 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-not-found.png) |
| task:generate:executing | 1440 | 139 | 124 / 9 / 6 / 0 / 0 / 0 | [image](artifacts/1440-task_generate_executing.png) |
| task:generate:completed | 1440 | 48 | 10 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_generate_completed.png) |
| task:generate:failed | 1440 | 47 | 9 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_generate_failed.png) |
| task:generate:awaiting_user | 1440 | 41 | 3 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_generate_awaiting_user.png) |
| task:generate:cancelled | 1440 | 43 | 5 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_generate_cancelled.png) |
| task:browser:executing | 1440 | 69 | 26 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1440-task_browser_executing.png) |
| task:browser:completed | 1440 | 75 | 32 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1440-task_browser_completed.png) |
| task:browser:failed | 1440 | 78 | 35 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1440-task_browser_failed.png) |
| task:browser:awaiting_user | 1440 | 68 | 23 / 39 / 6 / 0 / 0 / 0 | [image](artifacts/1440-task_browser_awaiting_user.png) |
| task:browser:cancelled | 1440 | 77 | 32 / 39 / 6 / 0 / 0 / 0 | [image](artifacts/1440-task_browser_cancelled.png) |
| task:scrape:executing | 1440 | 48 | 8 / 39 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_scrape_executing.png) |
| task:scrape:completed | 1440 | 52 | 12 / 39 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_scrape_completed.png) |
| task:scrape:failed | 1440 | 53 | 13 / 39 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_scrape_failed.png) |
| task:scrape:awaiting_user | 1440 | 47 | 7 / 39 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_scrape_awaiting_user.png) |
| task:scrape:cancelled | 1440 | 49 | 9 / 39 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_scrape_cancelled.png) |
| task:image:executing | 1440 | 44 | 4 / 39 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_image_executing.png) |
| task:image:completed | 1440 | 50 | 11 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_image_completed.png) |
| task:image:failed | 1440 | 49 | 10 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_image_failed.png) |
| task:image:awaiting_user | 1440 | 43 | 4 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_image_awaiting_user.png) |
| task:image:cancelled | 1440 | 45 | 6 / 38 / 1 / 0 / 0 / 0 | [image](artifacts/1440-task_image_cancelled.png) |
| /account/closure-recovery | 1440 | 8 | 6 / 0 / 1 / 1 / 0 / 0 | [image](artifacts/1440-_account_closure-recovery.png) |
| /login | 1440 | 19 | 17 / 0 / 2 / 0 / 0 / 0 | [image](artifacts/1440-_login.png) |
| /register | 1440 | 21 | 18 / 0 / 3 / 0 / 0 / 0 | [image](artifacts/1440-_register.png) |
| /privacy | 1440 | 14 | 11 / 0 / 0 / 3 / 0 / 0 | [image](artifacts/1440-_privacy.png) |
| /terms | 1440 | 4 | 3 / 0 / 0 / 1 / 0 / 0 | [image](artifacts/1440-_terms.png) |
| /500 | 1440 | 4 | 3 / 0 / 0 / 1 / 0 / 0 | [image](artifacts/1440-_500.png) |
| /cosmic-preview | 1440 | 160 | 159 / 0 / 1 / 0 / 0 / 0 | [image](artifacts/1440-_cosmic-preview.png) |
| /app | 1440 | 50 | 12 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1440-_app.png) |
| /roles | 1440 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_roles.png) |
| /tasks | 1440 | 64 | 27 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_tasks.png) |
| /schedule | 1440 | 182 | 101 / 37 / 43 / 0 / 0 / 1 | [image](artifacts/1440-_schedule.png) |
| /calendar | 1440 | 182 | 0 / 182 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_calendar.png) |
| /experts | 1440 | 73 | 32 / 37 / 2 / 0 / 0 / 2 | [image](artifacts/1440-_experts.png) |
| /plugins | 1440 | 73 | 0 / 73 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_plugins.png) |
| /settings/appearance | 1440 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1440-_settings_appearance.png) |
| /settings/api-keys | 1440 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1440-_settings_api-keys.png) |
| /settings/memory | 1440 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1440-_settings_memory.png) |
| /settings/notifications | 1440 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1440-_settings_notifications.png) |
| /settings/account | 1440 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1440-_settings_account.png) |
| /admin | 1440 | 9 | 9 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_admin.png) |
| /admin/users | 1440 | 16 | 5 / 9 / 2 / 0 / 0 / 0 | [image](artifacts/1440-_admin_users.png) |
| /admin/users/:userId | 1440 | 10 | 1 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_admin_users_userId.png) |
| /admin/finance | 1440 | 14 | 4 / 9 / 1 / 0 / 0 / 0 | [image](artifacts/1440-_admin_finance.png) |
| /admin/partners | 1440 | 10 | 1 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_admin_partners.png) |
| /admin/learning | 1440 | 14 | 5 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_admin_learning.png) |
| /admin/models | 1440 | 23 | 13 / 9 / 1 / 0 / 0 / 0 | [image](artifacts/1440-_admin_models.png) |
| /admin/self-check | 1440 | 10 | 1 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_admin_self-check.png) |
| /admin/learning/:domain | 1440 | 11 | 2 / 9 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_admin_learning_domain.png) |
| / | 1440 | 50 | 0 / 50 / 0 / 0 / 0 / 0 | [image](artifacts/1440-home.png) |
| /profile | 1440 | 55 | 15 / 37 / 2 / 1 / 0 / 0 | [image](artifacts/1440-_profile.png) |
| /settings | 1440 | 88 | 50 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1440-_settings.png) |
| /settings/roles | 1440 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_settings_roles.png) |
| /partner | 1440 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_partner.png) |
| /partner/recharge | 1440 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_partner_recharge.png) |
| /partner/ledger | 1440 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_partner_ledger.png) |
| /partner/withdraw | 1440 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_partner_withdraw.png) |
| /plan | 1440 | 47 | 7 / 37 / 1 / 2 / 0 / 0 | [image](artifacts/1440-_plan.png) |
| /billing | 1440 | 46 | 6 / 37 / 0 / 3 / 0 / 0 | [image](artifacts/1440-_billing.png) |
| /usage | 1440 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_usage.png) |
| /cosmic | 1440 | 198 | 160 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1440-_cosmic.png) |
| /history | 1440 | 64 | 0 / 64 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_history.png) |
| /skills | 1440 | 73 | 0 / 73 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_skills.png) |
| /stocks | 1440 | 258 | 79 / 40 / 106 / 0 / 0 / 33 | [image](artifacts/1440-_stocks.png) |
| /stocks/discovery | 1440 | 55 | 12 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1440-_stocks_discovery.png) |
| /projects | 1440 | 58 | 19 / 37 / 2 / 0 / 0 / 0 | [image](artifacts/1440-_projects.png) |
| /projects/:projectId | 1440 | 73 | 35 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1440-_projects_projectId.png) |
| /organizations/invitations/accept | 1440 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_organizations_invitations_accept.png) |
| /starred | 1440 | 46 | 9 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_starred.png) |
| /files | 1440 | 57 | 20 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_files.png) |
| /video | 1440 | 167 | 127 / 37 / 2 / 0 / 0 / 1 | [image](artifacts/1440-_video.png) |
| /video/edit/:projectId | 1440 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_video_edit_projectId.png) |
| /image | 1440 | 115 | 77 / 37 / 1 / 0 / 0 / 0 | [image](artifacts/1440-_image.png) |
| /planned | 1440 | 189 | 144 / 37 / 2 / 0 / 0 / 6 | [image](artifacts/1440-_planned.png) |
| /planned/legacy-scheduled | 1440 | 182 | 0 / 182 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_planned_legacy-scheduled.png) |
| /planned/legacy-batch | 1440 | 61 | 15 / 38 / 4 / 0 / 0 / 4 | [image](artifacts/1440-_planned_legacy-batch.png) |
| /scheduled | 1440 | 182 | 0 / 182 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_scheduled.png) |
| /batch | 1440 | 189 | 0 / 189 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_batch.png) |
| /batch/:batchId | 1440 | 38 | 1 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_batch_batchId.png) |
| /connections | 1440 | 38 | 0 / 37 / 0 / 1 / 0 / 0 | [image](artifacts/1440-_connections.png) |
| * | 1440 | 40 | 3 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-not-found.png) |

## Boundary and exclusions

- 403 /api/trpc/videoEditing.getProject on /video/edit/:projectId: Actual backend default-off contract: FORBIDDEN; no license or remote SDK is provisioned
- synthetic external popup landing: URL navigation tested through local HTML interception; third-party availability is not tested
- exact five brand PNG assets: offline SVG placeholder preserves box geometry; logo pixel fidelity is excluded

Disabled controls are recorded as prerequisites, not successful actions. Static source inventory is broader than the finite runtime states. Missing runtime contracts, traversal limits and unknown routes block the gate. See README.md and known-issues.md for the interpretation of this baseline.
