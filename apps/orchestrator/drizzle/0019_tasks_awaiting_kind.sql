-- P2-A — split awaiting_user into clarification vs login/captcha/browser_action.
--
-- Before: the SPA flipped the BrowserPanel banner to "需要您手动完成验证"
-- and auto-expanded the panel for every awaiting_user park, including
-- expert-workflow intake clarifications (douyin-livestream-review's
-- "复盘哪一场？后台还是附件？" prompt). This made plain text-clarification
-- pauses look like login walls.
--
-- After: the supercar onAwaitingUser callback writes the classified
-- kind here; tasks.detail surfaces it; BrowserPanel only treats
-- non-'clarification' rows as needing the verify banner / panel
-- auto-expand. NULL = legacy row, treated as the safe default
-- (clarification) by the SPA.

ALTER TABLE `tasks` ADD COLUMN `awaiting_kind` varchar(32) NULL;
