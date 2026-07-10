-- Partner daily activity events for check-in game weighting.
--
-- Pure additive: creates only the partner activity event table and does not
-- alter existing tables or data.
--
-- Rollback note: drop `partner_activity_events`.

CREATE TABLE `partner_activity_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `activity_date` VARCHAR(10) NOT NULL,
  `event_type` VARCHAR(32) NOT NULL,
  `points` INT UNSIGNED NOT NULL DEFAULT 0,
  `idempotency_key` VARCHAR(160) NOT NULL,
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partner_activity_events_external_id` (`external_id`),
  UNIQUE KEY `uk_partner_activity_events_idempotency_key` (`idempotency_key`),
  UNIQUE KEY `uk_partner_activity_events_user_day_type` (`user_id`, `activity_date`, `event_type`),
  KEY `ix_partner_activity_events_user_date` (`user_id`, `activity_date`),
  KEY `ix_partner_activity_events_date_type` (`activity_date`, `event_type`),
  CONSTRAINT `fk_partner_activity_events_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
