-- Phase 5d — API keys for webhook / external-trigger access.
--
-- Webhook flow (POST /api/webhooks/tasks):
--   1. Authorization: Bearer hd_live_<...>
--   2. orchestrator SHA-256s the full key
--   3. SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL
--      AND (expires_at IS NULL OR expires_at > NOW())
--   4. stamp last_used_at, run tasks.create as the owning user
--
-- We never persist the plaintext key — only `key_prefix` (first 12
-- chars for SPA display) and `key_hash` (sha256-hex). Revocation is
-- soft-delete (revoked_at != NULL) so the row stays for audit and a
-- replayed request 401s instead of mysteriously succeeding.

CREATE TABLE `api_keys` (
  `id` bigint unsigned PRIMARY KEY AUTO_INCREMENT,
  `external_id` varchar(32) NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `name` varchar(100) NOT NULL,
  `key_prefix` varchar(16) NOT NULL,
  `key_hash` varchar(64) NOT NULL,
  `last_used_at` datetime(3),
  `expires_at` datetime(3),
  `revoked_at` datetime(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `fk_api_keys_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_api_keys_external_id` ON `api_keys` (`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_api_keys_hash` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `ix_api_keys_user` ON `api_keys` (`user_id`);
