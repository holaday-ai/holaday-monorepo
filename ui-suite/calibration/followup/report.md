# UI regression report

Result: **failed** · candidate `ff1e30d9b357c7d499335f47f1604cb108030a49` · seed `2026-10-09-v2`

Frontend source: `345eb8b47855551898ea5f1e0f49e55e1b9ac197ce1d7262fea418b0fc5243a4`; build: `f8a3ea427b5f5777cb14e3d583db14c25f1ba974ef442403464ca0cffd632e39`.

Local seeded frontend/backend only. Production, paid services and real accounts are not contacted. Baseline creation is not a passed comparison.

Pages: 27/27; findings: 546; coverage gaps: 1.

## Findings

| Severity | Route / width | Rule | Detail | Screenshot |
| --- | --- | --- | --- | --- |
| P1 | /settings/appearance / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_appearance-control-170.png) |
| P2 | /settings/appearance / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings_appearance.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1440-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1440 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | [image](artifacts/1440-_settings_appearance-control-83.png) |
| P2 | /settings/appearance / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_appearance.png) |
| P2 | /settings/appearance / 1440 | selected-tab-semantics | 手机登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_appearance.png) |
| P1 | /settings/api-keys / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_api-keys-control-84.png) |
| P2 | /settings/api-keys / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings_api-keys.png) |
| P2 | /settings/api-keys / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_api-keys.png) |
| P1 | /settings/memory / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_memory-control-84.png) |
| P2 | /settings/memory / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings_memory.png) |
| P1 | /settings/memory / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|取消\|\|0 | [image](artifacts/1440-_settings_memory-control-64.png) |
| P2 | /settings/memory / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_memory.png) |
| P1 | /settings/notifications / 1440 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_notifications-control-84.png) |
| P2 | /settings/notifications / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings_notifications.png) |
| P1 | /settings/notifications / 1440 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1440-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1440 | control-occluded | BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1440-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1440-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1440-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|取消\|\|0 | [image](artifacts/1440-_settings_notifications-control-64.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|外观\|/settings#appearance\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|数据区域\|/settings#model-region\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|API Key\|/settings#api-keys\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|浏览器数据\|/settings#browser-data\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|AI 记忆\|/settings#memory\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|通知\|/settings#notifications\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1440 | control-overlap | A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_notifications-control-66.png) |
| P2 | /settings/notifications / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_notifications.png) |
| P1 | /settings/account / 1440 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings_account-control-83.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings_account-control-83.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_account-control-84.png) |
| P2 | /settings/account / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings_account.png) |
| P1 | /settings/account / 1440 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1440-_settings_account-control-50.png) |
| P1 | /settings/account / 1440 | control-occluded | BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1440-_settings_account-control-50.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1440-_settings_account-control-50.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1440-_settings_account-control-50.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|外观\|/settings#appearance\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_account-control-65.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_account-control-65.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|数据区域\|/settings#model-region\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_account-control-65.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|API Key\|/settings#api-keys\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_account-control-65.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|浏览器数据\|/settings#browser-data\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_account-control-65.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|AI 记忆\|/settings#memory\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_account-control-65.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|通知\|/settings#notifications\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_account-control-65.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1440-_settings_account-control-65.png) |
| P1 | /settings/account / 1440 | control-overlap | A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings_account-control-65.png) |
| P2 | /settings/account / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings_account.png) |
| P2 | /settings / 1440 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1440-_settings.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1440-_settings-control-84.png) |
| P1 | /settings / 1440 | control-occluded | BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1440-_settings-control-50.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1440-_settings-control-50.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1440-_settings-control-50.png) |
| P1 | /settings / 1440 | control-occluded | BUTTON\|\|查看关闭影响\|\|0 | [image](artifacts/1440-_settings-control-55.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|外观\|/settings#appearance\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1440-_settings-control-72.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1440-_settings-control-72.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1440-_settings-control-72.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|数据区域\|/settings#model-region\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1440-_settings-control-72.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|API Key\|/settings#api-keys\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1440-_settings-control-72.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|浏览器数据\|/settings#browser-data\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1440-_settings-control-72.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|AI 记忆\|/settings#memory\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1440-_settings-control-72.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|通知\|/settings#notifications\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1440-_settings-control-72.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1440-_settings-control-72.png) |
| P1 | /settings / 1440 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings-control-81.png) |
| P1 | /settings / 1440 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1440-_settings-control-81.png) |
| P2 | /settings / 1440 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_settings.png) |
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
| P2 | /video / 1440 | selected-tab-semantics | 氛围风格基调: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1440-_video.png) |
| P1 | /settings/appearance / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings_appearance-control-170.png) |
| P1 | /settings/appearance / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_appearance-control-170.png) |
| P1 | /settings/appearance / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_appearance-control-170.png) |
| P2 | /settings/appearance / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings_appearance.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1280-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1280 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | [image](artifacts/1280-_settings_appearance-control-83.png) |
| P2 | /settings/appearance / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings_appearance.png) |
| P2 | /settings/appearance / 1280 | selected-tab-semantics | 手机登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings_appearance.png) |
| P1 | /settings/api-keys / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings_api-keys-control-84.png) |
| P1 | /settings/api-keys / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_api-keys-control-84.png) |
| P1 | /settings/api-keys / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_api-keys-control-84.png) |
| P2 | /settings/api-keys / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings_api-keys.png) |
| P2 | /settings/api-keys / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings_api-keys.png) |
| P1 | /settings/memory / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings_memory-control-84.png) |
| P1 | /settings/memory / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_memory-control-84.png) |
| P1 | /settings/memory / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_memory-control-84.png) |
| P2 | /settings/memory / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings_memory.png) |
| P1 | /settings/memory / 1280 | dead-control | 账号: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_settings_memory-control-41.png) |
| P1 | /settings/memory / 1280 | control-occluded | BUTTON\|\|查看关闭影响\|\|0 | [image](artifacts/1280-_settings_memory-control-71.png) |
| P1 | /settings/memory / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|取消\|\|0 | [image](artifacts/1280-_settings_memory-control-64.png) |
| P2 | /settings/memory / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings_memory.png) |
| P1 | /settings/notifications / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings_notifications-control-84.png) |
| P1 | /settings/notifications / 1280 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings_notifications-control-83.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_notifications-control-84.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_notifications-control-84.png) |
| P1 | /settings/notifications / 1280 | control-overlap | BUTTON\|\|删除记忆：报告偏好\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_notifications-control-83.png) |
| P2 | /settings/notifications / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings_notifications.png) |
| P1 | /settings/notifications / 1280 | dead-control | 账号: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1280-_settings_notifications-control-41.png) |
| P1 | /settings/notifications / 1280 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1280 | control-occluded | BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1280-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1280-_settings_notifications-control-50.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|取消\|\|0 | [image](artifacts/1280-_settings_notifications-control-64.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|外观\|/settings#appearance\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|数据区域\|/settings#model-region\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|API Key\|/settings#api-keys\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|浏览器数据\|/settings#browser-data\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|AI 记忆\|/settings#memory\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|通知\|/settings#notifications\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 | [image](artifacts/1280-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_notifications-control-66.png) |
| P1 | /settings/notifications / 1280 | control-overlap | A\|\|专业角色 挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）\|/settings/roles\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_notifications-control-66.png) |
| P2 | /settings/notifications / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings_notifications.png) |
| P1 | /settings/account / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings_account-control-84.png) |
| P1 | /settings/account / 1280 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings_account-control-83.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings_account-control-83.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings_account-control-84.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_account-control-84.png) |
| P1 | /settings/account / 1280 | control-overlap | BUTTON\|\|删除记忆：报告偏好\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings_account-control-83.png) |
| P2 | /settings/account / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings_account.png) |
| P1 | /settings/account / 1280 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_settings_account-control-50.png) |
| P1 | /settings/account / 1280 | control-occluded | BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1280-_settings_account-control-50.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_settings_account-control-50.png) |
| P1 | /settings/account / 1280 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1280-_settings_account-control-50.png) |
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
| P2 | /settings / 1280 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1280-_settings.png) |
| P1 | /settings / 1280 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1280-_settings-control-84.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings-control-84.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings-control-84.png) |
| P1 | /settings / 1280 | control-occluded | BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1280-_settings-control-50.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1280-_settings-control-50.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|新建 API Key\|\|0 | [image](artifacts/1280-_settings-control-50.png) |
| P1 | /settings / 1280 | control-overlap | BUTTON\|\|新建 API Key\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1280-_settings-control-50.png) |
| P1 | /settings / 1280 | control-overlap | BUTTON\|\|新建 API Key\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings-control-50.png) |
| P1 | /settings / 1280 | control-occluded | BUTTON\|\|查看关闭影响\|\|0 | [image](artifacts/1280-_settings-control-55.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|外观\|/settings#appearance\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1280-_settings-control-72.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1280-_settings-control-72.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1280-_settings-control-72.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|数据区域\|/settings#model-region\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1280-_settings-control-72.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|API Key\|/settings#api-keys\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1280-_settings-control-72.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|浏览器数据\|/settings#browser-data\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1280-_settings-control-72.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|AI 记忆\|/settings#memory\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1280-_settings-control-72.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|通知\|/settings#notifications\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1280-_settings-control-72.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / INPUT\|\|搜索 AI 记忆\|\|0 | [image](artifacts/1280-_settings-control-72.png) |
| P1 | /settings / 1280 | control-occluded | BUTTON\|\|取消\|\|0 | [image](artifacts/1280-_settings-control-65.png) |
| P1 | /settings / 1280 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings-control-81.png) |
| P1 | /settings / 1280 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1280-_settings-control-81.png) |
| P1 | /settings / 1280 | control-overlap | BUTTON\|\|删除记忆：报告偏好\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1280-_settings-control-81.png) |
| P2 | /settings / 1280 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_settings.png) |
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
| P2 | /video / 1280 | selected-tab-semantics | 氛围风格基调: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1280-_video.png) |
| P1 | /settings/appearance / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings_appearance-control-170.png) |
| P1 | /settings/appearance / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings_appearance-control-170.png) |
| P1 | /settings/appearance / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings_appearance-control-170.png) |
| P1 | /settings/appearance / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_appearance-control-170.png) |
| P1 | /settings/appearance / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings_appearance-control-170.png) |
| P2 | /settings/appearance / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings_appearance.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|新任务\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|搜索任务 ⌘K\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|技能\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|股市任务\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|今日能量\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|视频任务\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|图片任务\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|规划任务\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|文件库\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|项目\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|管理后台\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P1 | /settings/appearance / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_appearance-control-33.png) |
| P2 | /settings/appearance / 1024 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | [image](artifacts/1024-_settings_appearance-control-83.png) |
| P2 | /settings/appearance / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_appearance.png) |
| P2 | /settings/appearance / 1024 | selected-tab-semantics | 手机登录: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_appearance.png) |
| P1 | /settings/api-keys / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings_api-keys-control-84.png) |
| P1 | /settings/api-keys / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings_api-keys-control-84.png) |
| P1 | /settings/api-keys / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings_api-keys-control-84.png) |
| P1 | /settings/api-keys / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_api-keys-control-84.png) |
| P1 | /settings/api-keys / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings_api-keys-control-84.png) |
| P2 | /settings/api-keys / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings_api-keys.png) |
| P2 | /settings/api-keys / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_api-keys.png) |
| P1 | /settings/memory / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings_memory-control-84.png) |
| P1 | /settings/memory / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings_memory-control-84.png) |
| P1 | /settings/memory / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings_memory-control-84.png) |
| P1 | /settings/memory / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_memory-control-84.png) |
| P1 | /settings/memory / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings_memory-control-84.png) |
| P2 | /settings/memory / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings_memory.png) |
| P1 | /settings/memory / 1024 | dead-control | 通知: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_memory-control-40.png) |
| P1 | /settings/memory / 1024 | dead-control | 账号: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_memory-control-41.png) |
| P1 | /settings/memory / 1024 | control-occluded | BUTTON\|\|添加渠道\|\|0 | [image](artifacts/1024-_settings_memory-control-55.png) |
| P2 | /settings/memory / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_memory.png) |
| P1 | /settings/notifications / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings_notifications-control-84.png) |
| P1 | /settings/notifications / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings_notifications-control-84.png) |
| P1 | /settings/notifications / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings_notifications-control-84.png) |
| P1 | /settings/notifications / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_notifications-control-84.png) |
| P1 | /settings/notifications / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings_notifications-control-84.png) |
| P2 | /settings/notifications / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings_notifications.png) |
| P1 | /settings/notifications / 1024 | dead-control | 账号: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_notifications-control-41.png) |
| P2 | /settings/notifications / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_notifications.png) |
| P1 | /settings/account / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings_account-control-84.png) |
| P1 | /settings/account / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings_account-control-84.png) |
| P1 | /settings/account / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings_account-control-84.png) |
| P1 | /settings/account / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings_account-control-84.png) |
| P1 | /settings/account / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings_account-control-84.png) |
| P2 | /settings/account / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings_account.png) |
| P1 | /settings/account / 1024 | dead-control | 通知: locator.click: Timeout 1800ms exceeded. | [image](artifacts/1024-_settings_account-control-40.png) |
| P1 | /settings/account / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|创建\|\|0 | [image](artifacts/1024-_settings_account-control-64.png) |
| P2 | /settings/account / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings_account.png) |
| P2 | /settings / 1024 | unexplained-text-truncation | 搜索 AI 记忆 | [image](artifacts/1024-_settings.png) |
| P1 | /settings / 1024 | control-occluded | A\|\|通知\|/settings#notifications\|0 | [image](artifacts/1024-_settings-control-84.png) |
| P1 | /settings / 1024 | control-occluded | A\|\|账号\|/settings#account\|0 | [image](artifacts/1024-_settings-control-84.png) |
| P1 | /settings / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_settings-control-84.png) |
| P1 | /settings / 1024 | control-overlap | A\|\|通知\|/settings#notifications\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_settings-control-84.png) |
| P1 | /settings / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings-control-84.png) |
| P1 | /settings / 1024 | control-occluded | BUTTON\|\|全部 1\|\|0 | [image](artifacts/1024-_settings-control-72.png) |
| P1 | /settings / 1024 | control-occluded | BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1024-_settings-control-72.png) |
| P1 | /settings / 1024 | control-overlap | A\|\|外观\|/settings#appearance\|0 / BUTTON\|\|全部 1\|\|0 | [image](artifacts/1024-_settings-control-72.png) |
| P1 | /settings / 1024 | control-overlap | A\|\|AI 视角\|/settings#roles\|0 / BUTTON\|\|偏好 1\|\|0 | [image](artifacts/1024-_settings-control-72.png) |
| P1 | /settings / 1024 | control-occluded | BUTTON\|\|创建\|\|0 | [image](artifacts/1024-_settings-control-65.png) |
| P1 | /settings / 1024 | control-occluded | BUTTON\|\|取消\|\|0 | [image](artifacts/1024-_settings-control-65.png) |
| P1 | /settings / 1024 | control-occluded | BUTTON\|\|查看关闭影响\|\|0 | [image](artifacts/1024-_settings-control-71.png) |
| P1 | /settings / 1024 | control-occluded | BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1024-_settings-control-79.png) |
| P1 | /settings / 1024 | control-overlap | A\|\|账号\|/settings#account\|0 / BUTTON\|\|删除记忆：报告偏好\|\|0 | [image](artifacts/1024-_settings-control-79.png) |
| P1 | /settings / 1024 | control-overlap | BUTTON\|\|删除记忆：报告偏好\|\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_settings-control-79.png) |
| P2 | /settings / 1024 | selected-tab-semantics | 企业微信 qyapi.weixin.qq.com: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_settings.png) |
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
| P2 | /video / 1024 | unexplained-text-truncation | 告诉 HOLA DAY 你的重点 | [image](artifacts/1024-_video.png) |
| P1 | /video / 1024 | control-occluded | BUTTON\|\|细节特写\|\|0 | [image](artifacts/1024-_video-control-56.png) |
| P1 | /video / 1024 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|浏览器工作区\|\|0 | [image](artifacts/1024-_video-control-56.png) |
| P1 | /video / 1024 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|通知，188 条未读\|\|0 | [image](artifacts/1024-_video-control-56.png) |
| P1 | /video / 1024 | control-overlap | BUTTON\|\|细节特写\|\|0 / BUTTON\|\|BUTTON\|\|0 | [image](artifacts/1024-_video-control-56.png) |
| P1 | /video / 1024 | control-overlap | BUTTON\|\|上传一位真人或写实虚构人物的清晰照片；当前模型仅支持单人换单人，取景和身体比例相近；暂不支持宠物、物体或多人替换。\|\|0 / BUTTON\|\|移除主角照片\|\|0 | [image](artifacts/1024-_video-control-64.png) |
| P2 | /video / 1024 | unexplained-truncation | BUTTON\|\|光影氛围\|\|0 | [image](artifacts/1024-_video-control-106.png) |
| P2 | /video / 1024 | unexplained-truncation | BUTTON\|\|细节特写\|\|0 | [image](artifacts/1024-_video-control-90.png) |
| P1 | /video / 1024 | control-occluded | BUTTON\|\|氛围 / 光感 / 色彩 随机\|\|0 | [image](artifacts/1024-_video-control-115.png) |
| P2 | /video / 1024 | selected-tab-semantics | 氛围风格基调: Selected choice is styled as active but lacks aria-selected/aria-pressed | [image](artifacts/1024-_video.png) |

## Coverage gaps

- Case-filtered run: not full release acceptance

## Page and control coverage

| Route | Width | Total | Passed / shared / disabled / protocol / uncovered / failed | Screenshot |
| --- | --- | --- | --- | --- | --- |
| /settings/appearance | 1440 | 182 | 170 / 8 / 4 / 0 / 0 / 0 | [image](artifacts/1440-_settings_appearance.png) |
| /settings/api-keys | 1440 | 89 | 52 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_settings_api-keys.png) |
| /settings/memory | 1440 | 89 | 52 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_settings_memory.png) |
| /settings/notifications | 1440 | 89 | 52 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_settings_notifications.png) |
| /settings/account | 1440 | 89 | 52 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_settings_account.png) |
| /settings | 1440 | 89 | 52 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_settings.png) |
| /stocks | 1440 | 258 | 112 / 40 / 106 / 0 / 0 / 0 | [image](artifacts/1440-_stocks.png) |
| /video | 1440 | 167 | 128 / 37 / 2 / 0 / 0 / 0 | [image](artifacts/1440-_video.png) |
| /video/edit/:projectId | 1440 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_video_edit_projectId.png) |
| /settings/appearance | 1280 | 182 | 170 / 8 / 4 / 0 / 0 / 0 | [image](artifacts/1280-_settings_appearance.png) |
| /settings/api-keys | 1280 | 89 | 52 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_settings_api-keys.png) |
| /settings/memory | 1280 | 89 | 51 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1280-_settings_memory.png) |
| /settings/notifications | 1280 | 89 | 51 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1280-_settings_notifications.png) |
| /settings/account | 1280 | 89 | 52 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_settings_account.png) |
| /settings | 1280 | 89 | 52 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_settings.png) |
| /stocks | 1280 | 258 | 112 / 40 / 106 / 0 / 0 / 0 | [image](artifacts/1280-_stocks.png) |
| /video | 1280 | 167 | 128 / 37 / 2 / 0 / 0 / 0 | [image](artifacts/1280-_video.png) |
| /video/edit/:projectId | 1280 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_video_edit_projectId.png) |
| /settings/appearance | 1024 | 182 | 170 / 8 / 4 / 0 / 0 / 0 | [image](artifacts/1024-_settings_appearance.png) |
| /settings/api-keys | 1024 | 89 | 52 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_settings_api-keys.png) |
| /settings/memory | 1024 | 89 | 50 / 37 / 0 / 0 / 0 / 2 | [image](artifacts/1024-_settings_memory.png) |
| /settings/notifications | 1024 | 89 | 51 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1024-_settings_notifications.png) |
| /settings/account | 1024 | 89 | 51 / 37 / 0 / 0 / 0 / 1 | [image](artifacts/1024-_settings_account.png) |
| /settings | 1024 | 89 | 52 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_settings.png) |
| /stocks | 1024 | 258 | 112 / 40 / 106 / 0 / 0 / 0 | [image](artifacts/1024-_stocks.png) |
| /video | 1024 | 167 | 128 / 37 / 2 / 0 / 0 / 0 | [image](artifacts/1024-_video.png) |
| /video/edit/:projectId | 1024 | 37 | 0 / 37 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_video_edit_projectId.png) |

## Boundary and exclusions

- 403 /api/trpc/videoEditing.getProject on /video/edit/:projectId: Actual backend default-off contract: FORBIDDEN; no license or remote SDK is provisioned
- synthetic external popup landing: URL navigation tested through local HTML interception; third-party availability is not tested
- exact five brand PNG assets: offline SVG placeholder preserves box geometry; logo pixel fidelity is excluded

Disabled controls are recorded as prerequisites, not successful actions. Static source inventory is broader than the finite runtime states. Missing runtime contracts, traversal limits and unknown routes block the gate. See README.md and known-issues.md for the interpretation of this baseline.
