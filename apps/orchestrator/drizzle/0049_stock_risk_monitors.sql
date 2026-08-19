-- Dedicated deterministic stock-risk monitors. The scheduler, notification
-- inbox, and generic planned tasks remain backward compatible.

CREATE TABLE `stock_risk_monitors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `planned_task_id` BIGINT UNSIGNED NOT NULL,
  `symbol` VARCHAR(32) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `market` VARCHAR(16) NOT NULL,
  `risk_keys_json` JSON NOT NULL,
  `last_evaluated_data_as_of` VARCHAR(10) NULL,
  `last_signals_json` JSON NOT NULL,
  `last_unavailable_checks_json` JSON NOT NULL,
  `last_notification_fingerprint` CHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stock_risk_monitors_external_id` (`external_id`),
  UNIQUE KEY `uk_stock_risk_monitors_user_symbol` (`user_id`, `symbol`),
  UNIQUE KEY `uk_stock_risk_monitors_plan` (`planned_task_id`),
  CONSTRAINT `fk_stock_risk_monitors_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stock_risk_monitors_plan` FOREIGN KEY (`planned_task_id`) REFERENCES `planned_tasks` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `planned_task_runs`
  ADD COLUMN `result_json` JSON NULL;
--> statement-breakpoint
ALTER TABLE `notifications`
  ADD COLUMN `planned_task_id` BIGINT UNSIGNED NULL,
  ADD KEY `ix_notifications_planned_task` (`planned_task_id`),
  ADD CONSTRAINT `fk_notifications_planned_task` FOREIGN KEY (`planned_task_id`) REFERENCES `planned_tasks` (`id`) ON DELETE SET NULL;
