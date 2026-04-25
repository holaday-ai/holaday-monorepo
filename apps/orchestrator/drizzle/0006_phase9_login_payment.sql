-- Phase 9 — login + payment.
--
-- Stage 1 (international): adds Google OAuth identity columns,
-- email verification flag, plan expiry, plus two new tables for
-- email-code persistence (audit) and payment records.
--
-- Stage 2 columns (wechat_openid) are intentionally OUT of this
-- migration — they go in a separate migration when WeChat ships.

ALTER TABLE `users` ADD `google_id` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_url` varchar(512);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified` tinyint(1) NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `users` ADD `plan_expires_at` datetime(3);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_users_google_id` ON `users` (`google_id`);--> statement-breakpoint
CREATE INDEX `ix_users_plan_expires_at` ON `users` (`plan_expires_at`);--> statement-breakpoint

CREATE TABLE `verification_codes` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `external_id` varchar(32) NOT NULL,
  `email` varchar(255) NOT NULL,
  `code_hash` varchar(255) NOT NULL,
  `purpose` varchar(32) NOT NULL DEFAULT 'login',
  `attempts` int NOT NULL DEFAULT 0,
  `used_at` datetime(3),
  `expires_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `verification_codes_id` PRIMARY KEY(`id`),
  CONSTRAINT `uk_verification_codes_external_id` UNIQUE(`external_id`)
);--> statement-breakpoint
CREATE INDEX `ix_verification_codes_email_purpose` ON `verification_codes` (`email`,`purpose`);--> statement-breakpoint
CREATE INDEX `ix_verification_codes_expires_at` ON `verification_codes` (`expires_at`);--> statement-breakpoint

CREATE TABLE `payments` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `external_id` varchar(32) NOT NULL,
  `user_external_id` varchar(32) NOT NULL,
  `provider` varchar(16) NOT NULL,
  `provider_order_id` varchar(128),
  `provider_capture_id` varchar(128),
  `plan` varchar(32) NOT NULL,
  `amount_cents` int unsigned NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'USD',
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `metadata` json,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `payments_id` PRIMARY KEY(`id`),
  CONSTRAINT `uk_payments_external_id` UNIQUE(`external_id`)
);--> statement-breakpoint
CREATE INDEX `ix_payments_user_status` ON `payments` (`user_external_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_payments_provider_order` ON `payments` (`provider`,`provider_order_id`);
