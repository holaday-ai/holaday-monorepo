ALTER TABLE `users`
  ADD COLUMN `mfa_enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `mfa_secret_encrypted` VARCHAR(512) NULL,
  ADD COLUMN `mfa_setup_created_at` DATETIME(3) NULL,
  ADD COLUMN `mfa_last_used_step` BIGINT NULL,
  ADD COLUMN `mfa_failed_attempts` INT NOT NULL DEFAULT 0,
  ADD COLUMN `mfa_locked_until` DATETIME(3) NULL;
--> statement-breakpoint
CREATE TABLE `user_mfa_recovery_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(64) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_mfa_recovery_code` (`user_id`, `code_hash`),
  KEY `ix_user_mfa_recovery_available` (`user_id`, `consumed_at`),
  CONSTRAINT `fk_user_mfa_recovery_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
