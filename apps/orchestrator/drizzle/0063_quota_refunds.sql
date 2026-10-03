-- Platform-failure refunds. One row per task that consumed quota at creation;
-- refunded_at is set at most once (conditional UPDATE), so a task is refunded
-- at most once no matter how many settlement/reaper paths observe its failure.
CREATE TABLE IF NOT EXISTS `quota_refunds` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_external_id` varchar(32) NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `plan` varchar(16) NOT NULL,
  `is_opus` boolean NOT NULL DEFAULT false,
  `charged_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `refunded_at` datetime(3) NULL,
  `refund_reason` varchar(64) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_quota_refunds_task` (`task_external_id`),
  KEY `ix_quota_refunds_pending` (`refunded_at`, `charged_at`),
  KEY `ix_quota_refunds_user` (`user_id`)
);
