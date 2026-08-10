-- Unified planned-task definitions, occurrence overrides and immutable run history.
-- Additive migration: legacy scheduled_tasks and batch_tasks remain intact for
-- compatibility and historical reads during the staged rollout.

CREATE TABLE `planned_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `instruction` TEXT NOT NULL,
  `notes` TEXT,
  `scope` VARCHAR(16) NOT NULL DEFAULT 'single',
  `repeat_type` VARCHAR(16) NOT NULL DEFAULT 'once',
  `rrule` VARCHAR(255),
  `first_run_at` DATETIME(3) NOT NULL,
  `ends_at` DATETIME(3),
  `next_run_at` DATETIME(3),
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  `reminder_minutes` INT UNSIGNED,
  `last_reminder_run` DATETIME(3),
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `item_count` INT UNSIGNED NOT NULL DEFAULT 1,
  `last_run_at` DATETIME(3),
  `last_run_status` VARCHAR(24),
  `last_error` TEXT,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_planned_tasks_external_id` (`external_id`),
  KEY `ix_planned_tasks_user_status` (`user_id`, `status`),
  KEY `ix_planned_tasks_due` (`status`, `next_run_at`),
  CONSTRAINT `fk_planned_tasks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `planned_task_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `planned_task_id` BIGINT UNSIGNED NOT NULL,
  `seq` INT UNSIGNED NOT NULL,
  `instruction` TEXT NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_planned_items_external_id` (`external_id`),
  UNIQUE KEY `uk_planned_items_plan_seq` (`planned_task_id`, `seq`),
  KEY `ix_planned_items_plan` (`planned_task_id`),
  CONSTRAINT `fk_planned_items_plan` FOREIGN KEY (`planned_task_id`) REFERENCES `planned_tasks` (`id`) ON DELETE CASCADE
);

CREATE TABLE `planned_task_occurrence_overrides` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `planned_task_id` BIGINT UNSIGNED NOT NULL,
  `original_scheduled_for` DATETIME(3) NOT NULL,
  `action` VARCHAR(16) NOT NULL,
  `scheduled_for` DATETIME(3),
  `instruction` TEXT,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_planned_override_external_id` (`external_id`),
  UNIQUE KEY `uk_planned_override_occurrence` (`planned_task_id`, `original_scheduled_for`),
  KEY `ix_planned_override_scheduled` (`scheduled_for`),
  CONSTRAINT `fk_planned_override_plan` FOREIGN KEY (`planned_task_id`) REFERENCES `planned_tasks` (`id`) ON DELETE CASCADE
);

CREATE TABLE `planned_task_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `planned_task_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `scheduled_for` DATETIME(3) NOT NULL,
  `series_scheduled_for` DATETIME(3) NOT NULL,
  `trigger` VARCHAR(16) NOT NULL DEFAULT 'scheduled',
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `task_id` BIGINT UNSIGNED,
  `batch_task_id` BIGINT UNSIGNED,
  `items_total` INT UNSIGNED NOT NULL DEFAULT 1,
  `items_done` INT UNSIGNED NOT NULL DEFAULT 0,
  `items_review` INT UNSIGNED NOT NULL DEFAULT 0,
  `items_failed` INT UNSIGNED NOT NULL DEFAULT 0,
  `error_message` TEXT,
  `started_at` DATETIME(3),
  `completed_at` DATETIME(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_planned_runs_external_id` (`external_id`),
  UNIQUE KEY `uk_planned_runs_occurrence` (`planned_task_id`, `series_scheduled_for`, `trigger`),
  KEY `ix_planned_runs_plan_created` (`planned_task_id`, `created_at`),
  KEY `ix_planned_runs_status` (`status`),
  KEY `ix_planned_runs_task` (`task_id`),
  KEY `ix_planned_runs_batch` (`batch_task_id`),
  CONSTRAINT `fk_planned_runs_plan` FOREIGN KEY (`planned_task_id`) REFERENCES `planned_tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_planned_runs_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_planned_runs_batch` FOREIGN KEY (`batch_task_id`) REFERENCES `batch_tasks` (`id`) ON DELETE SET NULL
);

CREATE TABLE `planned_task_run_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `planned_task_run_id` BIGINT UNSIGNED NOT NULL,
  `planned_task_item_id` BIGINT UNSIGNED,
  `seq` INT UNSIGNED NOT NULL,
  `instruction` TEXT NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `task_id` BIGINT UNSIGNED,
  `error_message` TEXT,
  `completed_at` DATETIME(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_planned_run_items_external_id` (`external_id`),
  UNIQUE KEY `uk_planned_run_items_run_seq` (`planned_task_run_id`, `seq`),
  KEY `ix_planned_run_items_task` (`task_id`),
  CONSTRAINT `fk_planned_run_items_run` FOREIGN KEY (`planned_task_run_id`) REFERENCES `planned_task_runs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_planned_run_items_item` FOREIGN KEY (`planned_task_item_id`) REFERENCES `planned_task_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_planned_run_items_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL
);
