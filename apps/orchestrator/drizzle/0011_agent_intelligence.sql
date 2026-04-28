-- Phase 13 — Agent Intelligence Upgrade.
--
-- Three concerns in one migration:
--
-- 1. tasks.plan_text + tasks.plan_status — first-frame plan output
--    (Markdown-ish text) plus a JSON status array tracking which
--    steps completed / failed. Both nullable so simple-search tasks
--    that skip the plan phase don't carry empty payloads.
--
-- 2. execution_memory — cross-task memory bank. The agent extracts
--    long-term-valuable facts after completion (preferences, site
--    state, useful tips) and re-injects matching ones on future
--    tasks. user_id is the bigint internal id (matches FK style
--    used elsewhere). Category as VARCHAR not ENUM so future
--    categories don't need DDL churn.
--
-- 3. execution_stats — per-tool-call performance log. Powers the
--    ExecutionRouter's lane-scoring on subsequent runs (success
--    rate × 0.7 + speed × 0.3). target_site stored as the bare
--    domain so cross-task aggregation is meaningful.
--
-- Additive migration; no data loss.

ALTER TABLE `tasks` ADD `plan_text` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `plan_status` json;--> statement-breakpoint

CREATE TABLE `execution_memory` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `external_id` varchar(32) NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `category` varchar(32) NOT NULL,
  `key_name` varchar(255) NOT NULL,
  `value` text NOT NULL,
  `expires_at` datetime(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `execution_memory_id` PRIMARY KEY(`id`),
  CONSTRAINT `uk_execution_memory_external_id` UNIQUE(`external_id`)
);--> statement-breakpoint
CREATE INDEX `ix_execution_memory_user_category` ON `execution_memory` (`user_id`,`category`);--> statement-breakpoint
CREATE INDEX `ix_execution_memory_expires` ON `execution_memory` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_execution_memory_user_key` ON `execution_memory` (`user_id`,`category`,`key_name`);--> statement-breakpoint

CREATE TABLE `execution_stats` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `task_external_id` varchar(32),
  `task_type` varchar(64),
  `target_site` varchar(255),
  `lane_used` varchar(48) NOT NULL,
  `success` tinyint(1) NOT NULL,
  `latency_ms` int unsigned,
  `error_type` varchar(64),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `execution_stats_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
CREATE INDEX `ix_execution_stats_user_site` ON `execution_stats` (`user_id`,`target_site`);--> statement-breakpoint
CREATE INDEX `ix_execution_stats_type_site` ON `execution_stats` (`task_type`,`target_site`);--> statement-breakpoint
CREATE INDEX `ix_execution_stats_created` ON `execution_stats` (`created_at`);
