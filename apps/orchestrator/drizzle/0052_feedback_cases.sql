CREATE TABLE `feedback_cases` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `external_id` varchar(32) NOT NULL,
  `user_id` bigint unsigned NULL,
  `closure_request_id` bigint unsigned NULL,
  `message` text NULL,
  `context` varchar(512) NULL,
  `user_agent` varchar(512) NULL,
  `hold_reason` enum('legal_hold','active_dispute') NULL,
  `restricted_at` datetime(3) NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_feedback_cases` PRIMARY KEY (`id`),
  CONSTRAINT `uk_feedback_cases_external_id` UNIQUE (`external_id`),
  KEY `ix_feedback_cases_user_id_id` (`user_id`, `id`),
  KEY `ix_feedback_cases_closure_request_id` (`closure_request_id`),
  CONSTRAINT `fk_feedback_cases_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_feedback_cases_closure_request`
    FOREIGN KEY (`closure_request_id`) REFERENCES `account_closure_requests` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `ck_feedback_cases_active_or_restricted` CHECK (
    (
      `closure_request_id` IS NULL
      AND `user_id` IS NOT NULL
      AND `message` IS NOT NULL
      AND `restricted_at` IS NULL
    ) OR (
      `closure_request_id` IS NOT NULL
      AND `user_id` IS NULL
      AND `hold_reason` IS NOT NULL
      AND `restricted_at` IS NOT NULL
      AND `message` IS NULL
      AND `context` IS NULL
      AND `user_agent` IS NULL
    )
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
