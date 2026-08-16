-- Privacy-minimal Today Energy analytics. This migration is additive:
-- no existing application table is modified or backfilled.

CREATE TABLE `energy_daily_metrics` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `metric_date` DATE NOT NULL,
  `bucket_hash` CHAR(64) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `experience_id` VARCHAR(32) NOT NULL DEFAULT '',
  `mode_id` VARCHAR(64) NOT NULL DEFAULT '',
  `energy_need` VARCHAR(16) NOT NULL DEFAULT '',
  `duration_bucket` VARCHAR(32) NOT NULL DEFAULT '',
  `outcome` VARCHAR(16) NOT NULL DEFAULT '',
  `section_id` VARCHAR(32) NOT NULL DEFAULT '',
  `target_type` VARCHAR(32) NOT NULL DEFAULT '',
  `source_kind` VARCHAR(32) NOT NULL DEFAULT '',
  `content_id` VARCHAR(64) NOT NULL DEFAULT '',
  `range_key` VARCHAR(16) NOT NULL DEFAULT '',
  `task_status` VARCHAR(16) NOT NULL DEFAULT '',
  `batch_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `event_count` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_energy_daily_metrics_bucket` (`metric_date`, `bucket_hash`),
  KEY `ix_energy_daily_metrics_expires_at` (`expires_at`),
  KEY `ix_energy_daily_metrics_date_type` (`metric_date`, `event_type`)
);
--> statement-breakpoint
CREATE TABLE `energy_daily_visitors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `activity_date` DATE NOT NULL,
  `visitor_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_energy_daily_visitors_day_hash` (`activity_date`, `visitor_hash`),
  KEY `ix_energy_daily_visitors_expires_at` (`expires_at`)
);
--> statement-breakpoint
CREATE TABLE `energy_event_receipts` (
  `event_id` CHAR(36) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`event_id`),
  KEY `ix_energy_event_receipts_expires_at` (`expires_at`)
);
