-- Persist the last real stock dashboard snapshot across orchestrator restarts.
--
-- This table is a display cache only. It prevents transient AkShare outages
-- from replacing previously fetched real intraday lines with empty watchlist
-- cards after a deploy or PM2 restart.

CREATE TABLE `stock_dashboard_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `cache_key_hash` VARCHAR(64) NOT NULL,
  `snapshot_json` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stock_dashboard_snapshots_user_key` (`user_id`, `cache_key_hash`),
  KEY `ix_stock_dashboard_snapshots_user` (`user_id`),
  CONSTRAINT `fk_stock_dashboard_snapshots_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
