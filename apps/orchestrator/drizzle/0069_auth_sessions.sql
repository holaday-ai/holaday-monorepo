-- Apply before orchestrator with session-bearing tokens. Additive and idempotent.
CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `sid` varchar(36) NOT NULL,
  UNIQUE KEY `uk_auth_sessions_sid` (`sid`),
  `user_external_id` varchar(32) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) NULL,
  KEY `ix_auth_sessions_user` (`user_external_id`),
  KEY `ix_auth_sessions_expiry` (`expires_at`),
  CONSTRAINT `fk_auth_sessions_user` FOREIGN KEY (`user_external_id`) REFERENCES `users` (`external_id`) ON DELETE CASCADE
);
