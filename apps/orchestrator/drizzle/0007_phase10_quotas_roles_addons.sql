-- Phase 10 Tier 2 — quotas + role permissions + add-on packs.
--
-- Three pieces wired together:
--
-- 1. `task_quotas` — per-(user, period) counter row. Period is 'day'
--    for free, 'month' for paid, expressed as half-open [start, end).
--    `tasks_used` and `opus_used` are the actual consumed counts;
--    `bonus_tasks` / `bonus_opus` carry first-month gifts and add-on
--    pack purchases. Bonus is consumed before regular usage so the
--    user sees their paid top-ups burn first.
--
-- 2. `users.selected_roles` — JSON list of open-pool role ids the
--    Basic plan user has actively chosen (max 5). Pro ignores this
--    column (gets all 33). Free has no role layer.
--    `users.role_changes_this_month` — anti-thrash counter (max 3
--    edits per calendar month). Resets via app code on month roll.
--
-- 3. `tasks.role_id` + `tasks.opus_used` — populated when the supercar
--    routes a task; lets us heatmap role popularity later and audit
--    Opus-quota burn separately.
--
-- 4. `payments.kind` — 'subscription' (default; what 0006 created) or
--    'addon'. Capture flow branches on this: subscription extends
--    plan_expires_at; addon adds bonus_tasks / bonus_opus to the
--    active quota row.

ALTER TABLE `users` ADD `selected_roles` json;--> statement-breakpoint
ALTER TABLE `users` ADD `role_changes_this_month` int NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `users` ADD `role_changes_period_start` datetime(3);--> statement-breakpoint

ALTER TABLE `tasks` ADD `role_id` varchar(48);--> statement-breakpoint
ALTER TABLE `tasks` ADD `opus_used` tinyint(1) NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE INDEX `ix_tasks_role_id` ON `tasks` (`role_id`);--> statement-breakpoint

ALTER TABLE `payments` ADD `kind` varchar(16) NOT NULL DEFAULT 'subscription';--> statement-breakpoint

CREATE TABLE `task_quotas` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `period` varchar(8) NOT NULL,
  `period_start` datetime(3) NOT NULL,
  `period_end` datetime(3) NOT NULL,
  `tasks_used` int unsigned NOT NULL DEFAULT 0,
  `opus_used` int unsigned NOT NULL DEFAULT 0,
  `bonus_tasks` int unsigned NOT NULL DEFAULT 0,
  `bonus_opus` int unsigned NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `task_quotas_id` PRIMARY KEY(`id`),
  CONSTRAINT `uk_task_quotas_user_period` UNIQUE(`user_id`,`period_start`)
);--> statement-breakpoint
CREATE INDEX `ix_task_quotas_user_active` ON `task_quotas` (`user_id`,`period_end`);
