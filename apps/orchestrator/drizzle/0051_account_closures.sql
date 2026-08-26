-- Durable, retryable account-closure orchestration. These tables preserve the
-- user tombstone and deliberately reject cascading deletion of closure history.

ALTER TABLE `users`
  MODIFY COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD CONSTRAINT `ck_users_status_allowed`
    CHECK (`status` IN ('active', 'suspended', 'closure_pending', 'closure_processing', 'closed'));
--> statement-breakpoint
CREATE TABLE `account_closure_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `active_user_id` BIGINT UNSIGNED NULL,
  `status` ENUM('pending_grace', 'cancelled', 'processing', 'needs_attention', 'completed') NOT NULL,
  `reason_code` ENUM('not_using', 'privacy', 'cost', 'missing_features', 'other_fixed') NULL,
  `requested_at` DATETIME(3) NOT NULL,
  `grace_ends_at` DATETIME(3) NOT NULL,
  `processing_started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `cancelled_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_account_closure_requests_external_id` (`external_id`),
  UNIQUE KEY `uk_account_closure_requests_active_user` (`active_user_id`),
  KEY `ix_account_closure_requests_status_grace` (`status`, `grace_ends_at`),
  CONSTRAINT `ck_account_closure_requests_active_user`
    CHECK (
      (`status` IN ('pending_grace', 'processing', 'needs_attention') AND `active_user_id` IS NOT NULL AND `active_user_id` = `user_id`)
      OR (`status` IN ('cancelled', 'completed') AND `active_user_id` IS NULL)
    ),
  CONSTRAINT `fk_account_closure_requests_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_account_closure_requests_active_user`
    FOREIGN KEY (`active_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `account_closure_steps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id` BIGINT UNSIGNED NOT NULL,
  `category_id` VARCHAR(64) NOT NULL,
  `handler_version` INT NOT NULL,
  `status` ENUM('pending', 'running', 'succeeded', 'retryable', 'blocked', 'skipped') NOT NULL DEFAULT 'pending',
  `attempt_count` INT NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NULL,
  `lease_owner` VARCHAR(64) NULL,
  `lease_until` DATETIME(3) NULL,
  `checkpoint` JSON NULL,
  `processed_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `retention_outcome` ENUM('deleted', 'anonymized', 'restricted', 'not_present') NULL,
  `last_error_code` ENUM('provider_unavailable', 'provider_rejected', 'storage_unavailable', 'database_unavailable', 'handler_missing', 'configuration', 'invariant_violation') NULL,
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_account_closure_steps_request_category` (`request_id`, `category_id`),
  KEY `ix_account_closure_steps_status_next_attempt` (`status`, `next_attempt_at`),
  KEY `ix_account_closure_steps_lease_until` (`lease_until`),
  CONSTRAINT `ck_account_closure_steps_checkpoint_keys`
    CHECK (
      `checkpoint` IS NULL
      OR (JSON_TYPE(`checkpoint`) = 'OBJECT' AND JSON_REMOVE(`checkpoint`, '$.targetIndex', '$.cursor', '$.processedCount') = JSON_OBJECT())
    ),
  CONSTRAINT `fk_account_closure_steps_request`
    FOREIGN KEY (`request_id`) REFERENCES `account_closure_requests` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `account_closure_effects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id` BIGINT UNSIGNED NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `resource_id` VARCHAR(128) NOT NULL,
  `previous_state` VARCHAR(64) NOT NULL,
  `closure_applied_state` VARCHAR(64) NOT NULL,
  `restored_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_account_closure_effects_request_resource` (`request_id`, `resource_type`, `resource_id`),
  CONSTRAINT `fk_account_closure_effects_request`
    FOREIGN KEY (`request_id`) REFERENCES `account_closure_requests` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `account_closure_challenges` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `request_id` BIGINT UNSIGNED NULL,
  `action` ENUM('begin', 'cancel') NOT NULL,
  `channel` ENUM('email', 'sms') NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `attempt_count` INT NOT NULL DEFAULT 0,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_account_closure_challenges_external_id` (`external_id`),
  KEY `ix_account_closure_challenges_user_action_expiry` (`user_id`, `action`, `expires_at`),
  CONSTRAINT `fk_account_closure_challenges_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_account_closure_challenges_request`
    FOREIGN KEY (`request_id`) REFERENCES `account_closure_requests` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `account_closure_receipts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `receipt_number` VARCHAR(32) NOT NULL,
  `kind` ENUM('application', 'completion') NOT NULL,
  `subject_digest` VARCHAR(64) NULL,
  `completed_category_ids` JSON NOT NULL,
  `restricted_category_ids` JSON NOT NULL,
  `notification_status` ENUM('pending', 'accepted', 'failed') NOT NULL DEFAULT 'pending',
  `issued_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_account_closure_receipts_number` (`receipt_number`),
  UNIQUE KEY `uk_account_closure_receipts_request_kind` (`request_id`, `kind`),
  CONSTRAINT `ck_account_closure_receipts_completed_categories_array`
    CHECK (JSON_TYPE(`completed_category_ids`) = 'ARRAY'),
  CONSTRAINT `ck_account_closure_receipts_restricted_categories_array`
    CHECK (JSON_TYPE(`restricted_category_ids`) = 'ARRAY'),
  CONSTRAINT `ck_account_closure_receipts_subject_digest_kind`
    CHECK (`kind` = 'completion' OR `subject_digest` IS NULL),
  CONSTRAINT `fk_account_closure_receipts_request`
    FOREIGN KEY (`request_id`) REFERENCES `account_closure_requests` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_account_closure_receipts_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
