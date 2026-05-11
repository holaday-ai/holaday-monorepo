-- Phase 5b — batch tasks. Users submit a list of prompts; the
-- batch executor dispatches each as a regular task, capped by the
-- user's plan concurrency (Basic=3 / Pro=5 / Free=1). Progress per
-- item streams back via the existing WS broadcaster.
--
-- Status machine, batch_tasks:
--   pending   → created, executor hasn't fired the first item
--   running   → at least one item dispatched
--   completed → every item .status='completed'
--   partial   → all items settled, ≥1 failed
--   cancelled → user pressed cancel; remaining items skipped
--
-- Status machine, batch_task_items:
--   pending   → in executor queue
--   running   → tasks.create returned, underlying task in flight
--   completed → underlying task terminal=completed
--   failed    → tasks.create threw OR task terminal=failed/timeout
--   cancelled → batch was cancelled before dispatch

CREATE TABLE `batch_tasks` (
  `id` bigint unsigned PRIMARY KEY AUTO_INCREMENT,
  `external_id` varchar(32) NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `name` varchar(200),
  `concurrency` int NOT NULL DEFAULT 3,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `items_total` int NOT NULL DEFAULT 0,
  `items_done` int NOT NULL DEFAULT 0,
  `items_failed` int NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` datetime(3),
  CONSTRAINT `fk_batch_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_batch_external_id` ON `batch_tasks` (`external_id`);--> statement-breakpoint
CREATE INDEX `ix_batch_user_status` ON `batch_tasks` (`user_id`, `status`);--> statement-breakpoint
CREATE INDEX `ix_batch_created_at` ON `batch_tasks` (`created_at`);--> statement-breakpoint

CREATE TABLE `batch_task_items` (
  `id` bigint unsigned PRIMARY KEY AUTO_INCREMENT,
  `external_id` varchar(32) NOT NULL,
  `batch_id` bigint unsigned NOT NULL,
  `seq` int NOT NULL,
  `prompt` text NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `task_id` bigint unsigned,
  `error_message` text,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` datetime(3),
  CONSTRAINT `fk_batch_item_batch_id` FOREIGN KEY (`batch_id`) REFERENCES `batch_tasks`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_batch_item_task_id` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE SET NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_batch_item_external_id` ON `batch_task_items` (`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_batch_item_batch_seq` ON `batch_task_items` (`batch_id`, `seq`);--> statement-breakpoint
CREATE INDEX `ix_batch_item_batch_id` ON `batch_task_items` (`batch_id`);--> statement-breakpoint
CREATE INDEX `ix_batch_item_task_id` ON `batch_task_items` (`task_id`);
