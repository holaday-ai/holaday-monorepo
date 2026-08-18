-- Explainable stock-preference profile storage. Pure additive: the profile
-- can be cleared independently without deleting the user's watchlist.

CREATE TABLE `stock_preference_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `manual_preferences_json` JSON NULL,
  `cleared_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stock_preference_profiles_user` (`user_id`),
  CONSTRAINT `fk_stock_preference_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `stock_preference_signals` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `dedupe_hash` CHAR(64) NOT NULL,
  `payload_json` JSON NOT NULL,
  `data_as_of` VARCHAR(10) NULL,
  `occurred_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stock_preference_signals_user_hash` (`user_id`, `dedupe_hash`),
  KEY `ix_stock_preference_signals_user_time` (`user_id`, `occurred_at`),
  CONSTRAINT `fk_stock_preference_signals_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
