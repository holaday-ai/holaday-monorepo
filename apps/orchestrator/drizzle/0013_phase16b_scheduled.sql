-- Phase 16b — scheduled tasks. Users can ask HOLA DAY to run a task
-- on a calendar (one-shot at a future time, or daily/weekly/monthly).
-- Skipping mcp_connections table for now: the MCP page is display-
-- only in this batch (no OAuth → no need to persist provider state).
-- The new files-library page reuses the existing task_files table,
-- so no new file storage table either.
--
-- Status machine: active ↔ paused; runs to completed when repeat
-- type is 'once' and the single run fires. Cron polling lives in
-- agent/scheduled-runner.ts (every 60s, no BullMQ; in-process).

CREATE TABLE `scheduled_tasks` (
  `id` bigint unsigned PRIMARY KEY AUTO_INCREMENT,
  `external_id` varchar(32) NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `intent` text NOT NULL,
  `repeat_type` varchar(16) NOT NULL DEFAULT 'once',
  `cron_expression` varchar(100),
  `next_run_at` datetime(3) NOT NULL,
  `last_run_at` datetime(3),
  `last_task_id` bigint unsigned,
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `fk_scheduled_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_scheduled_external_id` ON `scheduled_tasks` (`external_id`);--> statement-breakpoint
CREATE INDEX `ix_scheduled_user_id` ON `scheduled_tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_scheduled_due` ON `scheduled_tasks` (`status`, `next_run_at`);
