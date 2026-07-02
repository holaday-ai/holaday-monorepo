-- Partner ledger independent storage foundation.
--
-- Pure additive: creates only partner ledger tables and does not alter
-- existing tables or data.
--
-- Rollback note: drop the tables below in reverse dependency order.

CREATE TABLE `partner_memberships` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `starts_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `source_payment_external_id` VARCHAR(32),
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partner_memberships_external_id` (`external_id`),
  KEY `ix_partner_memberships_user_status` (`user_id`, `status`),
  KEY `ix_partner_memberships_expires_at` (`expires_at`),
  CONSTRAINT `fk_partner_memberships_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `partner_kyc_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'not_started',
  `country` VARCHAR(8) NOT NULL DEFAULT 'CN',
  `real_name_hash` VARCHAR(128),
  `id_number_hash` VARCHAR(128),
  `bank_card_hash` VARCHAR(128),
  `phone_hash` VARCHAR(128),
  `provider` VARCHAR(32),
  `provider_ref` VARCHAR(128),
  `reviewed_at` DATETIME(3),
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partner_kyc_profiles_external_id` (`external_id`),
  UNIQUE KEY `uk_partner_kyc_profiles_user` (`user_id`),
  KEY `ix_partner_kyc_profiles_status` (`status`),
  CONSTRAINT `fk_partner_kyc_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `partner_recharge_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `provider` VARCHAR(24) NOT NULL,
  `provider_order_id` VARCHAR(128),
  `provider_capture_id` VARCHAR(128),
  `amount_cny_cents` INT UNSIGNED NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `order_kind` VARCHAR(32) NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partner_recharge_orders_external_id` (`external_id`),
  UNIQUE KEY `uk_partner_recharge_orders_idempotency_key` (`idempotency_key`),
  UNIQUE KEY `uk_partner_recharge_orders_provider_capture` (`provider`, `provider_capture_id`),
  KEY `ix_partner_recharge_orders_user_status` (`user_id`, `status`),
  CONSTRAINT `fk_partner_recharge_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `partner_lots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `recharge_order_id` BIGINT UNSIGNED,
  `status` VARCHAR(24) NOT NULL DEFAULT 'accumulating',
  `risk_status` VARCHAR(24) NOT NULL DEFAULT 'normal',
  `principal_credit_cents` INT UNSIGNED NOT NULL,
  `tier_multiplier_bps` INT UNSIGNED NOT NULL,
  `api_units` BIGINT UNSIGNED NOT NULL,
  `bonus_cap_credit_cents` INT UNSIGNED NOT NULL,
  `locked_bonus_credit_cents` INT UNSIGNED NOT NULL DEFAULT 0,
  `released_principal_credit_cents` INT UNSIGNED NOT NULL DEFAULT 0,
  `released_bonus_credit_cents` INT UNSIGNED NOT NULL DEFAULT 0,
  `carry_forward_credit_cents` INT UNSIGNED NOT NULL DEFAULT 0,
  `accumulation_starts_at` DATETIME(3) NOT NULL,
  `accumulation_ends_at` DATETIME(3) NOT NULL,
  `release_starts_at` DATETIME(3) NOT NULL,
  `release_ends_at` DATETIME(3) NOT NULL,
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partner_lots_external_id` (`external_id`),
  KEY `ix_partner_lots_user_status` (`user_id`, `status`),
  KEY `ix_partner_lots_release_status` (`release_starts_at`, `status`),
  CONSTRAINT `fk_partner_lots_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_partner_lots_recharge_order` FOREIGN KEY (`recharge_order_id`) REFERENCES `partner_recharge_orders` (`id`) ON DELETE RESTRICT
);

CREATE TABLE `hola_credit_ledger_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `lot_id` BIGINT UNSIGNED,
  `entry_type` VARCHAR(48) NOT NULL,
  `direction` VARCHAR(8) NOT NULL,
  `bucket` VARCHAR(32) NOT NULL,
  `amount_credit_cents` INT UNSIGNED NOT NULL DEFAULT 0,
  `amount_api_units` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `status` VARCHAR(16) NOT NULL DEFAULT 'posted',
  `idempotency_key` VARCHAR(160) NOT NULL,
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_hola_credit_ledger_entries_external_id` (`external_id`),
  UNIQUE KEY `uk_hola_credit_ledger_entries_idempotency_key` (`idempotency_key`),
  KEY `ix_hola_credit_ledger_entries_user_created` (`user_id`, `created_at`),
  KEY `ix_hola_credit_ledger_entries_lot` (`lot_id`),
  CONSTRAINT `fk_hola_credit_ledger_entries_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_hola_credit_ledger_entries_lot` FOREIGN KEY (`lot_id`) REFERENCES `partner_lots` (`id`) ON DELETE SET NULL
);

CREATE TABLE `api_cost_pool_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `event_date` VARCHAR(10) NOT NULL,
  `source` VARCHAR(32) NOT NULL,
  `cost_usd_micros` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `fx_bps` INT UNSIGNED NOT NULL,
  `api_units` BIGINT UNSIGNED NOT NULL,
  `idempotency_key` VARCHAR(160) NOT NULL,
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_api_cost_pool_events_external_id` (`external_id`),
  UNIQUE KEY `uk_api_cost_pool_events_idempotency_key` (`idempotency_key`),
  KEY `ix_api_cost_pool_events_event_date` (`event_date`)
);

CREATE TABLE `partner_withdrawal_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `amount_credit_cents` INT UNSIGNED NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'requested',
  `review_due_at` DATETIME(3) NOT NULL,
  `bank_account_fingerprint` VARCHAR(128) NOT NULL,
  `risk_score` INT UNSIGNED NOT NULL DEFAULT 0,
  `rejection_reason` TEXT,
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partner_withdrawal_requests_external_id` (`external_id`),
  KEY `ix_partner_withdrawal_requests_user_status` (`user_id`, `status`),
  KEY `ix_partner_withdrawal_requests_review_status` (`review_due_at`, `status`),
  CONSTRAINT `fk_partner_withdrawal_requests_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `partner_risk_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `lot_id` BIGINT UNSIGNED,
  `event_type` VARCHAR(48) NOT NULL,
  `severity` VARCHAR(16) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'open',
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partner_risk_events_external_id` (`external_id`),
  KEY `ix_partner_risk_events_user_status` (`user_id`, `status`),
  KEY `ix_partner_risk_events_lot` (`lot_id`),
  CONSTRAINT `fk_partner_risk_events_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_partner_risk_events_lot` FOREIGN KEY (`lot_id`) REFERENCES `partner_lots` (`id`) ON DELETE SET NULL
);

CREATE TABLE `partner_referrals` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `inviter_user_id` BIGINT UNSIGNED NOT NULL,
  `invitee_user_id` BIGINT UNSIGNED NOT NULL,
  `recharge_order_id` BIGINT UNSIGNED,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `reward_credit_cents` INT UNSIGNED NOT NULL DEFAULT 0,
  `reward_rate_bps` INT UNSIGNED NOT NULL DEFAULT 0,
  `assisted` INT UNSIGNED NOT NULL DEFAULT 0,
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partner_referrals_external_id` (`external_id`),
  UNIQUE KEY `uk_partner_referrals_invitee_user` (`invitee_user_id`),
  KEY `ix_partner_referrals_inviter_status` (`inviter_user_id`, `status`),
  CONSTRAINT `fk_partner_referrals_inviter_user` FOREIGN KEY (`inviter_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_partner_referrals_invitee_user` FOREIGN KEY (`invitee_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_partner_referrals_recharge_order` FOREIGN KEY (`recharge_order_id`) REFERENCES `partner_recharge_orders` (`id`) ON DELETE SET NULL
);

CREATE TABLE `partner_daily_allocations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `lot_id` BIGINT UNSIGNED NOT NULL,
  `allocation_date` VARCHAR(10) NOT NULL,
  `locked_bonus_credit_cents` INT UNSIGNED NOT NULL,
  `api_units_weight` BIGINT UNSIGNED NOT NULL,
  `idempotency_key` VARCHAR(160) NOT NULL,
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partner_daily_allocations_external_id` (`external_id`),
  UNIQUE KEY `uk_partner_daily_allocations_idempotency_key` (`idempotency_key`),
  KEY `ix_partner_daily_allocations_lot` (`lot_id`),
  KEY `ix_partner_daily_allocations_date` (`allocation_date`),
  CONSTRAINT `fk_partner_daily_allocations_lot` FOREIGN KEY (`lot_id`) REFERENCES `partner_lots` (`id`) ON DELETE CASCADE
);

CREATE TABLE `partner_monthly_releases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `lot_id` BIGINT UNSIGNED NOT NULL,
  `release_month` VARCHAR(7) NOT NULL,
  `principal_credit_cents` INT UNSIGNED NOT NULL DEFAULT 0,
  `bonus_credit_cents` INT UNSIGNED NOT NULL DEFAULT 0,
  `carry_forward_credit_cents` INT UNSIGNED NOT NULL DEFAULT 0,
  `status` VARCHAR(24) NOT NULL DEFAULT 'posted',
  `idempotency_key` VARCHAR(160) NOT NULL,
  `metadata` JSON,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partner_monthly_releases_external_id` (`external_id`),
  UNIQUE KEY `uk_partner_monthly_releases_idempotency_key` (`idempotency_key`),
  KEY `ix_partner_monthly_releases_lot` (`lot_id`),
  KEY `ix_partner_monthly_releases_month` (`release_month`),
  CONSTRAINT `fk_partner_monthly_releases_lot` FOREIGN KEY (`lot_id`) REFERENCES `partner_lots` (`id`) ON DELETE CASCADE
);
